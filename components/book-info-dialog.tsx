"use client"

import { type ReactNode, useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { Check, Heart, Share2, Star } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { SharedBook } from "@/convex/shelf"
import { cn } from "@/lib/utils"
import { useBookInfo } from "@/lib/use-book-info"
import { BookCover } from "@/components/book-cover"
import { BookInfo } from "@/components/book-info"
import { RecommendDialog } from "@/components/recommend-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/** Opened from a friend's shelf tile. Shows the book's summary/subjects/author
 *  bios, the friend's own rating + review, and lets you act on the find. */
export function BookInfoDialog({
  book,
  trigger,
}: {
  book: SharedBook
  trigger: ReactNode
}) {
  const addBook = useMutation(api.books.addBook)
  const [open, setOpen] = useState(false)
  const [wished, setWished] = useState(false)
  const [adding, setAdding] = useState(false)

  // Lazy: only fetch enrichment once the dialog is actually open.
  const { data, loading } = useBookInfo({
    workKey: open ? book.workKey : undefined,
    title: open ? book.title : "",
    author: open ? book.authors[0] : undefined,
  })

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <div className="border-b border-lavender px-6 pb-4 pt-6 pr-12">
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
                coverId={book.coverId}
                coverUrlFallback={book.coverUrlFallback}
                title={book.title}
                size="M"
              />
            </div>
            <div className="min-w-0 flex-1">
              {book.rating !== undefined && (
                <div className="flex items-center gap-0.5" aria-label={`Their rating: ${book.rating} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={cn(
                        "h-4 w-4",
                        n <= book.rating! ? "fill-gold text-gold" : "fill-transparent text-lavender",
                      )}
                    />
                  ))}
                </div>
              )}
              {book.review ? (
                <p className="mt-2 rounded-2xl bg-lavender/40 px-3 py-2 text-sm italic text-ink">
                  “{book.review}”
                </p>
              ) : (
                book.rating === undefined && (
                  <p className="text-sm text-teal/70">No rating or review yet.</p>
                )
              )}
            </div>
          </div>

          <div className="mt-5 border-t border-lavender pt-5">
            <BookInfo data={data} loading={loading} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-lavender px-6 py-4">
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
      </DialogContent>
    </Dialog>
  )
}
