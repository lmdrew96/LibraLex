import type { MutationCtx, QueryCtx } from "./_generated/server"

// Shared auth helpers for the social modules. Mirrors the inline pattern in
// books.ts: the userId is Clerk's stable tokenIdentifier. Queries stay quiet
// (return empty/null) before auth resolves; mutations reject.

export const getUserId = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string | null> => {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.tokenIdentifier ?? null
}

export const requireUserId = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string> => {
  const userId = await getUserId(ctx)
  if (!userId) throw new Error("Not authenticated")
  return userId
}
