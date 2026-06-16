import { internalMutation, internalQuery } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"

// Data layer for the MCP door (convex/http.ts). Every function here is INTERNAL —
// callable only from other Convex functions, never the public internet. The sole
// caller is the token-gated MCP httpAction, which resolves token → userId BEFORE
// calling these. That's why they take `userId` explicitly: an MCP request carries
// no Clerk session, so the usual "derive identity from ctx.auth" rule doesn't apply
// here — the door upstream has already authenticated.
//
// Reads mirror the public queries in books.ts but project to a compact, chat-
// friendly shape and never leak internal ids. Timestamps stay raw (ms); the action
// layer formats dates with a real clock (Date.now() isn't available in queries).

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

export type McpBook = {
  title: string
  authors: string[]
  ownership: Doc<"books">["ownership"]
  readStatus: Doc<"books">["readStatus"]
  firstPublishYear?: number
  pageCount?: number
  rating?: number
  isbn?: string
}

const toMcpBook = (b: Doc<"books">): McpBook => ({
  title: b.title,
  authors: b.authors,
  ownership: b.ownership,
  readStatus: b.readStatus,
  firstPublishYear: b.firstPublishYear,
  pageCount: b.pageCount,
  rating: b.rating,
  isbn: b.isbn,
})

// All of the user's books, optionally filtered, newest first. Picks the most
// selective index for the filter — same strategy as books.listBooks.
export const listBooksForUser = internalQuery({
  args: {
    userId: v.string(),
    ownership: v.optional(ownershipValidator),
    readStatus: v.optional(readStatusValidator),
  },
  handler: async (ctx, { userId, ownership, readStatus }) => {
    let rows: Doc<"books">[]
    if (ownership) {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", ownership))
        .collect()
    } else if (readStatus) {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user_readStatus", (q) => q.eq("userId", userId).eq("readStatus", readStatus))
        .collect()
    } else {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    }
    if (ownership && readStatus) rows = rows.filter((b) => b.readStatus === readStatus)
    return rows.sort((a, b) => b.addedAt - a.addedAt).map(toMcpBook)
  },
})

// Books currently being read, most-recently-started first.
export const currentlyReadingForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_readStatus", (q) => q.eq("userId", userId).eq("readStatus", "reading"))
      .collect()
    return rows
      .sort((a, b) => (b.startedAt ?? b.addedAt) - (a.startedAt ?? a.addedAt))
      .map(toMcpBook)
  },
})

// The user's wishlist, newest first.
export const wishlistForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", "wishlist"))
      .collect()
    return rows.sort((a, b) => b.addedAt - a.addedAt).map(toMcpBook)
  },
})

// Active library loans (not yet returned), soonest due first. Raw dueDate/
// checkoutDate ms — the action computes days-until with a real clock.
export const activeLoansForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", "library"))
      .collect()
    return rows
      .filter((b) => b.returned !== true)
      .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
      .map((b) => ({
        title: b.title,
        authors: b.authors,
        readStatus: b.readStatus,
        libraryName: b.libraryName,
        checkoutDate: b.checkoutDate,
        dueDate: b.dueDate,
      }))
  },
})

const normalizeTitle = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

// Add a book to the user's wishlist from chat ("Coru, add X to my wishlist").
// Idempotent on title: a same-title wishlist entry returns { status: "exists" }
// instead of stacking a duplicate. Bibliographic fields are best-effort — the door
// enriches via Open Library before calling, falling back to bare title + author.
export const addWishlistBook = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) =>
        q.eq("userId", args.userId).eq("ownership", "wishlist"),
      )
      .collect()
    const dup = existing.find((b) => normalizeTitle(b.title) === normalizeTitle(args.title))
    if (dup) return { status: "exists" as const, title: dup.title }

    await ctx.db.insert("books", {
      userId: args.userId,
      title: args.title,
      authors: args.authors,
      isbn: args.isbn,
      coverId: args.coverId,
      coverUrlFallback: args.coverUrlFallback,
      workKey: args.workKey,
      firstPublishYear: args.firstPublishYear,
      pageCount: args.pageCount,
      ownership: "wishlist",
      readStatus: "unread",
      addedAt: Date.now(),
    })
    return { status: "added" as const, title: args.title }
  },
})
