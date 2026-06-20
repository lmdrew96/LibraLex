import { NextResponse } from "next/server"
import { ConvexHttpClient } from "convex/browser"
import { api } from "@/convex/_generated/api"

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

// Convex client for the precomputed discovery cache (convex/discoverCache.ts, refreshed
// daily by a cron). It's the fast, reliable source for the fixed genre subjects; the
// per-user taste subjects on the Recs row aren't precomputed and fall through to OL.
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL
const convexClient = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null

// Edge cache (Vercel CDN) for healthy responses — the real speed/reliability win: a
// warm (subject, page) is served from the edge with no function run and no OL call,
// surviving the cold starts that wipe the module cache above. 6h fresh, then serve
// stale for another day while revalidating in the background. Empty/failed payloads
// use no-store so a transient OL dud can't pin an empty row at the edge for hours.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" }
const NO_CACHE_HEADERS = { "Cache-Control": "no-store" }

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
// One Open Library fetch for (subject, page). Throws on a non-OK response so the
// retry/caller can distinguish failure from a legitimately empty result.
const fetchSubjectOnce = async (subject: string, page: number): Promise<DiscoveryCandidate[]> => {
  // `language:eng` keeps auto-recommendations English — it filters server-side to
  // works with an English edition (whose OL work title is reliably English), so a
  // Portuguese/Spanish title never reaches the Discover row and the page stays full.
  const q = `subject:"${subject.replace(/"/g, "")}" AND language:eng AND first_publish_year:[${YEAR_FLOOR} TO ${YEAR_CEIL}]`
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&sort=readinglog&limit=${PER_SUBJECT}&offset=${page * PER_SUBJECT}&fields=${SEARCH_FIELDS}`
  const res = await fetchWithTimeout(url, OL_TIMEOUT_MS)
  if (!res.ok) throw new Error(`Open Library responded ${res.status}`)
  const data = (await res.json()) as { docs?: OLSearchDoc[] }
  return (data.docs ?? []).map(mapDoc).filter((c): c is DiscoveryCandidate => c !== null)
}

const fetchSubject = async (subject: string, page: number): Promise<DiscoveryCandidate[]> => {
  // 1. Precomputed Convex pool (daily cron) — the fast, reliable path for genre
  //    subjects. The whole deep pool ships on page 0; deeper pages are empty for a
  //    cached subject (the carousel reads it all at once and stops paginating).
  //    try/catch so an unreachable / not-yet-deployed Convex just falls through to OL.
  if (convexClient) {
    try {
      const precomputed = await convexClient.query(api.discoverCache.getBySubject, { subject })
      if (precomputed.length > 0) return page === 0 ? precomputed : []
    } catch {
      // Convex unreachable or function not deployed yet — fall through to live OL.
    }
  }

  // 2. Module cache + live OL (the fallback for not-yet-precomputed subjects, e.g.
  //    per-user taste subjects, and until the cron first runs).
  const cacheKey = `${subject.trim().toLowerCase()}@${page}`
  const cached = subjectCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SUBJECT_CACHE_TTL_MS) return cached.candidates

  // Open Library's search index is eventually-consistent: a valid subject query can
  // return an empty 200 on the first hit and resolve on a retry — the same lag
  // /api/search documents and retries for its ISBN path. Page 0 is the base pool the
  // Discover row renders from, so an un-retried empty there is what surfaced as the
  // row "occasionally showing only two books": the flaky empty got cached for the
  // full 6h TTL and served to every request on that warm instance. So: retry page 0
  // on an empty batch, and NEVER cache an empty result — a transient dud must not
  // poison the cache. Deeper pages (backfill) aren't retried: there an empty just
  // means the catalog ran dry for that subject, which is a real signal, not flakiness.
  const RETRIES = page === 0 ? 3 : 1
  try {
    let candidates: DiscoveryCandidate[] = []
    for (let i = 0; i < RETRIES; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 350 * i))
      candidates = await fetchSubjectOnce(subject, page)
      if (candidates.length > 0) break
    }
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
  // deeper pages backfill dismissals; the ceiling bounds the OL fan-out.
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
  // Only edge-cache a healthy, non-empty payload — never pin an empty (a transient OL
  // failure or a tapped-out deep page) at the CDN for the full window.
  return NextResponse.json(
    { results },
    { headers: results.length > 0 ? CACHE_HEADERS : NO_CACHE_HEADERS },
  )
}
