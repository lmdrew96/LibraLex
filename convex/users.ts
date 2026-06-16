import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { getUserId, requireUserId } from "./util"

// Ambiguity-free charset (no 0/O/1/I/L) so a code is easy to read aloud / retype.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const CODE_LEN = 4

// Math.random() is permitted in Convex mutations (unlike queries), same bucket as
// the Date.now() the existing mutations already rely on. We retry on the rare
// collision against the by_friendCode index.
const mintFriendCode = async (ctx: MutationCtx): Promise<string> => {
  for (let attempt = 0; attempt < 8; attempt++) {
    let body = ""
    for (let i = 0; i < CODE_LEN; i++) {
      body += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    }
    const code = `SHELF-${body}`
    const clash = await ctx.db
      .query("users")
      .withIndex("by_friendCode", (q) => q.eq("friendCode", code))
      .unique()
    if (!clash) return code
  }
  throw new Error("Couldn't mint a unique friend code — try again.")
}

// The profile shape safe to expose to friends / by-code lookups (never the
// internal _id or createdAt). userId is opaque, so including it is harmless and
// lets the client route to a friend's shelf.
export type PublicProfile = {
  userId: string
  displayName: string
  avatarUrl?: string
}

export const toPublicProfile = (p: Doc<"users">): PublicProfile => ({
  userId: p.userId,
  displayName: p.displayName,
  avatarUrl: p.avatarUrl,
})

export const profileFor = async (
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<"users"> | null> =>
  await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique()

// ── Queries ───────────────────────────────────────────────────────────────────

// The caller's own profile (incl. their shareable friend code). Null until
// ensureProfile has run for this identity.
export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    return await profileFor(ctx, userId)
  },
})

// Resolve a friend code to a public profile — powers the /add/[code] landing.
// Returns null for unknown codes and for the caller's own code (nothing to do).
export const getProfileByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const code = normalizeCode(args.code)
    if (!code) return null
    const profile = await ctx.db
      .query("users")
      .withIndex("by_friendCode", (q) => q.eq("friendCode", code))
      .unique()
    if (!profile || profile.userId === userId) return null
    return toPublicProfile(profile)
  },
})

// ── Mutations ─────────────────────────────────────────────────────────────────

// Upsert the caller's profile from their Clerk identity. Called on every
// authenticated load (see AppShell), so it also keeps name/avatar fresh. Returns
// the friend code so the client never has to round-trip again.
export const ensureProfile = mutation({
  args: { displayName: v.string(), avatarUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const displayName = args.displayName.trim() || "Reader"
    const existing = await profileFor(ctx, userId)

    if (existing) {
      if (
        existing.displayName !== displayName ||
        existing.avatarUrl !== args.avatarUrl
      ) {
        await ctx.db.patch(existing._id, { displayName, avatarUrl: args.avatarUrl })
      }
      return existing.friendCode
    }

    const friendCode = await mintFriendCode(ctx)
    await ctx.db.insert("users", {
      userId,
      displayName,
      avatarUrl: args.avatarUrl,
      friendCode,
      createdAt: Date.now(),
    })
    return friendCode
  },
})

// Normalize user-entered codes: trim, uppercase, accept with/without the
// "SHELF-" prefix, drop stray whitespace. Returns "" if it can't form a code body.
export const normalizeCode = (raw: string): string => {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "")
  const body = cleaned.startsWith("SHELF-") ? cleaned.slice(6) : cleaned
  if (!body) return ""
  return `SHELF-${body}`
}
