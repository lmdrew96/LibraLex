import { NextResponse } from "next/server"
import type { BookInfo } from "@/lib/types"

// On-demand book enrichment: summary, subjects, author bios. Source strategy
// mirrors /api/search — Open Library primary, iTunes (keyless) as the fallback
// for descriptions OL lacks. Google Books is intentionally NOT used here: keyless
// Google is globally quota-throttled (429), so it can't be relied on. Result is
// stable reference data (same for every user), so we cache it hard and never
// store it on the book record.

const UA = "LibraLex/0.4 (libra.adhdesigns.dev)"
const OL_TIMEOUT_MS = 8000
const ITUNES_TIMEOUT_MS = 3000
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

// iTunes descriptions are HTML — strip tags and decode the common entities.
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
  return {
    description: descRaw ? cleanOpenLibrary(descRaw) : undefined,
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

// Keyless iTunes description fallback, guarded by a loose title-overlap check so
// we don't attach a different book's blurb (same guard as the cover fallback).
const fetchItunesDescription = async (
  title: string,
  author: string | undefined,
): Promise<string | undefined> => {
  try {
    const term = [title, author].filter(Boolean).join(" ")
    const res = await fetchWithTimeout(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=ebook&limit=5`,
      ITUNES_TIMEOUT_MS,
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as {
      results?: Array<{ description?: string; trackName?: string }>
    }
    const want = normalizeTitle(title)
    const key = want.slice(0, 12)
    const match = (data.results ?? []).find((item) => {
      if (!item.description) return false
      const got = normalizeTitle(item.trackName ?? "")
      return Boolean(got) && (got.includes(key) || want.includes(got.slice(0, 12)))
    })
    return match?.description ? stripHtml(match.description) : undefined
  } catch {
    return undefined
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const workKey = params.get("workKey")?.trim() ?? ""
  const title = params.get("title")?.trim() ?? ""
  const author = params.get("author")?.trim() || undefined

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
      // fall through to the iTunes description fallback
    }
  }

  // 2) iTunes fallback for the description when OL had none.
  if (!description && title) {
    description = await fetchItunesDescription(title, author)
  }

  const body: BookInfo = { description, subjects, authors }
  return NextResponse.json(body, {
    headers: {
      // Stable, user-agnostic reference data — cache hard at the edge.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
