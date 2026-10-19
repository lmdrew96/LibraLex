import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"
import { fetchVolumesByQuery, type GoogleVolume } from "@/convex/googleBooks"

// Server-side book search — Google Books only (search, author catalog, and
// ISBN/barcode lookup all resolve here; covers come from Google's thumbnail URL,
// no separate cover source). Runs server-side so no CORS and no key reaches the
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
  // Throwing lookup (not the fault-tolerant fetchVolumeByIsbn) so a Google
  // outage or rate limit reads as an error, not as "we couldn't find that book".
  if (isbn) {
    if (!ISBN_RE.test(isbn)) {
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }
    try {
      const [volume] = await fetchVolumesByQuery(`isbn:${isbn}`, { maxResults: 1 })
      if (!volume) {
        return NextResponse.json({ results: [] satisfies BookSearchResult[] }, { headers: CACHE_HEADERS })
      }
      // Pin the scanned ISBN so the saved book keeps the exact code even if Google's
      // matched edition reports a different one.
      return NextResponse.json({ results: [{ ...toSearchResult(volume), isbn }] }, { headers: CACHE_HEADERS })
    } catch (err) {
      console.error("/api/search ISBN lookup failed:", err instanceof Error ? err.message : err)
      return NextResponse.json(
        { results: [], error: "Book lookup is unavailable right now. Try again in a minute." },
        { status: 504 },
      )
    }
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
