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

// Default library loan period: 3 weeks. SINGLE server-side source — every code
// path that stamps a due date imports this (books.addBook/checkoutBook,
// mcpData.addBookForUser); it's a default, not a law (renewLoan lets the user
// override). The client mirrors it as lib/loans.LOAN_PERIOD_MS — the two runtimes
// can't share a module, so keep the day count identical if it ever changes.
export const LOAN_PERIOD_MS = 21 * 24 * 60 * 60 * 1000
