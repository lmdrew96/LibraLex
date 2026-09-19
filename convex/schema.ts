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

    // ── bibliographic (Google Books) ──────────────────────────────────────────
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    // DEPRECATED — legacy Open Library cover_i. No longer written after the
    // Google Books migration + backfill; kept for any row the backfill couldn't
    // reach. book-cover.tsx checks coverUrlFallback first.
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()), // Google Books thumbnail — the primary cover source (not just a fallback)
    coverStorageId: v.optional(v.id("_storage")), // user-uploaded cover (Convex file storage) — overrides the auto ones when set
    // Google Books volume id (opaque, edition-level — NOT a work-level grouping id
    // like the old OL /works/OL...W). Used for cross-shelf/candidate identity
    // (lib/book-key.ts, convex/discover.ts) and community-rating grouping
    // (by_workKey); falls back to isbn/title+author when absent.
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),

    // ── cached enrichment (enrich-once pipeline, see convex/enrich.ts) ─────────
    // Populated once on add (Google Books, normalized) so the detail view renders
    // with ZERO external calls. Refreshed by the manual "re-fetch metadata"
    // action. All optional — older records backfill in.
    description: v.optional(v.string()), // Google Books description
    categories: v.optional(v.array(v.string())), // Google Books BISAC categories (coarse; drives the comic-guard + future filters)
    // Google Books categories (coarse — typically 1–2 BISAC-style tags, not OL's
    // granular per-book tag list). Recommender fuel, weaker signal than before —
    // see convex/embed.ts (description is the dominant embedding input).
    subjects: v.optional(v.array(v.string())),
    // DEPRECATED — Open Library author bios, feature dropped (Google Books has no
    // author-biography data). Field kept for existing rows; no longer written.
    authorBios: v.optional(
      v.array(v.object({ name: v.string(), bio: v.optional(v.string()) })),
    ),
    averageRating: v.optional(v.number()), // GB community average (0–5) — shown alongside the LibraLex community average
    ratingsCount: v.optional(v.number()), // number of GB ratings behind averageRating

    // DEPRECATED — vectors moved to the `bookEmbeddings` table (v0.49). Kept only
    // so pre-migration rows validate; migrations:moveEmbeddingsToTable copies each
    // one over and clears it here. Never written or read by live code.
    embedding: v.optional(v.array(v.float64())),

    // ── shelf relationship ────────────────────────────────────────────────────
    // "none" = read/encountered but not in your possession (a friend's copy, a
    // returned library book, a digital read). It carries no loan fields and never
    // shows on the owned shelf / wishlist / loans — it lives in History by
    // readStatus, and feeds the recommender's taste profile like any other read.
    ownership: v.union(
      v.literal("owned"),
      v.literal("wishlist"),
      v.literal("library"),
      v.literal("none"),
    ),
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
    .index("by_user_dueDate", ["userId", "dueDate"])
    // Cross-user lookups by book identity — power the LibraLex community average,
    // which collects every user's copy of a title and averages their ratings.
    .index("by_workKey", ["workKey"])
    .index("by_isbn", ["isbn"]),

  // One Gemini gemini-embedding-2 vector per book (title/authors/description/
  // subjects — see convex/embed.ts), split out of `books` so every scan of book
  // docs (friend shelves, the MCP recommender, backfills) doesn't also drag ~12KB
  // of floats per row toward Convex's per-execution read limit. Written by the
  // enrich-on-add path + backfills via convex/bookEmbeddings.ts; deleted with its
  // book. userId is denormalized from the book so vector search can filter by it.
  bookEmbeddings: defineTable({
    bookId: v.id("books"),
    userId: v.string(), // the book's owner — same value books.userId uses
    embedding: v.array(v.float64()),
  })
    .index("by_book", ["bookId"])
    // Nearest-neighbor search (see convex/gemini.ts for the dimension count).
    // filterFields lets a search scope to one user's shelf or OR across a friend
    // list (FriendPicks) without a full table scan.
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),

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
    // Genre ids the user picked in Settings (see lib/genres.ts) — drives the
    // "Popular in <genre>" browse rows on the Search page. Stored as our stable
    // genre ids, not raw catalog subject strings, so the curated list can evolve
    // without rewriting saved preferences. Absent/empty falls back to a default set.
    favoriteGenres: v.optional(v.array(v.string())),
    // Ownership shelves the user has hidden from friends (see convex/shelf,
    // discover, mcpData — every friend-facing read filters these out). Absent/empty
    // = everything visible, which is the default and the pre-toggle behavior. Loan
    // due dates are always stripped regardless; this controls whole-shelf visibility.
    hiddenShelves: v.optional(
      v.array(
        v.union(
          v.literal("owned"),
          v.literal("wishlist"),
          v.literal("library"),
          v.literal("none"),
        ),
      ),
    ),
    // Rolling centroid (running mean) of embeddings for this user's read/reading
    // books — see convex/tasteVector.ts. Updated incrementally on the unread →
    // read/reading transition, not recomputed from scratch each time,
    // so it only ever grows more informed forward (un-reading or deleting a
    // taste-source book doesn't retract its contribution). tasteVectorCount is
    // the running-mean denominator.
    tasteVector: v.optional(v.array(v.float64())),
    tasteVectorCount: v.optional(v.number()),
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
    // The sender's uploaded cover, if any. Best-effort: it points at the sender's
    // book file, so it's resolved to a URL at read time and falls back to
    // coverId/coverUrlFallback if the sender later deletes the book (file gone).
    coverStorageId: v.optional(v.id("_storage")),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),

    message: v.optional(v.string()), // optional note from the sender
    status: v.union(v.literal("unread"), v.literal("read")),
    createdAt: v.number(),
  })
    .index("by_recipient", ["toUserId"])
    .index("by_recipient_status", ["toUserId", "status"]),

  // "Not interested" — a user declining an auto-recommendation. One row per
  // (user, book) dismissed from the off-shelf discovery surfaces (FriendPicks +
  // DiscoverPicks). `key` is the cross-shelf bookKey()/dedupeKey identity
  // (workKey → isbn → title+author), so a title dismissed from one source stays
  // hidden everywhere. Dismissals are durable (no expiry); undoing deletes the
  // row. by_user_key makes the idempotent insert + undo an O(1) lookup.
  dismissedBooks: defineTable({
    userId: v.string(), // Clerk identity.tokenIdentifier
    key: v.string(), // bookKey() — stable cross-shelf identity
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_key", ["userId", "key"]),

  // Precomputed catalog discovery — "popular books in <subject>" from Google
  // Books, refreshed daily by a cron (convex/crons.ts → discoverCache.refreshAll).
  // The /api/discover route reads this first and only falls back to a live Google
  // fetch when a subject isn't cached, so the genre browse carousels never wait on
  // an external call at render. One row per subject; `candidates` is the
  // work-deduped, relevance-ranked pool.
  discoveryCache: defineTable({
    subject: v.string(), // subject phrase, lowercased (mirrors lib/genres.ts subjects)
    candidates: v.array(
      v.object({
        // Google Books volume id (edition-level, not a true cross-edition work id).
        workKey: v.string(),
        title: v.string(),
        authors: v.array(v.string()),
        coverId: v.optional(v.number()), // DEPRECATED — legacy OL cover_i, unused for new candidates
        coverUrlFallback: v.optional(v.string()), // Google Books thumbnail
        firstPublishYear: v.optional(v.number()),
        subjects: v.optional(v.array(v.string())), // Google Books categories (coarse)
      }),
    ),
    refreshedAt: v.number(),
  }).index("by_subject", ["subject"]),

  // A broad, embedded book catalog — independent of any user's shelf — seeded
  // from Google Books across the curated genre list (convex/catalog.ts) and
  // powering "ask for a book" free-text search (convex/search.ts). Distinct
  // from `books` (which only has embeddings for books someone actually added):
  // this exists purely to be semantically searched, so an entry is only ever
  // inserted once it already has a vector — no partial/unembedded rows.
  catalogBooks: defineTable({
    workKey: v.string(), // Google Books volume id — the identity for cross-genre dedup
    title: v.string(),
    authors: v.array(v.string()),
    coverId: v.optional(v.number()), // DEPRECATED — legacy OL cover_i, unused for new rows
    coverUrlFallback: v.optional(v.string()), // Google Books thumbnail
    firstPublishYear: v.optional(v.number()),
    subjects: v.optional(v.array(v.string())), // Google Books categories (coarse)
    description: v.optional(v.string()),
    embedding: v.array(v.float64()),
    seededAt: v.number(),
  })
    .index("by_workKey", ["workKey"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),
})
