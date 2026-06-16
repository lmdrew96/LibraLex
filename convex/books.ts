import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

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

    return rows.sort((a, b) => b.addedAt - a.addedAt)
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
    return book
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
    return loans
      .filter((b) => b.returned !== true)
      .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
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
      authors: args.authors,
      isbn: args.isbn,
      coverId: args.coverId,
      coverUrlFallback: args.coverUrlFallback,
      workKey: args.workKey,
      firstPublishYear: args.firstPublishYear,
      pageCount: args.pageCount,
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

// Remove a book from the catalog entirely.
export const deleteBook = mutation({
  args: { id: v.id("books") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    await getOwnedBook(ctx, userId, args.id)
    await ctx.db.delete(args.id)
  },
})
