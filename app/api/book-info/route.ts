import { NextResponse } from "next/server"
import type { BookInfo } from "@/lib/types"
import { isLikelyEnglish } from "@/convex/normalize"

// On-demand book enrichment: summary, subjects, author bios. Open Library is the
// source for subjects + author bios (OL-native data Google Books doesn't expose);
// when OL has no description, Google Books fills it in (ISBN-exact when we have
// the ISBN, else a title+author query). iTunes is retired. Result is stable
// reference data (same for every user), so we cache it hard and never store it on
// the book record.

const UA = "LibraLex/0.4 (libra.adhdesigns.dev)"
const OL_TIMEOUT_MS = 8000
const GOOGLE_TIMEOUT_MS = 3000
const MAX_AUTHORS = 2
const MAX_SUBJECTS = 12

const fetchWithTimeout = async (url: string, ms: number): Promise<Response> => {
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

// Open Library text fields come as either a plain string or `{ type, value }`.
const asText = (v: unknown): string | undefined => {
  if (typeof v === "string") return v
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as { value?: unknown }).value
    if (typeof inner === "string") return inner
  }
  return undefined
}

// OL descriptions/bios are user-edited markdown that we render as plain text, so
// normalize them: drop the trailing dashed "source" footer, remove inline links
// (almost always promo/download spam in this data) and emphasis markers, and
// collapse the whitespace the removals leave behind.
const cleanOpenLibrary = (raw: string): string =>
  raw
    .split(/\r?\n\s*-{3,}/)[0] // dashed source footer
    .replace(/\(\[source\]\[\d+\]\)/gi, "") // ([source][1]) marker
    .replace(/\r?\n\s*\[\d+\]:\s*\S+/g, "") // [1]: http… footnote defs
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1") // ref-style [text][1] → text
    .replace(/\[[^\]]*\]\([^)]*\)/g, "") // inline [text](url) → remove
    .replace(/\*+/g, "") // markdown emphasis markers
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

// Google Books descriptions can carry light HTML (<p>, <br>, <b>) — strip tags
// and decode the common entities so we render clean plain text.
const stripHtml = (html: string): string =>
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

const normalizeTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "")

type OpenLibraryWork = {
  description?: unknown
  subjects?: string[]
  authors?: Array<{ author?: { key?: string } }>
}

// Fetch description + subjects + author keys from an OL work record.
const fetchWork = async (
  workKey: string,
): Promise<{ description?: string; subjects: string[]; authorKeys: string[] }> => {
  const res = await fetchWithTimeout(`https://openlibrary.org${workKey}.json`, OL_TIMEOUT_MS)
  if (!res.ok) throw new Error(`Open Library work ${res.status}`)
  const work = (await res.json()) as OpenLibraryWork
  const descRaw = asText(work.description)
  const desc = descRaw ? cleanOpenLibrary(descRaw) : undefined
  return {
    // OL has no language tag on the work, so the text guard keeps a non-English
    // summary out (the Google Books fallback below, English-restricted, takes over).
    description: desc && isLikelyEnglish(desc) ? desc : undefined,
    subjects: (work.subjects ?? []).slice(0, MAX_SUBJECTS),
    authorKeys: (work.authors ?? [])
      .map((a) => a.author?.key)
      .filter((k): k is string => Boolean(k))
      .slice(0, MAX_AUTHORS),
  }
}

// Resolve one author record to a name + (best-effort) bio.
const fetchAuthor = async (
  key: string,
): Promise<{ name: string; bio?: string } | null> => {
  try {
    const res = await fetchWithTimeout(`https://openlibrary.org${key}.json`, OL_TIMEOUT_MS)
    if (!res.ok) return null
    const a = (await res.json()) as { name?: string; bio?: unknown }
    if (!a.name) return null
    const bioRaw = asText(a.bio)
    return { name: a.name, bio: bioRaw ? cleanOpenLibrary(bioRaw) : undefined }
  } catch {
    return null
  }
}

// Google Books description fallback for books Open Library has no summary for.
// Prefers an ISBN-exact query (no guard needed — exact match); without an ISBN it
// falls back to a title+author query with a loose title-overlap guard so we don't
// attach a different book's blurb. Keyless Google Books shares a global daily
// quota (HTTP 429); set GOOGLE_BOOKS_API_KEY to raise it — no code change needed.
const fetchGoogleDescription = async (
  isbn: string | undefined,
  title: string,
  author: string | undefined,
): Promise<string | undefined> => {
  try {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY
    const keyParam = apiKey ? `&key=${apiKey}` : ""

    // Only keep an English blurb: trust GB's language tag when present, fall back to
    // the text guard when it's absent.
    const isEnglishDesc = (desc: string, lang: string | undefined): boolean =>
      (!lang || lang.toLowerCase().startsWith("en")) && isLikelyEnglish(desc)

    // ISBN-exact: trust items[0] directly.
    if (isbn) {
      const res = await fetchWithTimeout(
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1${keyParam}`,
        GOOGLE_TIMEOUT_MS,
      )
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{ volumeInfo?: { description?: string; language?: string } }>
        }
        const info = data.items?.[0]?.volumeInfo
        const desc = info?.description ? stripHtml(info.description) : undefined
        if (desc && isEnglishDesc(desc, info?.language)) return desc
      }
    }

    // No ISBN (or ISBN missed): title+author query with an overlap guard.
    // `langRestrict=en` biases Google toward the English edition's blurb.
    const q = [`intitle:${title}`, author ? `inauthor:${author}` : ""].filter(Boolean).join("+")
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&langRestrict=en${keyParam}`,
      GOOGLE_TIMEOUT_MS,
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as {
      items?: Array<{ volumeInfo?: { description?: string; title?: string; language?: string } }>
    }
    const want = normalizeTitle(title)
    const key = want.slice(0, 12)
    const match = (data.items ?? []).find((item) => {
      const info = item.volumeInfo
      if (!info?.description) return false
      if (!isEnglishDesc(stripHtml(info.description), info.language)) return false
      const got = normalizeTitle(info.title ?? "")
      return Boolean(got) && (got.includes(key) || want.includes(got.slice(0, 12)))
    })
    return match?.volumeInfo?.description ? stripHtml(match.volumeInfo.description) : undefined
  } catch {
    return undefined
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const workKey = params.get("workKey")?.trim() ?? ""
  const title = params.get("title")?.trim() ?? ""
  const author = params.get("author")?.trim() || undefined
  const isbn = params.get("isbn")?.replace(/[^0-9Xx]/g, "") || undefined

  let description: string | undefined
  let subjects: string[] = []
  let authors: BookInfo["authors"] = []

  // 1) Open Library work (when we have a stable work key).
  if (/^\/works\/OL\w+W$/.test(workKey)) {
    try {
      const work = await fetchWork(workKey)
      description = work.description
      subjects = work.subjects
      const resolved = await Promise.all(work.authorKeys.map(fetchAuthor))
      authors = resolved.filter((a): a is { name: string; bio?: string } => a !== null)
    } catch {
      // fall through to the Google Books description fallback
    }
  }

  // 2) Google Books fallback for the description when OL had none.
  if (!description && (isbn || title)) {
    description = await fetchGoogleDescription(isbn, title, author)
  }

  const body: BookInfo = { description, subjects, authors }
  return NextResponse.json(body, {
    headers: {
      // Stable, user-agnostic reference data — cache hard at the edge.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
