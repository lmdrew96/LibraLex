import { normalizeAuthors, normalizeSubjects, sanitizeYear } from "./normalize"

/** A fully enriched, cacheable book record — search-result fields plus the merged
 *  enrichment (description/categories/subjects/authorBios) written to Convex so the
 *  detail view renders with no external calls. Defined here (the engine) and
 *  re-exported from lib/types for the frontend; self-contained so this module
 *  imports nothing outside convex/ (keeps the Convex bundler happy). */
export type EnrichedBook = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  firstPublishYear?: number
  pageCount?: number
  workKey?: string
  description?: string
  categories?: string[]
  subjects?: string[]
  authorBios?: { name: string; bio?: string }[]
}

// The enrich-once engine. Merges Google Books (bibliographic) + Open Library
// (cover, work subjects, author bios) into one normalized record, field-by-field,
// taking the first non-empty value in each field's source-preference order. Runs
// server-side (the /api/enrich route + the re-fetch action) so the result can be
// cached on the Convex book record — after which the detail view needs zero
// external calls. The Convex backfill reuses enrichBook directly.

const GOOGLE_TIMEOUT_MS = 4000
const OL_TIMEOUT_MS = 8000
const MAX_BIO_AUTHORS = 2

const UA = "LibraLex/0.11 (libra.adhdesigns.dev)"

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    })
  } finally {
    clearTimeout(timer)
  }
}

// 4-digit year from a Google Books publishedDate ("2014", "2014-09-02").
const parseYear = (publishedDate: string | undefined): number | undefined => {
  const m = publishedDate?.match(/^\d{4}/)
  return m ? Number(m[0]) : undefined
}

// Google Books lists only the writer for comics/graphic novels (drops the
// artist), so author overwrite is suppressed for these — see mergeAuthors.
const isComicCategory = (categories: string[]): boolean =>
  categories.some((c) => /comics|graphic novel|manga/i.test(c))

// OL text fields are either a plain string or `{ type, value }`.
const asText = (v: unknown): string | undefined => {
  if (typeof v === "string") return v
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as { value?: unknown }).value
    if (typeof inner === "string") return inner
  }
  return undefined
}

// OL descriptions/bios are user-edited markdown rendered as plain text: drop the
// dashed source footer, ref-links, and emphasis markers, then collapse whitespace.
const cleanOpenLibrary = (raw: string): string =>
  raw
    .split(/\r?\n\s*-{3,}/)[0]
    .replace(/\(\[source\]\[\d+\]\)/gi, "")
    .replace(/\r?\n\s*\[\d+\]:\s*\S+/g, "")
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\*+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

// Google Books descriptions can carry light HTML — strip tags + decode entities.
const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim()

type GoogleVolume = {
  authors: string[]
  year: number | undefined
  pageCount: number | undefined
  description: string | undefined
  categories: string[]
  thumbnail: string | undefined
  isComic: boolean
}

const fetchGoogleVolumeByIsbn = async (isbn: string): Promise<GoogleVolume | null> => {
  try {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY
    const keyParam = apiKey ? `&key=${apiKey}` : ""
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1${keyParam}`,
      GOOGLE_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      items?: Array<{
        volumeInfo?: {
          authors?: string[]
          publishedDate?: string
          pageCount?: number
          description?: string
          categories?: string[]
          imageLinks?: { thumbnail?: string; smallThumbnail?: string }
        }
      }>
    }
    const info = data.items?.[0]?.volumeInfo
    if (!info) return null
    const thumb = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail
    return {
      authors: info.authors ?? [],
      year: parseYear(info.publishedDate),
      pageCount: typeof info.pageCount === "number" && info.pageCount > 0 ? info.pageCount : undefined,
      description: info.description ? stripHtml(info.description) : undefined,
      categories: info.categories ?? [],
      thumbnail: thumb ? thumb.replace(/^http:\/\//, "https://") : undefined,
      isComic: isComicCategory(info.categories ?? []),
    }
  } catch {
    return null
  }
}

type OpenLibraryEdition = {
  coverId: number | undefined
  workKey: string | undefined
  authors: string[]
  year: number | undefined
  pageCount: number | undefined
}

const fetchOpenLibraryByIsbn = async (isbn: string): Promise<OpenLibraryEdition | null> => {
  try {
    const res = await fetchWithTimeout(
      `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1&fields=title,author_name,cover_i,first_publish_year,number_of_pages_median,key`,
      OL_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      docs?: Array<{
        author_name?: string[]
        cover_i?: number
        first_publish_year?: number
        number_of_pages_median?: number
        key?: string
      }>
    }
    const doc = data.docs?.[0]
    if (!doc) return null
    return {
      coverId: doc.cover_i,
      workKey: doc.key,
      authors: doc.author_name ?? [],
      year: doc.first_publish_year,
      pageCount: doc.number_of_pages_median,
    }
  } catch {
    return null
  }
}

type OpenLibraryWork = { description: string | undefined; subjects: string[]; authorKeys: string[] }

const fetchOpenLibraryWork = async (workKey: string): Promise<OpenLibraryWork | null> => {
  if (!/^\/works\/OL\w+W$/.test(workKey)) return null
  try {
    const res = await fetchWithTimeout(`https://openlibrary.org${workKey}.json`, OL_TIMEOUT_MS)
    if (!res.ok) return null
    const work = (await res.json()) as {
      description?: unknown
      subjects?: string[]
      authors?: Array<{ author?: { key?: string } }>
    }
    const descRaw = asText(work.description)
    return {
      description: descRaw ? cleanOpenLibrary(descRaw) : undefined,
      subjects: work.subjects ?? [],
      authorKeys: (work.authors ?? [])
        .map((a) => a.author?.key)
        .filter((k): k is string => Boolean(k))
        .slice(0, MAX_BIO_AUTHORS),
    }
  } catch {
    return null
  }
}

const fetchOpenLibraryAuthor = async (
  key: string,
): Promise<{ name: string; bio?: string } | null> => {
  try {
    const res = await fetchWithTimeout(`https://openlibrary.org${key}.json`, OL_TIMEOUT_MS)
    if (!res.ok) return null
    const a = (await res.json()) as { name?: string; bio?: unknown }
    if (!a.name) return null
    const bioRaw = asText(a.bio)
    return { name: a.name, bio: bioRaw ? cleanOpenLibrary(bioRaw) : undefined }
  } catch {
    return null
  }
}

// The first non-empty value wins, in order. `undefined`/empty arrays are skipped.
const firstOf = <T>(...vals: (T | undefined)[]): T | undefined =>
  vals.find((v) => v !== undefined && !(Array.isArray(v) && v.length === 0))

/**
 * Enrich a picked candidate into a complete, normalized, cacheable record.
 * `candidate` carries whatever the search/scan already knew (title, isbn,
 * workKey, and provisional authors/year/cover); this fills the gaps and prefers
 * the authoritative source per field. Pure-degrades: with no ISBN/workKey it just
 * normalizes and returns the candidate, so manual adds still work.
 */
export const enrichBook = async (candidate: EnrichedBook): Promise<EnrichedBook> => {
  const isbn = candidate.isbn
  const [gb, ol] = await Promise.all([
    isbn ? fetchGoogleVolumeByIsbn(isbn) : Promise.resolve(null),
    isbn ? fetchOpenLibraryByIsbn(isbn) : Promise.resolve(null),
  ])

  const workKey = firstOf(candidate.workKey, ol?.workKey)
  const work = workKey ? await fetchOpenLibraryWork(workKey) : null
  const bios = work?.authorKeys.length
    ? (await Promise.all(work.authorKeys.map(fetchOpenLibraryAuthor))).filter(
        (b): b is { name: string; bio?: string } => b !== null,
      )
    : []

  // Authors: GB wins for prose; for comics GB drops the artist, so keep the
  // candidate/OL creators. Always run the normalizer.
  const gbAuthors = gb && !gb.isComic && gb.authors.length > 0 ? gb.authors : undefined
  const authors = normalizeAuthors(
    firstOf(gbAuthors, candidate.authors, ol?.authors) ?? candidate.authors ?? [],
  )

  const coverId = firstOf(candidate.coverId, ol?.coverId)

  return {
    title: candidate.title,
    authors,
    isbn,
    coverId,
    // GB thumbnail only when there's no OL cover_i to render from.
    coverUrlFallback: coverId === undefined ? firstOf(candidate.coverUrlFallback, gb?.thumbnail) : undefined,
    workKey,
    firstPublishYear: sanitizeYear(firstOf(gb?.year, candidate.firstPublishYear, ol?.year)),
    pageCount: firstOf(gb?.pageCount, candidate.pageCount, ol?.pageCount),
    description: firstOf(gb?.description, work?.description),
    categories: gb?.categories && gb.categories.length > 0 ? gb.categories : undefined,
    subjects: work?.subjects.length ? normalizeSubjects(work.subjects) : undefined,
    authorBios: bios.length > 0 ? bios : undefined,
  }
}
