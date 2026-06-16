"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { BookOpen, Search } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookSearchResult } from "@/lib/types"
import { useBookSearch } from "@/lib/use-book-search"
import { AppShell } from "@/components/app-shell"
import { BookCover } from "@/components/book-cover"
import { BookInfoDialog } from "@/components/book-info-dialog"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

// Map a search result onto addBook's bibliographic args (mirrors the add-book flow).
const bookArgs = (b: BookSearchResult) => ({
  title: b.title,
  authors: b.authors,
  isbn: b.isbn,
  coverId: b.coverId,
  coverUrlFallback: b.coverUrlFallback,
  workKey: b.workKey,
  firstPublishYear: b.firstPublishYear,
  pageCount: b.pageCount,
})

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
          Look up any book to read its summary, subjects, and author bios — browse freely, add only what you want.
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

      {!searching && !error && results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((b, i) => (
            <li key={`${b.workKey ?? b.title}-${i}`}>
              <BookInfoDialog
                book={b}
                footer={<AddActions book={b} />}
                trigger={
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-lavender/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
                  >
                    <div className="w-14 shrink-0">
                      <BookCover
                        coverId={b.coverId}
                        coverUrlFallback={b.coverUrlFallback}
                        title={b.title}
                        size="S"
                      />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{b.title}</span>
                      <span className="block truncate text-sm text-teal">
                        {b.authors[0] ?? "Unknown author"}
                        {b.firstPublishYear ? ` · ${b.firstPublishYear}` : ""}
                      </span>
                    </span>
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {showNoMatches && (
        <EmptyState
          icon={Search}
          title="No matches found"
          message="Try a different title or author. Some indie and very new books may not be in the catalog yet."
        />
      )}

      {!typed && !searching && (
        <EmptyState
          icon={BookOpen}
          title="Search for any book"
          message="Type a title or author above to see summaries, subjects, and author bios — no need to add it to a shelf first."
        />
      )}
    </AppShell>
  )
}

// Footer for the info dialog: a one-tap add onto the shelf or wishlist, so reading
// about a book and keeping it aren't separate trips. Library loans (which need
// checkout dates) stay with the dedicated Add-book flow.
function AddActions({ book }: { book: BookSearchResult }) {
  const addBook = useMutation(api.books.addBook)
  const [busy, setBusy] = useState<"owned" | "wishlist" | null>(null)
  const [added, setAdded] = useState<"owned" | "wishlist" | null>(null)

  const add = async (ownership: "owned" | "wishlist") => {
    if (busy || added) return
    setBusy(ownership)
    try {
      await addBook({ ...bookArgs(book), ownership })
      setAdded(ownership)
      toast.success(`Added “${book.title}” to your ${ownership === "owned" ? "shelf" : "wishlist"}.`)
    } catch {
      toast.error(`Couldn't add “${book.title}”. Try again.`)
    } finally {
      setBusy(null)
    }
  }

  if (added) {
    return (
      <p className="text-center text-sm font-medium text-teal">
        Added to your {added === "owned" ? "shelf" : "wishlist"} ✓
      </p>
    )
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="calm"
        size="sm"
        className="flex-1"
        disabled={busy !== null}
        onClick={() => add("owned")}
      >
        I own it
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={busy !== null}
        onClick={() => add("wishlist")}
      >
        Add to wishlist
      </Button>
    </div>
  )
}
