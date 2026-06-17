"use client"

import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { Check, Heart, Trash2 } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookWithCover } from "@/lib/types"
import { AppShell } from "@/components/app-shell"
import { AddBookDialog } from "@/components/add-book-dialog"
import { BookCover } from "@/components/book-cover"
import { BookGridSkeleton } from "@/components/book-grid"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

export default function WishlistPage() {
  const books = useQuery(api.books.listBooks, { ownership: "wishlist" })

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold">Wishlist</h1>
        <p className="mt-1 text-teal">Books you want — one tap away from your shelf.</p>
      </div>

      {books === undefined ? (
        <BookGridSkeleton count={6} />
      ) : books.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Nothing on the wishlist"
          message="Spotted something you want but don't own yet? Add it here — then promote it the day it's yours."
          action={<AddBookDialog />}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {books.map((book) => (
            <li key={book._id}>
              <WishlistCard book={book} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}

function WishlistCard({ book }: { book: BookWithCover }) {
  const updateBook = useMutation(api.books.updateBook)
  const deleteBook = useMutation(api.books.deleteBook)

  const promote = async () => {
    try {
      await updateBook({ id: book._id, patch: { ownership: "owned" } })
      toast.success(`“${book.title}” is on your shelf. Happy reading! 📚`)
    } catch {
      toast.error("Couldn't move it. Try again.")
    }
  }

  const remove = async () => {
    if (!confirm(`Remove “${book.title}” from your wishlist?`)) return
    try {
      await deleteBook({ id: book._id })
      toast.success("Removed from wishlist.")
    } catch {
      toast.error("Couldn't remove it. Try again.")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={`/book/${book._id}`}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <BookCover coverUrl={book.coverUrl} coverId={book.coverId} coverUrlFallback={book.coverUrlFallback} title={book.title} size="M" />
      </Link>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{book.title}</p>
        <p className="truncate text-xs text-teal">{book.authors[0] ?? "Unknown author"}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="primary" className="flex-1" onClick={promote}>
          <Check className="h-4 w-4" />
          I got this
        </Button>
        <button
          onClick={remove}
          aria-label={`Remove ${book.title} from wishlist`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-teal transition-colors hover:bg-lavender focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
