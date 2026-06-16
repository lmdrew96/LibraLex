"use client"

import Link from "next/link"
import { useQuery } from "convex/react"
import { formatDistanceToNow } from "date-fns"
import { BookOpen } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { dueLabel, loanStatus } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { AppShell } from "@/components/app-shell"
import { AddBookDialog } from "@/components/add-book-dialog"
import { BookCover } from "@/components/book-cover"
import { EmptyState } from "@/components/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

const dueColor: Record<string, string> = {
  comfortable: "text-teal",
  soon: "text-[var(--color-due-soon)]",
  overdue: "text-[var(--color-overdue)] font-semibold",
}

export default function ReadingPage() {
  // "Reading" spans every shelf — owned and borrowed books you're mid-read on.
  const books = useQuery(api.books.listBooks, { readStatus: "reading" })

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold">Currently reading</h1>
        <p className="mt-1 text-teal">Where you left off, across every shelf.</p>
      </div>

      {books === undefined ? (
        <ul className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-4 rounded-[24px] border border-lavender bg-card p-4">
              <Skeleton className="h-28 w-20 shrink-0" />
              <div className="flex-1 space-y-3 pt-1">
                <Skeleton className="h-5 w-2/3 rounded" />
                <Skeleton className="h-4 w-1/3 rounded" />
              </div>
            </li>
          ))}
        </ul>
      ) : books.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Nothing open right now"
          message="When you start a book, mark it as Reading and it'll show up here — your at-a-glance nightstand."
          action={<AddBookDialog />}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {books.map((book) => {
            const activeLoan = book.dueDate !== undefined && book.returned !== true
            return (
              <li key={book._id}>
                <Link
                  href={`/book/${book._id}`}
                  className="flex gap-4 rounded-[24px] border border-lavender bg-card p-4 transition-colors hover:bg-lavender/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                >
                  <div className="w-20 shrink-0">
                    <BookCover
                      coverId={book.coverId}
                      coverUrlFallback={book.coverUrlFallback}
                      title={book.title}
                      size="M"
                    />
                  </div>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="font-medium text-ink">{book.title}</p>
                    <p className="text-sm text-teal">{book.authors[0] ?? "Unknown author"}</p>
                    {book.startedAt && (
                      <p className="mt-2 text-sm text-teal">
                        Started {formatDistanceToNow(book.startedAt, { addSuffix: true })}
                      </p>
                    )}
                    {activeLoan && book.dueDate !== undefined && (
                      <p className={cn("mt-1 text-sm", dueColor[loanStatus(book.dueDate)])}>
                        {dueLabel(book.dueDate)}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </AppShell>
  )
}
