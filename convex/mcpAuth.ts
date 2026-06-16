import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server"
import { v } from "convex/values"
import { internal } from "./_generated/api"
import { profileFor } from "./users"
import { getUserId, requireUserId } from "./util"

// Identity for the MCP door (convex/http.ts). The app keys every shelf to a Clerk
// session token, which an MCP client (Claude) can't present — so each user mints a
// per-account secret that rides the MCP URL path and resolves back to their userId.
// Token-in-URL mirrors the URL-path identity of the other Chaos MCPs (Tangle/pctx).

const TOKEN_PREFIX = "shelf_"
const TOKEN_LEN = 40
// URL-safe charset (no padding chars) so the token drops cleanly into a path segment.
const TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// Cryptographically-strong token. Built in an action (not a mutation) so we can use
// crypto.getRandomValues — this secret guards read access, so a PRNG won't do.
const mintToken = (): string => {
  const bytes = new Uint8Array(TOKEN_LEN)
  crypto.getRandomValues(bytes)
  let body = ""
  for (const b of bytes) body += TOKEN_CHARS[b % TOKEN_CHARS.length]
  return TOKEN_PREFIX + body
}

// ── Public (Clerk-authed) ───────────────────────────────────────────────────────

// The caller's current MCP token, or null if they haven't generated one. Powers the
// Settings page's "already connected" state. The token is low-sensitivity (a book
// list) and re-displayable so the user can copy their URL anytime.
export const getMyMcpToken = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const profile = await profileFor(ctx, userId)
    return profile?.mcpToken ?? null
  },
})

// Mint (or rotate) the caller's MCP token and return it. An action so it can use
// crypto.getRandomValues; persistence happens in the internal mutation below, which
// runs with the caller's propagated auth.
export const generateMcpToken = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")
    const token = mintToken()
    await ctx.runMutation(internal.mcpAuth.storeMcpToken, { token })
    return token
  },
})

// Clear the caller's MCP token — any Claude connected with it loses access until a
// new one is generated.
export const revokeMcpToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    const profile = await profileFor(ctx, userId)
    if (profile?.mcpToken) await ctx.db.patch(profile._id, { mcpToken: undefined })
  },
})

// ── Internal (called by the action / the MCP door) ───────────────────────────────

// Persist a freshly-minted token onto the caller's profile. Internal: only the
// generateMcpToken action calls it, and it re-derives the user from propagated auth.
export const storeMcpToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUserId(ctx)
    const profile = await profileFor(ctx, userId)
    if (!profile) throw new Error("Profile isn't ready yet — reload the page and try again.")
    await ctx.db.patch(profile._id, { mcpToken: token })
  },
})

// Resolve an MCP token to the userId that owns it, or null. The guard rejects junk
// or empty tokens before the index lookup, so a missing token can never match the
// token-less (mcpToken === undefined) rows.
export const userIdForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<string | null> => {
    if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 16) {
      return null
    }
    const profile = await ctx.db
      .query("users")
      .withIndex("by_mcpToken", (q) => q.eq("mcpToken", token))
      .unique()
    return profile?.userId ?? null
  },
})
