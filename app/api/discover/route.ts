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

const UA = "LibraLex/0.14 (libra.adhdesigns.dev)"
const SUBJECT_TIMEOUT_MS = 9000
const MAX_SUBJECTS = 4 // bound the fan-out (one OL call each, in parallel)
const PER_SUBJECT = 14
const MAX_RESULTS = 40
const MAX_SUBJECT_TOKENS = 14 // trim each candidate's subject list to keep the payload sane

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

const fetchSubject = async (slug: string): Promise<OLSubjectWork[]> => {
  try {
    const res = await fetchWithTimeout(
      `https://openlibrary.org/subjects/${encodeURIComponent(slug)}.json?limit=${PER_SUBJECT}`,
      SUBJECT_TIMEOUT_MS,
    )
    if (!res.ok) return []
    const data = (await res.json()) as { works?: OLSubjectWork[] }
    return data.works ?? []
  } catch {
    return []
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

  // Fan out across subjects in parallel; merge, deduping by work key.
  const batches = await Promise.all(slugs.map(fetchSubject))
  const byKey = new Map<string, DiscoveryCandidate>()
  for (const works of batches) {
    for (const w of works) {
      const c = mapWork(w)
      if (c && !byKey.has(c.workKey)) byKey.set(c.workKey, c)
    }
  }

  return NextResponse.json({ results: [...byKey.values()].slice(0, MAX_RESULTS) })
}
