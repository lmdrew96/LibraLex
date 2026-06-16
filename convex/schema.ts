import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

// Single denormalized `books` table — bibliographic fields + the shelf
// relationship live on one record. Solo user for v1, so no dedup / no separate
// editions table. All timestamps are ms-epoch numbers (Convex convention);
// due-date math lives in mutations, never here.
export default defineSchema({
  books: defineTable({
    userId: v.string(), // Clerk user id (identity.tokenIdentifier)

    // ── bibliographic (from Open Library / Google Books) ──────────────────────
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()), // Open Library cover_i — render covers from THIS (rate-limit-free)
    coverUrlFallback: v.optional(v.string()), // Google Books thumbnail when coverId missing
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
})
