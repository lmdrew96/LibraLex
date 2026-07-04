import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import { fetchOpenLibraryWork } from "./enrich"
import { embedBookWithRetry } from "./embed"
import { GENRE_SUBJECTS } from "./discoverCache"

// One-off seed for the broad "ask for a book" catalog (convex/search.ts) —
// independent of any user's shelf. Pulls a deep pool per genre from Open
// Library (much deeper than discoverCache's carousel pool, which is
// intentionally shallow), enriches each candidate with its OL work
// description, embeds it (Gemini), and stores it. Cross-genre deduped by
// workKey and resumable: re-running a genre skips anything already stored, so
// a timed-out or interrupted run just picks up where it left off.
//
// Run once per genre from the CLI — get the list with:
//   npx convex run catalog:_genreSubjects
// then for each: npx convex run catalog:seedCatalogForGenre '{"subject": "fantasy"}'

const UA = "LibraLex/0.40 (libra.adhdesigns.dev)"
const OL_TIMEOUT_MS = 9000
const PER_PAGE = 100
const PAGES = 3 // up to 300 raw candidates/genre before dedup
const YEAR_FLOOR = 1980
const MAX_SUBJECT_TOKENS = 14
const SEARCH_FIELDS = "key,title,author_name,cover_i,first_publish_year,subject"
const DEFAULT_MAX_NEW = 150 // cap on newly-embedded books per genre call

type OLCandidate = {
  workKey: string
  title: string
  authors: string[]
  coverId?: number
  firstPublishYear?: number
  subjects?: string[]
}

type OLDoc = {
  key?: string
  title?: string
  author_name?: string[]
  cover_i?: number
  first_publish_year?: number
  subject?: string[]
}

const mapDoc = (d: OLDoc): OLCandidate | null => {
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

// One OL page for (subject, page) — mirrors discoverCache's fetchPage, but this
// module fetches far more pages/page-size since it's a one-off deep seed, not a
// carousel cache refreshed daily.
const fetchPage = async (subject: string, page: number, yearCeil: number): Promise<OLCandidate[]> => {
  const q = `subject:"${subject.replace(/"/g, "")}" AND language:eng AND first_publish_year:[${YEAR_FLOOR} TO ${yearCeil}]`
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&sort=readinglog&limit=${PER_PAGE}&offset=${page * PER_PAGE}&fields=${SEARCH_FIELDS}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OL_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { docs?: OLDoc[] }
    return (data.docs ?? []).map(mapDoc).filter((c): c is OLCandidate => c !== null)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

const fetchGenreDeep = async (subject: string): Promise<OLCandidate[]> => {
  const yearCeil = new Date().getFullYear() + 1
  const out: OLCandidate[] = []
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
    coverId: v.optional(v.number()),
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
      const work = await fetchOpenLibraryWork(c.workKey)
      const description = work?.description
      const subjects = work?.subjects.length ? work.subjects.slice(0, MAX_SUBJECT_TOKENS) : c.subjects

      const embedding = await embedBookWithRetry({
        title: c.title,
        authors: c.authors,
        description,
        subjects,
      })
      if (!embedding) {
        failed++
        continue
      }

      await ctx.runMutation(internal.catalog._insertCatalogBook, {
        workKey: c.workKey,
        title: c.title,
        authors: c.authors,
        coverId: c.coverId,
        firstPublishYear: c.firstPublishYear,
        subjects,
        description,
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
