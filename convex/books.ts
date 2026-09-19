import { action, mutation, query } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { normalizeAuthors } from "./normalize"
import { assertMaxLength, LOAN_PERIOD_MS, TEXT_LIMITS } from "./util"
import { addOrMoveBook, readStatusStamps, rollTasteOnStart, type AddResult } from "./shelfAdd"
import { internal } from "./_generated/api"
import { deleteEmbedding } from "./bookEmbeddings"

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
  averageRating: v.optional(v.number()),
  ratingsCount: v.optional(v.number()),
}

const ownershipValidator = v.union(
  v.literal("owned"),
  v.literal("wishlist"),
  v.literal("library"),
  v.literal("none"), // read/encountered but not owned — see schema
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
//
// The embedding is stripped here: it's ~1536 floats (~12KB) per book, only ever
// used server-side (vector search, taste vector), and these queries are live
// subscriptions — shipping it would re-send every vector on every shelf change.
const withCoverUrl = async (
  ctx: QueryCtx,
  book: Doc<"books">,
): Promise<Omit<Doc<"books">, "embedding"> & { coverUrl?: string }> => {
  const { embedding: _embedding, ...rest } = book
  return {
    ...rest,
    coverUrl: book.coverStorageId
      ? ((await ctx.storage.getUrl(book.coverStorageId)) ?? undefined)
      : undefined,
  }
}

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

// Returned library loans, most recently due first (capped) — the Loans page's
// "Returned" list, where a book can be borrowed again.
export const listReturnedLoans = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const loans = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", "library"))
      .collect()
    const returned = loans
      .filter((b) => b.returned === true)
      .sort((a, b) => (b.dueDate ?? 0) - (a.dueDate ?? 0))
      .slice(0, 10)
    return await Promise.all(returned.map((b) => withCoverUrl(ctx, b)))
  },
})

// ── Mutations ─────────────────────────────────────────────────────────────────

// Put a book on a shelf. Dedupes across all shelves (an existing copy is left
// alone or moved, never duplicated) and schedules server-side enrich + embed —
// see convex/shelfAdd.ts. Returns what happened so the UI can say so.
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
  handler: async (ctx, args): Promise<AddResult> => {
    const userId = await requireUserId(ctx)
    const { authorBios: _authorBios, ...input } = args // deprecated field, no longer written
    return await addOrMoveBook(ctx, userId, input)
  },
})

// Partial update of a book's shelf relationship. Read-status transitions stamp
// startedAt / finishedAt once; moving away from "library" clears the loan fields.
export const updateBook = mutation({
  args: {
    id: v.id("books"),
    patch: v.object({
      readStatus: v.optional(readStatusValidator),
      // 1–5 sets a rating; null clears it.
      rating: v.optional(v.union(v.number(), v.null())),
      review: v.optional(v.string()),
      ownership: v.optional(ownershipValidator),
      title: v.optional(v.string()),
      authors: v.optional(v.array(v.string())),
      libraryName: v.optional(v.string()),
      // Explicit finish date from the mark-as-read control: a number sets it, null
      // clears it ("don't remember"). Pulled out of the patch spread below because
      // null isn't a Doc field value — clearing is an undefined patch in Convex.
      finishedAt: v.optional(v.union(v.number(), v.null())),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const book = await getOwnedBook(ctx, userId, args.id)
    const now = Date.now()

    const { finishedAt: finishedAtInput, rating, ...patch } = args.patch
    assertMaxLength(patch.title, TEXT_LIMITS.title, "Title")
    assertMaxLength(patch.review, TEXT_LIMITS.review, "Review")
    if (rating !== undefined && rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      throw new ConvexError("Rating must be a whole number from 1 to 5.")
    }
    const updates: Partial<Doc<"books">> = { ...patch }
    // null clears the rating (an undefined patch value removes the field in Convex).
    if (rating !== undefined) updates.rating = rating ?? undefined

    // Normalize edited author lists the same way writes do.
    if (patch.authors !== undefined) {
      updates.authors = normalizeAuthors(patch.authors)
    }

    const stamps = patch.readStatus ? readStatusStamps(book, patch.readStatus, now) : {}
    if (stamps.startedAt !== undefined) updates.startedAt = stamps.startedAt

    // Finish date drives the "read this year" stats. An explicit value from the
    // date control wins (number sets it; null clears it — the read still counts
    // all-time, just not in any year). Without one, flipping to "read" stamps now
    // as the default for a just-finished book; a back-catalog entry can re-date or
    // clear it (or use the bulk "undate" action in Settings).
    if (finishedAtInput !== undefined) {
      updates.finishedAt = finishedAtInput ?? undefined
    } else if (stamps.finishedAt !== undefined) {
      updates.finishedAt = stamps.finishedAt
    }

    // Switching off the library shelf retires its loan fields (setting an
    // optional field to undefined removes it in Convex).
    if (patch.ownership && patch.ownership !== "library") {
      updates.checkoutDate = undefined
      updates.dueDate = undefined
      updates.returned = undefined
      updates.libraryName = undefined
    }

    await ctx.db.patch(args.id, updates)

    // A book newly finished/started feeds the taste vector.
    if (patch.readStatus) await rollTasteOnStart(ctx, book, patch.readStatus)
  },
})

// One-time correction: clear finishedAt on every "read" book. Marking a book read
// stamps today's date, so entering a years-old back-catalog in one sitting dates
// them all to today and inflates "read this year." This nulls those dates in bulk
// (all-time count is unchanged — it's just readStatus === "read"); the user then
// re-dates only the books they actually finished this year. Returns the count cleared.
export const undateReadBooks = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const reads = await ctx.db
      .query("books")
      .withIndex("by_user_readStatus", (q) => q.eq("userId", userId).eq("readStatus", "read"))
      .collect()
    let cleared = 0
    for (const b of reads) {
      if (b.finishedAt !== undefined) {
        await ctx.db.patch(b._id, { finishedAt: undefined })
        cleared++
      }
    }
    return { cleared }
  },
})

// The detail page's "Re-fetch metadata" action: re-run the server-side enrich
// (+ embed if missing) for one owned book. Enrichment only ever improves a record
// (convex/shelfAdd.ts _applyServerEnrichment never blanks a populated field).
export const refetchMetadata = action({
  args: { id: v.id("books") },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")
    const book = await ctx.runQuery(internal.shelfAdd._getBook, { id: args.id })
    if (!book || book.userId !== identity.tokenIdentifier) throw new Error("Book not found")
    await ctx.runAction(internal.shelfAdd.enrichBookById, { id: args.id })
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
    await deleteEmbedding(ctx, args.id)
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

// The LibraLex community average for a book: every user's copy of the same title,
// averaged over those who actually rated it. Identity follows the same preference
// as the cross-shelf dedupe (work key, else ISBN) so the same book on two shelves
// collapses to one pool. Returns an ANONYMOUS aggregate only — no user, no per-
// rating data — so it's safe to show beyond the friend graph. Null when nobody
// (yet) has rated it, which the UI renders as "no community rating".
export const communityRating = query({
  args: { workKey: v.optional(v.string()), isbn: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ average: number; count: number } | null> => {
    // Need an authenticated session (the whole app is gated) but no ownership
    // check — this is a cross-user aggregate by design.
    const userId = await getUserId(ctx)
    if (!userId) return null

    let copies: Doc<"books">[] = []
    if (args.workKey) {
      copies = await ctx.db
        .query("books")
        .withIndex("by_workKey", (q) => q.eq("workKey", args.workKey))
        .collect()
    } else if (args.isbn) {
      copies = await ctx.db
        .query("books")
        .withIndex("by_isbn", (q) => q.eq("isbn", args.isbn))
        .collect()
    } else {
      return null
    }

    const ratings = copies
      .map((b) => b.rating)
      .filter((r): r is number => typeof r === "number")
    if (ratings.length === 0) return null

    const average = ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    return { average, count: ratings.length }
  },
})
