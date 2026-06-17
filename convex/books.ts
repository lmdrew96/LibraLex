import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { normalizeAuthors, normalizeSubjects, sanitizeYear } from "./normalize"

// Cached enrichment fields shared by addBook + the re-fetch action. Optional —
// produced by the enrich-once pipeline (lib/enrich.ts), stored so reads need no
// external calls.
const enrichmentValidators = {
  description: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  subjects: v.optional(v.array(v.string())),
  authorBios: v.optional(
    v.array(v.object({ name: v.string(), bio: v.optional(v.string()) })),
  ),
}

// Default library loan period: 3 weeks. It's a default, not a law — every code
// path that sets a due date keeps it user-editable (see renewLoan).
const LOAN_PERIOD_MS = 21 * 24 * 60 * 60 * 1000

const ownershipValidator = v.union(
  v.literal("owned"),
  v.literal("wishlist"),
  v.literal("library"),
)
const readStatusValidator = v.union(
  v.literal("unread"),
  v.literal("reading"),
  v.literal("read"),
)

// Queries stay quiet (return empty/null) before auth resolves; mutations reject.
const getUserId = async (ctx: QueryCtx | MutationCtx): Promise<string | null> => {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.tokenIdentifier ?? null
}

const requireUserId = async (ctx: MutationCtx): Promise<string> => {
  const userId = await getUserId(ctx)
  if (!userId) throw new Error("Not authenticated")
  return userId
}

// Load a book and assert the caller owns it. Throws otherwise.
const getOwnedBook = async (
  ctx: MutationCtx,
  userId: string,
  id: Doc<"books">["_id"],
): Promise<Doc<"books">> => {
  const book = await ctx.db.get(id)
  if (!book || book.userId !== userId) throw new Error("Book not found")
  return book
}

// Attach the servable URL for a user-uploaded cover (Convex file storage). Books
// without an uploaded cover return coverUrl: undefined and fall back to the
// auto-fetched coverId/coverUrlFallback in <BookCover>. The getUrl lookup only
// runs for books that actually have an upload, so listing a full shelf is cheap.
const withCoverUrl = async (
  ctx: QueryCtx,
  book: Doc<"books">,
): Promise<Doc<"books"> & { coverUrl?: string }> => ({
  ...book,
  coverUrl: book.coverStorageId
    ? ((await ctx.storage.getUrl(book.coverStorageId)) ?? undefined)
    : undefined,
})

// ── Queries ───────────────────────────────────────────────────────────────────

// All of the user's books, optionally filtered by ownership and/or readStatus,
// newest first. Picks the most selective index for the given filter.
export const listBooks = query({
  args: {
    ownership: v.optional(ownershipValidator),
    readStatus: v.optional(readStatusValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) return []

    let rows: Doc<"books">[]
    if (args.ownership) {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user_ownership", (q) =>
          q.eq("userId", userId).eq("ownership", args.ownership!),
        )
        .collect()
    } else if (args.readStatus) {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user_readStatus", (q) =>
          q.eq("userId", userId).eq("readStatus", args.readStatus!),
        )
        .collect()
    } else {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    }

    // Secondary filter when both were supplied (indexes cover only one).
    if (args.ownership && args.readStatus) {
      rows = rows.filter((b) => b.readStatus === args.readStatus)
    }

    const sorted = rows.sort((a, b) => b.addedAt - a.addedAt)
    return await Promise.all(sorted.map((b) => withCoverUrl(ctx, b)))
  },
})

// A single book, owner-checked. Returns null if missing or not the caller's.
export const getBook = query({
  args: { id: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const book = await ctx.db.get(args.id)
    if (!book || book.userId !== userId) return null
    return await withCoverUrl(ctx, book)
  },
})

// Active library loans (not yet returned), soonest due first — for the Loans view.
export const listLoans = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const loans = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) =>
        q.eq("userId", userId).eq("ownership", "library"),
      )
      .collect()
    const active = loans
      .filter((b) => b.returned !== true)
      .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
    return await Promise.all(active.map((b) => withCoverUrl(ctx, b)))
  },
})

// ── Mutations ─────────────────────────────────────────────────────────────────

// Insert a book onto a shelf. Library adds capture checkout + computed due date.
export const addBook = mutation({
  args: {
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    ...enrichmentValidators,
    ownership: ownershipValidator,
    readStatus: v.optional(readStatusValidator),
    checkoutDate: v.optional(v.number()),
    dueDate: v.optional(v.number()), // editable at add-time; defaults to checkout + 21d
    libraryName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const now = Date.now()

    const base = {
      userId,
      title: args.title,
      // Normalize on write — source-agnostic cleanup (see convex/normalize.ts).
      authors: normalizeAuthors(args.authors),
      isbn: args.isbn,
      coverId: args.coverId,
      coverUrlFallback: args.coverUrlFallback,
      workKey: args.workKey,
      firstPublishYear: sanitizeYear(args.firstPublishYear),
      pageCount: args.pageCount,
      // Cached enrichment (already merged/normalized by the pipeline).
      description: args.description,
      categories: args.categories,
      subjects: args.subjects ? normalizeSubjects(args.subjects) : undefined,
      authorBios: args.authorBios,
      ownership: args.ownership,
      readStatus: args.readStatus ?? ("unread" as const),
      addedAt: now,
    }

    if (args.ownership === "library") {
      const checkoutDate = args.checkoutDate ?? now
      return await ctx.db.insert("books", {
        ...base,
        checkoutDate,
        dueDate: args.dueDate ?? checkoutDate + LOAN_PERIOD_MS,
        returned: false,
        libraryName: args.libraryName,
      })
    }

    return await ctx.db.insert("books", base)
  },
})

// Partial update of a book's shelf relationship. Read-status transitions stamp
// startedAt / finishedAt once; moving away from "library" clears the loan fields.
export const updateBook = mutation({
  args: {
    id: v.id("books"),
    patch: v.object({
      readStatus: v.optional(readStatusValidator),
      rating: v.optional(v.number()),
      review: v.optional(v.string()),
      ownership: v.optional(ownershipValidator),
      title: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      libraryName: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const book = await getOwnedBook(ctx, userId, args.id)
    const now = Date.now()

    const updates: Partial<Doc<"books">> = { ...args.patch }

    // Normalize edited author lists the same way writes do.
    if (args.patch.authors !== undefined) {
      updates.authors = normalizeAuthors(args.patch.authors)
    }

    if (args.patch.readStatus === "reading" && !book.startedAt) {
      updates.startedAt = now
    }
    if (args.patch.readStatus === "read" && !book.finishedAt) {
      updates.finishedAt = now
    }

    // Switching off the library shelf retires its loan fields (setting an
    // optional field to undefined removes it in Convex).
    if (args.patch.ownership && args.patch.ownership !== "library") {
      updates.checkoutDate = undefined
      updates.dueDate = undefined
      updates.returned = undefined
      updates.libraryName = undefined
    }

    await ctx.db.patch(args.id, updates)
  },
})

// Apply a fresh enrichment to an owned book (the detail page's "Re-fetch
// metadata" action: client calls /api/enrich, then hands the merged record here).
// Patches the bibliographic + cached-enrichment fields; leaves the user's title,
// uploaded cover, rating/review, and shelf state alone.
export const applyEnrichment = mutation({
  args: {
    id: v.id("books"),
    authors: v.array(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    ...enrichmentValidators,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await getOwnedBook(ctx, userId, args.id)
    await ctx.db.patch(args.id, {
      authors: normalizeAuthors(args.authors),
      coverId: args.coverId,
      coverUrlFallback: args.coverUrlFallback,
      workKey: args.workKey,
      firstPublishYear: sanitizeYear(args.firstPublishYear),
      pageCount: args.pageCount,
      description: args.description,
      categories: args.categories,
      subjects: args.subjects ? normalizeSubjects(args.subjects) : undefined,
      authorBios: args.authorBios,
    })
  },
})

// Move a book onto the library shelf as an active loan. Default due date is
// checkout + 21 days; renewLoan lets the user override it later.
export const checkoutBook = mutation({
  args: {
    id: v.id("books"),
    checkoutDate: v.optional(v.number()),
    libraryName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const book = await getOwnedBook(ctx, userId, args.id)
    const checkoutDate = args.checkoutDate ?? Date.now()
    await ctx.db.patch(args.id, {
      ownership: "library",
      checkoutDate,
      dueDate: checkoutDate + LOAN_PERIOD_MS,
      returned: false,
      libraryName: args.libraryName ?? book.libraryName,
    })
  },
})

// Renew a loan to a user-chosen due date (renewal periods vary by library).
export const renewLoan = mutation({
  args: { id: v.id("books"), newDueDate: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await getOwnedBook(ctx, userId, args.id)
    await ctx.db.patch(args.id, { dueDate: args.newDueDate, returned: false })
  },
})

// Mark a loan returned (drops it out of the active-loans view).
export const returnBook = mutation({
  args: { id: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await getOwnedBook(ctx, userId, args.id)
    await ctx.db.patch(args.id, { returned: true })
  },
})

// Remove a book from the catalog entirely. Also drops any uploaded cover so we
// don't leave an orphaned file in storage.
export const deleteBook = mutation({
  args: { id: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const book = await getOwnedBook(ctx, userId, args.id)
    if (book.coverStorageId) await ctx.storage.delete(book.coverStorageId)
    await ctx.db.delete(args.id)
  },
})

// ── Cover upload (Convex file storage) ──────────────────────────────────────
// Optional user-supplied cover, for books with a wrong/ugly/missing auto cover.
// Flow: client calls generateCoverUploadUrl → POSTs the file to that URL → gets
// a storageId → calls setBookCover. The book queries resolve the id to a URL.

// Short-lived signed URL the client POSTs the image bytes to. Auth-gated so only
// signed-in users can mint one.
export const generateCoverUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

// Attach an uploaded image as the book's cover. Replacing an existing custom
// cover deletes the previous file first, so storage never accumulates orphans.
export const setBookCover = mutation({
  args: { id: v.id("books"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const book = await getOwnedBook(ctx, userId, args.id)
    if (book.coverStorageId && book.coverStorageId !== args.storageId) {
      await ctx.storage.delete(book.coverStorageId)
    }
    await ctx.db.patch(args.id, { coverStorageId: args.storageId })
  },
})

// Drop the uploaded cover and revert to the auto-fetched one (deletes the file).
export const removeBookCover = mutation({
  args: { id: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const book = await getOwnedBook(ctx, userId, args.id)
    if (book.coverStorageId) {
      await ctx.storage.delete(book.coverStorageId)
      await ctx.db.patch(args.id, { coverStorageId: undefined })
    }
  },
})
