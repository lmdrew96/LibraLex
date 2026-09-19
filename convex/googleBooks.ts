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
// Google's Books API intermittently 503s ("Service temporarily unavailable")
// on an otherwise well-formed, keyed request that succeeds seconds later —
// confirmed by hand against production ISBNs, and frequently enough (roughly
// half of requests in one manual sample) that a single short retry isn't
// reliable. A permanent miss (no match) comes back 200 with an empty `items`
// array, so retrying a non-2xx never masks a real "not found." Escalating but
// still bounded since /api/search hits this on every keystroke and has a 30s
// Vercel budget: worst case here is 4 * DEFAULT_TIMEOUT_MS + 2100ms ≈ 18s.
const FETCH_RETRY_ATTEMPTS = 4
const FETCH_RETRY_DELAYS_MS = [300, 600, 1200]

/** `&key=...` when GOOGLE_BOOKS_API_KEY is set, else "". Keyless requests work
 *  until the shared daily quota is hit (HTTP 429) — the key just raises it. */
export const googleApiKeyParam = (): string => {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY
  return apiKey ? `&key=${apiKey}` : ""
}

const fetchJsonOnce = async (
  url: string,
  ms: number,
): Promise<{ ok: boolean; status: number; json: unknown }> => {
  // Guards the whole request, headers *and* body — a bare `fetch()` timeout
  // only covers the wait for headers, so a connection that stalls mid-body
  // (Google being slow to stream, not just slow to respond) would hang past
  // `ms` with no protection and eventually trip Vercel's platform-level
  // function timeout instead of ours.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

/** Retries a transient non-2xx or network/timeout failure a couple of times
 *  before giving up — see FETCH_RETRY_ATTEMPTS above for why. */
export const fetchJsonWithTimeout = async (
  url: string,
  ms: number,
): Promise<{ ok: boolean; status: number; json: unknown }> => {
  let lastResult: { ok: boolean; status: number; json: unknown } | undefined
  let lastError: unknown
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      lastResult = await fetchJsonOnce(url, ms)
      if (lastResult.ok) return lastResult
    } catch (err) {
      lastError = err
    }
    if (attempt < FETCH_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_DELAYS_MS[attempt - 1]))
    }
  }
  if (lastResult) return lastResult
  throw lastError
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
    const { ok, json } = await fetchJsonWithTimeout(
      `${VOLUMES_URL}?${qs}${googleApiKeyParam()}`,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    if (!ok) return null
    const item = (json as { items?: GoogleVolumeItem[] } | null)?.items?.[0]
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
  const { ok, status, json } = await fetchJsonWithTimeout(
    `${VOLUMES_URL}?${qs}${googleApiKeyParam()}`,
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if (!ok) throw new Error(`Google Books responded ${status}`)
  const items = (json as { items?: GoogleVolumeItem[] } | null)?.items ?? []
  return items.map(mapVolume).filter((v): v is GoogleVolume => v !== null)
}

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Fallback for books with no ISBN (or whose ISBN lookup misses) — a title+author
 *  query with a loose title-overlap guard so a mismatched search result doesn't
 *  attach the wrong book's cover/data. Same matching approach as
 *  app/api/book-info/route.ts's fetchDescription. Fault-tolerant — null on
 *  miss/error, never throws. */
export const fetchVolumeByTitleAuthor = async (
  title: string,
  author: string | undefined,
  opts: FetchOpts = {},
): Promise<GoogleVolume | null> => {
  try {
    const q = [`intitle:${title}`, author ? `inauthor:${author}` : ""].filter(Boolean).join("+")
    const volumes = await fetchVolumesByQuery(q, { maxResults: 5, ...opts })
    return pickTitleMatch(volumes, title)
  } catch {
    return null
  }
}

/** The first volume whose title plausibly matches `title` (loose overlap guard),
 *  or null. With `prefer`, a matching volume that satisfies it (e.g. has a cover)
 *  wins over an earlier match that doesn't — search results often lead with a
 *  bare edition of the same book. Pure, so it's unit-tested. */
export const pickTitleMatch = <V extends { title: string }>(
  volumes: V[],
  title: string,
  { prefer }: { prefer?: (v: V) => boolean } = {},
): V | null => {
  const want = normalizeTitle(title)
  const key = want.slice(0, 12)
  const matches = volumes.filter((v) => {
    const got = normalizeTitle(v.title)
    return Boolean(got) && (got.includes(key) || want.includes(got.slice(0, 12)))
  })
  if (prefer) return matches.find(prefer) ?? matches[0] ?? null
  return matches[0] ?? null
}

/** English title search for a volume that has what we need (`need`: a cover, a
 *  description), for when the best-matching edition lacks it — typically an ISBN
 *  for a foreign/niche edition (its non-English description is blanked by
 *  mapVolume, and it may have no image). Tries title + author, then title alone
 *  (catches renamed authors). Null if no matching volume has it — never throws. */
export const fetchTitleMatchWith = async (
  title: string,
  author: string | undefined,
  need: (v: GoogleVolume) => boolean,
): Promise<GoogleVolume | null> => {
  const attempts = author ? [author, undefined] : [undefined]
  for (const a of attempts) {
    try {
      const q = [`intitle:${title}`, a ? `inauthor:${a}` : ""].filter(Boolean).join("+")
      const volumes = await fetchVolumesByQuery(q, { maxResults: 10, langRestrict: "en" })
      const match = pickTitleMatch(volumes, title, { prefer: need })
      if (match && need(match)) return match
    } catch {
      // try the next, broader query
    }
  }
  return null
}

/** Last-resort cover search — see fetchTitleMatchWith. */
export const fetchCoverByTitle = async (
  title: string,
  author: string | undefined,
): Promise<string | undefined> =>
  (await fetchTitleMatchWith(title, author, (v) => Boolean(v.thumbnail)))?.thumbnail

/** Strict "same book" check for rewriting identity (not just borrowing a cover):
 *  normalized titles equal, and first authors equal when both are known. */
export const isSameBook = (
  a: { title: string; authors: string[] },
  b: { title: string; authors: string[] },
): boolean => {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false
  const aa = a.authors[0] ? normalizeTitle(a.authors[0]) : ""
  const ba = b.authors[0] ? normalizeTitle(b.authors[0]) : ""
  return !aa || !ba || aa === ba
}
