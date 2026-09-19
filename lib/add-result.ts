import type { AddResult } from "@/convex/shelfAdd"
import { OWNERSHIP_LABELS, type Ownership } from "@/lib/types"

const shelfName = (o: Ownership): string =>
  o === "owned"
    ? "your shelf"
    : o === "wishlist"
      ? "your wishlist"
      : o === "library"
        ? "your loans"
        : "your history"

/**
 * Toast copy for an add. Adds dedupe server-side (convex/shelfAdd.ts), so an
 * add can also mean "already there" or "moved from another shelf" — say which.
 * `addedMessage` is the caller's own wording for a genuinely new book.
 */
export const addResultMessage = (result: AddResult, addedMessage: string): string => {
  if (result.status === "exists") return `“${result.title}” is already on ${shelfName(result.ownership)}.`
  if (result.status === "moved") {
    if (result.from === "library" && result.ownership === "library")
      return `Borrowing “${result.title}” again — due in 3 weeks.`
    return `Moved “${result.title}” from ${OWNERSHIP_LABELS[result.from]} to ${shelfName(result.ownership)}.`
  }
  return addedMessage
}
