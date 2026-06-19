import { NextResponse } from "next/server"

// Catalog discovery (Recommendations v2, Phase 2). Given a set of subjects — the
// user's top taste subjects, or one book's subjects — expand them into candidate
// books from Open Library.
//
// We use search.json sorted by `readinglog` (how many readers have shelved a book)
// with a publication-year floor, NOT the /subjects/ endpoint. The subjects endpoint
// ranks by edition count, which buries everything under heavily-reprinted
// public-domain classics (Austen, Carroll, …) — so discovery only ever surfaced
// 50+-year-old books. readinglog reflects what people actually read today, so the
// pool skews contemporary while still carrying the rich subject[] the scorer needs.
//
// Runs server-side so no CORS and a descriptive UA reaches Open Library. Stateless:
// it knows nothing about the user — just subjects in, candidates out; the client
// ranks by taste and dedupes against the shelf + friends.
export const maxDuration = 30

const UA = "LibraLex/0.16 (libra.adhdesigns.dev)"
const OL_TIMEOUT_MS = 9000
const MAX_SUBJECTS = 4 // bound the fan-out (one OL call each, in parallel)
const PER_SUBJECT = 14
const MAX_RESULTS = 40
const MAX_SUBJECT_TOKENS = 14 // trim each candidate's subject list to keep the payload sane

// Recency floor: only works first published in/after this year are candidates, so
// public-domain classics drop out while modern classics (Watchmen '87, the '90s
// fantasy boom, …) stay. The ceiling is "next year" so just-published books count.
const YEAR_FLOOR = 1980
const YEAR_CEIL = new Date().getFullYear() + 1

const SEARCH_FIELDS = "key,title,author_name,cover_i,first_publish_year,subject"

// Open Library is slow (a few seconds per call), but a subject's popular books
// barely change day to day. Cache the mapped candidates per subject in module
// memory (persists across requests within a warm instance) so repeat views are
// instant. A slow/failed refetch falls back to the stale entry.
const SUBJECT_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const subjectCache = new Map<string, { candidates: DiscoveryCandidate[]; at: number }>()

export type DiscoveryCandidate = {
  workKey: string
  title: string
  authors: string[]
  coverId?: number
  firstPublishYear?: number
  subjects?: string[]
}

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

type OLSearchDoc = {
  key?: string
  title?: string
  author_name?: string[]
  cover_i?: number
  first_publish_year?: number
  subject?: string[]
}

const mapDoc = (d: OLSearchDoc): DiscoveryCandidate | null => {
  if (!d.key || !d.title) return null
  return {
    workKey: d.key,
    title: d.title,
    authors: d.author_name ?? [],
    coverId: typeof d.cover_i === "number" && d.cover_i > 0 ? d.cover_i : undefined,
    firstPublishYear: d.first_publish_year,
    subjects: d.subject?.slice(0, MAX_SUBJECT_TOKENS),
  }
}

// The popular, contemporary works tagged with one subject, for one page of the
// readinglog ranking. The subject is matched as a quoted phrase so multi-word
// stored subjects ("Fantasy fiction") resolve. `page` offsets into the ranking so
// the client can pull deeper titles to backfill dismissed picks — each page is
// cached independently (offset is part of the cache key).
const fetchSubject = async (subject: string, page: number): Promise<DiscoveryCandidate[]> => {
  const cacheKey = `${subject.trim().toLowerCase()}@${page}`
  const cached = subjectCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SUBJECT_CACHE_TTL_MS) return cached.candidates
  try {
    const q = `subject:"${subject.replace(/"/g, "")}" AND first_publish_year:[${YEAR_FLOOR} TO ${YEAR_CEIL}]`
    const url =
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
      `&sort=readinglog&limit=${PER_SUBJECT}&offset=${page * PER_SUBJECT}&fields=${SEARCH_FIELDS}`
    const res = await fetchWithTimeout(url, OL_TIMEOUT_MS)
    if (!res.ok) return cached?.candidates ?? []
    const data = (await res.json()) as { docs?: OLSearchDoc[] }
    const candidates = (data.docs ?? [])
      .map(mapDoc)
      .filter((c): c is DiscoveryCandidate => c !== null)
    subjectCache.set(cacheKey, { candidates, at: Date.now() })
    return candidates
  } catch {
    // Serve a stale entry on a slow/failed refetch rather than nothing.
    return cached?.candidates ?? []
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let subjects: string[] = []
  let page = 0
  try {
    const body = (await request.json()) as { subjects?: unknown; page?: unknown }
    if (Array.isArray(body.subjects)) {
      subjects = body.subjects.filter((s): s is string => typeof s === "string")
    }
    // Clamp the page into a sane window — page 0 is the popular head; deeper pages
    // backfill dismissals. The ceiling bounds the fan-out of slow OL calls.
    if (typeof body.page === "number" && Number.isFinite(body.page)) {
      page = Math.min(Math.max(Math.floor(body.page), 0), 10)
    }
  } catch {
    return NextResponse.json({ results: [] satisfies DiscoveryCandidate[] })
  }

  // Dedupe (case-insensitively) and cap the fan-out, keeping the original text.
  const seen = new Set<string>()
  const wanted: string[] = []
  for (const s of subjects) {
    const t = s.trim()
    const k = t.toLowerCase()
    if (t && !seen.has(k)) {
      seen.add(k)
      wanted.push(t)
    }
    if (wanted.length >= MAX_SUBJECTS) break
  }
  if (wanted.length === 0) {
    return NextResponse.json({ results: [] satisfies DiscoveryCandidate[] })
  }

  // Fan out across subjects in parallel (each cached); merge, deduping by work key.
  const batches = await Promise.all(wanted.map((s) => fetchSubject(s, page)))
  const byKey = new Map<string, DiscoveryCandidate>()
  for (const cands of batches) {
    for (const c of cands) {
      if (!byKey.has(c.workKey)) byKey.set(c.workKey, c)
    }
  }

  return NextResponse.json({ results: [...byKey.values()].slice(0, MAX_RESULTS) })
}
