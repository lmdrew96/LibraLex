// Source-agnostic bibliographic normalization, applied on every book write
// (addBook, addRecToShelf, addWishlistBook, updateBook) and reused by the one-off
// backfill. These are PURE functions — no I/O — so they're safe to call from
// Convex mutations (which can't fetch). The backfill action layers Google Books
// re-fetching on top of these for the data only an external source can fix
// (narrators/translators baked into an author list, wrong years).

// Generous cap: dedupe + subset-collapse handle the common junk, so this only
// bounds pathological contributor lists (audiobook narrator + multiple
// translators + editors). Set high enough that legit creative teams — a comic's
// writer/penciller/inker/colorist/letterer — survive intact.
const MAX_AUTHORS = 6

/**
 * Clean an author list, source-agnostic:
 *  - trim + strip leading/trailing separators (";", ",") off each name
 *  - drop empties
 *  - dedupe case/whitespace-insensitively, keeping the first-seen casing
 *  - collapse subset-name duplicates: a name whose words are a strict subset of
 *    another kept name is dropped ("Sue Kidd" ⊂ "Sue Monk Kidd" → keep the fuller)
 *  - cap runaway lists at MAX_AUTHORS
 * Deliberately does NOT try to guess which entries are narrators/translators when
 * names look distinct (e.g. Atlas Shrugged's phantom "Adrian Rand") — that's the
 * backfill's Google Books re-fetch job; guessing here risks nuking real co-authors.
 */
export const normalizeAuthors = (authors: string[]): string[] => {
  const cleaned = authors
    .map((a) => a.trim().replace(/^[;,\s]+/, "").replace(/[;,\s]+$/, "").trim())
    .filter((a) => a.length > 0)

  // Case/whitespace-insensitive dedupe, preserving first-seen original casing.
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const name of cleaned) {
    const key = name.toLowerCase().replace(/\s+/g, " ")
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(name)
    }
  }

  // Subset-name collapse: drop any name whose word-set is a strict subset of
  // another remaining name's word-set.
  const wordsOf = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\s+/).filter(Boolean))
  const isStrictSubset = (a: Set<string>, b: Set<string>): boolean =>
    a.size < b.size && [...a].every((w) => b.has(w))
  const collapsed = deduped.filter((name, i) => {
    const w = wordsOf(name)
    return !deduped.some((other, j) => j !== i && isStrictSubset(w, wordsOf(other)))
  })

  return collapsed.slice(0, MAX_AUTHORS)
}

/**
 * Reject impossible years (≤ 0 or in the future) → undefined. Plausible-but-
 * possibly-wrong years (e.g. an edition-confused date) pass through untouched
 * here, because the mutation layer has no corroborating source; the backfill
 * trusts Google Books' edition year to correct those.
 */
export const sanitizeYear = (year: number | undefined): number | undefined => {
  if (year === undefined) return undefined
  if (!Number.isFinite(year)) return undefined
  const maxYear = new Date(Date.now()).getUTCFullYear() + 1
  if (year <= 0 || year > maxYear) return undefined
  return Math.trunc(year)
}

/**
 * Normalize the bibliographic fields shared by every book-write path. Spread the
 * result over the insert/patch so authors + year are always clean on disk.
 */
export const normalizeBibFields = <
  T extends { authors: string[]; firstPublishYear?: number },
>(
  fields: T,
): T => ({
  ...fields,
  authors: normalizeAuthors(fields.authors),
  firstPublishYear: sanitizeYear(fields.firstPublishYear),
})
