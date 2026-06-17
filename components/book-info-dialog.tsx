"use client"

import { type ReactNode, useState } from "react"
import { useBookInfo } from "@/lib/use-book-info"
import { BookCover } from "@/components/book-cover"
import { BookInfo } from "@/components/book-info"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// The minimal book shape this dialog needs. SharedBook, Doc<"recommendations">,
// and Doc<"books"> all structurally satisfy it, so any of them can be passed.
export type BookInfoSubject = {
  title: string
  authors: string[]
  workKey?: string
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  coverUrl?: string
  firstPublishYear?: number
  pageCount?: number
}

/** Reusable book-info dialog: cover + summary + subjects + author bios, fetched
 *  lazily on open. Callers drop in context via the optional slots — `headerExtra`
 *  (beside the cover, e.g. a friend's rating/review) and `footer` (an action bar).
 *  With no headerExtra it falls back to the book's own publication meta. */
export function BookInfoDialog({
  book,
  trigger,
  headerExtra,
  footer,
}: {
  book: BookInfoSubject
  trigger: ReactNode
  headerExtra?: ReactNode
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)

  const { data, loading } = useBookInfo({
    workKey: open ? book.workKey : undefined,
    title: open ? book.title : "",
    author: open ? book.authors[0] : undefined,
    isbn: open ? book.isbn : undefined,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <div className="border-b border-lavender px-6 pb-4 pr-12 pt-6">
          <DialogTitle>{book.title}</DialogTitle>
          <DialogDescription className="mt-1">
            {book.authors.join(", ") || "Unknown author"}
            {book.firstPublishYear ? ` · ${book.firstPublishYear}` : ""}
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex gap-4">
            <div className="w-24 shrink-0">
              <BookCover
                coverUrl={book.coverUrl}
                coverId={book.coverId}
                coverUrlFallback={book.coverUrlFallback}
                title={book.title}
                size="M"
              />
            </div>
            <div className="min-w-0 flex-1">{headerExtra ?? <DefaultMeta book={book} />}</div>
          </div>

          <div className="mt-5 border-t border-lavender pt-5">
            <BookInfo data={data} loading={loading} />
          </div>
        </div>

        {footer && <div className="border-t border-lavender px-6 py-4">{footer}</div>}
      </DialogContent>
    </Dialog>
  )
}

// Fallback header content when a caller has no richer context to show.
function DefaultMeta({ book }: { book: BookInfoSubject }) {
  const bits: string[] = []
  if (book.firstPublishYear) bits.push(String(book.firstPublishYear))
  if (book.pageCount) bits.push(`${book.pageCount} pages`)
  return (
    <div className="flex flex-col gap-1 text-sm text-teal">
      {bits.length > 0 && <span>{bits.join(" · ")}</span>}
      {book.isbn && <span className="font-mono text-xs">ISBN {book.isbn}</span>}
    </div>
  )
}
