import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { getUserId, requireUserId } from "./util"
import { areFriends } from "./friends"
import { profileFor, toPublicProfile } from "./users"

// Recommendations can only be added to your own shelf as owned or wishlist —
// the library-loan path is checkout-specific and not meaningful for a rec.
const recOwnershipValidator = v.union(v.literal("owned"), v.literal("wishlist"))

// ── Queries ───────────────────────────────────────────────────────────────────

// My inbox — every recommendation sent to me, newest first, each with its
// sender's public profile resolved.
export const getInbox = query({
  args: {},
  handler: async (ctx) => {
    const me = await getUserId(ctx)
    if (!me) return []

    const recs = (
      await ctx.db
        .query("recommendations")
        .withIndex("by_recipient", (q) => q.eq("toUserId", me))
        .collect()
    ).sort((a, b) => b.createdAt - a.createdAt)

    return await Promise.all(
      recs.map(async (rec) => {
        const sender = await profileFor(ctx, rec.fromUserId)
        return {
          ...rec,
          // Resolve the sender's uploaded cover; null (file deleted) falls back to
          // the snapshot's coverId/coverUrlFallback in <BookCover>.
          coverUrl: rec.coverStorageId
            ? ((await ctx.storage.getUrl(rec.coverStorageId)) ?? undefined)
            : undefined,
          from: sender ? toPublicProfile(sender) : null,
        }
      }),
    )
  },
})

// Badge count: recommendations I haven't opened yet.
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await getUserId(ctx)
    if (!me) return 0
    const unread = await ctx.db
      .query("recommendations")
      .withIndex("by_recipient_status", (q) =>
        q.eq("toUserId", me).eq("status", "unread"),
      )
      .collect()
    return unread.length
  },
})

// ── Mutations ─────────────────────────────────────────────────────────────────

// Recommend a book to a friend. Carries a self-contained snapshot so the rec
// survives the sender later removing the book. Friends-only.
export const sendRec = mutation({
  args: {
    toUserId: v.string(),
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    coverStorageId: v.optional(v.id("_storage")),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireUserId(ctx)
    if (args.toUserId === me) throw new Error("You can't recommend to yourself.")
    if (!(await areFriends(ctx, me, args.toUserId))) {
      throw new Error("You can only recommend books to friends.")
    }

    const message = args.message?.trim()
    await ctx.db.insert("recommendations", {
      fromUserId: me,
      toUserId: args.toUserId,
      title: args.title,
      authors: args.authors,
      isbn: args.isbn,
      coverId: args.coverId,
      coverUrlFallback: args.coverUrlFallback,
      coverStorageId: args.coverStorageId,
      workKey: args.workKey,
      firstPublishYear: args.firstPublishYear,
      pageCount: args.pageCount,
      message: message ? message : undefined,
      status: "unread",
      createdAt: Date.now(),
    })
  },
})

// Mark all my unread recs read — called when the inbox opens, to clear the badge.
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireUserId(ctx)
    const unread = await ctx.db
      .query("recommendations")
      .withIndex("by_recipient_status", (q) =>
        q.eq("toUserId", me).eq("status", "unread"),
      )
      .collect()
    await Promise.all(unread.map((rec) => ctx.db.patch(rec._id, { status: "read" })))
  },
})

// Accept a rec onto my shelf: insert the snapshot as a book, then consume the
// rec (acting on an inbox item removes it).
export const addRecToShelf = mutation({
  args: { recId: v.id("recommendations"), ownership: recOwnershipValidator },
  handler: async (ctx, args) => {
    const me = await requireUserId(ctx)
    const rec = await ctx.db.get(args.recId)
    if (!rec || rec.toUserId !== me) throw new Error("Recommendation not found.")

    // Deliberately NOT carrying coverStorageId: it points at the sender's file,
    // and deleting either book deletes that file. The accepted book keeps the
    // auto cover; the recipient can upload their own from its detail page.
    await ctx.db.insert("books", {
      userId: me,
      title: rec.title,
      authors: rec.authors,
      isbn: rec.isbn,
      coverId: rec.coverId,
      coverUrlFallback: rec.coverUrlFallback,
      workKey: rec.workKey,
      firstPublishYear: rec.firstPublishYear,
      pageCount: rec.pageCount,
      ownership: args.ownership,
      readStatus: "unread",
      addedAt: Date.now(),
    })
    await ctx.db.delete(rec._id)
  },
})

// Dismiss a rec without adding it.
export const dismissRec = mutation({
  args: { recId: v.id("recommendations") },
  handler: async (ctx, args) => {
    const me = await requireUserId(ctx)
    const rec = await ctx.db.get(args.recId)
    if (!rec || rec.toUserId !== me) throw new Error("Recommendation not found.")
    await ctx.db.delete(rec._id)
  },
})
