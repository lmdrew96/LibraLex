import type { BookWithCover } from "@/lib/types"
import { Skeleton } from "@/components/ui/skeleton"
import { BookCard } from "@/components/book-card"

/** Responsive cover grid: 2 cols on phones → up to 5 on desktop. */
export function BookGrid({ books, showDue = false }: { books: BookWithCover[]; showDue?: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {books.map((book) => (
        <li key={book._id}>
          <BookCard book={book} showDue={showDue} />
        </li>
      ))}
    </ul>
  )
}

/** Cover-shaped loading skeletons matching the grid (no spinners, no layout shift). */
export function BookGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full" />
          <Skeleton className="h-3.5 w-3/4 rounded" />
          <Skeleton className="h-3 w-1/2 rounded" />
        </li>
      ))}
    </ul>
  )
}
