import Link from "next/link"
import type { BookWithCover, ReadStatus } from "@/lib/types"
import { READ_STATUS_LABELS } from "@/lib/types"
import { dueLabel, loanStatus } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"

// Three mutually-distinct dots. Reading (deep violet) and Read (sage green)
// are separated on BOTH hue and luminance (~5.6:1) so they read apart even
// under color-vision deficiency, where luminance is the channel that survives —
// the dark↔light split matters as much as the hue.
const statusDot: Record<ReadStatus, string> = {
  // A teal border gives every dot a ≥3:1 edge (sage "read" alone is ~1.75:1 on
  // light); the fill still carries the state at a glance.
  unread: "bg-card border border-teal",
  reading: "bg-indigo border border-teal",
  read: "bg-green border border-teal",
}

const dueColor: Record<string, string> = {
  comfortable: "text-teal",
  soon: "text-[var(--color-due-soon)]",
  overdue: "text-[var(--color-overdue)] font-semibold",
}

/** A single cover tile linking to the book's detail page. */
export function BookCard({ book, showDue = false }: { book: BookWithCover; showDue?: boolean }) {
  const activeLoan = book.dueDate !== undefined && book.returned !== true
  return (
    <Link
      href={`/book/${book._id}`}
      className="group flex flex-col gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <div className="relative transition-transform group-hover:-translate-y-0.5">
        <BookCover
          coverUrl={book.coverUrl}
          coverUrlFallback={book.coverUrlFallback}
          title={book.title}
          size="M"
        />
        <span
          className={cn(
            "absolute right-1.5 top-1.5 h-3 w-3 rounded-full ring-2 ring-surface",
            statusDot[book.readStatus],
          )}
          title={READ_STATUS_LABELS[book.readStatus]}
          aria-hidden
        />
        <span className="sr-only">{READ_STATUS_LABELS[book.readStatus]}</span>
      </div>
      <div className="min-w-0">
        <p className="font-display truncate text-sm font-medium text-ink">{book.title}</p>
        <p className="truncate text-xs text-teal">{book.authors[0] ?? "Unknown author"}</p>
        {showDue && activeLoan && book.dueDate !== undefined && (
          <p className={cn("mt-0.5 text-xs", dueColor[loanStatus(book.dueDate)])}>
            {dueLabel(book.dueDate)}
          </p>
        )}
      </div>
    </Link>
  )
}
