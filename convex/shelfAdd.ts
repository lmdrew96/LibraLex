import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { identityKey } from "./discover"
import { enrichBook } from "./enrich"
import { embedBookWithRetry } from "./embed"
import { normalizeAuthors, normalizeSubjects, sanitizeYear } from "./normalize"
import { rollTasteVector } from "./tasteVector"
import { assertMaxLength, LOAN_PERIOD_MS, TEXT_LIMITS } from "./util"

// The ONE write path for putting a book on someone's shelf — used by the web
// (books.addBook), accepting a rec (recs.addRecToShelf) and the MCP door
// (mcpData.addBookForUser), so every surface dedupes and enriches identically:
//
//  1. Dedupe across ALL the user's shelves. Same shelf → no-op ("exists");
//     different shelf → move the existing row ("moved"); otherwise insert ("added").
//  2. A newly added book schedules server-side enrich + embed (enrichBookById),
//     so no add path can leave a bare, unembedded row — and embeddings are never
//     accepted from the client.

type Ownership = Doc<"books">["ownership"]
type ReadStatus = Doc<"books">["readStatus"]

export type AddInput = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  workKey?: string
  firstPublishYear?: number
  pageCount?: number
  description?: string
  categories?: string[]
  subjects?: string[]
  averageRating?: number
  ratingsCount?: number
  ownership: Ownership
  readStatus?: ReadStatus
  checkoutDate?: number
  dueDate?: number
  libraryName?: string
}

export type AddResult =
  | { status: "added"; id: Id<"books">; title: string; ownership: Ownership }
  | { status: "moved"; id: Id<"books">; title: string; from: Ownership; ownership: Ownership }
  | { status: "exists"; id: Id<"books">; title: string; ownership: Ownership }

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

// Same book already on any shelf? Identity first (workKey → isbn → title+author).
// Google volume ids are edition-level, so a different edition misses on identity —
// fall back to title + first author (or title alone when either side has no author).
export const findExistingCopy = (
  rows: Doc<"books">[],
  input: Pick<AddInput, "title" | "authors" | "isbn" | "workKey">,
): Doc<"books"> | undefined => {
  const key = identityKey(input)
  const byKey = rows.find((b) => identityKey(b) === key)
  if (byKey) return byKey
  const title = norm(input.title)
  const author = input.authors[0] ? norm(input.authors[0]) : undefined
  return rows.find((b) => {
    if (norm(b.title) !== title) return false
    const theirs = b.authors[0] ? norm(b.authors[0]) : undefined
    return !author || !theirs || author === theirs
  })
}

export const addOrMoveBook = async (
  ctx: MutationCtx,
  userId: string,
  input: AddInput,
): Promise<AddResult> => {
  assertMaxLength(input.title, TEXT_LIMITS.title, "Title")
  const now = Date.now()
  const rows = await ctx.db
    .query("books")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()
  const existing = findExistingCopy(rows, input)

  if (existing) {
    const reborrow =
      input.ownership === "library" && existing.ownership === "library" && existing.returned === true
    if (existing.ownership === input.ownership && !reborrow) {
      return { status: "exists", id: existing._id, title: existing.title, ownership: input.ownership }
    }

    const updates: Partial<Doc<"books">> = { ownership: input.ownership }
    // Only ever advance read state on a move — re-adding a book you've read as
    // "owned" (default unread) must not wipe your read history.
    let readStatus =
      input.readStatus && input.readStatus !== "unread" ? input.readStatus : existing.readStatus
    // "Don't own" books live in History by read status; unread would vanish.
    if (input.ownership === "none" && readStatus === "unread") readStatus = "read"
    if (readStatus !== existing.readStatus) {
      updates.readStatus = readStatus
      Object.assign(updates, readStatusStamps(existing, readStatus, now))
    }
    if (input.ownership === "library") {
      const checkoutDate = input.checkoutDate ?? now
      updates.checkoutDate = checkoutDate
      updates.dueDate = input.dueDate ?? checkoutDate + LOAN_PERIOD_MS
      updates.returned = false
      updates.libraryName = input.libraryName ?? existing.libraryName
    } else {
      // Leaving the library shelf retires the loan fields.
      updates.checkoutDate = undefined
      updates.dueDate = undefined
      updates.returned = undefined
      updates.libraryName = undefined
    }
    await ctx.db.patch(existing._id, updates)
    await rollTasteOnStart(ctx, existing, readStatus)
    return {
      status: "moved",
      id: existing._id,
      title: existing.title,
      from: existing.ownership,
      ownership: input.ownership,
    }
  }

  const readStatus = input.readStatus ?? "unread"
  const base = {
    userId,
    title: input.title,
    // Normalize on write — source-agnostic cleanup (see convex/normalize.ts).
    authors: normalizeAuthors(input.authors),
    isbn: input.isbn,
    coverId: input.coverId,
    coverUrlFallback: input.coverUrlFallback,
    workKey: input.workKey,
    firstPublishYear: sanitizeYear(input.firstPublishYear),
    pageCount: input.pageCount,
    description: input.description,
    categories: input.categories,
    subjects: input.subjects ? normalizeSubjects(input.subjects) : undefined,
    averageRating: input.averageRating,
    ratingsCount: input.ratingsCount,
    ownership: input.ownership,
    readStatus,
    // "Reading" starts now. An add straight to "read" stays undated on purpose:
    // it's usually a back-catalog entry, and stamping today would inflate
    // "read this year" (the user can date it from the book page).
    startedAt: readStatus === "reading" ? now : undefined,
    addedAt: now,
  }
  const id =
    input.ownership === "library"
      ? await ctx.db.insert("books", {
          ...base,
          checkoutDate: input.checkoutDate ?? now,
          dueDate: input.dueDate ?? (input.checkoutDate ?? now) + LOAN_PERIOD_MS,
          returned: false,
          libraryName: input.libraryName,
        })
      : await ctx.db.insert("books", base)

  await ctx.scheduler.runAfter(0, internal.shelfAdd.enrichBookById, { id })
  return { status: "added", id, title: input.title, ownership: input.ownership }
}

// ── Server-side enrich + embed ──────────────────────────────────────────────

export const _getBook = internalQuery({
  args: { id: v.id("books") },
  handler: async (ctx, { id }): Promise<Doc<"books"> | null> => ctx.db.get(id),
})

// Patch enrichment in, never blanking a populated field (flaky fetches return
// empty), and roll the taste vector if this is a read/reading book's first vector.
export const _applyServerEnrichment = internalMutation({
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
  handler: async (ctx, args) => {
    const book = await ctx.db.get(args.id)
    if (!book) return // deleted while enrichment was in flight
    await ctx.db.patch(args.id, {
      authors: args.authors.length ? normalizeAuthors(args.authors) : book.authors,
      coverUrlFallback: args.coverUrlFallback ?? book.coverUrlFallback,
      workKey: book.workKey ?? args.workKey,
      firstPublishYear: sanitizeYear(args.firstPublishYear) ?? book.firstPublishYear,
      pageCount: args.pageCount ?? book.pageCount,
      description: args.description ?? book.description,
      categories: args.categories ?? book.categories,
      subjects: args.subjects?.length ? normalizeSubjects(args.subjects) : book.subjects,
      averageRating: args.averageRating ?? book.averageRating,
      ratingsCount: args.ratingsCount ?? book.ratingsCount,
      embedding: args.embedding ?? book.embedding,
    })
    const gotFirstEmbedding = !book.embedding?.length && (args.embedding?.length ?? 0) > 0
    const isTasteSource = book.readStatus === "read" || book.readStatus === "reading"
    if (gotFirstEmbedding && isTasteSource) {
      await rollTasteVector(ctx, book.userId, args.embedding!)
    }
  },
})

// Enrich (Google Books) and embed (Gemini) one book, then patch it in. Scheduled
// by addOrMoveBook for every new row; also run by the re-fetch action and the
// embed-backfill cron. Best-effort: a failed lookup leaves the row as it was.
export const enrichBookById = internalAction({
  args: { id: v.id("books") },
  handler: async (ctx, { id }): Promise<void> => {
    const book = await ctx.runQuery(internal.shelfAdd._getBook, { id })
    if (!book) return
    const enriched = await enrichBook({
      title: book.title,
      authors: book.authors,
      isbn: book.isbn,
      coverUrlFallback: book.coverUrlFallback,
      workKey: book.workKey,
      firstPublishYear: book.firstPublishYear,
      pageCount: book.pageCount,
    }).catch(() => null)
    const description = enriched?.description ?? book.description
    const subjects = enriched?.subjects ?? book.subjects
    const embedding = book.embedding?.length
      ? undefined
      : ((await embedBookWithRetry({
          title: book.title,
          authors: enriched?.authors ?? book.authors,
          description,
          subjects,
        })) ?? undefined)
    if (!enriched && !embedding) return
    await ctx.runMutation(internal.shelfAdd._applyServerEnrichment, {
      id,
      authors: enriched?.authors ?? book.authors,
      coverUrlFallback: enriched?.coverUrlFallback,
      workKey: enriched?.workKey,
      firstPublishYear: enriched?.firstPublishYear,
      pageCount: enriched?.pageCount,
      description: enriched?.description,
      categories: enriched?.categories,
      subjects: enriched?.subjects,
      averageRating: enriched?.averageRating,
      ratingsCount: enriched?.ratingsCount,
      embedding,
    })
  },
})

// ── Scheduled embed backfill (convex/crons.ts) ──────────────────────────────

// One page of the books table, reduced to the ids that still lack an embedding.
// Paged (not .collect()) so the scan stays far under the per-query read limit.
export const _missingEmbeddingPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("books").paginate({ cursor, numItems: 100 })
    return {
      ids: page.page.filter((b) => !b.embedding?.length).map((b) => b._id),
      cursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

// Safety net behind the add-time enrichment: finds up to `limit` unembedded books
// (a failed Gemini call, rows from before server-side enrichment) and runs the
// same enrich + embed on each. Small batches, so a run never nears the action
// time limit; anything left over is picked up next run.
export const embedMissing = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 25 }): Promise<{ processed: number }> => {
    const ids: Id<"books">[] = []
    let cursor: string | null = null
    while (ids.length < limit) {
      const page: { ids: Id<"books">[]; cursor: string; isDone: boolean } = await ctx.runQuery(
        internal.shelfAdd._missingEmbeddingPage,
        { cursor },
      )
      ids.push(...page.ids)
      if (page.isDone) break
      cursor = page.cursor
    }
    const batch = ids.slice(0, limit)
    for (const id of batch) {
      await ctx.runAction(internal.shelfAdd.enrichBookById, { id })
    }
    return { processed: batch.length }
  },
})

// ── Read-status transitions (shared by books.updateBook + the MCP door) ─────

// Date stamps for a read-status change. Starting a book stamps startedAt the
// first time, and again on a RE-read (read → reading). Finishing stamps finishedAt
// the first time, and again when the current read started after the last finish
// — so a re-read finished this year counts this year. The previous finish date
// stays until then, so abandoning a re-read doesn't erase last year's read.
export const readStatusStamps = (
  book: Pick<Doc<"books">, "readStatus" | "startedAt" | "finishedAt">,
  next: ReadStatus,
  now: number,
): Partial<Pick<Doc<"books">, "startedAt" | "finishedAt">> => {
  if (next === book.readStatus) return {}
  if (next === "reading" && (!book.startedAt || book.readStatus === "read")) {
    return { startedAt: now }
  }
  if (next === "read") {
    const rereadInProgress =
      book.startedAt !== undefined &&
      book.finishedAt !== undefined &&
      book.startedAt > book.finishedAt
    if (!book.finishedAt || rereadInProgress) return { finishedAt: now }
  }
  return {}
}

// Roll a book into the taste vector the first time it becomes read/reading
// (see convex/tasteVector.ts). No-op until the book has an embedding —
// _applyServerEnrichment covers the embedding-arrives-later case.
export const rollTasteOnStart = async (
  ctx: MutationCtx,
  book: Doc<"books">,
  next: ReadStatus,
): Promise<void> => {
  const was = book.readStatus === "read" || book.readStatus === "reading"
  const now = next === "read" || next === "reading"
  if (!was && now && book.embedding?.length) {
    await rollTasteVector(ctx, book.userId, book.embedding)
  }
}
