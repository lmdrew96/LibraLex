import { normalizeAuthors, normalizeSubjects, sanitizeYear } from "./normalize"
import { fetchVolumeByIsbn, fetchVolumeByTitleAuthor } from "./googleBooks"

/** A fully enriched, cacheable book record — search-result fields plus the merged
 *  enrichment (description/categories/subjects) written to Convex so the detail
 *  view renders with no external calls. Defined here (the engine) and re-exported
 *  from lib/types for the frontend; self-contained so this module imports nothing
 *  outside convex/ (keeps the Convex bundler happy). */
export type EnrichedBook = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number // DEPRECATED — legacy Open Library cover_i; never written here
  coverUrlFallback?: string
  firstPublishYear?: number
  pageCount?: number
  workKey?: string
  description?: string
  categories?: string[]
  subjects?: string[]
  averageRating?: number // Google Books community average (0–5)
  ratingsCount?: number // number of Google Books ratings behind that average
  embedding?: number[] // Gemini vector (see convex/embed.ts) — not set by enrichBook itself
}

// The enrich-once engine. A single Google Books ISBN lookup supplies everything —
// biblio, cover, description, categories — normalized into one record. Runs
// server-side (convex/shelfAdd.ts enrichBookById — on add and on re-fetch) so the result can be
// cached on the Convex book record — after which the detail view needs zero
// external calls. The Convex backfill reuses enrichBook directly.

// Google Books lists only the writer for comics/graphic novels (drops the
// artist), so author overwrite is suppressed for these — see enrichBook.
const isComicCategory = (categories: string[]): boolean =>
  categories.some((c) => /comics|graphic novel|manga/i.test(c))

// The first non-empty value wins, in order. `undefined`/empty arrays are skipped.
const firstOf = <T>(...vals: (T | undefined)[]): T | undefined =>
  vals.find((v) => v !== undefined && !(Array.isArray(v) && v.length === 0))

/**
 * Enrich a picked candidate into a complete, normalized, cacheable record.
 * `candidate` carries whatever the search/scan already knew (title, isbn,
 * workKey, and provisional authors/year/cover); this fills the gaps with a
 * Google Books ISBN lookup. Pure-degrades: with no ISBN it just normalizes and
 * returns the candidate, so manual adds still work.
 */
export const enrichBook = async (candidate: EnrichedBook): Promise<EnrichedBook> => {
  const isbn = candidate.isbn
  // ISBN-exact first; without an ISBN (or when it misses — a mismatched/unindexed
  // edition code), fall back to a title+author search. Without this, any book
  // that was catalogued pre-Google-Books-migration (matched by title/author, no
  // ISBN stored) can never get a cover or other enrichment.
  const gb =
    (isbn ? await fetchVolumeByIsbn(isbn) : null) ??
    (await fetchVolumeByTitleAuthor(candidate.title, candidate.authors[0], { langRestrict: "en" }))

  // Authors: GB wins for prose; for comics GB drops the artist, so keep whatever
  // the candidate already carried. Always run the normalizer.
  const gbAuthors =
    gb && !isComicCategory(gb.categories) && gb.authors.length > 0 ? gb.authors : undefined
  const authors = normalizeAuthors(firstOf(gbAuthors, candidate.authors) ?? candidate.authors ?? [])

  return {
    title: candidate.title,
    authors,
    isbn,
    coverUrlFallback: firstOf(candidate.coverUrlFallback, gb?.thumbnail),
    workKey: firstOf(candidate.workKey, gb?.id),
    firstPublishYear: sanitizeYear(firstOf(gb?.year, candidate.firstPublishYear)),
    pageCount: firstOf(gb?.pageCount, candidate.pageCount),
    description: gb?.description,
    categories: gb?.categories && gb.categories.length > 0 ? gb.categories : undefined,
    subjects: gb?.categories?.length ? normalizeSubjects(gb.categories) : undefined,
    averageRating: gb?.averageRating,
    ratingsCount: gb?.ratingsCount,
  }
}
