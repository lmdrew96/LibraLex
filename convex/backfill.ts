import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { enrichBook } from "./enrich"
import { embedBookWithRetry } from "./embed"

// One-off (re-runnable) enrich + normalize backfill for the existing shelf.
// INTERNAL — not client-exposed; run from the CLI against whichever deployment
// holds the real data:
//   npx convex run backfill:enrichAllBooks '{"dryRun": true}'   # preview
//   npx convex run backfill:enrichAllBooks '{"dryRun": false}'  # apply
//
// Reuses the same enrichBook engine as the add path, so a backfilled record is
// identical to a freshly-enriched one: Google Books bibliographic (prose authors,
// edition year, cover, description, categories), normalized; comics keep their
// stored creators. Also embeds (Gemini) any book that doesn't have a vector yet,
// using the freshly-merged description/subjects.
//
// Also the mechanism that clears every legacy row's Open Library coverId: this
// mutation unconditionally patches coverId to undefined on every row it touches
// — the intended way to retire OL cover rendering after the Google Books
// migration (see components/book-cover.tsx). IMPORTANT: `undefined` is not a
// valid Convex function-argument value — a caller passing `coverId: undefined`
// through ctx.runMutation() has that key silently dropped before it reaches this
// handler, so patch() never sees it and leaves the old value in place. coverId is
// therefore NOT accepted as an arg at all; the clear is built directly inside the
// handler's own db.patch() call, which is the one context where an explicit
// `undefined` value is honored (it removes the field — see Convex's "Working
// with undefined" docs).
//
// Requires GOOGLE_BOOKS_API_KEY and GEMINI_API_KEY in the deployment env
// (un-referrer-restricted):
//   npx convex env set GOOGLE_BOOKS_API_KEY <key>
//   npx convex env set GEMINI_API_KEY <key>

export const _allBooks = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"books">[]> => ctx.db.query("books").collect(),
})

export const _applyEnrichment = internalMutation({
  args: {
    id: v.id("books"),
    authors: v.array(v.string()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    description: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    subjects: v.optional(v.array(v.string())),
    averageRating: v.optional(v.number()),
    ratingsCount: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, { ...fields, coverId: undefined })
  },
})

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

type BackfillChange = {
  title: string
  authors?: { before: string[]; after: string[] }
  year?: { before: number | undefined; after: number | undefined }
  addedSubjects?: number
  addedDescription?: boolean
  addedRating?: boolean
  addedEmbedding?: boolean
  clearedCoverId?: boolean
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

      // Never blank a populated field when a flaky fetch comes back empty — the
      // enrichment sources are non-deterministic run-to-run, so re-runs must only
      // add/improve, never erase. (Biblio fields already fall back to the existing
      // values inside enrichBook, so they can't go empty here. coverId is the one
      // exception — it's not part of `next` at all; _applyEnrichment clears it
      // unconditionally in its own db.patch() call, since `undefined` can't
      // survive as a cross-function argument — see that mutation's comment.)
      const willClearCoverId = b.coverId !== undefined
      const next = {
        authors: enriched.authors,
        coverUrlFallback: enriched.coverUrlFallback,
        workKey: enriched.workKey,
        firstPublishYear: enriched.firstPublishYear,
        pageCount: enriched.pageCount,
        description: enriched.description ?? b.description,
        categories: enriched.categories ?? b.categories,
        subjects: enriched.subjects ?? b.subjects,
        averageRating: enriched.averageRating ?? b.averageRating,
        ratingsCount: enriched.ratingsCount ?? b.ratingsCount,
        embedding: b.embedding,
      }

      // Embedding is a separate (costlier) call, so only attempt it when the book
      // doesn't already have one — same preserve-on-empty rule as the biblio
      // fields: a failed embed leaves `embedding` at its existing value (undefined).
      const embeddingMissing = !b.embedding || b.embedding.length === 0
      if (embeddingMissing) {
        const embedded = await embedBookWithRetry({
          title: b.title,
          authors: next.authors,
          description: next.description,
          subjects: next.subjects,
        })
        if (embedded) next.embedding = embedded
      }

      const changedFields =
        !sameJson(next.authors, b.authors) ||
        next.firstPublishYear !== b.firstPublishYear ||
        next.pageCount !== b.pageCount ||
        willClearCoverId ||
        next.coverUrlFallback !== b.coverUrlFallback ||
        next.workKey !== b.workKey ||
        next.description !== b.description ||
        !sameJson(next.categories, b.categories) ||
        !sameJson(next.subjects, b.subjects) ||
        next.averageRating !== b.averageRating ||
        next.ratingsCount !== b.ratingsCount ||
        next.embedding !== b.embedding

      if (!changedFields) continue

      const change: BackfillChange = { title: b.title }
      if (!sameJson(next.authors, b.authors)) change.authors = { before: b.authors, after: next.authors }
      if (next.firstPublishYear !== b.firstPublishYear)
        change.year = { before: b.firstPublishYear, after: next.firstPublishYear }
      if (!b.subjects?.length && next.subjects?.length) change.addedSubjects = next.subjects.length
      if (!b.description && next.description) change.addedDescription = true
      if (b.averageRating === undefined && next.averageRating !== undefined) change.addedRating = true
      if (embeddingMissing && next.embedding) change.addedEmbedding = true
      if (willClearCoverId) change.clearedCoverId = true
      changes.push(change)

      if (!dryRun) {
        await ctx.runMutation(internal.backfill._applyEnrichment, { id: b._id, ...next })
      }
    }

    return { dryRun, total: books.length, changed: changes.length, changes }
  },
})
