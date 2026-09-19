import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { enrichBook } from "./enrich"
import {
  fetchCoverByTitle,
  fetchTitleMatchWith,
  fetchVolumeByIsbn,
  isSameBook,
  type GoogleVolume,
} from "./googleBooks"
import { embedBookWithRetry } from "./embed"
import { rollTasteVector } from "./tasteVector"
import { identityKey } from "./discover"

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

// One page of the table. Paged so no single query reads every book (with their
// 1536-float embeddings) at once — that's what hits Convex's per-query read limit.
export const _booksPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    { cursor },
  ): Promise<{ page: Doc<"books">[]; cursor: string; isDone: boolean }> => {
    const res = await ctx.db.query("books").paginate({ cursor, numItems: 50 })
    return { page: res.page, cursor: res.continueCursor, isDone: res.isDone }
  },
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
    const book = await ctx.db.get(id)
    if (!book) return
    await ctx.db.patch(id, { ...fields, coverId: undefined })
    // Same rule as the add path: a read/reading book's first vector joins the taste vector.
    const gotFirstEmbedding = !book.embedding?.length && (fields.embedding?.length ?? 0) > 0
    if (gotFirstEmbedding && (book.readStatus === "read" || book.readStatus === "reading")) {
      await rollTasteVector(ctx, book.userId, fields.embedding!)
    }
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
    const books: Doc<"books">[] = []
    let cursor: string | null = null
    for (;;) {
      const res: { page: Doc<"books">[]; cursor: string; isDone: boolean } = await ctx.runQuery(
        internal.backfill._booksPage,
        { cursor },
      )
      books.push(...res.page)
      if (res.isDone) break
      cursor = res.cursor
    }
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

// ── Covers-only backfill ────────────────────────────────────────────────────
// Finds books with no cover (no Google thumbnail, no upload) and looks one up —
// the ISBN edition's cover, else the same title's cover (fetchCoverByTitle). It
// writes ONLY coverUrlFallback, and only while it's still empty, so it can't
// disturb authors/years the way a full enrichAllBooks pass would.
//   npx convex run --prod backfill:backfillMissingCovers '{"dryRun": true}'

export const _setCoverIfMissing = internalMutation({
  args: { id: v.id("books"), coverUrlFallback: v.string() },
  handler: async (ctx, { id, coverUrlFallback }): Promise<boolean> => {
    const book = await ctx.db.get(id)
    if (!book || book.coverUrlFallback || book.coverStorageId) return false
    await ctx.db.patch(id, { coverUrlFallback })
    return true
  },
})

export const backfillMissingCovers = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { dryRun = true },
  ): Promise<{ dryRun: boolean; missing: number; found: string[]; stillMissing: string[] }> => {
    const missing: Doc<"books">[] = []
    let cursor: string | null = null
    for (;;) {
      const res: { page: Doc<"books">[]; cursor: string; isDone: boolean } = await ctx.runQuery(
        internal.backfill._booksPage,
        { cursor },
      )
      missing.push(...res.page.filter((b) => !b.coverUrlFallback && !b.coverStorageId))
      if (res.isDone) break
      cursor = res.cursor
    }

    const found: string[] = []
    const stillMissing: string[] = []
    for (const b of missing) {
      const byIsbn = b.isbn ? await fetchVolumeByIsbn(b.isbn) : null
      const cover = byIsbn?.thumbnail ?? (await fetchCoverByTitle(b.title, b.authors[0]))
      if (!cover) {
        stillMissing.push(b.title)
        continue
      }
      found.push(b.title)
      if (!dryRun) {
        await ctx.runMutation(internal.backfill._setCoverIfMissing, { id: b._id, coverUrlFallback: cover })
      }
    }
    return { dryRun, missing: missing.length, found, stillMissing }
  },
})

// ── Legacy-row repair: Open Library workKeys + missing descriptions ─────────
// Two gaps left by the Open Library → Google Books migration:
//  • workKey still "/works/OL…W" on most older rows, so those books never share an
//    identity (dedupe, community ratings) with the same book added from Google.
//    Swapped for the Google volume id ONLY on a confident match — the row's own
//    ISBN edition, else an English title search whose title AND first author match
//    exactly (isSameBook) — and never onto an id another of the user's rows has.
//  • empty or stub (<15 words) descriptions, filled from the ISBN edition or the
//    English title match. Nothing else on the row is touched.
//   npx convex run --prod backfill:repairLegacyRows '{"dryRun": true}'

const isLegacyWorkKey = (k: string | undefined): boolean => Boolean(k?.startsWith("/works/"))
const isStubDescription = (d: string | undefined): boolean =>
  !d || d.trim().split(/\s+/).length < 15

export const _applyRepair = internalMutation({
  args: {
    id: v.id("books"),
    workKey: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, workKey, description }) => {
    const book = await ctx.db.get(id)
    if (!book) return
    const patch: Partial<Doc<"books">> = {}
    if (workKey && isLegacyWorkKey(book.workKey)) patch.workKey = workKey
    if (description && isStubDescription(book.description)) patch.description = description
    if (Object.keys(patch).length) await ctx.db.patch(id, patch)
  },
})

type Repair = { title: string; workKey?: { from: string; to: string; via: "isbn" | "title" }; description?: boolean }

export const repairLegacyRows = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { dryRun = true },
  ): Promise<{
    dryRun: boolean
    scanned: number
    repairs: Repair[]
    keyCollisions: string[]
    unmatchedKeys: string[]
  }> => {
    const rows: Doc<"books">[] = []
    let cursor: string | null = null
    for (;;) {
      const res: { page: Doc<"books">[]; cursor: string; isDone: boolean } = await ctx.runQuery(
        internal.backfill._booksPage,
        { cursor },
      )
      rows.push(...res.page)
      if (res.isDone) break
      cursor = res.cursor
    }

    // Identity keys each user already holds — a swap must not collide with one.
    const keysByUser = new Map<string, Set<string>>()
    for (const b of rows) {
      const set = keysByUser.get(b.userId) ?? new Set<string>()
      set.add(identityKey(b))
      keysByUser.set(b.userId, set)
    }

    const repairs: Repair[] = []
    const keyCollisions: string[] = []
    const unmatchedKeys: string[] = []

    for (const b of rows) {
      const needsKey = isLegacyWorkKey(b.workKey)
      const needsDesc = isStubDescription(b.description)
      if (!needsKey && !needsDesc) continue

      const byIsbn: GoogleVolume | null = b.isbn ? await fetchVolumeByIsbn(b.isbn) : null
      const repair: Repair = { title: b.title }
      let newKey: string | undefined
      let newDesc: string | undefined

      if (needsKey) {
        let match: { id: string; via: "isbn" | "title" } | null =
          byIsbn && isSameBook(b, byIsbn) ? { id: byIsbn.id, via: "isbn" } : null
        if (!match) {
          const t = await fetchTitleMatchWith(b.title, b.authors[0], (v) => isSameBook(b, v))
          if (t) match = { id: t.id, via: "title" }
        }
        if (!match) {
          unmatchedKeys.push(b.title)
        } else if (keysByUser.get(b.userId)?.has(`w:${match.id}`)) {
          keyCollisions.push(b.title) // the user already has this exact volume on another row
        } else {
          newKey = match.id
          keysByUser.get(b.userId)?.add(`w:${match.id}`)
          repair.workKey = { from: b.workKey!, to: match.id, via: match.via }
        }
      }

      if (needsDesc) {
        newDesc =
          byIsbn?.description ??
          (await fetchTitleMatchWith(b.title, b.authors[0], (v) => Boolean(v.description)))?.description
        if (newDesc && !isStubDescription(newDesc)) repair.description = true
        else newDesc = undefined
      }

      if (!repair.workKey && !repair.description) continue
      repairs.push(repair)
      if (!dryRun) {
        await ctx.runMutation(internal.backfill._applyRepair, {
          id: b._id,
          workKey: newKey,
          description: newDesc,
        })
      }
    }

    return { dryRun, scanned: rows.length, repairs, keyCollisions, unmatchedKeys }
  },
})
