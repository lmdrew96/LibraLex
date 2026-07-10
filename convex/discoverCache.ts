import { internalAction, internalMutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import { fetchVolumesByQuery, type GoogleVolume } from "./googleBooks"

// Precomputed catalog-discovery cache. A daily cron (convex/crons.ts) fans out to
// Google Books for each genre subject and stores the work-deduped, relevance-ranked
// pool here, so the genre browse carousels read popular-by-genre straight from the
// DB — instant, and never blocked on a live Google call at render time. The
// /api/discover route reads getBySubject first and only hits Google Books for
// subjects that aren't cached (e.g. the per-user taste subjects on the Recs row).
//
// The Google Books query below MIRRORS app/api/discover/route.ts — keep the two in sync.

// The genre subjects to precompute. MUST mirror the `subject` values in lib/genres.ts
// (the frontend source of truth; Convex can't import it, so the list is duplicated —
// add a genre there, add its subject here). Exported for convex/catalog.ts, which
// seeds its own (much deeper) one-off pull across the same genre set.
export const GENRE_SUBJECTS = [
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

const PER_SUBJECT = 14
const PAGES = 3 // ~42 candidates/subject — deep enough that a carousel never paginates
const MAX_STORED = 42
const YEAR_FLOOR = 1980
const MAX_SUBJECT_TOKENS = 14

type Candidate = {
  // Google Books volume id (edition-level, not a true cross-edition work id).
  workKey: string
  title: string
  authors: string[]
  coverId?: number // DEPRECATED — legacy OL cover_i, unused for new candidates
  coverUrlFallback?: string // Google Books thumbnail
  firstPublishYear?: number
  subjects?: string[] // Google Books categories (coarse)
}

const candidateValidator = v.object({
  workKey: v.string(),
  title: v.string(),
  authors: v.array(v.string()),
  coverId: v.optional(v.number()),
  coverUrlFallback: v.optional(v.string()),
  firstPublishYear: v.optional(v.number()),
  subjects: v.optional(v.array(v.string())),
})

const toCandidate = (v: GoogleVolume): Candidate => ({
  workKey: v.id,
  title: v.title,
  authors: v.authors,
  coverUrlFallback: v.thumbnail,
  firstPublishYear: v.year,
  subjects: v.categories.slice(0, MAX_SUBJECT_TOKENS),
})

// One Google Books page for (subject, page), English-restricted, filtered to the
// recency floor post-fetch (no query-string date-range operator exists in Google's
// `q=` syntax, unlike Open Library's old first_publish_year clause). Returns [] on
// any failure — the caller keeps a subject's prior cache rather than overwriting it
// with an empty (see refreshAll).
const fetchPage = async (subject: string, page: number, yearCeil: number): Promise<Candidate[]> => {
  try {
    const volumes = await fetchVolumesByQuery(`subject:"${subject.replace(/"/g, "")}"`, {
      startIndex: page * PER_SUBJECT,
      maxResults: PER_SUBJECT,
      langRestrict: "en",
    })
    return volumes
      .filter((v) => v.year !== undefined && v.year >= YEAR_FLOOR && v.year <= yearCeil)
      .map(toCandidate)
  } catch {
    return []
  }
}

// A subject's deep pool: PAGES of Google Books merged + work-deduped, capped. Stops
// early once the catalog runs dry for the subject.
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
// /api/discover route then falls back to a live Google Books fetch for that subject.
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

// Refresh every genre subject's pool from Google Books. Run daily by the cron, and
// re-runnable from the CLI to seed/refresh on demand:
//   npx convex run discoverCache:refreshAll
// A subject whose fetch comes back empty (a Google hiccup) keeps its prior cached pool.
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
