// Shared edition-collapse: dedupe a list of book-like records down to one entry per
// WORK, so large-print / audio / subtitle-variant editions of the same book don't
// render as separate rows. Used on every surface that shows catalog or shelf lists —
// search results, author page, genre carousels, wishlist — so dedup behaves
// identically everywhere.
//
// Identity here is by WORK, deliberately DIFFERENT from lib/book-key.bookKey (which
// keys a shelf COPY by workKey → isbn → title+author). Editions of one work have
// DIFFERENT ISBNs, so ISBN must NOT be part of edition identity — we group on the
// Open Library work key when present, else a noise-stripped title + primary author.
//
// WATCH: numbered series volumes (Vol 1 vs Vol 2) are DIFFERENT works and must never
// merge. The work key handles that for sourced data; the title fallback preserves
// volume/number tokens and refuses to strip a subtitle that carries one.

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

// Edition-noise phrases that describe a FORMAT, never a different work. Stripped from
// the title before building the fallback group key so "Dear Edward" and "Dear Edward
// [large print]" collapse. Matched anywhere in the title (bracketed or bare).
const EDITION_NOISE: RegExp[] = [
  /\blarge print\b/g,
  /\blarge type\b/g,
  /\bunabridged\b/g,
  /\babridged\b/g,
  /\baudio\s?book\b/g,
  /\baudio cd\b/g,
  /\bcompact disc\b/g,
  /\bmedia tie[-\s]?in\b/g,
  /\bmovie tie[-\s]?in\b/g,
  /\b(?:deluxe|anniversary|revised|expanded|illustrated|annotated|collector'?s|special|reprint|reissue)\s+edition\b/g,
]

// Generic format subtitles that never distinguish two works — always safe to drop.
const FORMAT_SUBTITLE = /:\s*(?:a|an|the)\s+(?:novel|memoir|novella|story|biography|play)\b.*$/

// A token marking an installment within a series. Its presence means a trailing
// subtitle is structural (a volume), so we must NOT strip it: digits, #N, and
// vol/book/part/no. markers plus spelled-out small ordinals. No `g` flag — `.test`
// must stay stateless.
const VOLUME_MARKER =
  /\bvol(?:ume)?\b|\bbook\b|\bpart\b|\bno\.?\b|#\s*\d|\b\d+\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i

// Drop a bracket/paren group ONLY when it is pure edition noise, e.g. "[large print]"
// or "(unabridged)". A bracket carrying a series/volume — "(The Lord of the Rings,
// Book 1)" — is preserved so those books stay distinct.
const stripNoiseBrackets = (t: string): string =>
  t.replace(/[([][^)\]]*[)\]]/g, (group) => {
    if (VOLUME_MARKER.test(group)) return group // series/volume bracket — keep
    let inner = group.slice(1, -1)
    for (const re of EDITION_NOISE) inner = inner.replace(re, "")
    // If stripping noise emptied the bracket's meaningful content, it was pure noise.
    return inner.replace(/[^a-z0-9]/g, "") === "" ? " " : group
  })

// Normalize a title down to a stable grouping form: lowercased, edition noise and
// format/empty subtitles removed, punctuation flattened. Volume/number tokens always
// survive so series installments never collapse together.
const groupTitle = (rawTitle: string): string => {
  let t = rawTitle.toLowerCase()
  t = stripNoiseBrackets(t)
  for (const re of EDITION_NOISE) t = t.replace(re, " ")
  t = t.replace(FORMAT_SUBTITLE, "")
  // Drop a trailing subtitle (after the first colon) ONLY when it carries no volume
  // marker — protects "Stormlight Archive: Book Two" while collapsing "Title: a tale".
  const colon = t.indexOf(":")
  if (colon !== -1 && !VOLUME_MARKER.test(t.slice(colon + 1))) {
    t = t.slice(0, colon)
  }
  // Keep alphanumerics + the volume hash; collapse everything else to single spaces.
  return t.replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim()
}

/** The work-level identity for a book-like record: the Open Library work key when
 *  present, else a noise-stripped title + primary author. Two editions of one work
 *  share this; two series volumes do NOT. Exported so the genre-carousel cross-row
 *  dedup can track which work has already been shown. */
export const editionKey = (b: EditionLike): string => {
  const work = b.workKey?.trim()
  if (work) return `w:${work}`
  const author = (b.authors[0] ?? "").trim().toLowerCase()
  return `t:${groupTitle(b.title)}|${author}`
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

/** Collapse a list of book-like records to one entry per work, keeping the best
 *  representative of each. Order is stable (first-seen group order); ties on score
 *  keep the first-seen record, so the same input always yields the same output. */
export const collapseEditions = <T extends EditionLike>(items: T[]): T[] => {
  const best = new Map<string, T>()
  const order: string[] = []
  for (const item of items) {
    const key = editionKey(item)
    const current = best.get(key)
    if (!current) {
      best.set(key, item)
      order.push(key)
    } else if (editionScore(item) > editionScore(current)) {
      // Strictly-better representative replaces; equal scores keep the first-seen.
      best.set(key, item)
    }
  }
  return order.map((k) => best.get(k)!)
}
