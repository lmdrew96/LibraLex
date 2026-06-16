import { query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { getUserId } from "./util"
import { areFriends } from "./friends"
import { profileFor, toPublicProfile } from "./users"

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
  workKey?: string
  isbn?: string
  firstPublishYear?: number
  pageCount?: number
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
  args: { friendUserId: v.string() },
  handler: async (ctx, args) => {
    const me = await getUserId(ctx)
    if (!me) return null
    if (args.friendUserId === me) return null // use your own shelf views
    if (!(await areFriends(ctx, me, args.friendUserId))) return null

    const profile = await profileFor(ctx, args.friendUserId)
    if (!profile) return null

    const books = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", args.friendUserId))
      .collect()

    return {
      profile: toPublicProfile(profile),
      books: books
        .sort((a, b) => b.addedAt - a.addedAt)
        .map(toSharedBook),
    }
  },
})
