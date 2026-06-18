"use client"

import { use, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { format } from "date-fns"
import { ArrowLeft, ImagePlus, Loader2, RefreshCw, Share2, Star, Trash2 } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { BookInfo as BookInfoData, BookWithCover, EnrichedBook, Ownership, ReadStatus } from "@/lib/types"
import { OWNERSHIP_LABELS, READ_STATUS_LABELS } from "@/lib/types"
import { dueLabel, loanStatus } from "@/lib/loans"
import { useBookInfo } from "@/lib/use-book-info"
import { cn } from "@/lib/utils"
import { AppShell } from "@/components/app-shell"
import { BookCover } from "@/components/book-cover"
import { BookInfo } from "@/components/book-info"
import { DiscoverPicks } from "@/components/discover-picks"
import { FriendPicks } from "@/components/friend-picks"
import { MoreLikeThis } from "@/components/more-like-this"
import { RatingsSummary } from "@/components/ratings-summary"
import { RecommendDialog } from "@/components/recommend-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const READ_STATUSES: ReadStatus[] = ["unread", "reading", "read"]
const OWNERSHIPS: Ownership[] = ["owned", "wishlist", "library", "none"]

const dueColor: Record<string, string> = {
  comfortable: "text-teal",
  soon: "text-[var(--color-due-soon)]",
  overdue: "text-[var(--color-overdue)] font-semibold",
}

export default function BookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const book = useQuery(api.books.getBook, { id: id as Id<"books"> })
  // Whole library for the "More like this" nearest-neighbour comparison.
  const allBooks = useQuery(api.books.listBooks, {})
  // Anonymous cross-user average for this title — keyed by the same identity the
  // recommender dedupes on. Skips until the book (its workKey/isbn) has loaded.
  const community = useQuery(
    api.books.communityRating,
    book ? { workKey: book.workKey, isbn: book.isbn } : "skip",
  )

  const updateBook = useMutation(api.books.updateBook)
  const checkoutBook = useMutation(api.books.checkoutBook)
  const deleteBook = useMutation(api.books.deleteBook)
  const applyEnrichment = useMutation(api.books.applyEnrichment)
  const router = useRouter()

  const [review, setReview] = useState<string | null>(null)
  const [refetching, setRefetching] = useState(false)

  // Prefer the cached enrichment (zero external calls). Fall back to an on-demand
  // fetch only when those fields aren't populated yet — an older record before the
  // backfill, or a just-added book still mid-enrich. The hook no-ops on an empty
  // title, so a cached book makes no request.
  const hasCachedInfo = Boolean(book?.description || book?.subjects?.length || book?.authorBios?.length)
  const { data: fetchedInfo, loading: fetchedLoading } = useBookInfo({
    workKey: hasCachedInfo ? undefined : book?.workKey,
    title: hasCachedInfo ? "" : (book?.title ?? ""),
    author: hasCachedInfo ? undefined : book?.authors?.[0],
    isbn: hasCachedInfo ? undefined : book?.isbn,
  })

  // Re-fetch metadata on demand: re-run the enrich pipeline for this book and
  // patch the fresh result in. The only path that hits external sources from the
  // detail view — normal opens read the cached fields below with zero calls.
  const refetchMetadata = async () => {
    if (!book || refetching) return
    setRefetching(true)
    try {
      const candidate: EnrichedBook = {
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        coverId: book.coverId,
        coverUrlFallback: book.coverUrlFallback,
        workKey: book.workKey,
        firstPublishYear: book.firstPublishYear,
        pageCount: book.pageCount,
      }
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      })
      if (!res.ok) throw new Error("enrich failed")
      const { book: enriched } = (await res.json()) as { book: EnrichedBook }
      await applyEnrichment({
        id: book._id,
        authors: enriched.authors,
        coverId: enriched.coverId,
        coverUrlFallback: enriched.coverUrlFallback,
        workKey: enriched.workKey,
        firstPublishYear: enriched.firstPublishYear,
        pageCount: enriched.pageCount,
        description: enriched.description,
        categories: enriched.categories,
        subjects: enriched.subjects,
        authorBios: enriched.authorBios,
        averageRating: enriched.averageRating,
        ratingsCount: enriched.ratingsCount,
      })
      toast.success("Metadata refreshed.")
    } catch {
      toast.error("Couldn't refresh metadata.")
    } finally {
      setRefetching(false)
    }
  }

  if (book === undefined) {
    return (
      <AppShell>
        <div className="flex flex-col gap-6 sm:flex-row">
          <Skeleton className="aspect-[2/3] w-44 shrink-0" />
          <div className="flex-1 space-y-4 pt-2">
            <Skeleton className="h-8 w-2/3 rounded" />
            <Skeleton className="h-5 w-1/3 rounded" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      </AppShell>
    )
  }

  if (book === null) {
    return (
      <AppShell>
        <div className="py-16 text-center">
          <p className="text-teal">This book isn&apos;t here anymore.</p>
          <Link href="/" className="mt-3 inline-block font-medium text-teal underline">
            Back to your shelf
          </Link>
        </div>
      </AppShell>
    )
  }

  const activeLoan = book.ownership === "library" && book.dueDate !== undefined && book.returned !== true
  const reviewValue = review ?? book.review ?? ""

  const setStatus = async (status: ReadStatus) => {
    if (status === book.readStatus) return
    try {
      await updateBook({ id: book._id, patch: { readStatus: status } })
      toast.success(`Marked ${READ_STATUS_LABELS[status].toLowerCase()}.`)
    } catch {
      toast.error("Couldn't update status.")
    }
  }

  const setRating = async (n: number) => {
    try {
      await updateBook({ id: book._id, patch: { rating: n } })
    } catch {
      toast.error("Couldn't save rating.")
    }
  }

  const saveReview = async () => {
    if (reviewValue === (book.review ?? "")) return
    try {
      await updateBook({ id: book._id, patch: { review: reviewValue } })
      toast.success("Review saved.")
    } catch {
      toast.error("Couldn't save review.")
    }
  }

  const changeOwnership = async (next: Ownership) => {
    if (next === book.ownership) return
    try {
      if (next === "library") {
        await checkoutBook({ id: book._id })
        toast.success("Moved to library loans — due in 3 weeks. Adjust on the Loans tab.")
      } else if (next === "none") {
        await updateBook({ id: book._id, patch: { ownership: next } })
        toast.success("Marked as read but not owned.")
      } else {
        await updateBook({ id: book._id, patch: { ownership: next } })
        toast.success(`Moved to ${OWNERSHIP_LABELS[next].toLowerCase()}.`)
      }
    } catch {
      toast.error("Couldn't change shelf.")
    }
  }

  const remove = async () => {
    if (!confirm(`Delete “${book.title}” from your library? This can't be undone.`)) return
    try {
      await deleteBook({ id: book._id })
      toast.success("Deleted.")
      router.push("/")
    } catch {
      toast.error("Couldn't delete it.")
    }
  }

  return (
    <AppShell>
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1 text-sm text-teal hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <div className="mx-auto w-44 shrink-0 sm:mx-0">
          <BookCover
            coverUrl={book.coverUrl}
            coverId={book.coverId}
            coverUrlFallback={book.coverUrlFallback}
            title={book.title}
            size="L"
          />
          <CoverControls book={book} />
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold">{book.title}</h1>
          <p className="mt-1 text-lg text-teal">{book.authors.join(", ") || "Unknown author"}</p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-teal">
            {book.firstPublishYear && <span>{book.firstPublishYear}</span>}
            {book.pageCount && <span>{book.pageCount} pages</span>}
            {book.isbn && <span className="font-mono text-xs">ISBN {book.isbn}</span>}
          </div>

          <RatingsSummary
            googleAverage={book.averageRating}
            googleCount={book.ratingsCount}
            communityAverage={community?.average}
            communityCount={community?.count}
          />

          <div className="mt-4">
            <RecommendDialog
              book={book}
              trigger={
                <Button variant="outline" size="sm">
                  <Share2 className="h-4 w-4" />
                  Recommend to a friend
                </Button>
              }
            />
          </div>

          {activeLoan && book.dueDate !== undefined && (
            <p className={cn("mt-3 text-sm", dueColor[loanStatus(book.dueDate)])}>
              On loan · {dueLabel(book.dueDate)} (due {format(book.dueDate, "MMM d, yyyy")})
            </p>
          )}

          {/* Read status */}
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-teal">Status</h2>
            <Segmented
              options={READ_STATUSES.map((s) => ({ value: s, label: READ_STATUS_LABELS[s] }))}
              value={book.readStatus}
              onChange={(v) => setStatus(v as ReadStatus)}
            />
          </section>

          {/* Rating */}
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold text-teal">Your rating</h2>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                  className="rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50"
                >
                  <Star
                    className={cn(
                      "h-7 w-7 transition-colors",
                      book.rating && n <= book.rating
                        ? "fill-gold text-gold"
                        : "fill-transparent text-lavender",
                    )}
                  />
                </button>
              ))}
            </div>
          </section>

          {/* Review */}
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold text-teal">Review</h2>
            <textarea
              value={reviewValue}
              onChange={(e) => setReview(e.target.value)}
              onBlur={saveReview}
              placeholder="A few words for future you…"
              rows={4}
              className="w-full rounded-2xl border border-lavender bg-card p-3 text-ink placeholder:text-teal/50 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20"
            />
            <p className="mt-1 text-xs text-teal/90">Saves when you click away.</p>
          </section>

          {/* Ownership */}
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold text-teal">Shelf</h2>
            <Segmented
              options={OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))}
              value={book.ownership}
              onChange={(v) => changeOwnership(v as Ownership)}
            />
          </section>

          {/* Delete */}
          <section className="mt-8 border-t border-lavender pt-5">
            <Button variant="danger" size="sm" onClick={remove}>
              <Trash2 className="h-4 w-4" />
              Delete book
            </Button>
          </section>
        </div>
      </div>

      {/* Summary, subjects, author bios — full width below the main panel.
          Read straight from the cached record (no external call on open). */}
      <section className="mt-10 border-t border-lavender pt-6">
        <div className="mb-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={refetchMetadata} disabled={refetching}>
            {refetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Re-fetch metadata
          </Button>
        </div>
        <BookInfo
          data={
            hasCachedInfo
              ? ({
                  description: book.description,
                  subjects: book.subjects ?? [],
                  authors: book.authorBios ?? [],
                } satisfies BookInfoData)
              : fetchedInfo
          }
          loading={hasCachedInfo ? false : fetchedLoading}
        />
      </section>

      <MoreLikeThis bookId={book._id} books={allBooks ?? []} />
      <FriendPicks
        library={allBooks ?? []}
        target={book}
        title="On your friends' shelves"
        layout="grid"
      />
      <DiscoverPicks
        library={allBooks ?? []}
        target={book}
        title="More to discover"
        layout="grid"
      />
    </AppShell>
  )
}

// Optional user-uploaded cover. Picks an image, POSTs it to a Convex upload URL,
// then attaches the returned storageId to the book. The live query swaps the
// cover in automatically. "Remove" reverts to the auto-fetched cover.
const MAX_COVER_BYTES = 5 * 1024 * 1024 // 5 MB

function CoverControls({ book }: { book: BookWithCover }) {
  const generateUploadUrl = useMutation(api.books.generateCoverUploadUrl)
  const setBookCover = useMutation(api.books.setBookCover)
  const removeBookCover = useMutation(api.books.removeBookCover)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const hasCustom = book.coverStorageId !== undefined

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // let the user re-pick the same file later
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.")
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      toast.error("That image is over 5 MB — pick a smaller one.")
      return
    }
    setBusy(true)
    try {
      const uploadUrl = await generateUploadUrl()
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      })
      if (!res.ok) throw new Error("upload failed")
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> }
      await setBookCover({ id: book._id, storageId })
      toast.success("Cover updated.")
    } catch {
      toast.error("Couldn't upload that cover. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async () => {
    setBusy(true)
    try {
      await removeBookCover({ id: book._id })
      toast.success("Reverted to the default cover.")
    } catch {
      toast.error("Couldn't remove the cover.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPick} />
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className="h-4 w-4" />
        {busy ? "Uploading…" : hasCustom ? "Replace cover" : "Upload cover"}
      </Button>
      {hasCustom && !busy && (
        <button onClick={onRemove} className="text-xs text-teal hover:underline">
          Remove custom cover
        </button>
      )}
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex rounded-full border border-lavender bg-card p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            value === opt.value ? "bg-teal text-surface" : "text-ink/70 hover:bg-lavender/50",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
