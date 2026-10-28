"use client"

import { useEffect, useState } from "react"
import type { BookSearchResult } from "@/lib/types"

/** Book search against `/api/search` that fires only on submit (Enter or the
 *  Search button) — typing makes no requests, which keeps Google quota for real
 *  searches. Owns the typed `query` and the last `submitted` query; clearing the
 *  box clears the results. Re-submitting the same query doesn't refetch.
 *  Queries under 2 characters are ignored. Aborts the in-flight request when a
 *  new query is submitted or the consumer unmounts. Shared by the add-book flow
 *  and the standalone search page so both surfaces behave identically. */
export function useBookSearch(): {
  query: string
  setQuery: (v: string) => void
  submit: () => void
  submitted: string
  results: BookSearchResult[]
  searching: boolean
  error: string | null
} {
  const [query, setQueryState] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [results, setResults] = useState<BookSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setQuery = (v: string): void => {
    setQueryState(v)
    if (!v.trim()) setSubmitted("")
  }

  const submit = (): void => {
    const q = query.trim()
    if (q.length >= 2) setSubmitted(q)
  }

  useEffect(() => {
    if (submitted.length < 2) {
      setResults([])
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(submitted)}`, {
          signal: ctrl.signal,
        })
        const data = (await res.json()) as { results?: BookSearchResult[]; error?: string }
        if (!res.ok) {
          setResults([])
          setError(data.error ?? "Search is unavailable right now.")
        } else {
          setResults(data.results ?? [])
          setError(null)
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError("Search failed. Check your connection.")
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    })()
    return () => ctrl.abort()
  }, [submitted])

  return { query, setQuery, submit, submitted, results, searching, error }
}
