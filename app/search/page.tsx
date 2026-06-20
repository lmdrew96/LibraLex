"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { useBookSearch } from "@/lib/use-book-search"
import { AppShell } from "@/components/app-shell"
import { BookResultList } from "@/components/book-result-list"
import { GenreBrowse } from "@/components/genre-browse"
import { Skeleton } from "@/components/ui/skeleton"

export default function SearchPage() {
  const [query, setQuery] = useState("")
  const { results, searching, error } = useBookSearch(query)
  const typed = query.trim().length >= 2
  const showNoMatches = typed && !searching && !error && results.length === 0

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Search</h1>
        <p className="mt-1 text-teal">
          Look up any book to read its summary, subjects, and author bios — or browse popular books by genre below.
        </p>
      </div>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-teal" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or author…"
          className="h-12 w-full rounded-full border border-lavender bg-card pl-12 pr-4 text-base text-ink placeholder:text-teal/60 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

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
        <p className="rounded-2xl bg-lavender/40 px-4 py-3 text-sm text-[var(--color-overdue)]">{error}</p>
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
