import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { getUserId, requireUserId } from "./util"
import { normalizeCode, profileFor, toPublicProfile } from "./users"

// Find the single friendship row between two users, in either direction.
const findFriendship = async (
  ctx: QueryCtx | MutationCtx,
  a: string,
  b: string,
): Promise<Doc<"friendships"> | null> => {
  const ab = await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("requesterId", a).eq("addresseeId", b))
    .unique()
  if (ab) return ab
  return await ctx.db
    .query("friendships")
    .withIndex("by_pair", (q) => q.eq("requesterId", b).eq("addresseeId", a))
    .unique()
}

// True iff the two users have an accepted friendship. Used as the gate for
// shelf-viewing and recommending.
export const areFriends = async (
  ctx: QueryCtx | MutationCtx,
  a: string,
  b: string,
): Promise<boolean> => {
  const f = await findFriendship(ctx, a, b)
  return f?.status === "accepted"
}

// ── Queries ───────────────────────────────────────────────────────────────────

// Accepted friends, each as a public profile plus the friendshipId (so the UI
// can offer "remove"). I may be on either side of the row.
export const getFriends = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []

    const asRequester = await ctx.db
      .query("friendships")
      .withIndex("by_requester", (q) => q.eq("requesterId", userId))
      .collect()
    const asAddressee = await ctx.db
      .query("friendships")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", userId))
      .collect()

    const accepted = [...asRequester, ...asAddressee].filter(
      (f) => f.status === "accepted",
    )

    const friends = await Promise.all(
      accepted.map(async (f) => {
        const otherId = f.requesterId === userId ? f.addresseeId : f.requesterId
        const profile = await profileFor(ctx, otherId)
        if (!profile) return null
        // profileId is the URL-safe handle used to route to a friend's shelf.
        return { ...toPublicProfile(profile), profileId: profile._id, friendshipId: f._id }
      }),
    )

    return friends
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  },
})

// Pending requests sent TO me (I decide accept/decline), newest first.
export const getIncomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []

    const pending = (
      await ctx.db
        .query("friendships")
        .withIndex("by_addressee", (q) => q.eq("addresseeId", userId))
        .collect()
    )
      .filter((f) => f.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt)

    const requests = await Promise.all(
      pending.map(async (f) => {
        const profile = await profileFor(ctx, f.requesterId)
        if (!profile) return null
        return { ...toPublicProfile(profile), friendshipId: f._id }
      }),
    )
    return requests.filter((r): r is NonNullable<typeof r> => r !== null)
  },
})

// Pending requests I've sent (to render a "request sent" state), newest first.
export const getOutgoingRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []

    const pending = (
      await ctx.db
        .query("friendships")
        .withIndex("by_requester", (q) => q.eq("requesterId", userId))
        .collect()
    )
      .filter((f) => f.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt)

    const requests = await Promise.all(
      pending.map(async (f) => {
        const profile = await profileFor(ctx, f.addresseeId)
        if (!profile) return null
        return { ...toPublicProfile(profile), friendshipId: f._id }
      }),
    )
    return requests.filter((r): r is NonNullable<typeof r> => r !== null)
  },
})

// ── Mutations ─────────────────────────────────────────────────────────────────

// Send a friend request by code. If the recipient already sent ME a pending
// request, this accepts it (the natural "we both added each other" case).
export const sendRequestByCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ result: "sent" | "accepted" }> => {
    const me = await requireUserId(ctx)
    const code = normalizeCode(args.code)
    if (!code) throw new Error("Enter a friend code.")

    const target = await ctx.db
      .query("users")
      .withIndex("by_friendCode", (q) => q.eq("friendCode", code))
      .unique()
    if (!target) throw new Error("No reader has that code.")
    if (target.userId === me) throw new Error("That's your own code.")

    const existing = await findFriendship(ctx, me, target.userId)
    if (existing) {
      if (existing.status === "accepted") {
        throw new Error(`You and ${target.displayName} are already friends.`)
      }
      // Pending. If they sent it to me, accept it; if I sent it, it's a no-op.
      if (existing.addresseeId === me) {
        await ctx.db.patch(existing._id, {
          status: "accepted",
          respondedAt: Date.now(),
        })
        return { result: "accepted" }
      }
      throw new Error("You've already sent them a request.")
    }

    await ctx.db.insert("friendships", {
      requesterId: me,
      addresseeId: target.userId,
      status: "pending",
      createdAt: Date.now(),
    })
    return { result: "sent" }
  },
})

// Accept or decline a pending request addressed to me. Decline deletes the row,
// leaving no trace (the requester can try again later).
export const respondToRequest = mutation({
  args: { friendshipId: v.id("friendships"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const me = await requireUserId(ctx)
    const f = await ctx.db.get(args.friendshipId)
    if (!f || f.addresseeId !== me || f.status !== "pending") {
      throw new Error("That request is no longer available.")
    }
    if (args.accept) {
      await ctx.db.patch(f._id, { status: "accepted", respondedAt: Date.now() })
    } else {
      await ctx.db.delete(f._id)
    }
  },
})

// Remove a friend (either party may). Deletes the friendship row; books and
// recommendations already exchanged are untouched.
export const removeFriend = mutation({
  args: { friendshipId: v.id("friendships") },
  handler: async (ctx, args) => {
    const me = await requireUserId(ctx)
    const f = await ctx.db.get(args.friendshipId)
    if (!f || (f.requesterId !== me && f.addresseeId !== me)) {
      throw new Error("Friendship not found.")
    }
    await ctx.db.delete(f._id)
  },
})
