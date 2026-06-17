"use client"

import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import type { BookWithCover } from "@/lib/types"
import { readNext } from "@/lib/recommend"
import { dueLabel } from "@/lib/loans"
import { BookCover } from "@/components/book-cover"

/** The single best thing to pick up next — taste × due-date urgency. One clear
 *  decision at the top of the shelf (low choice-load). Hidden when there's no
 *  signal at all (no taste yet and nothing due). */
export function ReadNext({ books }: { books: BookWithCover[] }) {
  const pick = readNext(books, Date.now())[0]
  if (!pick || pick.score <= 0) return null

  const b = pick.book
  const reasons: string[] = []
  if (pick.urgency > 0 && b.dueDate !== undefined) reasons.push(dueLabel(b.dueDate))
  if (pick.taste > 0.2) reasons.push("right up your alley")
  const reason = reasons.join(" · ") || "next from your shelf"

  return (
    <section aria-label="Read next" className="rounded-3xl border border-lavender bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-teal">
        <Sparkles className="h-4 w-4" />
        Read next
      </div>
      <Link
        href={`/book/${b._id}`}
        className="group flex items-center gap-4 rounded-2xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
      >
        <div className="w-16 shrink-0 sm:w-20">
          <BookCover
            coverUrl={b.coverUrl}
            coverId={b.coverId}
            coverUrlFallback={b.coverUrlFallback}
            title={b.title}
            size="M"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-ink">{b.title}</p>
          <p className="truncate text-sm text-teal">{b.authors[0] ?? "Unknown author"}</p>
          <p className="mt-1 text-sm capitalize text-ink/80">{reason}</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-teal transition-transform group-hover:translate-x-0.5" />
      </Link>
    </section>
  )
}
