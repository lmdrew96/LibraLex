import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"
import { fetchVolumesByQuery, type GoogleVolume } from "@/convex/googleBooks"
import { fetchOpenLibraryByIsbn, searchOpenLibrary } from "@/convex/openLibrary"

// Server-side book search — Google Books for search, author catalog, and
// ISBN/barcode lookup; Open Library (convex/openLibrary.ts) backs up the
// barcode and typed-search paths. Runs server-side so no CORS and no key
// reaches the client. The client only searches on submit.
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

// Why Google failed, labeled for the logs: a 429 is the daily quota, a 5xx is
// Google having trouble, an abort is our timeout.
const describeFailure = (err: unknown): string => {
  if (err instanceof Error && err.name === "AbortError") return "timeout"
  const msg = err instanceof Error ? err.message : String(err)
  const status = msg.match(/responded (\d{3})/)?.[1]
  if (status === "429") return `quota/rate limit (429) — ${msg}`
  return status ? `upstream ${status} — ${msg}` : msg
}

const STOPWORDS = new Set(["the", "a", "an", "and", "of", "to", "in", "on", "for", "by"])
const words = (s: string): string[] =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))

// Conservative "did Google find it?" check: some result's title + authors
// contain every main word of the query. "Stand Still Stay Silent" → Google's
// webcomics guides and dictionaries fail it; "Minna Sundberg" passes on author.
const hasPlausibleMatch = (results: BookSearchResult[], query: string): boolean => {
  const wanted = words(query)
  if (wanted.length === 0) return results.length > 0
  return results.some((r) => {
    const have = new Set(words(`${r.title} ${r.authors.join(" ")}`))
    return wanted.every((w) => have.has(w))
  })
}

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
      console.error("/api/search author lookup failed:", describeFailure(err))
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
      console.error("/api/search ISBN lookup failed:", describeFailure(err))
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
  // Google first; Open Library when Google fails or nothing it returned looks
  // like the query. Only an outage on both sides reads as an error — a query
  // neither catalog knows is "no matches".
  let fromGoogle: BookSearchResult[] = []
  let googleFailed = false
  try {
    const volumes = await fetchVolumesByQuery(query, { maxResults: 10, langRestrict: "en" })
    fromGoogle = volumes.map(toSearchResult)
  } catch (err) {
    googleFailed = true
    console.error("/api/search text search failed:", describeFailure(err))
  }
  if (!googleFailed && hasPlausibleMatch(fromGoogle, query)) {
    return NextResponse.json({ results: fromGoogle }, { headers: CACHE_HEADERS })
  }
  const fromOpenLibrary = await searchOpenLibrary(query)
  if (fromOpenLibrary?.length) {
    return NextResponse.json({ results: fromOpenLibrary }, { headers: CACHE_HEADERS })
  }
  if (googleFailed && fromOpenLibrary === null) {
    return NextResponse.json(
      { results: [], error: "Search is unavailable right now. Try again." },
      { status: 504 },
    )
  }
  return NextResponse.json({ results: fromGoogle }, { headers: CACHE_HEADERS })
}
