"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Search, UserRound } from "lucide-react"
import type { BookSearchResult } from "@/lib/types"
import { AppShell } from "@/components/app-shell"
import { BookResultList } from "@/components/book-result-list"
import { EmptyState } from "@/components/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

/** One author's catalog — reached by tapping an author's name on a book page.
 *  Fetches their works from Open Library (popular first) and renders the same
 *  tappable result list the Search page uses, so adding from here is identical. */
export default function AuthorPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)
  const author = decodeURIComponent(name)
  const router = useRouter()

  // null = still loading; [] = loaded but empty (or errored). Keeps the three
  // states (loading / results / nothing) unambiguous.
  const [results, setResults] = useState<BookSearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setResults(null)
    setError(null)
    fetch(`/api/search?author=${encodeURIComponent(author)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const data = (await res.json()) as { results?: BookSearchResult[]; error?: string }
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this author right now.")
          setResults([])
        } else {
          setResults(data.results ?? [])
          setError(null)
        }
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError("Couldn't load this author. Check your connection.")
          setResults([])
        }
      })
    return () => ctrl.abort()
  }, [author])

  const loading = results === null

  return (
    <AppShell>
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-teal hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6">
        <p className="flex items-center gap-1.5 text-sm font-medium text-teal">
          <UserRound className="h-4 w-4" />
          Author
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{author}</h1>
        <p className="mt-1 text-teal">
          More of their work — tap any title to read about it or add it to a shelf.
        </p>
      </div>

      {loading && (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-20 w-14 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && !loading && (
        <p className="rounded-2xl bg-lavender/40 px-4 py-3 text-sm text-[var(--color-overdue)]">
          {error}
        </p>
      )}

      {!loading && !error && results.length > 0 && <BookResultList results={results} />}

      {!loading && !error && results.length === 0 && (
        <EmptyState
          icon={Search}
          title="No other titles found"
          message="The catalog doesn't list more work under this exact name. Some authors appear under name variants or aren't fully indexed yet."
        />
      )}
    </AppShell>
  )
}
