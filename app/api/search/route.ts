import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"
import { fetchVolumeByIsbn, fetchVolumesByQuery, type GoogleVolume } from "@/convex/googleBooks"

// Server-side book search — Google Books only (search, author catalog, and
// ISBN/barcode lookup all resolve here; covers come from Google's thumbnail URL,
// no separate cover source). Runs server-side so no CORS and no key reaches the
// client. Client debounces (~300ms).
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

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const isbn = (params.get("isbn") ?? "").replace(/[^0-9Xx]/g, "")
  const query = params.get("q")?.trim() ?? ""
  const author = params.get("author")?.trim() ?? ""

  // ── Author path: one author's catalog ──────────────────────────────────────
  // Powers the /author/[name] page ("see more of their work"). Quoted phrase so
  // multi-word names resolve.
  if (author) {
    try {
      const volumes = await fetchVolumesByQuery(`inauthor:"${author}"`, {
        maxResults: 24,
        langRestrict: "en",
      })
      return NextResponse.json({ results: volumes.map(toSearchResult) })
    } catch {
      return NextResponse.json(
        { results: [], error: "Couldn't load this author's books. Try again." },
        { status: 504 },
      )
    }
  }

  // ── Barcode path: ISBN-exact lookup ────────────────────────────────────────
  if (isbn) {
    if (!/^(\d{9}[0-9Xx]|\d{13})$/.test(isbn)) {
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }
    const volume = await fetchVolumeByIsbn(isbn)
    if (!volume) {
      return NextResponse.json({ results: [] satisfies BookSearchResult[] })
    }
    // Pin the scanned ISBN so the saved book keeps the exact code even if Google's
    // matched edition reports a different one.
    return NextResponse.json({ results: [{ ...toSearchResult(volume), isbn }] })
  }

  // ── Text search path ────────────────────────────────────────────────────────
  if (query.length < 2) {
    return NextResponse.json({ results: [] satisfies BookSearchResult[] })
  }
  try {
    const volumes = await fetchVolumesByQuery(query, { maxResults: 10, langRestrict: "en" })
    return NextResponse.json({ results: volumes.map(toSearchResult) })
  } catch {
    return NextResponse.json(
      { results: [], error: "Search is unavailable right now. Try again." },
      { status: 504 },
    )
  }
}
