import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import { fetchVolumesByQuery, type GoogleVolume } from "./googleBooks"
import { embedBookWithRetry } from "./embed"
import { GENRE_SUBJECTS } from "./discoverCache"

// One-off seed for the broad "ask for a book" catalog (convex/search.ts) —
// independent of any user's shelf. Pulls a deep pool per genre from Google Books
// (much deeper than discoverCache's carousel pool, which is intentionally
// shallow), embeds each candidate (Gemini) using the description Google's search
// response already carries, and stores it. Cross-genre deduped by workKey and
// resumable: re-running a genre skips anything already stored, so a timed-out or
// interrupted run just picks up where it left off.
//
// Run once per genre from the CLI — get the list with:
//   npx convex run catalog:_genreSubjects
// then for each: npx convex run catalog:seedCatalogForGenre '{"subject": "fantasy"}'

const PER_PAGE = 40 // Google Books caps maxResults at 40/request
const PAGES = 8 // up to 320 raw candidates/genre before dedup
const YEAR_FLOOR = 1980
const MAX_SUBJECT_TOKENS = 14
const DEFAULT_MAX_NEW = 150 // cap on newly-embedded books per genre call

type Candidate = {
  workKey: string
  title: string
  authors: string[]
  coverUrlFallback?: string
  firstPublishYear?: number
  subjects?: string[]
  description?: string
}

const toCandidate = (v: GoogleVolume): Candidate => ({
  workKey: v.id,
  title: v.title,
  authors: v.authors,
  coverUrlFallback: v.thumbnail,
  firstPublishYear: v.year,
  subjects: v.categories.slice(0, MAX_SUBJECT_TOKENS),
  description: v.description,
})

// One Google Books page for (subject, page) — mirrors discoverCache's fetchPage,
// but this module fetches far more pages since it's a one-off deep seed, not a
// carousel cache refreshed daily.
const fetchPage = async (subject: string, page: number, yearCeil: number): Promise<Candidate[]> => {
  try {
    const volumes = await fetchVolumesByQuery(`subject:"${subject.replace(/"/g, "")}"`, {
      startIndex: page * PER_PAGE,
      maxResults: PER_PAGE,
      langRestrict: "en",
    })
    return volumes
      .filter((v) => v.year !== undefined && v.year >= YEAR_FLOOR && v.year <= yearCeil)
      .map(toCandidate)
  } catch {
    return []
  }
}

const fetchGenreDeep = async (subject: string): Promise<Candidate[]> => {
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
  return out
}

export const _genreSubjects = internalQuery({
  args: {},
  handler: (): string[] => GENRE_SUBJECTS,
})

// Indexed point-lookups per candidate workKey, NOT a full table scan — the
// catalog grows across every genre call, and collect()-ing the whole table
// (including each row's 1536-float embedding) blows past Convex's 16MB
// per-execution read limit once the catalog gets into the hundreds of rows.
// Bounded by this genre's candidate count (≤ a few hundred), not table size.
export const _existingWorkKeys = internalQuery({
  args: { workKeys: v.array(v.string()) },
  handler: async (ctx, { workKeys }): Promise<string[]> => {
    const existing: string[] = []
    for (const key of workKeys) {
      const row = await ctx.db
        .query("catalogBooks")
        .withIndex("by_workKey", (q) => q.eq("workKey", key))
        .unique()
      if (row) existing.push(key)
    }
    return existing
  },
})

export const _insertCatalogBook = internalMutation({
  args: {
    workKey: v.string(),
    title: v.string(),
    authors: v.array(v.string()),
    coverUrlFallback: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    subjects: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("catalogBooks")
      .withIndex("by_workKey", (q) => q.eq("workKey", args.workKey))
      .unique()
    if (existing) return // another genre's run inserted it first (cross-genre overlap)
    await ctx.db.insert("catalogBooks", { ...args, seededAt: Date.now() })
  },
})

export const seedCatalogForGenre = internalAction({
  args: { subject: v.string(), maxNew: v.optional(v.number()) },
  handler: async (
    ctx,
    { subject, maxNew = DEFAULT_MAX_NEW },
  ): Promise<{ subject: string; fetched: number; inserted: number; skippedExisting: number; failed: number }> => {
    const candidates = await fetchGenreDeep(subject)
    const existingKeys = new Set(
      await ctx.runQuery(internal.catalog._existingWorkKeys, {
        workKeys: candidates.map((c) => c.workKey),
      }),
    )
    const fresh = candidates.filter((c) => !existingKeys.has(c.workKey)).slice(0, maxNew)

    let inserted = 0
    let failed = 0
    for (const c of fresh) {
      const embedding = await embedBookWithRetry({
        title: c.title,
        authors: c.authors,
        description: c.description,
        subjects: c.subjects,
      })
      if (!embedding) {
        failed++
        continue
      }

      await ctx.runMutation(internal.catalog._insertCatalogBook, {
        workKey: c.workKey,
        title: c.title,
        authors: c.authors,
        coverUrlFallback: c.coverUrlFallback,
        firstPublishYear: c.firstPublishYear,
        subjects: c.subjects,
        description: c.description,
        embedding,
      })
      inserted++
    }

    return {
      subject,
      fetched: candidates.length,
      inserted,
      skippedExisting: candidates.length - fresh.length,
      failed,
    }
  },
})
