import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

// Denormalized `books` table — bibliographic fields + the shelf relationship
// live on one record. Friends layer adds `users` (a profile per Clerk identity,
// so a friend sees a name not a token), `friendships` (mutual request → accept),
// and `recommendations` (a self-contained book snapshot one friend sends another).
// All timestamps are ms-epoch numbers (Convex convention); date math lives in
// mutations, never here.
export default defineSchema({
  books: defineTable({
    userId: v.string(), // Clerk user id (identity.tokenIdentifier)

    // ── bibliographic (from Open Library / Google Books) ──────────────────────
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()), // Open Library cover_i — render covers from THIS (rate-limit-free)
    coverUrlFallback: v.optional(v.string()), // Google Books thumbnail when coverId missing
    coverStorageId: v.optional(v.id("_storage")), // user-uploaded cover (Convex file storage) — overrides the auto ones when set
    workKey: v.optional(v.string()), // /works/OL...W stable id
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),

    // ── shelf relationship ────────────────────────────────────────────────────
    ownership: v.union(v.literal("owned"), v.literal("wishlist"), v.literal("library")),
    readStatus: v.union(v.literal("unread"), v.literal("reading"), v.literal("read")),
    rating: v.optional(v.number()), // 1–5
    review: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),

    // ── library loan fields (only meaningful when ownership === "library") ────
    checkoutDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    returned: v.optional(v.boolean()),
    libraryName: v.optional(v.string()),

    addedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_ownership", ["userId", "ownership"])
    .index("by_user_readStatus", ["userId", "readStatus"])
    .index("by_user_dueDate", ["userId", "dueDate"]),

  // One profile row per Clerk identity. Minted on first authenticated load
  // (see users.ensureProfile) and kept in sync with Clerk's name/avatar. The
  // `friendCode` is the only handle a friend ever needs — short, unique, shareable.
  users: defineTable({
    userId: v.string(), // Clerk identity.tokenIdentifier — same value books.userId uses
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    friendCode: v.string(), // e.g. "SHELF-7K2Q" — unique, ambiguity-free charset
    // IANA timezone (e.g. "America/New_York"), captured browser-side on profile
    // sync. The frontend does loan date-math in the browser's local zone; the MCP
    // door runs on Convex (UTC), so it reads this to count "due in N days" on the
    // user's calendar-day boundaries instead of UTC's. Absent until first sync.
    timeZone: v.optional(v.string()),
    // Secret bearer token for the MCP door (convex/http.ts). Absent until the user
    // generates one in Settings; rotating/revoking just rewrites/clears it. Unlike
    // the human-friendly friendCode, this carries real entropy — it grants read
    // access to the shelf. Indexed so the MCP can resolve token → userId in O(1).
    mcpToken: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_friendCode", ["friendCode"])
    .index("by_mcpToken", ["mcpToken"]),

  // A friendship is a single row regardless of direction. `requester` sent it,
  // `addressee` accepts or declines. Both `by_*` indexes are scanned to assemble
  // "my friends" (I may be on either side); `by_pair` dedupes a directed edge.
  friendships: defineTable({
    requesterId: v.string(),
    addresseeId: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted")),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
  })
    .index("by_requester", ["requesterId"])
    .index("by_addressee", ["addresseeId"])
    .index("by_pair", ["requesterId", "addresseeId"]),

  // A recommendation carries its own book snapshot so it stands alone even if the
  // sender later removes the book from their shelf. Acting on a rec (add/dismiss)
  // deletes the row, so the inbox stays an actionable list, not an archive.
  recommendations: defineTable({
    fromUserId: v.string(),
    toUserId: v.string(),

    // book snapshot (mirrors the bibliographic half of `books`)
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),

    message: v.optional(v.string()), // optional note from the sender
    status: v.union(v.literal("unread"), v.literal("read")),
    createdAt: v.number(),
  })
    .index("by_recipient", ["toUserId"])
    .index("by_recipient_status", ["toUserId", "status"]),
})
