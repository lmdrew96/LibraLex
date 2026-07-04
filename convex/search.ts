import { action } from "./_generated/server"
import { v } from "convex/values"
import { internal } from "./_generated/api"
import { embedText } from "./voyage"
import type { ScoredFriendCandidate } from "./discover"

const MAX_RESULTS = 20

// Natural-language "ask for a book" — free text ("something atmospheric and
// slow") embedded as a QUERY vector (Voyage tunes query vs. document embeddings
// differently) and matched against the same by_embedding index the taste-vector
// recs use (see convex/discover.friendPicksVector). Same visibility scope as
// FriendPicks: friends' shelves, minus anything already mine or shelf-hidden —
// this is a query-driven discovery surface, not a search over your own shelf.
export const searchBooksByQuery = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<ScoredFriendCandidate[]> => {
    const identity = await ctx.auth.getUserIdentity()
    const me = identity?.tokenIdentifier
    if (!me) return []

    const trimmed = query.trim()
    if (!trimmed) return []

    const inputs = await ctx.runQuery(internal.discover._friendVectorInputs, { me })
    if (inputs.friendIds.length === 0) return []

    const queryVector = await embedText(trimmed, "query")
    if (!queryVector) return []

    const hits = await ctx.vectorSearch("books", "by_embedding", {
      vector: queryVector,
      limit: 64,
      filter: (q) =>
        inputs.friendIds.length === 1
          ? q.eq("userId", inputs.friendIds[0])
          : q.or(...inputs.friendIds.map((id) => q.eq("userId", id))),
    })
    if (hits.length === 0) return []

    const results = await ctx.runQuery(internal.discover._assembleVectorCandidates, {
      me,
      hits: hits.map((h) => ({ id: h._id, score: h._score })),
    })
    return results.slice(0, MAX_RESULTS)
  },
})
