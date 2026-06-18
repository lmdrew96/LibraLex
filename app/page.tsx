"use client"

import { useMemo, useState } from "react"
import { useQuery } from "convex/react"
import { BookMarked } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { ReadStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AppShell } from "@/components/app-shell"
import { AddBookDialog } from "@/components/add-book-dialog"
import { BookGrid, BookGridSkeleton } from "@/components/book-grid"
import { EmptyState } from "@/components/empty-state"
import { DiscoverPicks } from "@/components/discover-picks"
import { FriendPicks } from "@/components/friend-picks"
import { ReadNext } from "@/components/read-next"
import { RecommendedForYou } from "@/components/recommended-for-you"

type Filter = "all" | ReadStatus
type Sort = "added" | "title" | "author"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "reading", label: "Reading" },
  { key: "read", label: "Read" },
]

const SORTS: { key: Sort; label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
]

export default function ShelfPage() {
  const books = useQuery(api.books.listBooks, { ownership: "owned" })
  // Whole library (any shelf) feeds the recommender — taste comes from read books
  // regardless of ownership, candidates from unread owned + wishlist.
  const allBooks = useQuery(api.books.listBooks, {})
  const [filter, setFilter] = useState<Filter>("all")
  const [sort, setSort] = useState<Sort>("added")

  const shown = useMemo(() => {
    if (!books) return []
    const list = filter === "all" ? books : books.filter((b) => b.readStatus === filter)
    if (sort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title))
    if (sort === "author")
      return [...list].sort((a, b) => (a.authors[0] ?? "").localeCompare(b.authors[0] ?? ""))
    return list // "added" — query already returns newest-first
  }, [books, filter, sort])

  return (
    <AppShell>
      {books === undefined ? (
        <BookGridSkeleton />
      ) : books.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title="Your shelf is empty"
          message="Add the books you own and watch your shelf fill up. Search pulls in covers and details automatically."
          action={<AddBookDialog />}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {allBooks && allBooks.length > 0 && (
            <>
              <ReadNext books={allBooks} />
              <RecommendedForYou books={allBooks} />
              <FriendPicks library={allBooks} title="From your friends" layout="carousel" />
              <DiscoverPicks library={allBooks} title="Discover" layout="carousel" eager />
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                    filter === key
                      ? "bg-ink text-surface"
                      : "bg-lavender/50 text-ink hover:bg-lavender",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-teal">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-full border border-lavender bg-card px-3 py-1.5 text-ink focus:border-teal focus:outline-none"
              >
                {SORTS.map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="py-12 text-center text-teal">
              No {filter} books yet.
            </p>
          ) : (
            <BookGrid books={shown} />
          )}
        </div>
      )}
    </AppShell>
  )
}
