import { NextResponse } from "next/server"
import type { BookInfo } from "@/lib/types"
import { fetchVolumeByIsbn, fetchVolumesByQuery } from "@/convex/googleBooks"

// On-demand book enrichment: summary + subjects, from Google Books. Result is
// stable reference data (same for every user), so we cache it hard and never
// store it on the book record. Only reached for books the enrich-once pipeline
// hasn't already cached (an older record, or one still mid-enrich) — a normal
// cached book renders straight from its stored fields with zero external calls.

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "")

type DescriptionResult = { description?: string; subjects: string[] }

// ISBN-exact query trusts the single match directly. Without an ISBN (or when the
// ISBN match had no usable description), a title+author query with a loose
// title-overlap guard so we don't attach a different book's blurb. `langRestrict`
// biases toward the English edition. Keyless Google Books shares a global daily
// quota (HTTP 429); set GOOGLE_BOOKS_API_KEY to raise it — no code change needed.
const fetchDescription = async (
  isbn: string | undefined,
  title: string,
  author: string | undefined,
): Promise<DescriptionResult> => {
  if (isbn) {
    const volume = await fetchVolumeByIsbn(isbn, { langRestrict: "en" })
    if (volume?.description) {
      return { description: volume.description, subjects: volume.categories }
    }
  }

  try {
    const q = [`intitle:${title}`, author ? `inauthor:${author}` : ""].filter(Boolean).join("+")
    const volumes = await fetchVolumesByQuery(q, { maxResults: 5, langRestrict: "en" })
    const want = normalizeTitle(title)
    const key = want.slice(0, 12)
    const match = volumes.find((v) => {
      if (!v.description) return false
      const got = normalizeTitle(v.title)
      return Boolean(got) && (got.includes(key) || want.includes(got.slice(0, 12)))
    })
    return { description: match?.description, subjects: match?.categories ?? [] }
  } catch {
    return { description: undefined, subjects: [] }
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const title = params.get("title")?.trim() ?? ""
  const author = params.get("author")?.trim() || undefined
  const isbn = params.get("isbn")?.replace(/[^0-9Xx]/g, "") || undefined

  let description: string | undefined
  let subjects: string[] = []

  if (isbn || title) {
    const result = await fetchDescription(isbn, title, author)
    description = result.description
    subjects = result.subjects
  }

  const body: BookInfo = { description, subjects }
  return NextResponse.json(body, {
    headers: {
      // Stable, user-agnostic reference data — cache hard at the edge.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
