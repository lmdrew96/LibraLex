"use client"

import Link from "next/link"
import { Sparkles } from "lucide-react"
import type { BookWithCover } from "@/lib/types"
import { recommendForYou, tasteSourceCount } from "@/lib/recommend"
import { BookCover } from "@/components/book-cover"

// Needs a few rated/read books before taste-based recs mean anything.
const MIN_TASTE_SOURCES = 3

function Header() {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-teal">
      <Sparkles className="h-4 w-4" />
      Recommended for you
    </h2>
  )
}

/** Taste-based picks from your unread + wishlist, each with a plain-language
 *  "because you loved X" reason (no black box). Below the cold-start threshold it
 *  shows a gentle nudge to rate a few books instead. */
export function RecommendedForYou({ books }: { books: BookWithCover[] }) {
  const enoughTaste = tasteSourceCount(books) >= MIN_TASTE_SOURCES

  if (!enoughTaste) {
    return (
      <section>
        <Header />
        <p className="rounded-2xl border border-dashed border-lavender bg-card/60 px-4 py-3 text-sm text-teal">
          Rate a few books you&apos;ve read and I&apos;ll start suggesting what to pick up next —
          with the reason for each pick.
        </p>
      </section>
    )
  }

  const recs = recommendForYou(books, 8)
  if (recs.length === 0) return null

  return (
    <section>
      <Header />
      <ul className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {recs.map(({ book, explanation }) => (
          <li key={book._id} className="w-32 shrink-0 sm:w-36">
            <Link
              href={`/book/${book._id}`}
              className="group flex flex-col gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <div className="transition-transform group-hover:-translate-y-0.5">
                <BookCover
                  coverUrl={book.coverUrl}
                  coverId={book.coverId}
                  coverUrlFallback={book.coverUrlFallback}
                  title={book.title}
                  size="M"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{book.title}</p>
                <p className="line-clamp-2 text-[11px] leading-snug text-teal">{explanation}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
