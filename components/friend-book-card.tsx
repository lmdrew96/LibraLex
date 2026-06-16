"use client"

import { Star } from "lucide-react"
import type { SharedBook } from "@/convex/shelf"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"
import { BookInfoDialog } from "@/components/book-info-dialog"

/** A book on a friend's shelf. The tile shows cover + their rating; tapping it
 *  opens the info dialog (summary, subjects, author bio, their review + actions). */
export function FriendBookCard({ book }: { book: SharedBook }) {
  return (
    <BookInfoDialog
      book={book}
      trigger={
        <button
          type="button"
          className="group flex w-full flex-col gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <div className="relative transition-transform group-hover:-translate-y-0.5">
            <BookCover
              coverId={book.coverId}
              coverUrlFallback={book.coverUrlFallback}
              title={book.title}
              size="M"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{book.title}</p>
            <p className="truncate text-xs text-teal">
              {book.authors[0] ?? "Unknown author"}
            </p>
            {book.rating !== undefined && (
              <div className="mt-1 flex items-center gap-0.5" aria-label={`${book.rating} of 5 stars`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={cn(
                      "h-3.5 w-3.5",
                      n <= book.rating! ? "fill-gold text-gold" : "fill-transparent text-lavender",
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </button>
      }
    />
  )
}
