"use client"

import { useEffect, useState } from "react"
import type { BookInfo } from "@/lib/types"

/** Fetch on-demand book enrichment (summary, subjects, author bios) from
 *  /api/book-info. Re-runs when the identifying fields change; aborts in flight. */
export function useBookInfo({
  workKey,
  title,
  author,
  isbn,
}: {
  workKey?: string
  title: string
  author?: string
  isbn?: string
}): { data: BookInfo | null; loading: boolean } {
  const [data, setData] = useState<BookInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Nothing to look up without at least a work key or a title.
    if (!workKey && !title) {
      setData({ subjects: [], authors: [] })
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setData(null)

    const qs = new URLSearchParams()
    if (workKey) qs.set("workKey", workKey)
    if (title) qs.set("title", title)
    if (author) qs.set("author", author)
    if (isbn) qs.set("isbn", isbn)

    fetch(`/api/book-info?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<BookInfo>) : null))
      .then((d) => {
        if (d) setData(d)
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setData({ subjects: [], authors: [] })
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [workKey, title, author, isbn])

  return { data, loading }
}
