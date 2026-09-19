import { ConvexError } from "convex/values"

/**
 * The message to show a user for a failed Convex call. Only ConvexError carries a
 * user-facing message across the wire intact — a plain Error arrives prefixed
 * ("[CONVEX M(...)] …") in dev and redacted to "Server Error" in prod — so
 * anything else falls back to the caller's friendly default.
 */
export const userMessage = (err: unknown, fallback: string): string =>
  err instanceof ConvexError && typeof err.data === "string" ? err.data : fallback
