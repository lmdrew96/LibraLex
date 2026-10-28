"use client"

import Link from "next/link"
import { Search } from "lucide-react"
import { useBookSearch } from "@/lib/use-book-search"
import { AppShell } from "@/components/app-shell"
import { BookResultList } from "@/components/book-result-list"
import { GenreBrowse } from "@/components/genre-browse"
import { Skeleton } from "@/components/ui/skeleton"

export default function SearchPage() {
  const { query, setQuery, submit, submitted, results, searching, error } = useBookSearch()
  const typed = submitted.length >= 2
  const showNoMatches = typed && !searching && !error && results.length === 0

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Search</h1>
        <p className="mt-1 text-teal">
          Look up a specific book by title or author to read its summary — or browse popular books by genre
          below. Want ideas instead?{" "}
          <Link href="/recs" className="font-medium text-ink underline underline-offset-4 hover:text-teal">
            Ask for a book
          </Link>{" "}
          by describing a mood.
        </p>
      </div>

      <form
        role="search"
        className="relative mb-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-teal" />
        <input
          autoFocus
          type="search"
          enterKeyHint="search"
          aria-label="Search books by title or author"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Title or author, then press Enter"
          className="h-12 w-full rounded-full border border-lavender bg-card pl-12 pr-24 text-base text-ink placeholder:text-teal/90 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
        <button
          type="submit"
          className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-teal px-4 text-sm font-medium text-surface transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
        >
          Search
        </button>
      </form>

      {searching && (
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

      {error && !searching && (
        <p className="rounded-2xl border-l-4 border-[var(--color-overdue)] bg-lavender/40 px-4 py-3 text-sm text-ink">{error}</p>
      )}

      {!searching && !error && results.length > 0 && <BookResultList results={results} />}

      {showNoMatches && (
        <p className="rounded-2xl bg-lavender/40 px-4 py-3 text-sm text-teal">
          No matches found. Try a different title or author — some indie and very new books may not be in the catalog yet.
        </p>
      )}

      {/* Resting state (nothing typed): browse popular books by genre. */}
      {!typed && !searching && <GenreBrowse />}
    </AppShell>
  )
}
