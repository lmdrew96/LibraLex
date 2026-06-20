import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"

// Server-side book search. Source strategy:
//  • ISBN/barcode path → Google Books (ISBN-exact) is the bibliographic source
//    (title, authors, year, pages); Open Library supplies only the cover_i +
//    workKey. Querying by exact ISBN kills the wrong-edition junk (narrators,
//    translators, bad years) that fuzzy title-matching used to pull in.
//  • Text typeahead → Open Library stays primary (it's quota-free and groups by
//    work, which suits a keystroke-rate typeahead; keyless Google Books is
//    globally quota-throttled, so it can't carry the high-frequency path). This
//    is the "secondary, no-ISBN" path.
// Covers always prefer Open Library's cover_i (rate-limit-free render); Google
// Books' thumbnail is the fallback when OL has none. iTunes is retired.
// Runs server-side so no CORS and no key ever reaches the client. Client
// debounces (~300ms) — we don't debounce here.

// Open Library is slow AND flaky: text search.json runs 5–8s, and its ISBN index
// is eventually-consistent (a just-valid ISBN often returns [] on the first hit,
// then resolves on a retry — the "works on the 2nd/3rd try" report). We retry
// here so the user doesn't have to, and raise the function budget so a slow-but-
// valid response isn't killed mid-flight (Vercel default ceilings are low).
export const maxDuration = 30

const OPEN_LIBRARY_FIELDS =
  "title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median,key"

// Bound worst-case Google Books cover calls per text search (most OL results
// have a cover_i, so this rarely maxes out).
const MAX_COVER_BACKFILLS = 6
// Per-attempt timeouts, sized so retries fit inside maxDuration. Text search is
// the slow path (patient); the ISBN lookups are exact-match queries (fast).
const OL_TEXT_TIMEOUT_MS = 10000
const OL_ISBN_TIMEOUT_MS = 6000
const GOOGLE_TIMEOUT_MS = 3000

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

// Parse a 4-digit year out of a Google Books publishedDate ("2014", "2014-09",
// "2014-09-02"). Returns undefined for anything without a leading year.
const parseYear = (publishedDate: string | undefined): number | undefined => {
  const m = publishedDate?.match(/^\d{4}/)
  return m ? Number(m[0]) : undefined
}

type GoogleVolume = {
  title?: string
  authors: string[]
  firstPublishYear?: number
  pageCount?: number
  coverThumbnail?: string
}

/**
 * Bibliographic lookup against Google Books by exact ISBN. Returns the mapped
 * volume (title, authors, year, pages, cover thumbnail) or null on miss/error.
 * Keyless works until the shared daily quota is hit (HTTP 429); set
 * GOOGLE_BOOKS_API_KEY to raise the limit — no code change needed.
 */
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
          title?: string
          authors?: string[]
          publishedDate?: string
          pageCount?: number
          imageLinks?: { thumbnail?: string; smallThumbnail?: string }
        }
      }>
    }
    const info = data.items?.[0]?.volumeInfo
    if (!info) return null
    const links = info.imageLinks
    const thumb = links?.thumbnail ?? links?.smallThumbnail
    return {
      title: info.title,
      authors: info.authors ?? [],
      firstPublishYear: parseYear(info.publishedDate),
      pageCount: typeof info.pageCount === "number" && info.pageCount > 0 ? info.pageCount : undefined,
      // Google returns http:// — force https to avoid mixed-content blocking.
      coverThumbnail: thumb ? thumb.replace(/^http:\/\//, "https://") : undefined,
    }
  } catch {
    return null
  }
}

/** Best-effort cover thumbnail from Google Books for a result Open Library has no
 *  cover_i for. iTunes is retired, so Google Books is the only cover fallback. */
const fetchFallbackCover = async (book: BookSearchResult): Promise<string | null> => {
  if (!book.isbn) return null
  const volume = await fetchGoogleVolumeByIsbn(book.isbn)
  return volume?.coverThumbnail ?? null
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
  const author = params.get("author")?.trim() ?? ""

  // ── Author path: one author's catalog, popular works first ────────────────────
  // Powers the /author/[name] page ("see more of their work"). Matches the author
  // field as a quoted phrase so multi-word names resolve, and sorts by readinglog so
  // the author's best-known titles lead instead of obscure reprints. Same retry +
  // cover-backfill machinery as the text path.
  if (author) {
    const q = `author:"${author.replace(/"/g, "")}"`
    let results: BookSearchResult[]
    try {
      results = await withRetry(
        () =>
          fetchOpenLibrary(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&sort=readinglog&limit=24&fields=${OPEN_LIBRARY_FIELDS}`,
            OL_TEXT_TIMEOUT_MS,
          ),
        { attempts: 2, backoffMs: 400 },
      )
    } catch {
      return NextResponse.json(
        { results: [], error: "Couldn't load this author's books. Try again." },
        { status: 504 },
      )
    }
    await backfillCovers(results)
    return NextResponse.json({ results })
  }

  // ── Barcode path: Google Books (ISBN-exact) biblio + Open Library cover ───────
  if (isbn) {
    if (!/^(\d{9}[0-9Xx]|\d{13})$/.test(isbn)) {
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }

    // Hit both sources in parallel: Google Books for clean edition data, Open
    // Library (one call, retried for its lagging ISBN index) for cover_i +
    // workKey. Either may fail independently without sinking the lookup.
    const [gbRes, olRes] = await Promise.allSettled([
      fetchGoogleVolumeByIsbn(isbn),
      withRetry(
        () =>
          fetchOpenLibrary(
            `https://openlibrary.org/search.json?isbn=${isbn}&limit=1&fields=${OPEN_LIBRARY_FIELDS}`,
            OL_ISBN_TIMEOUT_MS,
          ),
        { attempts: 3, backoffMs: 350, retryOn: (r) => r.length === 0 },
      ),
    ])

    const gb = gbRes.status === "fulfilled" ? gbRes.value : null
    const ol = olRes.status === "fulfilled" ? olRes.value[0] : undefined

    // Google Books is the bibliographic source of truth; Open Library only fills
    // gaps when Google Books missed the book entirely (its data is normalized
    // downstream). Cover_i + workKey always come from Open Library.
    const title = gb?.title ?? ol?.title
    if (!title) {
      // Both sources came up empty (or errored): let the caller fall to manual.
      if (gbRes.status === "rejected" && olRes.status === "rejected") {
        return NextResponse.json({ results: [], error: "Lookup failed. Try again." }, { status: 504 })
      }
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }

    const result: BookSearchResult = {
      title,
      authors: gb && gb.authors.length > 0 ? gb.authors : (ol?.authors ?? []),
      isbn, // pin the scanned ISBN so the saved book keeps the exact code
      coverId: ol?.coverId,
      // Google thumbnail only when Open Library has no cover_i to render from.
      coverUrlFallback: ol?.coverId === undefined ? gb?.coverThumbnail : undefined,
      firstPublishYear: gb?.firstPublishYear ?? ol?.firstPublishYear,
      pageCount: gb?.pageCount ?? ol?.pageCount,
      workKey: ol?.workKey,
    }

    return NextResponse.json({ results: [result] })
  }

  // ── Text search path (secondary, no-ISBN): Open Library candidate list ────────
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
