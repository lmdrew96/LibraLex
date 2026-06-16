import { Star } from "lucide-react"
import type { SharedBook } from "@/convex/shelf"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"

/** Read-only book tile for a friend's shelf — surfaces their rating + review,
 *  the social payoff. Not a link: a friend's book has no owner-editable page. */
export function FriendBookCard({ book }: { book: SharedBook }) {
  return (
    <div className="flex flex-col gap-2">
      <BookCover
        coverId={book.coverId}
        coverUrlFallback={book.coverUrlFallback}
        title={book.title}
        size="M"
      />
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
        {book.review && (
          <p className="mt-1 line-clamp-2 text-xs italic text-teal/80">
            “{book.review}”
          </p>
        )}
      </div>
    </div>
  )
}
