"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { Check, Heart, Share2, Star } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { SharedBook } from "@/convex/shelf"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"
import { BookInfoDialog } from "@/components/book-info-dialog"
import { RecommendDialog } from "@/components/recommend-dialog"
import { Button } from "@/components/ui/button"

/** A book on a friend's shelf. The tile shows cover + their rating; tapping it
 *  opens the shared info dialog, with their full review and the act-on-it
 *  buttons supplied as the dialog's header/footer slots. */
export function FriendBookCard({ book }: { book: SharedBook }) {
  return (
    <BookInfoDialog
      book={book}
      headerExtra={<FriendTake book={book} />}
      footer={<FriendActions book={book} />}
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
            {book.rating !== undefined && <Stars rating={book.rating} className="mt-1 h-3.5 w-3.5" />}
          </div>
        </button>
      }
    />
  )
}

// The friend's take, shown beside the cover in the dialog header.
function FriendTake({ book }: { book: SharedBook }) {
  if (book.rating === undefined && !book.review) {
    return <p className="text-sm text-teal/90">No rating or review yet.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {book.rating !== undefined && <Stars rating={book.rating} className="h-4 w-4" />}
      {book.review && (
        <p className="rounded-2xl bg-lavender/40 px-3 py-2 text-sm italic text-ink">
          “{book.review}”
        </p>
      )}
    </div>
  )
}

// Pull a friend's book onto your own wishlist, or pass it along to another friend.
function FriendActions({ book }: { book: SharedBook }) {
  const addBook = useMutation(api.books.addBook)
  const [wished, setWished] = useState(false)
  const [adding, setAdding] = useState(false)

  const wantToRead = async () => {
    if (wished || adding) return
    setAdding(true)
    try {
      await addBook({
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        coverId: book.coverId,
        coverUrlFallback: book.coverUrlFallback,
        workKey: book.workKey,
        firstPublishYear: book.firstPublishYear,
        pageCount: book.pageCount,
        ownership: "wishlist",
      })
      setWished(true)
      toast.success(`Added “${book.title}” to your wishlist.`)
    } catch {
      toast.error("Couldn't add that to your wishlist.")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant={wished ? "calm" : "primary"}
        className="flex-1"
        disabled={wished || adding}
        onClick={wantToRead}
      >
        {wished ? <Check className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
        {wished ? "On your wishlist" : "Want to read"}
      </Button>
      <RecommendDialog
        book={book}
        trigger={
          <Button variant="outline" className="flex-1">
            <Share2 className="h-4 w-4" />
            Recommend
          </Button>
        }
      />
    </div>
  )
}

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            n <= rating ? "fill-gold text-gold" : "fill-transparent text-lavender",
            className,
          )}
        />
      ))}
    </div>
  )
}
