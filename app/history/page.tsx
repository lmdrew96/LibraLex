"use client"

import { useState } from "react"
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

type Tab = "reading" | "read"
const TABS: { key: Tab; label: string }[] = [
  { key: "reading", label: "Reading" },
  { key: "read", label: "Read" },
]

const EMPTY: Record<Tab, { title: string; message: string }> = {
  reading: {
    title: "Nothing open right now",
    message: "When you start a book, mark it Reading and it'll show up here — your at-a-glance nightstand.",
  },
  read: {
    title: "No finished books yet",
    message:
      "Mark a book Read — even one you don't own a copy of — and it lands in your history. The more you log, the sharper your recommendations get.",
  },
}

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>("reading")
  // Ownership-agnostic by design: a book you're reading or have read lives on every
  // shelf — owned, borrowed, and "Don't own" reads that aren't in your collection.
  const books = useQuery(api.books.listBooks, { readStatus: tab })

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold">History</h1>
        <p className="mt-1 text-teal">Everything you&apos;re reading and have read — across every shelf.</p>
      </div>

      <div className="mb-5 inline-flex rounded-full border border-lavender bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.key ? "bg-teal text-surface" : "text-ink/70 hover:bg-lavender/50",
            )}
          >
            {t.label}
          </button>
        ))}
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
          title={EMPTY[tab].title}
          message={EMPTY[tab].message}
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
                      coverUrl={book.coverUrl}
                      coverId={book.coverId}
                      coverUrlFallback={book.coverUrlFallback}
                      title={book.title}
                      size="M"
                    />
                  </div>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="font-medium text-ink">{book.title}</p>
                    <p className="text-sm text-teal">{book.authors[0] ?? "Unknown author"}</p>
                    {tab === "reading" && book.startedAt && (
                      <p className="mt-2 text-sm text-teal">
                        Started {formatDistanceToNow(book.startedAt, { addSuffix: true })}
                      </p>
                    )}
                    {tab === "read" && book.finishedAt && (
                      <p className="mt-2 text-sm text-teal">
                        Finished {formatDistanceToNow(book.finishedAt, { addSuffix: true })}
                      </p>
                    )}
                    {tab === "reading" && activeLoan && book.dueDate !== undefined && (
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
