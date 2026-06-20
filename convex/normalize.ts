// Source-agnostic bibliographic normalization, applied on every book write
// (addBook, addRecToShelf, addBookForUser, updateBook) and reused by the one-off
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

// High-frequency English function words chosen to NOT collide with common
// Spanish/Portuguese words (so "a", "as", "no", "e", "o", "de", "que" are
// deliberately absent). English prose is ~30–50% function words, so genuine
// English easily clears the threshold below while Romance-language text scores
// near zero — a wide safety margin against false positives.
const ENGLISH_MARKERS = new Set([
  "the", "and", "of", "to", "in", "is", "that", "was", "were", "for", "with",
  "this", "these", "those", "they", "them", "their", "there", "his", "her",
  "she", "he", "which", "what", "when", "where", "who", "why", "how", "would",
  "could", "should", "will", "can", "have", "has", "had", "been", "are", "not",
  "but", "about", "into", "than", "then", "your", "you", "our", "all", "one",
  "out", "from", "by", "on", "or", "an", "it", "as", "at", "we", "if", "so",
  "after", "before", "while", "between", "through", "such", "only", "other",
])

/**
 * Conservative "is this English?" guard for free text (descriptions/bios), used to
 * keep non-English summaries off the shelf. Pure heuristic — no I/O, no language
 * library — so it's safe in Convex mutations and shared by the enrich pipeline and
 * the book-info route. Counts the share of distinctly-English function words; very
 * short text (< 8 words) is too small to judge, so it passes through to avoid
 * dropping a legitimate one-line English blurb. Accented Romance-language words
 * (ã, é, ñ) simply don't match [a-z], so foreign text lands well under the bar.
 */
export const isLikelyEnglish = (text: string): boolean => {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? []
  if (words.length < 8) return true
  let hits = 0
  for (const w of words) if (ENGLISH_MARKERS.has(w)) hits++
  return hits / words.length >= 0.06
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

// Generous cap on stored subjects — breadth is intentional (TF-IDF down-weights
// common ones later), so this only bounds storage.
const MAX_SUBJECTS = 30

// Open Library mixes administrative/catalog tags into `subjects` that aren't
// thematic and poison content similarity + the "shared: …" explanations. Drop
// them. Exact matches are BISAC filler; substrings catch the tag families.
const NOISE_EXACT = new Set(["general", "nyt", "fiction in english", "import"])
const NOISE_SUBSTRINGS = [
  "staff pick",
  "reading level",
  "accessible book",
  "protected daisy",
  "in library",
  "overdrive",
  "large print",
  "large type",
  "lending library",
  "new york times bestseller",
  "internet archive",
]
const isNoiseSubject = (s: string): boolean =>
  s.length < 2 ||
  /^\d+$/.test(s) ||
  NOISE_EXACT.has(s) ||
  NOISE_SUBSTRINGS.some((n) => s.includes(n))

/**
 * Clean an OL subject list for storage: split comma-bundled BISAC strings
 * ("Fiction, Family life, General" → 3 tokens), lowercase, trim, drop catalog
 * noise + empties, dedupe, cap. Shared by the enrich pipeline (convex/enrich) and
 * the backfill so subjects are stored identically regardless of source path.
 */
export const normalizeSubjects = (subjects: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of subjects) {
    for (const part of raw.split(",")) {
      const s = part.trim().toLowerCase()
      if (s && !isNoiseSubject(s) && !seen.has(s)) {
        seen.add(s)
        out.push(s)
      }
    }
  }
  return out.slice(0, MAX_SUBJECTS)
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
