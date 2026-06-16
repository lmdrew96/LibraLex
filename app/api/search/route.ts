import { NextResponse } from "next/server"
import type { BookSearchResult } from "@/lib/types"

// Server-side book search. Open Library is primary (its cover_i ids render
// covers with no rate limit); Google Books backfills a thumbnail URL only for
// results Open Library has no cover for. Runs server-side so no CORS and no key
// ever reaches the client. Client debounces (~300ms) — we don't debounce here.

const OPEN_LIBRARY_FIELDS =
  "title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median,key"

// Bound worst-case Google Books calls per search (most OL results have a cover_i).
const MAX_COVER_BACKFILLS = 6
const FETCH_TIMEOUT_MS = 4000

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
      FETCH_TIMEOUT_MS,
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

export async function GET(request: Request): Promise<NextResponse> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
  if (query.length < 2) {
    return NextResponse.json({ results: [] satisfies BookSearchResult[] })
  }

  let results: BookSearchResult[]
  try {
    const res = await fetchWithTimeout(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=${OPEN_LIBRARY_FIELDS}`,
      FETCH_TIMEOUT_MS,
    )
    if (!res.ok) {
      return NextResponse.json(
        { results: [], error: "Search is unavailable right now." },
        { status: 502 },
      )
    }
    const data = (await res.json()) as { docs?: OpenLibraryDoc[] }
    results = (data.docs ?? []).map(mapDoc).filter((b): b is BookSearchResult => b !== null)
  } catch {
    return NextResponse.json(
      { results: [], error: "Search timed out. Try again." },
      { status: 504 },
    )
  }

  // Backfill covers Open Library lacks, in parallel, capped and fault-tolerant.
  const needsCover = results.filter((b) => b.coverId === undefined && b.isbn)
  await Promise.allSettled(
    needsCover.slice(0, MAX_COVER_BACKFILLS).map(async (book) => {
      const cover = await fetchGoogleCover(book.isbn!)
      if (cover) book.coverUrlFallback = cover
    }),
  )

  return NextResponse.json({ results })
}
