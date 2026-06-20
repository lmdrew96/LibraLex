import { internalAction, internalMutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"

// Precomputed catalog-discovery cache. A daily cron (convex/crons.ts) fans out to Open
// Library for each genre subject and stores the work-deduped, readinglog-ranked pool
// here, so the genre browse carousels read popular-by-genre straight from the DB —
// instant, and never blocked on OL's slow search at render time. The /api/discover
// route reads getBySubject first and only hits OL for subjects that aren't cached
// (e.g. the per-user taste subjects on the Recs row).
//
// The OL query below MIRRORS app/api/discover/route.ts — keep the two in sync.

// The genre subjects to precompute. MUST mirror the `subject` values in lib/genres.ts
// (the frontend source of truth; Convex can't import it, so the list is duplicated —
// add a genre there, add its subject here).
const GENRE_SUBJECTS = [
  "fantasy",
  "science fiction",
  "mystery",
  "thriller",
  "romance",
  "horror",
  "historical fiction",
  "literary fiction",
  "young adult fiction",
  "graphic novels",
  "nonfiction",
  "biography",
  "history",
  "science",
  "poetry",
  "self-help",
]

const UA = "LibraLex/0.34 (libra.adhdesigns.dev)"
const OL_TIMEOUT_MS = 9000
const PER_SUBJECT = 14
const PAGES = 3 // ~42 candidates/subject — deep enough that a carousel never paginates
const MAX_STORED = 42
const YEAR_FLOOR = 1980
const MAX_SUBJECT_TOKENS = 14
const SEARCH_FIELDS = "key,title,author_name,cover_i,first_publish_year,subject"

type Candidate = {
  workKey: string
  title: string
  authors: string[]
  coverId?: number
  firstPublishYear?: number
  subjects?: string[]
}

const candidateValidator = v.object({
  workKey: v.string(),
  title: v.string(),
  authors: v.array(v.string()),
  coverId: v.optional(v.number()),
  firstPublishYear: v.optional(v.number()),
  subjects: v.optional(v.array(v.string())),
})

type OLDoc = {
  key?: string
  title?: string
  author_name?: string[]
  cover_i?: number
  first_publish_year?: number
  subject?: string[]
}

const mapDoc = (d: OLDoc): Candidate | null => {
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

// One OL page for (subject, page), readinglog-ranked, English + recency-floored.
// Returns [] on any failure — the caller keeps a subject's prior cache rather than
// overwriting it with an empty (see refreshAll).
const fetchPage = async (subject: string, page: number, yearCeil: number): Promise<Candidate[]> => {
  const q = `subject:"${subject.replace(/"/g, "")}" AND language:eng AND first_publish_year:[${YEAR_FLOOR} TO ${yearCeil}]`
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&sort=readinglog&limit=${PER_SUBJECT}&offset=${page * PER_SUBJECT}&fields=${SEARCH_FIELDS}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OL_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { docs?: OLDoc[] }
    return (data.docs ?? []).map(mapDoc).filter((c): c is Candidate => c !== null)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

// A subject's deep pool: PAGES of OL merged + work-deduped, capped. Stops early once
// the catalog runs dry for the subject.
const fetchSubjectDeep = async (subject: string): Promise<Candidate[]> => {
  const yearCeil = new Date().getFullYear() + 1
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (let page = 0; page < PAGES; page++) {
    const batch = await fetchPage(subject, page, yearCeil)
    if (batch.length === 0) break
    for (const c of batch) {
      if (!seen.has(c.workKey)) {
        seen.add(c.workKey)
        out.push(c)
      }
    }
  }
  return out.slice(0, MAX_STORED)
}

// Read a subject's precomputed pool. Returns [] when not yet cached — the
// /api/discover route then falls back to a live OL fetch for that subject.
export const getBySubject = query({
  args: { subject: v.string() },
  handler: async (ctx, { subject }): Promise<Candidate[]> => {
    const row = await ctx.db
      .query("discoveryCache")
      .withIndex("by_subject", (q) => q.eq("subject", subject.trim().toLowerCase()))
      .unique()
    return row?.candidates ?? []
  },
})

// Upsert one subject's pool. Internal — only refreshAll calls it.
export const storeSubject = internalMutation({
  args: { subject: v.string(), candidates: v.array(candidateValidator) },
  handler: async (ctx, { subject, candidates }) => {
    const key = subject.trim().toLowerCase()
    const existing = await ctx.db
      .query("discoveryCache")
      .withIndex("by_subject", (q) => q.eq("subject", key))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, { candidates, refreshedAt: Date.now() })
    } else {
      await ctx.db.insert("discoveryCache", { subject: key, candidates, refreshedAt: Date.now() })
    }
  },
})

// Refresh every genre subject's pool from Open Library. Run daily by the cron, and
// re-runnable from the CLI to seed/refresh on demand:
//   npx convex run discoverCache:refreshAll
// A subject whose fetch comes back empty (OL hiccup) keeps its prior cached pool.
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ subject: string; count: number }[]> => {
    return await Promise.all(
      GENRE_SUBJECTS.map(async (subject) => {
        const candidates = await fetchSubjectDeep(subject)
        if (candidates.length > 0) {
          await ctx.runMutation(internal.discoverCache.storeSubject, { subject, candidates })
        }
        return { subject, count: candidates.length }
      }),
    )
  },
})
