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

/** Fetch catalog discovery candidates for a set of subjects. Re-runs when the
 *  subject set changes; aborts in flight. Empty subjects → empty results, no call. */
export function useDiscover(subjects: string[]): {
  results: DiscoveryCandidate[]
  loading: boolean
} {
  const [results, setResults] = useState<DiscoveryCandidate[]>([])
  const [loading, setLoading] = useState(false)
  // Join into a stable primitive so the effect doesn't re-fire on array identity.
  const key = subjects.join("|")

  useEffect(() => {
    if (subjects.length === 0) {
      setResults([])
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjects }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ results?: DiscoveryCandidate[] }>) : null))
      .then((d) => {
        if (d) setResults(d.results ?? [])
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setResults([])
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
    // subjects is captured via `key`; depending on the array itself would re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { results, loading }
}
