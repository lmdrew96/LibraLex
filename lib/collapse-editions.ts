import { groupSameBooks } from "@/convex/bookIdentity"

// Shared edition-collapse: dedupe a list of book-like records down to one entry per
// book, so large-print / audio editions of the same book don't render as separate
// rows. Used on every surface that shows catalog or shelf lists — search results,
// author page, genre carousels, wishlist. "Same book" is the app-wide rule in
// convex/bookIdentity.ts (any shared volume id / ISBN / title + author); this file
// only picks each group's best representative.

export type EditionLike = {
  title: string
  authors: string[]
  workKey?: string
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  coverUrl?: string
  firstPublishYear?: number
  pageCount?: number
  subjects?: string[]
}

// A raw title that names a non-standard edition (large print / audio / abridged) —
// used only to prefer the standard edition as a group's representative.
const isAltEdition = (title: string): boolean =>
  /\blarge print\b|\blarge type\b|\bunabridged\b|\babridged\b|\baudio\s?book\b|\baudio cd\b/.test(
    title.toLowerCase(),
  )

const hasCover = (b: EditionLike): boolean =>
  b.coverId != null || Boolean(b.coverUrlFallback) || Boolean(b.coverUrl)

const metadataCount = (b: EditionLike): number =>
  [b.isbn, b.firstPublishYear, b.pageCount, b.subjects?.length].filter(Boolean).length

// Rank a record as a group's representative: a cover dominates, then richer metadata,
// then a standard (non-large-print/non-audio) edition breaks the remaining ties.
const editionScore = (b: EditionLike): number =>
  (hasCover(b) ? 1000 : 0) + metadataCount(b) * 10 + (isAltEdition(b.title) ? 0 : 5)

/** Group a list into one array per book, best representative first. Group order is
 *  first-seen; ties on score keep first-seen order, so output is deterministic. */
export const groupEditions = <T extends EditionLike>(items: T[]): T[][] =>
  groupSameBooks(items).map((group) =>
    group
      .map((item, i) => ({ item, i }))
      .sort((a, b) => editionScore(b.item) - editionScore(a.item) || a.i - b.i)
      .map(({ item }) => item),
  )

/** Collapse a list to one entry per book, keeping the best representative of each. */
export const collapseEditions = <T extends EditionLike>(items: T[]): T[] =>
  groupEditions(items).map((group) => group[0])
