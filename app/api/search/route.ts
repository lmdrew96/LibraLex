import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"

// Server-side book search. Open Library is primary (its cover_i ids render
// covers with no rate limit); Google Books backfills a thumbnail URL only for
// results Open Library has no cover for. Runs server-side so no CORS and no key
// ever reaches the client. Client debounces (~300ms) — we don't debounce here.

// Open Library is slow AND flaky: text search.json runs 5–8s, and its ISBN index
// is eventually-consistent (a just-valid ISBN often returns [] on the first hit,
// then resolves on a retry — the "works on the 2nd/3rd try" report). We retry
// here so the user doesn't have to, and raise the function budget so a slow-but-
// valid response isn't killed mid-flight (Vercel default ceilings are low).
export const maxDuration = 30

const OPEN_LIBRARY_FIELDS =
  "title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median,key"

// Bound worst-case Google Books calls per search (most OL results have a cover_i).
const MAX_COVER_BACKFILLS = 6
// Per-attempt timeouts, sized so retries fit inside maxDuration. Text search is
// the slow path (patient); the ISBN lookup is an exact-match query (fast).
const OL_TEXT_TIMEOUT_MS = 10000
const OL_ISBN_TIMEOUT_MS = 6000
const GOOGLE_TIMEOUT_MS = 3000
const ITUNES_TIMEOUT_MS = 3000

type OpenLibraryDoc = {
  title?: string
  author_name?: string[]
  isbn?: string[]
  cover_i?: number
  first_publish_year?: number
  number_of_pages_median?: number
  key?: string
}

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        // Open Library asks for a descriptive UA so they can contact heavy users.
        "User-Agent": "LibraLex/0.1 (libra.adhdesigns.dev)",
        Accept: "application/json",
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

const mapDoc = (doc: OpenLibraryDoc): BookSearchResult | null => {
  if (!doc.title) return null
  return {
    title: doc.title,
    authors: doc.author_name ?? [],
    isbn: doc.isbn?.[0],
    coverId: doc.cover_i,
    firstPublishYear: doc.first_publish_year,
    pageCount: doc.number_of_pages_median,
    workKey: doc.key,
  }
}

/** Look up a Google Books cover thumbnail by ISBN. Returns an https URL or null. */
const fetchGoogleCover = async (isbn: string): Promise<string | null> => {
  try {
    // Keyless works until the shared daily quota is hit (HTTP 429); set
    // GOOGLE_BOOKS_API_KEY to raise the limit — no code change needed.
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY
    const keyParam = apiKey ? `&key=${apiKey}` : ""
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1${keyParam}`,
      GOOGLE_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      items?: Array<{ volumeInfo?: { imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }>
    }
    const links = data.items?.[0]?.volumeInfo?.imageLinks
    const thumb = links?.thumbnail ?? links?.smallThumbnail
    // Google returns http:// — force https to avoid mixed-content blocking.
    return thumb ? thumb.replace(/^http:\/\//, "https://") : null
  } catch {
    return null
  }
}

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * Look up a cover via the iTunes Search API (keyless, no quota). Matches by
 * title + author, with a loose title-overlap guard so we don't show a wrong
 * book's cover. Returns an upscaled (600px) https artwork URL or null.
 */
const fetchItunesCover = async (book: BookSearchResult): Promise<string | null> => {
  try {
    const term = [book.title, book.authors[0]].filter(Boolean).join(" ")
    const res = await fetchWithTimeout(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=ebook&limit=5`,
      ITUNES_TIMEOUT_MS,
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{ artworkUrl100?: string; trackName?: string; collectionName?: string }>
    }

    // Scan the top results for the first whose title meaningfully overlaps the
    // wanted title — guards against iTunes ranking a different book first.
    const want = normalizeTitle(book.title)
    const key = want.slice(0, 12)
    const match = (data.results ?? []).find((item) => {
      if (!item.artworkUrl100) return false
      const got = normalizeTitle(item.trackName ?? item.collectionName ?? "")
      return Boolean(got) && (got.includes(key) || want.includes(got.slice(0, 12)))
    })
    if (!match?.artworkUrl100) return null

    // artworkUrl100 ends in /100x100bb.jpg — bump to a crisp 600px.
    return match.artworkUrl100.replace(/\/\d+x\d+bb\.jpg$/, "/600x600bb.jpg")
  } catch {
    return null
  }
}

/**
 * Best-effort cover for a result Open Library has no cover_i for. iTunes first
 * (keyless, reliable); Google Books only as a bonus when an ISBN + API key exist
 * (keyless Google is globally quota-throttled — HTTP 429).
 */
const fetchFallbackCover = async (book: BookSearchResult): Promise<string | null> => {
  const itunes = await fetchItunesCover(book)
  if (itunes) return itunes
  if (book.isbn) return await fetchGoogleCover(book.isbn)
  return null
}

// Fetch + normalize an Open Library search.json URL. Throws on a non-OK response
// so callers can map failures to a status code.
const fetchOpenLibrary = async (olUrl: string, timeoutMs: number): Promise<BookSearchResult[]> => {
  const res = await fetchWithTimeout(olUrl, timeoutMs)
  if (!res.ok) throw new Error(`Open Library responded ${res.status}`)
  const data = (await res.json()) as { docs?: OpenLibraryDoc[] }
  return (data.docs ?? []).map(mapDoc).filter((b): b is BookSearchResult => b !== null)
}

/**
 * Retry an async attempt against Open Library's flakiness. Errors (timeouts,
 * 5xx) always retry until attempts run out. `retryOn` additionally retries a
 * *successful* result — used for the ISBN path, where OL's lagging index returns
 * an empty 200 that a moment later resolves. The final attempt's value is always
 * returned (we don't discard a legit empty result); only all-errors throws.
 */
const withRetry = async <T>(
  attempt: () => Promise<T>,
  { attempts, backoffMs, retryOn }: { attempts: number; backoffMs: number; retryOn?: (r: T) => boolean },
): Promise<T> => {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, backoffMs * i))
    try {
      const result = await attempt()
      if (i < attempts - 1 && retryOn?.(result)) continue
      return result
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error("Open Library: retries exhausted")
}

// Backfill covers Open Library lacks, in parallel, capped and fault-tolerant.
const backfillCovers = async (results: BookSearchResult[]): Promise<void> => {
  const needsCover = results.filter((b) => b.coverId === undefined)
  await Promise.allSettled(
    needsCover.slice(0, MAX_COVER_BACKFILLS).map(async (book) => {
      const cover = await fetchFallbackCover(book)
      if (cover) book.coverUrlFallback = cover
    }),
  )
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const isbn = (params.get("isbn") ?? "").replace(/[^0-9Xx]/g, "")
  const query = params.get("q")?.trim() ?? ""

  // ── Barcode path: exact ISBN lookup, single best result ──────────────────────
  if (isbn) {
    if (!/^(\d{9}[0-9Xx]|\d{13})$/.test(isbn)) {
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }
    let results: BookSearchResult[]
    try {
      // Retry on an empty result too: OL's ISBN index lags, so a valid code
      // routinely misses on the first hit and resolves moments later.
      results = await withRetry(
        () =>
          fetchOpenLibrary(
            `https://openlibrary.org/search.json?isbn=${isbn}&limit=1&fields=${OPEN_LIBRARY_FIELDS}`,
            OL_ISBN_TIMEOUT_MS,
          ),
        { attempts: 3, backoffMs: 350, retryOn: (r) => r.length === 0 },
      )
    } catch {
      return NextResponse.json({ results: [], error: "Lookup failed. Try again." }, { status: 504 })
    }
    // Pin the scanned ISBN onto the result so the saved book keeps the exact code.
    results.forEach((b) => (b.isbn = isbn))
    await backfillCovers(results)
    return NextResponse.json({ results })
  }

  // ── Text search path ─────────────────────────────────────────────────────────
  if (query.length < 2) {
    return NextResponse.json({ results: [] satisfies BookSearchResult[] })
  }
  let results: BookSearchResult[]
  try {
    // Retry on error only — an empty text result is a legitimate "no matches",
    // not a transient failure, so we don't want to slow that path down.
    results = await withRetry(
      () =>
        fetchOpenLibrary(
          `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=${OPEN_LIBRARY_FIELDS}`,
          OL_TEXT_TIMEOUT_MS,
        ),
      { attempts: 2, backoffMs: 400 },
    )
  } catch {
    return NextResponse.json({ results: [], error: "Search timed out. Try again." }, { status: 504 })
  }
  await backfillCovers(results)
  return NextResponse.json({ results })
}
