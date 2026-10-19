import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"
import { fetchJsonWithTimeout, fetchVolumesByQuery, type GoogleVolume } from "@/convex/googleBooks"

// Server-side book search — Google Books for search, author catalog, and
// ISBN/barcode lookup; Open Library backs up the barcode path only (see
// fetchOpenLibraryByIsbn). Runs server-side so no CORS and no key reaches the
// client. Client debounces (~500ms).
export const maxDuration = 30

const toSearchResult = (v: GoogleVolume): BookSearchResult => ({
  title: v.title,
  authors: v.authors,
  isbn: v.isbn,
  coverUrlFallback: v.thumbnail,
  firstPublishYear: v.year,
  pageCount: v.pageCount,
  workKey: v.id,
})

const ISBN_RE = /^(\d{9}[0-9Xx]|\d{13})$/

// Successful lookups are cached by the browser for a few minutes, so backspacing
// or retyping a query doesn't spend another Google request. Private: the route
// sits behind Clerk.
const CACHE_HEADERS = { "Cache-Control": "private, max-age=300" }

type OpenLibraryBook = {
  title?: string
  subtitle?: string
  authors?: Array<{ name?: string }>
  number_of_pages?: number
  publish_date?: string
  cover?: { small?: string; medium?: string; large?: string }
}

/** Barcode fallback for ISBNs Google doesn't index. Null on miss or any failure —
 *  it only ever turns a dead end into a hit. Keyless, so it costs no Google quota.
 *  The saved book still gets Google enrichment server-side when Google has it. */
const fetchOpenLibraryByIsbn = async (isbn: string): Promise<BookSearchResult | null> => {
  try {
    const { ok, json } = await fetchJsonWithTimeout(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`,
      4000,
    )
    const book = ok ? (json as Record<string, OpenLibraryBook> | null)?.[`ISBN:${isbn}`] : undefined
    if (!book?.title) return null
    const year = book.publish_date?.match(/\d{4}/)?.[0]
    const cover = book.cover?.large ?? book.cover?.medium
    return {
      title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
      authors: (book.authors ?? []).map((a) => a.name).filter((n): n is string => Boolean(n)),
      isbn,
      coverUrlFallback: cover ? cover.replace(/^http:\/\//, "https://") : undefined,
      firstPublishYear: year ? Number(year) : undefined,
      pageCount: book.number_of_pages && book.number_of_pages > 0 ? book.number_of_pages : undefined,
    }
  } catch (err) {
    console.error("/api/search Open Library lookup failed:", err instanceof Error ? err.message : err)
    return null
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const query = params.get("q")?.trim() ?? ""
  const author = params.get("author")?.trim() ?? ""
  // A typed ISBN in the search box takes the exact-lookup path too.
  const typedIsbn = query.replace(/[\s-]/g, "")
  const isbn = (params.get("isbn") ?? (ISBN_RE.test(typedIsbn) ? typedIsbn : "")).replace(
    /[^0-9Xx]/g,
    "",
  )

  // ── Author path: one author's catalog ──────────────────────────────────────
  // Powers the /author/[name] page ("see more of their work"). Quoted phrase so
  // multi-word names resolve.
  if (author) {
    try {
      const volumes = await fetchVolumesByQuery(`inauthor:"${author}"`, {
        maxResults: 24,
        langRestrict: "en",
      })
      return NextResponse.json({ results: volumes.map(toSearchResult) }, { headers: CACHE_HEADERS })
    } catch (err) {
      console.error("/api/search author lookup failed:", err instanceof Error ? err.message : err)
      return NextResponse.json(
        { results: [], error: "Couldn't load this author's books. Try again." },
        { status: 504 },
      )
    }
  }

  // ── Barcode path: ISBN-exact lookup ────────────────────────────────────────
  // Google first; Open Library when Google has no match (its ISBN index misses
  // plenty of small-press and graphic-novel editions) or is down/rate-limited.
  // A Google failure that Open Library can't cover reads as an error, not as
  // "we couldn't find that book".
  if (isbn) {
    if (!ISBN_RE.test(isbn)) {
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }
    let googleFailed = false
    try {
      const [volume] = await fetchVolumesByQuery(`isbn:${isbn}`, { maxResults: 1 })
      // Pin the scanned ISBN so the saved book keeps the exact code even if Google's
      // matched edition reports a different one.
      if (volume) {
        return NextResponse.json({ results: [{ ...toSearchResult(volume), isbn }] }, { headers: CACHE_HEADERS })
      }
    } catch (err) {
      googleFailed = true
      console.error("/api/search ISBN lookup failed:", err instanceof Error ? err.message : err)
    }
    const fromOpenLibrary = await fetchOpenLibraryByIsbn(isbn)
    if (fromOpenLibrary) {
      return NextResponse.json({ results: [fromOpenLibrary] }, { headers: CACHE_HEADERS })
    }
    if (googleFailed) {
      return NextResponse.json(
        { results: [], error: "Book lookup is unavailable right now. Try again in a minute." },
        { status: 504 },
      )
    }
    return NextResponse.json({ results: [] satisfies BookSearchResult[] }, { headers: CACHE_HEADERS })
  }

  // ── Text search path ────────────────────────────────────────────────────────
  if (query.length < 2) {
    return NextResponse.json({ results: [] satisfies BookSearchResult[] })
  }
  try {
    const volumes = await fetchVolumesByQuery(query, { maxResults: 10, langRestrict: "en" })
    return NextResponse.json({ results: volumes.map(toSearchResult) }, { headers: CACHE_HEADERS })
  } catch (err) {
    console.error("/api/search text search failed:", err instanceof Error ? err.message : err)
    return NextResponse.json(
      { results: [], error: "Search is unavailable right now. Try again." },
      { status: 504 },
    )
  }
}
