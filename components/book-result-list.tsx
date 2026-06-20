"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { BookSearchResult } from "@/lib/types"
import { BookCover } from "@/components/book-cover"
import { BookInfoDialog } from "@/components/book-info-dialog"
import { Button } from "@/components/ui/button"

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

/** A tappable list of book search results — each row opens the shared info dialog
 *  with one-tap add actions. Shared by the Search page (title/author typeahead) and
 *  the author page (one author's catalog) so both surfaces behave identically. */
export function BookResultList({ results }: { results: BookSearchResult[] }) {
  return (
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
  )
}

// Footer for the info dialog: a one-tap add onto the shelf or wishlist, so reading
// about a book and keeping it aren't separate trips. Library loans (which need
// checkout dates) stay with the dedicated Add-book flow.
function AddActions({ book }: { book: BookSearchResult }) {
  const addBook = useMutation(api.books.addBook)
  const [busy, setBusy] = useState<"owned" | "wishlist" | "none" | null>(null)
  const [added, setAdded] = useState<"owned" | "wishlist" | "none" | null>(null)

  // "none" = read but not owned, logged as read in one tap (see the books schema's
  // ownership note). Owned/wishlist leave readStatus at its "unread" default.
  const add = async (ownership: "owned" | "wishlist" | "none") => {
    if (busy || added) return
    setBusy(ownership)
    try {
      await addBook({
        ...bookArgs(book),
        ownership,
        readStatus: ownership === "none" ? "read" : undefined,
      })
      setAdded(ownership)
      toast.success(
        ownership === "none"
          ? `Logged “${book.title}” as read.`
          : `Added “${book.title}” to your ${ownership === "owned" ? "shelf" : "wishlist"}.`,
      )
    } catch {
      toast.error(`Couldn't add “${book.title}”. Try again.`)
    } finally {
      setBusy(null)
    }
  }

  if (added) {
    return (
      <p className="text-center text-sm font-medium text-teal">
        {added === "none"
          ? "Logged as read ✓"
          : `Added to your ${added === "owned" ? "shelf" : "wishlist"} ✓`}
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
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
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={busy !== null}
        onClick={() => add("none")}
      >
        I&apos;ve read it
      </Button>
    </div>
  )
}
