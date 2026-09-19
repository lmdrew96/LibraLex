// Shared addBook argument builder for the add-book dialog and off-shelf picks.
// Enrichment (description, subjects, embedding) happens server-side after the
// add — see convex/shelfAdd.ts — so no surface needs to enrich on its own.

// The candidate fields addBook can use. A raw search result and a
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
// immediately (friend candidates have them); server-side enrichment fills the rest.
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
