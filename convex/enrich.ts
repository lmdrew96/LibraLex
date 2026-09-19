import { normalizeAuthors, normalizeSubjects, sanitizeYear } from "./normalize"
import {
  fetchCoverByTitle,
  fetchTitleMatchWith,
  fetchVolumeByIsbn,
  fetchVolumeByTitleAuthor,
} from "./googleBooks"

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

  // The matched volume can lack a cover — typically an ISBN for a foreign/niche
  // edition Google has without an image. Then look for the same title's cover
  // separately (keeping the rest of the matched data), so an ISBN hit never
  // blocks a cover that a title search would find.
  const cover =
    firstOf(candidate.coverUrlFallback, gb?.thumbnail) ??
    (await fetchCoverByTitle(candidate.title, candidate.authors[0]))

  // Same for the description: a foreign edition's description is blanked by
  // mapVolume (English-only), which would leave the book with none at all — so
  // borrow the English title match's description (and categories, if the
  // matched edition had none).
  const descVolume = gb?.description
    ? null
    : await fetchTitleMatchWith(candidate.title, candidate.authors[0], (v) => Boolean(v.description))
  const categories = gb?.categories?.length ? gb.categories : descVolume?.categories

  return {
    title: candidate.title,
    authors,
    isbn,
    coverUrlFallback: cover,
    workKey: firstOf(candidate.workKey, gb?.id),
    firstPublishYear: sanitizeYear(firstOf(gb?.year, candidate.firstPublishYear)),
    pageCount: firstOf(gb?.pageCount, candidate.pageCount),
    description: gb?.description ?? descVolume?.description,
    categories: categories?.length ? categories : undefined,
    subjects: categories?.length ? normalizeSubjects(categories) : undefined,
    averageRating: gb?.averageRating,
    ratingsCount: gb?.ratingsCount,
  }
}
