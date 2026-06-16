// Shared front-end types. The canonical stored-book shape is Convex's generated
// Doc<"books"> — import that where you need a saved record. These types cover the
// pre-save search payload and the small string unions reused across the UI.

export type Ownership = "owned" | "wishlist" | "library"
export type ReadStatus = "unread" | "reading" | "read"

/** A normalized result from the book search service (`/api/search`). */
export type BookSearchResult = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  firstPublishYear?: number
  pageCount?: number
  workKey?: string
}

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
  owned: "Owned",
  wishlist: "Wishlist",
  library: "Library",
}

export const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
}
