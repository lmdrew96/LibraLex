import { query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { getUserId } from "./util"
import { areFriends } from "./friends"
import { toPublicProfile } from "./users"

// A friend-visible book: the bibliographic fields plus the social signal
// (rating + review + where it lives), with library loan logistics deliberately
// stripped — nobody needs to see your due dates. _id is kept only as a stable
// React key; it's the friend's id and not actionable by the viewer.
export type SharedBook = {
  _id: Doc<"books">["_id"]
  title: string
  authors: string[]
  coverId?: number
  coverUrlFallback?: string
  coverUrl?: string // resolved URL for the owner's uploaded cover, when set
  workKey?: string
  isbn?: string
  firstPublishYear?: number
  pageCount?: number
  subjects?: string[] // the recommender's primary signal — carried so cross-shelf recs can score a friend's books
  ownership: Doc<"books">["ownership"]
  readStatus: Doc<"books">["readStatus"]
  rating?: number
  review?: string
  addedAt: number
}

const toSharedBook = (b: Doc<"books">): SharedBook => ({
  _id: b._id,
  title: b.title,
  authors: b.authors,
  coverId: b.coverId,
  coverUrlFallback: b.coverUrlFallback,
  workKey: b.workKey,
  isbn: b.isbn,
  firstPublishYear: b.firstPublishYear,
  pageCount: b.pageCount,
  subjects: b.subjects,
  ownership: b.ownership,
  readStatus: b.readStatus,
  rating: b.rating,
  review: b.review,
  addedAt: b.addedAt,
})

// A friend's shelf — gated on an accepted friendship. Returns null when the
// viewer isn't friends with the target (or the target doesn't exist), which the
// page renders as a gentle "not friends" state rather than leaking existence.
export const getFriendShelf = query({
  // Routed by the friend's `users` document id — a URL-safe Convex id, never the
  // Clerk tokenIdentifier (which contains "://" and "|" and can't survive a
  // single dynamic route segment).
  args: { friendId: v.id("users") },
  handler: async (ctx, args) => {
    const me = await getUserId(ctx)
    if (!me) return null

    const profile = await ctx.db.get(args.friendId)
    if (!profile) return null
    if (profile.userId === me) return null // use your own shelf views
    if (!(await areFriends(ctx, me, profile.userId))) return null

    const books = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", profile.userId))
      .collect()

    return {
      profile: toPublicProfile(profile),
      books: await Promise.all(
        books
          .sort((a, b) => b.addedAt - a.addedAt)
          .map(async (b) => ({
            ...toSharedBook(b),
            coverUrl: b.coverStorageId
              ? ((await ctx.storage.getUrl(b.coverStorageId)) ?? undefined)
              : undefined,
          })),
      ),
    }
  },
})
