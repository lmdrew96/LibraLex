import { isLikelyEnglish } from "./normalize"

// Shared Google Books primitives — the single source for every book-related
// external API call (search, genre discovery, enrichment, the MCP door).
// Self-contained (imports nothing outside convex/, keeps the Convex bundler
// happy) but importable from Next.js API routes too — app/api/book-info/route.ts
// already imports isLikelyEnglish from convex/normalize, so this is the same,
// proven cross-boundary pattern, not a new one.

const UA = "LibraLex/0.41 (libra.adhdesigns.dev)"
const VOLUMES_URL = "https://www.googleapis.com/books/v1/volumes"
const DEFAULT_TIMEOUT_MS = 4000

/** `&key=...` when GOOGLE_BOOKS_API_KEY is set, else "". Keyless requests work
 *  until the shared daily quota is hit (HTTP 429) — the key just raises it. */
export const googleApiKeyParam = (): string => {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY
  return apiKey ? `&key=${apiKey}` : ""
}

export const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
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
export const parseYear = (publishedDate: string | undefined): number | undefined => {
  const m = publishedDate?.match(/^\d{4}/)
  return m ? Number(m[0]) : undefined
}

// Google returns http:// thumbnails — force https to avoid mixed-content blocks.
export const toHttps = (url: string): string => url.replace(/^http:\/\//, "https://")

// Prefer ISBN_13, fall back to ISBN_10.
export const extractIsbn = (
  ids: Array<{ type?: string; identifier?: string }> | undefined,
): string | undefined =>
  ids?.find((i) => i.type === "ISBN_13")?.identifier ??
  ids?.find((i) => i.type === "ISBN_10")?.identifier

// Google Books descriptions can carry light HTML (<p>, <br>, <b>) — strip tags
// and decode the common entities so we render clean plain text.
export const stripHtml = (html: string): string =>
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

// Keep only an English result: trust Google's language tag when present, and run
// the text guard (convex/normalize.ts) as a backstop for the common case where
// it's absent or a volume is mistagged.
export const isEnglishVolume = (language: string | undefined, text?: string): boolean => {
  const langOk = !language || language.toLowerCase().startsWith("en")
  if (!langOk) return false
  return text === undefined || isLikelyEnglish(text)
}

export type GoogleVolume = {
  id: string // Google Books volume id — opaque, edition-level (not a work-level id)
  title: string
  authors: string[]
  isbn?: string
  year?: number
  pageCount?: number
  description?: string
  categories: string[]
  thumbnail?: string
  averageRating?: number
  ratingsCount?: number
}

type GoogleVolumeInfo = {
  title?: string
  authors?: string[]
  publishedDate?: string
  pageCount?: number
  description?: string
  language?: string
  categories?: string[]
  imageLinks?: { thumbnail?: string; smallThumbnail?: string }
  industryIdentifiers?: Array<{ type?: string; identifier?: string }>
  averageRating?: number
  ratingsCount?: number
}

type GoogleVolumeItem = { id?: string; volumeInfo?: GoogleVolumeInfo }

// Normalize one Books API volume item. Null when it's missing an id/title. A
// present-but-non-English description doesn't drop the whole item — only the
// description is blanked, since biblio fields (title/authors/year/cover) are
// language-agnostic and still worth keeping.
export const mapVolume = (item: GoogleVolumeItem): GoogleVolume | null => {
  const info = item.volumeInfo
  if (!item.id || !info?.title) return null
  const thumb = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail
  const rawDesc = info.description ? stripHtml(info.description) : undefined
  // Only trust a rating backed by at least one vote — Google occasionally returns
  // an averageRating with a 0/absent count.
  const ratingsCount =
    typeof info.ratingsCount === "number" && info.ratingsCount > 0 ? info.ratingsCount : undefined
  return {
    id: item.id,
    title: info.title,
    authors: info.authors ?? [],
    isbn: extractIsbn(info.industryIdentifiers),
    year: parseYear(info.publishedDate),
    pageCount: typeof info.pageCount === "number" && info.pageCount > 0 ? info.pageCount : undefined,
    description: rawDesc && isEnglishVolume(info.language, rawDesc) ? rawDesc : undefined,
    categories: info.categories ?? [],
    thumbnail: thumb ? toHttps(thumb) : undefined,
    averageRating:
      ratingsCount !== undefined && typeof info.averageRating === "number"
        ? info.averageRating
        : undefined,
    ratingsCount,
  }
}

export type FetchOpts = {
  maxResults?: number
  startIndex?: number
  langRestrict?: string
  printType?: string
  timeoutMs?: number
}

const buildQuery = (q: string, opts: FetchOpts): string => {
  const params = new URLSearchParams({ q })
  params.set("maxResults", String(opts.maxResults ?? 10))
  if (opts.startIndex) params.set("startIndex", String(opts.startIndex))
  if (opts.langRestrict) params.set("langRestrict", opts.langRestrict)
  params.set("printType", opts.printType ?? "books")
  params.set("country", "US")
  return params.toString()
}

/** Bibliographic lookup by exact ISBN. Fault-tolerant — null on miss/error, never
 *  throws, so callers can use it inside a best-effort/parallel step. */
export const fetchVolumeByIsbn = async (
  isbn: string,
  opts: FetchOpts = {},
): Promise<GoogleVolume | null> => {
  try {
    const qs = buildQuery(`isbn:${isbn}`, { ...opts, maxResults: 1 })
    const res = await fetchWithTimeout(
      `${VOLUMES_URL}?${qs}${googleApiKeyParam()}`,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as { items?: GoogleVolumeItem[] }
    const item = data.items?.[0]
    return item ? mapVolume(item) : null
  } catch {
    return null
  }
}

/** General volume search — text query, `inauthor:`/`intitle:`/`subject:` operators,
 *  paginated via startIndex (max 40/request; Google caps results around ~1000
 *  total for a given query). Throws on a non-OK response/network failure so
 *  callers that need a fallback path (or a fault-tolerant []) can catch it. */
export const fetchVolumesByQuery = async (
  query: string,
  opts: FetchOpts = {},
): Promise<GoogleVolume[]> => {
  const qs = buildQuery(query, opts)
  const res = await fetchWithTimeout(
    `${VOLUMES_URL}?${qs}${googleApiKeyParam()}`,
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if (!res.ok) throw new Error(`Google Books responded ${res.status}`)
  const data = (await res.json()) as { items?: GoogleVolumeItem[] }
  return (data.items ?? []).map(mapVolume).filter((v): v is GoogleVolume => v !== null)
}
