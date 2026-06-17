// Shared front-end types. The canonical stored-book shape is Convex's generated
// Doc<"books"> — import that where you need a saved record. These types cover the
// pre-save search payload and the small string unions reused across the UI.

import type { Doc } from "@/convex/_generated/dataModel"

export type Ownership = "owned" | "wishlist" | "library"
export type ReadStatus = "unread" | "reading" | "read"

/** A stored book plus its resolved cover URL. The book queries resolve an
 *  uploaded `coverStorageId` to a servable `coverUrl`; surfaces that render the
 *  owner's own books use this so a custom cover shows everywhere consistently. */
export type BookWithCover = Doc<"books"> & { coverUrl?: string }

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

/** A fully enriched, cacheable book record — search-result fields plus the merged
 *  enrichment (`description`, `categories`, `subjects`, `authorBios`) the enrich-once
 *  pipeline (`convex/enrich.ts` → `/api/enrich`) writes to Convex so the detail view
 *  renders with no external calls. Defined in the engine, re-exported here for the UI. */
export type { EnrichedBook } from "@/convex/enrich"

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

/** Enriched reference data for a book — summary, subjects, author bios. Fetched
 *  on demand from `/api/book-info` (Open Library + Google Books); never stored. */
export type BookInfo = {
  description?: string
  subjects: string[]
  authors: { name: string; bio?: string }[]
}
