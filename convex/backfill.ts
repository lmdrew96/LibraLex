import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { enrichBook } from "./enrich"

// One-off (re-runnable) enrich + normalize backfill for the existing shelf.
// INTERNAL — not client-exposed; run from the CLI against whichever deployment
// holds the real data:
//   npx convex run backfill:enrichAllBooks '{"dryRun": true}'   # preview
//   npx convex run backfill:enrichAllBooks '{"dryRun": false}'  # apply
//
// Reuses the same enrichBook engine as the add path, so a backfilled record is
// identical to a freshly-enriched one: GB bibliographic (prose authors, edition
// year, description, categories) + OL (cover_i, work subjects, author bios),
// normalized; comics keep their stored creators.
//
// Requires GOOGLE_BOOKS_API_KEY in the deployment env (un-referrer-restricted):
//   npx convex env set GOOGLE_BOOKS_API_KEY <key>

const authorBiosValidator = v.optional(
  v.array(v.object({ name: v.string(), bio: v.optional(v.string()) })),
)

export const _allBooks = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"books">[]> => ctx.db.query("books").collect(),
})

export const _applyEnrichment = internalMutation({
  args: {
    id: v.id("books"),
    authors: v.array(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    description: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    subjects: v.optional(v.array(v.string())),
    authorBios: authorBiosValidator,
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields)
  },
})

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

type BackfillChange = {
  title: string
  authors?: { before: string[]; after: string[] }
  year?: { before: number | undefined; after: number | undefined }
  addedSubjects?: number
  addedDescription?: boolean
  addedBios?: number
}
type BackfillResult = {
  dryRun: boolean
  total: number
  changed: number
  changes: BackfillChange[]
}

// Re-enrich every book through the shared engine and patch what changed. Pass
// { dryRun: true } to preview without writing.
export const enrichAllBooks = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun = true }): Promise<BackfillResult> => {
    const books = await ctx.runQuery(internal.backfill._allBooks, {})
    const changes: BackfillChange[] = []

    for (const b of books) {
      const enriched = await enrichBook({
        title: b.title,
        authors: b.authors,
        isbn: b.isbn,
        coverId: b.coverId,
        coverUrlFallback: b.coverUrlFallback,
        workKey: b.workKey,
        firstPublishYear: b.firstPublishYear,
        pageCount: b.pageCount,
      })

      const next = {
        authors: enriched.authors,
        coverId: enriched.coverId,
        coverUrlFallback: enriched.coverUrlFallback,
        workKey: enriched.workKey,
        firstPublishYear: enriched.firstPublishYear,
        pageCount: enriched.pageCount,
        description: enriched.description,
        categories: enriched.categories,
        subjects: enriched.subjects,
        authorBios: enriched.authorBios,
      }

      const changedFields =
        !sameJson(next.authors, b.authors) ||
        next.firstPublishYear !== b.firstPublishYear ||
        next.pageCount !== b.pageCount ||
        next.coverId !== b.coverId ||
        next.coverUrlFallback !== b.coverUrlFallback ||
        next.workKey !== b.workKey ||
        next.description !== b.description ||
        !sameJson(next.categories, b.categories) ||
        !sameJson(next.subjects, b.subjects) ||
        !sameJson(next.authorBios, b.authorBios)

      if (!changedFields) continue

      const change: BackfillChange = { title: b.title }
      if (!sameJson(next.authors, b.authors)) change.authors = { before: b.authors, after: next.authors }
      if (next.firstPublishYear !== b.firstPublishYear)
        change.year = { before: b.firstPublishYear, after: next.firstPublishYear }
      if (!b.subjects?.length && next.subjects?.length) change.addedSubjects = next.subjects.length
      if (!b.description && next.description) change.addedDescription = true
      if (!b.authorBios?.length && next.authorBios?.length) change.addedBios = next.authorBios.length
      changes.push(change)

      if (!dryRun) {
        await ctx.runMutation(internal.backfill._applyEnrichment, { id: b._id, ...next })
      }
    }

    return { dryRun, total: books.length, changed: changes.length, changes }
  },
})
