import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { getUserId, requireUserId } from "./util"
import { profileFor, toPublicProfile, type PublicProfile } from "./users"

// Cross-shelf recommendation candidates (the "friends" source, Phase 1). Returns
// books that live on an accepted friend's shelf but NOT on yours, each tagged with
// the friend(s) who vouch for it. The content-based recommender (lib/recommend.ts)
// scores these against your taste profile client-side; this query only assembles
// and dedupes the pool — it does no ranking.

// One friend's endorsement of a book: who they are + how they relate to it. Drives
// the explanation ("Maya loved this") and the ranking boost.
export type FriendEndorsement = PublicProfile & {
  rating?: number
  readStatus: Doc<"books">["readStatus"]
  review?: string
}

// A book on a friend's shelf, carrying the bibliographic + subject fields the
// recommender scores and the add flow needs, plus its endorsers.
export type FriendCandidate = {
  dedupeKey: string
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  coverUrl?: string
  workKey?: string
  firstPublishYear?: number
  pageCount?: number
  subjects?: string[]
  endorsers: FriendEndorsement[]
}

// Stable identity for a book across shelves: prefer the OL work key, then a
// normalized ISBN, then title+first-author. Two friends owning "the same book"
// collapse to one candidate; a book already on your shelf is excluded by key.
// Works on any record carrying these bibliographic fields — a stored Doc OR an
// inbound add payload — so the MCP add path can resolve an existing copy by the
// SAME identity it dedupes recommendations against (convex/mcpData.ts).
export const identityKey = (b: {
  workKey?: string
  isbn?: string
  title: string
  authors: string[]
}): string => {
  const work = b.workKey?.trim()
  if (work) return `w:${work}`
  const isbn = b.isbn?.replace(/[^0-9Xx]/g, "").toLowerCase()
  if (isbn) return `i:${isbn}`
  return `t:${b.title.trim().toLowerCase()}|${(b.authors[0] ?? "").trim().toLowerCase()}`
}

// The same identity, specialized to a stored book row. Kept as a named export
// because the recommenders read it all over (here + mcpData).
export const dedupeKey = (b: Doc<"books">): string => identityKey(b)

// A book a friend has actually engaged with is a real recommendation; a book
// still sitting unread+unrated on their wishlist is not (it's their to-read, not
// a vouch). So everything qualifies EXCEPT unread, unrated wishlist items.
export const isVouchworthy = (b: Doc<"books">): boolean =>
  !(b.ownership === "wishlist" && b.readStatus === "unread" && b.rating === undefined)

// How strongly an endorsement should sort within the (rare) overflow cap below —
// loved beats read beats merely-owned. Exported so the MCP recommender
// (convex/mcpData.ts) ranks friend picks by the SAME rule; typed structurally
// (rating + readStatus) so both FriendEndorsement and the MCP's RecEndorsement fit.
export const endorsementStrength = (e: {
  rating?: number
  readStatus: Doc<"books">["readStatus"]
}): number =>
  (e.rating ?? 0) * 2 + (e.readStatus === "read" ? 2 : e.readStatus === "reading" ? 1 : 0)

// Rating → taste weight for subject tallies. MUST mirror lib/recommend.ratingWeight
// (the client engine behind the in-app Discover row) so chat "what should I read
// next?" weights taste identically — the two run in different runtimes and can't
// share the module. A read-but-unrated book takes the neutral 1.0.
export const tasteRatingWeight = (rating?: number): number => {
  switch (rating) {
    case 5:
      return 2.0
    case 4:
      return 1.5
    case 3:
      return 1.0
    case 2:
      return 0.5
    case 1:
      return 0.25
    default:
      return 1.0
  }
}

// Cap the pool shipped to the client. Friend libraries are small today, so this
// rarely bites; when it does, the strongest endorsements survive (taste ranking
// then happens client-side over the survivors).
const MAX_CANDIDATES = 200

// Books a friend has, scored against your taste — assembled here, ranked client-side.
export const friendCandidates = query({
  args: {},
  handler: async (ctx): Promise<FriendCandidate[]> => {
    const me = await getUserId(ctx)
    if (!me) return []

    // Accepted friendships in either direction → the set of friend user ids.
    const asRequester = await ctx.db
      .query("friendships")
      .withIndex("by_requester", (q) => q.eq("requesterId", me))
      .collect()
    const asAddressee = await ctx.db
      .query("friendships")
      .withIndex("by_addressee", (q) => q.eq("addresseeId", me))
      .collect()
    const friendIds = [...asRequester, ...asAddressee]
      .filter((f) => f.status === "accepted")
      .map((f) => (f.requesterId === me ? f.addresseeId : f.requesterId))
    if (friendIds.length === 0) return []

    // Keys already on my shelf — anything matching is not a discovery for me.
    const mine = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect()
    const mineKeys = new Set(mine.map(dedupeKey))

    // Walk each friend's shelf, merging duplicate works across friends into one
    // candidate that accrues every endorser.
    const byKey = new Map<string, FriendCandidate & { _coverStorageId?: Doc<"books">["coverStorageId"] }>()
    for (const friendId of friendIds) {
      const profile = await profileFor(ctx, friendId)
      if (!profile) continue
      const endorser = toPublicProfile(profile)
      const books = await ctx.db
        .query("books")
        .withIndex("by_user", (q) => q.eq("userId", friendId))
        .collect()

      for (const b of books) {
        if (!isVouchworthy(b)) continue
        const key = dedupeKey(b)
        if (mineKeys.has(key)) continue

        const endorsement: FriendEndorsement = {
          ...endorser,
          rating: b.rating,
          readStatus: b.readStatus,
          review: b.review?.trim() ? b.review.trim() : undefined,
        }

        const existing = byKey.get(key)
        if (existing) {
          existing.endorsers.push(endorsement)
          // Opportunistically fill any bibliographic gaps from this copy.
          existing.coverId ??= b.coverId
          existing.coverUrlFallback ??= b.coverUrlFallback
          existing.firstPublishYear ??= b.firstPublishYear
          existing.pageCount ??= b.pageCount
          if (!existing.subjects?.length && b.subjects?.length) existing.subjects = b.subjects
          if (!existing._coverStorageId && b.coverStorageId) existing._coverStorageId = b.coverStorageId
          continue
        }

        byKey.set(key, {
          dedupeKey: key,
          title: b.title,
          authors: b.authors,
          isbn: b.isbn,
          coverId: b.coverId,
          coverUrlFallback: b.coverUrlFallback,
          workKey: b.workKey,
          firstPublishYear: b.firstPublishYear,
          pageCount: b.pageCount,
          subjects: b.subjects,
          endorsers: [endorsement],
          _coverStorageId: b.coverStorageId,
        })
      }
    }

    const candidates = [...byKey.values()].sort((a, b) => {
      const sa = Math.max(...a.endorsers.map(endorsementStrength))
      const sb = Math.max(...b.endorsers.map(endorsementStrength))
      return sb - sa
    })

    // Resolve uploaded covers (a friend's own file, same as getFriendShelf does)
    // only for the survivors, then drop the internal storage-id field.
    return await Promise.all(
      candidates.slice(0, MAX_CANDIDATES).map(async ({ _coverStorageId, ...c }) => ({
        ...c,
        coverUrl: _coverStorageId
          ? ((await ctx.storage.getUrl(_coverStorageId)) ?? undefined)
          : undefined,
      })),
    )
  },
})

// ── "Not interested" — declining off-shelf auto-recommendations ────────────────

// The bookKey() identities the caller has dismissed. The discovery surfaces
// (FriendPicks + DiscoverPicks) read this and filter these books out before
// ranking, so a decline sticks across both sources and re-renders live.
export const dismissedKeys = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const me = await getUserId(ctx)
    if (!me) return []
    const rows = await ctx.db
      .query("dismissedBooks")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .collect()
    return rows.map((r) => r.key)
  },
})

// Mark a book "not interested" by its cross-shelf key. Idempotent — a repeat
// dismiss is a no-op, so double-taps and re-dismissing a re-surfaced title are safe.
export const dismissPick = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const me = await requireUserId(ctx)
    const existing = await ctx.db
      .query("dismissedBooks")
      .withIndex("by_user_key", (q) => q.eq("userId", me).eq("key", key))
      .unique()
    if (existing) return
    await ctx.db.insert("dismissedBooks", { userId: me, key, createdAt: Date.now() })
  },
})

// Undo a dismissal (the "Undo" on the toast) — deletes the row so the book is
// eligible to surface again. No-op if it wasn't dismissed.
export const undismissPick = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const me = await requireUserId(ctx)
    const existing = await ctx.db
      .query("dismissedBooks")
      .withIndex("by_user_key", (q) => q.eq("userId", me).eq("key", key))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})
