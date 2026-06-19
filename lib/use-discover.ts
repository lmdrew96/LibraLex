"use client"

import { useEffect, useState } from "react"

/** A catalog candidate from Open Library's subjects endpoint (`/api/discover`).
 *  Carries the work key + rich subjects the recommender scores; no ISBN (the
 *  subjects endpoint doesn't expose one — background enrichment fills the rest on
 *  add). Satisfies AddCandidate, so it flows straight into the add+enrich path. */
export type DiscoveryCandidate = {
  workKey: string
  title: string
  authors: string[]
  coverId?: number
  firstPublishYear?: number
  subjects?: string[]
}

// Cap on-demand pagination so a row that can never fill (very narrow taste) doesn't
// fan out unbounded slow OL calls. Page 0 is the popular head; pages 1..MAX backfill.
const MAX_PAGE = 4

/** Fetch catalog discovery candidates for a set of subjects, with on-demand
 *  pagination. Re-runs from page 0 when the subject set changes; `loadMore()` pulls
 *  the next page and appends genuinely new titles (deduped by work key), so a
 *  dismissed pick can be backfilled from a deeper pool instead of leaving a gap.
 *  `exhausted` flips true once a page brings nothing new or the cap is reached. */
export function useDiscover(subjects: string[]): {
  results: DiscoveryCandidate[]
  loading: boolean
  loadMore: () => void
  exhausted: boolean
} {
  const [results, setResults] = useState<DiscoveryCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [exhausted, setExhausted] = useState(false)
  // Join into a stable primitive so the effect doesn't re-fire on array identity.
  const key = subjects.join("|")

  // Reset to page 0 the instant the subject set changes — React's "adjust state
  // during render" pattern. Runs before the fetch effect, so page-0 results replace
  // the old subjects' results with no effect-ordering race.
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    setPage(0)
    setResults([])
    setExhausted(false)
  }

  const loadMore = (): void => {
    if (loading || exhausted || subjects.length === 0) return
    if (page >= MAX_PAGE) {
      setExhausted(true)
      return
    }
    setPage((p) => p + 1)
  }

  useEffect(() => {
    if (subjects.length === 0) {
      setResults([])
      setLoading(false)
      setExhausted(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjects, page }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ results?: DiscoveryCandidate[] }>) : null))
      .then((d) => {
        if (!d) return
        const incoming = d.results ?? []
        // A page that brings nothing means the catalog is tapped out for these
        // subjects — stop here so loadMore() no-ops.
        if (incoming.length === 0) {
          setExhausted(true)
          if (page === 0) setResults([])
          return
        }
        setResults((prev) => {
          if (page === 0) return incoming
          const seen = new Set(prev.map((c) => c.workKey))
          const fresh = incoming.filter((c) => !seen.has(c.workKey))
          return fresh.length ? [...prev, ...fresh] : prev
        })
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError") && page === 0) {
          setResults([])
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
    // subjects is captured via `key`; `page` drives pagination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page])

  return { results, loading, loadMore, exhausted }
}
