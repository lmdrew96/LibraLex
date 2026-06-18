// Shared "add a book, then enrich it once" helper. Used by the add-book dialog
// (search/scan/manual) and by off-shelf picks (friends' shelves, catalog), so a
// book added from any surface lands with the same cached metadata.

import type { Id } from "@/convex/_generated/dataModel"
import type { EnrichedBook } from "@/lib/types"

// The candidate fields addBook + /api/enrich can use. A raw search result and a
// friend's shelf book both satisfy this; subjects are optional (only some sources
// carry them up front).
export type AddCandidate = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  workKey?: string
  firstPublishYear?: number
  pageCount?: number
  subjects?: string[]
}

// Bibliographic args for the addBook mutation. Carries any cached subjects through
// immediately (friend candidates have them); background enrichment fills the rest.
export const bookArgs = (b: AddCandidate) => ({
  title: b.title,
  authors: b.authors,
  isbn: b.isbn,
  coverId: b.coverId,
  coverUrlFallback: b.coverUrlFallback,
  workKey: b.workKey,
  firstPublishYear: b.firstPublishYear,
  pageCount: b.pageCount,
  subjects: b.subjects,
})

export type ApplyEnrichmentArgs = {
  id: Id<"books">
  authors: string[]
  coverId?: number
  coverUrlFallback?: string
  workKey?: string
  firstPublishYear?: number
  pageCount?: number
  description?: string
  categories?: string[]
  subjects?: string[]
  authorBios?: { name: string; bio?: string }[]
  averageRating?: number
  ratingsCount?: number
}

// Enrich-once: after a book lands on the shelf, fetch its full metadata
// (description, subjects, author bios) once and patch it in. Best-effort and
// fire-and-forget — a slow/failed lookup never blocks the add or loses the book.
// Skipped when there's nothing to look up by.
export const enrichInBackground = async (
  id: Id<"books">,
  candidate: AddCandidate,
  apply: (args: ApplyEnrichmentArgs) => Promise<unknown>,
): Promise<void> => {
  if (!candidate.isbn && !candidate.workKey) return
  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    })
    if (!res.ok) return
    const { book } = (await res.json()) as { book: EnrichedBook }
    await apply({
      id,
      authors: book.authors,
      coverId: book.coverId,
      coverUrlFallback: book.coverUrlFallback,
      workKey: book.workKey,
      firstPublishYear: book.firstPublishYear,
      pageCount: book.pageCount,
      description: book.description,
      categories: book.categories,
      subjects: book.subjects,
      authorBios: book.authorBios,
      averageRating: book.averageRating,
      ratingsCount: book.ratingsCount,
    })
  } catch {
    // best-effort enrichment — the book is already saved with its base data
  }
}
