"use client"

import type { BookWithCover } from "@/lib/types"
import { moreLikeThis } from "@/lib/recommend"
import { BookCard } from "@/components/book-card"

/** Nearest neighbours of the current book by shared subjects/author/era/length.
 *  Content-only — works even with zero ratings. Hidden when nothing is similar. */
export function MoreLikeThis({ bookId, books }: { bookId: string; books: BookWithCover[] }) {
  const similar = moreLikeThis(bookId, books, 5)
  if (similar.length === 0) return null

  return (
    <section className="mt-10 border-t border-lavender pt-6">
      <h2 className="mb-4 text-sm font-semibold text-teal">More like this</h2>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5">
        {similar.map(({ book }) => (
          <li key={book._id}>
            <BookCard book={book} />
          </li>
        ))}
      </ul>
    </section>
  )
}
