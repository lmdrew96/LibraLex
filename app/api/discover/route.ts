import { NextResponse } from "next/server"

// Catalog discovery (Recommendations v2, Phase 2). Given a set of subjects — the
// user's top taste subjects, or one book's subjects — expand them into candidate
// books via Open Library's subjects endpoint. Each returned work carries a rich
// `subject[]` array (far more than search.json exposes), which is exactly the fuel
// the content recommender scores; the client ranks + dedupes against the shelf.
//
// Runs server-side so no CORS and a descriptive UA reaches Open Library. Stateless:
// it knows nothing about the user — just subjects in, candidates out.
export const maxDuration = 30

const UA = "LibraLex/0.16 (libra.adhdesigns.dev)"
const SUBJECT_TIMEOUT_MS = 9000
const MAX_SUBJECTS = 4 // bound the fan-out (one OL call each, in parallel)
const PER_SUBJECT = 14
const MAX_RESULTS = 40
const MAX_SUBJECT_TOKENS = 14 // trim each candidate's subject list to keep the payload sane

// The OL subjects endpoint is slow (several seconds per call), but a subject's
// popular works barely change day to day. Cache the mapped candidates per slug in
// module memory (persists across requests within a warm instance) so repeat views
// are instant. A slow/failed refetch falls back to the stale entry.
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

// "Fantasy fiction" → "fantasy_fiction". OL's subjects endpoint matches these
// slugified free-text subjects, so most stored subjects resolve; a miss just
// returns no works (graceful — other subjects still contribute).
const slugify = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

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

type OLSubjectWork = {
  key?: string
  title?: string
  authors?: Array<{ name?: string }>
  cover_id?: number
  first_publish_year?: number
  subject?: string[]
}

const fetchSubject = async (slug: string): Promise<DiscoveryCandidate[]> => {
  const cached = subjectCache.get(slug)
  if (cached && Date.now() - cached.at < SUBJECT_CACHE_TTL_MS) return cached.candidates
  try {
    const res = await fetchWithTimeout(
      `https://openlibrary.org/subjects/${encodeURIComponent(slug)}.json?limit=${PER_SUBJECT}`,
      SUBJECT_TIMEOUT_MS,
    )
    if (!res.ok) return cached?.candidates ?? []
    const data = (await res.json()) as { works?: OLSubjectWork[] }
    const candidates = (data.works ?? [])
      .map(mapWork)
      .filter((c): c is DiscoveryCandidate => c !== null)
    subjectCache.set(slug, { candidates, at: Date.now() })
    return candidates
  } catch {
    // Serve a stale entry on a slow/failed refetch rather than nothing.
    return cached?.candidates ?? []
  }
}

const mapWork = (w: OLSubjectWork): DiscoveryCandidate | null => {
  if (!w.key || !w.title) return null
  return {
    workKey: w.key,
    title: w.title,
    authors: (w.authors ?? [])
      .map((a) => a.name)
      .filter((n): n is string => Boolean(n)),
    coverId: typeof w.cover_id === "number" && w.cover_id > 0 ? w.cover_id : undefined,
    firstPublishYear: w.first_publish_year,
    subjects: w.subject?.slice(0, MAX_SUBJECT_TOKENS),
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let subjects: string[] = []
  try {
    const body = (await request.json()) as { subjects?: unknown }
    if (Array.isArray(body.subjects)) {
      subjects = body.subjects.filter((s): s is string => typeof s === "string")
    }
  } catch {
    return NextResponse.json({ results: [] satisfies DiscoveryCandidate[] })
  }

  const slugs = [...new Set(subjects.map(slugify).filter(Boolean))].slice(0, MAX_SUBJECTS)
  if (slugs.length === 0) {
    return NextResponse.json({ results: [] satisfies DiscoveryCandidate[] })
  }

  // Fan out across subjects in parallel (each cached per slug); merge, deduping
  // by work key.
  const batches = await Promise.all(slugs.map(fetchSubject))
  const byKey = new Map<string, DiscoveryCandidate>()
  for (const cands of batches) {
    for (const c of cands) {
      if (!byKey.has(c.workKey)) byKey.set(c.workKey, c)
    }
  }

  return NextResponse.json({ results: [...byKey.values()].slice(0, MAX_RESULTS) })
}
