import Link from "next/link"
import type { Doc } from "@/convex/_generated/dataModel"
import type { ReadStatus } from "@/lib/types"
import { READ_STATUS_LABELS } from "@/lib/types"
import { dueLabel, loanStatus } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"

const statusDot: Record<ReadStatus, string> = {
  unread: "bg-card ring-1 ring-teal/40",
  reading: "bg-gold",
  read: "bg-green",
}

const dueColor: Record<string, string> = {
  comfortable: "text-teal",
  soon: "text-[var(--color-due-soon)]",
  overdue: "text-[var(--color-overdue)] font-semibold",
}

/** A single cover tile linking to the book's detail page. */
export function BookCard({ book, showDue = false }: { book: Doc<"books">; showDue?: boolean }) {
  const activeLoan = book.dueDate !== undefined && book.returned !== true
  return (
    <Link
      href={`/book/${book._id}`}
      className="group flex flex-col gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <div className="relative transition-transform group-hover:-translate-y-0.5">
        <BookCover
          coverId={book.coverId}
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
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{book.title}</p>
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
