"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useAction, useQuery } from "convex/react"
import { Search, Sparkles } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { CatalogSearchResult } from "@/convex/search"
import type { BookWithCover } from "@/lib/types"
import { bookKey } from "@/lib/book-key"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { Skeleton } from "@/components/ui/skeleton"

/** Free-text "ask for a book" search — embeds the query and matches it against
 *  the broad catalog seeded by convex/catalog.ts (see convex/search.ts), not
 *  any shelf. Explicit submit rather than live-as-you-type — each search is a
 *  real Gemini embedding call. Hits already on your shelf or marked "not
 *  interested" are hidden, like the other discovery rows. */
export function AskForABook({ library }: { library: BookWithCover[] }) {
  const search = useAction(api.search.searchBooksByQuery)
  const dismissed = useQuery(api.discover.dismissedKeys)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(false)
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [results, setResults] = useState<CatalogSearchResult[]>([])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || searching) return
    setSearching(true)
    setError(false)
    try {
      const found = await search({ query: trimmed })
      setResults(found)
      setSearchedFor(trimmed)
    } catch {
      setError(true)
    } finally {
      setSearching(false)
    }
  }

  const excluded = new Set<string>([...library.map(bookKey), ...(dismissed ?? [])])
  const visible = results.filter((r) => !excluded.has(bookKey(r)))

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-teal">
        <Sparkles className="h-4 w-4" />
        Ask for a book
      </h2>
      <p className="-mt-1 mb-3 text-sm text-teal">
        Describe a mood, theme, or vibe, not a title. Looking for a specific book?{" "}
        <Link href="/search" className="font-medium text-ink underline underline-offset-4 hover:text-teal">
          Use Search
        </Link>
        .
      </p>

      <form onSubmit={submit} className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-teal" />
        <input
          type="text"
          aria-label="Describe the kind of book you want"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Something atmospheric and slow…"
          className="h-12 w-full rounded-full border border-lavender bg-card pl-12 pr-24 text-base text-ink placeholder:text-teal/90 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="absolute right-2 top-1/2 h-9 -translate-y-1/2 rounded-full bg-teal px-4 text-sm font-medium text-surface transition-opacity disabled:opacity-40"
        >
          {searching ? "Asking…" : "Ask"}
        </button>
      </form>

      {searching && (
        <ul className="flex gap-4 overflow-x-hidden pb-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="w-32 shrink-0 sm:w-36">
              <Skeleton className="aspect-[2/3] w-full rounded-md" />
              <Skeleton className="mt-2 h-3 w-3/4 rounded" />
            </li>
          ))}
        </ul>
      )}

      {!searching && error && (
        <p className="text-sm text-[var(--color-overdue)]">Couldn’t search right now — try again.</p>
      )}

      {!searching && !error && searchedFor && visible.length === 0 && (
        <p className="text-sm text-teal">
          {results.length === 0
            ? `No catalog matches for “${searchedFor}”.`
            : `Everything that matched “${searchedFor}” is already on your shelves.`}
        </p>
      )}

      {!searching && visible.length > 0 && (
        <ul className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {visible.map((book) => (
            <li key={book.dedupeKey} className="shrink-0">
              <OffShelfPick book={book} reason="Matches your search" layout="carousel" />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
