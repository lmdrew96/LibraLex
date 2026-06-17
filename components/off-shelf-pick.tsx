"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { Star } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { FriendEndorsement } from "@/convex/discover"
import { bookArgs, enrichInBackground, type AddCandidate } from "@/lib/enrich-on-add"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"
import { BookInfoDialog } from "@/components/book-info-dialog"
import { FriendAvatar } from "@/components/friend-avatar"
import { Button } from "@/components/ui/button"

// A book that isn't on your shelf yet (a friend's pick, or — in Phase 2 — a catalog
// result), plus the resolved cover URL for any uploaded cover.
export type OffShelfBook = AddCandidate & { coverUrl?: string }

// Order endorsers by signal strength so the lead one fronts the card.
const endorserRank = (e: FriendEndorsement): number =>
  (e.rating ?? 0) * 2 + (e.readStatus === "read" ? 2 : e.readStatus === "reading" ? 1 : 0)

const relationLabel = (e: FriendEndorsement): string =>
  e.rating && e.rating >= 4
    ? "loved it"
    : e.readStatus === "read"
      ? "read it"
      : e.readStatus === "reading"
        ? "is reading it"
        : "has this"

/** A discovery pick: a cover tile that opens the shared book-info dialog with the
 *  endorsers' context and an add-to-shelf action bar. Unlike BookCard it doesn't
 *  link anywhere — the book isn't yours yet, so the tap is "learn more + add". */
export function OffShelfPick({
  book,
  reason,
  endorsers = [],
  layout,
}: {
  book: OffShelfBook
  reason: string
  endorsers?: FriendEndorsement[]
  layout: "carousel" | "grid"
}) {
  const [open, setOpen] = useState(false)
  const lead = endorsers.length
    ? [...endorsers].sort((a, b) => endorserRank(b) - endorserRank(a))[0]
    : null

  const trigger = (
    <button
      type="button"
      aria-label={`More about ${book.title}`}
      className={cn(
        "group flex flex-col gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        layout === "carousel" && "w-32 shrink-0 sm:w-36",
      )}
    >
      <div className="relative transition-transform group-hover:-translate-y-0.5">
        <BookCover
          coverUrl={book.coverUrl}
          coverId={book.coverId}
          coverUrlFallback={book.coverUrlFallback}
          title={book.title}
          size="M"
        />
        {lead && (
          <span className="absolute -bottom-1.5 -right-1.5 rounded-full ring-2 ring-surface">
            <FriendAvatar name={lead.displayName} avatarUrl={lead.avatarUrl} size="sm" />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{book.title}</p>
        <p className="line-clamp-2 text-[11px] leading-snug text-teal">{reason}</p>
      </div>
    </button>
  )

  return (
    <BookInfoDialog
      book={book}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      headerExtra={endorsers.length ? <Endorsers endorsers={endorsers} /> : undefined}
      footer={<AddActions book={book} onAdded={() => setOpen(false)} />}
    />
  )
}

// Each friend's relationship to the book — avatar, what they did with it, their
// rating, and any review — shown in the dialog header.
function Endorsers({ endorsers }: { endorsers: FriendEndorsement[] }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {endorsers.map((e, i) => (
        <div key={`${e.userId}-${i}`} className="flex items-start gap-2">
          <FriendAvatar name={e.displayName} avatarUrl={e.avatarUrl} size="sm" />
          <div className="min-w-0">
            <p className="text-ink">
              <span className="font-medium">{e.displayName}</span>{" "}
              <span className="text-teal">{relationLabel(e)}</span>
            </p>
            {e.rating ? <Stars n={e.rating} /> : null}
            {e.review && (
              <p className="mt-0.5 line-clamp-3 text-xs italic text-teal">“{e.review}”</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Stars({ n }: { n: number }) {
  return (
    <div className="mt-0.5 flex" aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i <= n ? "fill-gold text-gold" : "fill-transparent text-lavender",
          )}
        />
      ))}
    </div>
  )
}

// Add the pick to my shelf or wishlist, then enrich it once in the background —
// the same path the add-book dialog uses. The live friendCandidates query drops
// the book from the carousel as soon as it lands on my shelf.
function AddActions({ book, onAdded }: { book: OffShelfBook; onAdded: () => void }) {
  const addBook = useMutation(api.books.addBook)
  const applyEnrichment = useMutation(api.books.applyEnrichment)
  const [saving, setSaving] = useState(false)

  const add = async (ownership: "owned" | "wishlist") => {
    if (saving) return
    setSaving(true)
    try {
      const id = await addBook({ ...bookArgs(book), ownership })
      toast.success(
        `Added “${book.title}” to your ${ownership === "owned" ? "shelf" : "wishlist"}.`,
      )
      void enrichInBackground(id, book, applyEnrichment)
      onAdded()
    } catch {
      toast.error("Couldn't add that book.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="calm" size="sm" disabled={saving} onClick={() => add("owned")}>
        I own it
      </Button>
      <Button variant="outline" size="sm" disabled={saving} onClick={() => add("wishlist")}>
        Add to wishlist
      </Button>
    </div>
  )
}
