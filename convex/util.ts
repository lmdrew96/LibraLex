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

// Default library loan period: 3 weeks. The SINGLE source for both runtimes —
// every server path that stamps a due date (shelfAdd, books.checkoutBook, the MCP
// renew_loan default) and the client (lib/loans re-exports it) import this. This
// module only has type-level imports, so it's safe in the browser bundle too.
// It's a default, not a law (renewLoan lets the user override).
export const LOAN_PERIOD_DAYS = 21
export const LOAN_PERIOD_MS = LOAN_PERIOD_DAYS * 24 * 60 * 60 * 1000
