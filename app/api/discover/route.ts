import { NextResponse } from "next/server"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"
import { fetchVolumesByQuery, type GoogleVolume } from "@/convex/googleBooks"

// Catalog discovery (Recommendations v2, Phase 2). Given a set of subjects — the
// user's top taste subjects, or one book's subjects — expand them into candidate
// books from Google Books' `subject:` search operator.
//
// Runs server-side so no CORS and a descriptive UA reaches Google. Stateless: it
// knows nothing about the user — just subjects in, candidates out; the client
// ranks by taste and dedupes against the shelf + friends.
export const maxDuration = 30

const MAX_SUBJECTS = 4 // bound the fan-out (one Google call each, in parallel)
const PER_SUBJECT = 14
const MAX_RESULTS = 40
const MAX_SUBJECT_TOKENS = 14 // trim each candidate's subject list to keep the payload sane

// Recency floor: only works first published in/after this year are candidates, so
// public-domain classics drop out while modern classics (Watchmen '87, the '90s
// fantasy boom, …) stay. The ceiling is "next year" so just-published books count.
// Google Books' query syntax has no date-range operator, so this is applied as a
// post-fetch filter below (unlike Open Library's old `first_publish_year:[...]`
// query clause).
const YEAR_FLOOR = 1980
const YEAR_CEIL = new Date().getFullYear() + 1

// Convex client for the precomputed discovery cache (convex/discoverCache.ts, refreshed
// daily by a cron). It's the fast, reliable source for the fixed genre subjects; the
// per-user taste subjects on the Recs row aren't precomputed and fall through to live
// Google Books.
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL
const convexClient = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null

// Edge cache (Vercel CDN) for healthy responses — the real speed/reliability win: a
// warm (subject, page) is served from the edge with no function run and no Google
// call, surviving the cold starts that wipe the module cache above. 6h fresh, then
// serve stale for another day while revalidating in the background. Empty/failed
// payloads use no-store so a transient dud can't pin an empty row at the edge for
// hours.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" }
const NO_CACHE_HEADERS = { "Cache-Control": "no-store" }

export type DiscoveryCandidate = {
  workKey: string
  title: string
  authors: string[]
  coverUrlFallback?: string
  firstPublishYear?: number
  subjects?: string[]
}

const toCandidate = (v: GoogleVolume): DiscoveryCandidate => ({
  workKey: v.id,
  title: v.title,
  authors: v.authors,
  coverUrlFallback: v.thumbnail,
  firstPublishYear: v.year,
  subjects: v.categories.slice(0, MAX_SUBJECT_TOKENS),
})

// Module-memory cache per (subject, page) — a subject's popular books barely
// change day to day. Persists across requests within a warm instance so repeat
// views are instant. A slow/failed refetch falls back to the stale entry.
const SUBJECT_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const subjectCache = new Map<string, { candidates: DiscoveryCandidate[]; at: number }>()

// One subject/page batch: Google Books `subject:"X"`, English-restricted, filtered
// to the recency floor post-fetch (no query-string equivalent exists). `page`
// offsets into the ranking so the client can pull deeper titles to backfill
// dismissed/added picks.
const fetchSubjectOnce = async (subject: string, page: number): Promise<DiscoveryCandidate[]> => {
  const volumes = await fetchVolumesByQuery(`subject:"${subject.replace(/"/g, "")}"`, {
    startIndex: page * PER_SUBJECT,
    maxResults: PER_SUBJECT,
    langRestrict: "en",
  })
  return volumes
    .filter((v) => v.year !== undefined && v.year >= YEAR_FLOOR && v.year <= YEAR_CEIL)
    .map(toCandidate)
}

// Pages already folded into discoverCache's precomputed pool (mirrors PAGES in
// convex/discoverCache.ts) — a precomputed subject's live-Google backfill
// continues from here instead of re-fetching (and discarding as duplicates)
// pages already cached.
const PRECOMPUTED_PAGES = 3

const fetchSubject = async (subject: string, page: number): Promise<DiscoveryCandidate[]> => {
  // 1. Precomputed Convex pool (daily cron) — the fast, reliable path for genre
  //    subjects. Page 0 ships the whole precomputed pool instantly. Deeper pages
  //    (the carousel backfilling after shelf/dismiss exclusions thin the row
  //    below its buffer target) fall through to live Google below, continuing
  //    past the pages the precompute already covered.
  //    try/catch so an unreachable / not-yet-deployed Convex just falls through.
  let livePage = page
  if (convexClient) {
    try {
      const precomputed = await convexClient.query(api.discoverCache.getBySubject, { subject })
      if (precomputed.length > 0) {
        if (page === 0) return precomputed
        livePage = PRECOMPUTED_PAGES + (page - 1)
      }
    } catch {
      // Convex unreachable or function not deployed yet — fall through to live Google.
    }
  }

  // 2. Module cache + live Google Books (the fallback for not-yet-precomputed
  //    subjects, e.g. per-user taste subjects, and until the cron first runs —
  //    plus deep backfill pages for precomputed genre subjects once their row
  //    runs low).
  const cacheKey = `${subject.trim().toLowerCase()}@${livePage}`
  const cached = subjectCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SUBJECT_CACHE_TTL_MS) return cached.candidates

  try {
    const candidates = await fetchSubjectOnce(subject, livePage)
    // Only cache a healthy (non-empty) batch — caching an empty would serve it for
    // the whole TTL. An empty falls back to any prior good entry for this key.
    if (candidates.length > 0) {
      subjectCache.set(cacheKey, { candidates, at: Date.now() })
      return candidates
    }
    return cached?.candidates ?? []
  } catch {
    // Serve a stale entry on a slow/failed refetch rather than nothing.
    return cached?.candidates ?? []
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  // Repeated ?subject= params (not a delimited list) so subject phrases keep any
  // punctuation. page clamps into the same window — page 0 is the popular head;
  // deeper pages backfill dismissals; the ceiling bounds the Google fan-out.
  const rawSubjects = params.getAll("subject")
  const pageRaw = Number(params.get("page") ?? "0")
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(Math.floor(pageRaw), 0), 10) : 0

  // Dedupe (case-insensitively) and cap the fan-out, keeping the original text.
  const seen = new Set<string>()
  const wanted: string[] = []
  for (const s of rawSubjects) {
    const t = s.trim()
    const k = t.toLowerCase()
    if (t && !seen.has(k)) {
      seen.add(k)
      wanted.push(t)
    }
    if (wanted.length >= MAX_SUBJECTS) break
  }
  if (wanted.length === 0) {
    return NextResponse.json(
      { results: [] satisfies DiscoveryCandidate[] },
      { headers: NO_CACHE_HEADERS },
    )
  }

  // Fan out across subjects in parallel (each cached); merge, deduping by work key.
  const batches = await Promise.all(wanted.map((s) => fetchSubject(s, page)))
  const byKey = new Map<string, DiscoveryCandidate>()
  for (const cands of batches) {
    for (const c of cands) {
      if (!byKey.has(c.workKey)) byKey.set(c.workKey, c)
    }
  }

  const results = [...byKey.values()].slice(0, MAX_RESULTS)
  // Only edge-cache a healthy, non-empty payload — never pin an empty (a transient
  // failure or a tapped-out deep page) at the CDN for the full window.
  return NextResponse.json(
    { results },
    { headers: results.length > 0 ? CACHE_HEADERS : NO_CACHE_HEADERS },
  )
}
