"use client"

import { useEffect, useState } from "react"
import type { BookSearchResult } from "@/lib/types"

/** Debounced (~300ms) book search against `/api/search`. Returns the live results
 *  for the current query, a `searching` flag, and a user-facing `error` string.
 *  Queries under 2 characters are treated as empty. Aborts the in-flight request
 *  when the query changes or the consumer unmounts. Shared by the add-book flow
 *  and the standalone search page so both surfaces behave identically. */
export function useBookSearch(query: string): {
  results: BookSearchResult[]
  searching: boolean
  error: string | null
} {
  const [results, setResults] = useState<BookSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
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
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  return { results, searching, error }
}
