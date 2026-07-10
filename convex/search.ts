import { action, internalQuery } from "./_generated/server"
import { v } from "convex/values"
import { internal } from "./_generated/api"
import { embedText } from "./gemini"

const MAX_RESULTS = 20
const VECTOR_SEARCH_LIMIT = 64

// A catalog match, shaped like the off-shelf candidates FriendPicks/DiscoverPicks
// already render (see components/off-shelf-pick.tsx) — no endorsers, since a
// catalog book isn't necessarily on anyone's shelf.
export type CatalogSearchResult = {
  dedupeKey: string
  workKey: string
  title: string
  authors: string[]
  coverUrlFallback?: string
  firstPublishYear?: number
  subjects?: string[]
  score: number
}

export const _catalogByIds = internalQuery({
  args: { ids: v.array(v.id("catalogBooks")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)))
    return docs.filter((d): d is NonNullable<typeof d> => d !== null)
  },
})

// Natural-language "ask for a book" — free text ("something atmospheric and
// slow") embedded as a QUERY vector (Gemini tunes query vs. document embeddings
// differently) and matched against the broad catalog seeded by convex/catalog.ts.
// This searches the wide catalog, not any user's or friend's shelf — FriendPicks'
// taste-based row (convex/discover.friendPicksVector) is the shelf-scoped surface.
export const searchBooksByQuery = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<CatalogSearchResult[]> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const trimmed = query.trim()
    if (!trimmed) return []

    const queryVector = await embedText(trimmed, "RETRIEVAL_QUERY")
    if (!queryVector) return []

    const hits = await ctx.vectorSearch("catalogBooks", "by_embedding", {
      vector: queryVector,
      limit: VECTOR_SEARCH_LIMIT,
    })
    if (hits.length === 0) return []

    const scoreById = new Map(hits.map((h) => [h._id, h._score]))
    const docs = await ctx.runQuery(internal.search._catalogByIds, {
      ids: hits.map((h) => h._id),
    })

    return docs
      .map((d) => ({
        dedupeKey: `w:${d.workKey}`,
        workKey: d.workKey,
        title: d.title,
        authors: d.authors,
        coverUrlFallback: d.coverUrlFallback,
        firstPublishYear: d.firstPublishYear,
        subjects: d.subjects,
        score: scoreById.get(d._id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
  },
})
