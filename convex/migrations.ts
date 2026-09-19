import { internalMutation } from "./_generated/server"

// One-off: clear every stored embedding/taste-vector before switching embedding
// providers (Voyage voyage-4, 1024 dims → Gemini gemini-embedding-2, 1536 dims).
// A vector from one model is meaningless compared against the other, and Convex's
// vector index is declared with a single fixed dimension count — old 1024-dim
// vectors are incompatible with a 1536-dim index. Run this BEFORE pushing the
// schema change, then re-run the embedding backfill + taste-vector seed:
//   npx convex run migrations:clearEmbeddingsForProviderSwitch
export const clearEmbeddingsForProviderSwitch = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ booksCleared: number; usersCleared: number }> => {
    const vectors = await ctx.db.query("bookEmbeddings").collect()
    for (const e of vectors) await ctx.db.delete(e._id)

    const users = await ctx.db.query("users").collect()
    let usersCleared = 0
    for (const u of users) {
      if (u.tasteVector?.length) {
        await ctx.db.patch(u._id, { tasteVector: undefined, tasteVectorCount: undefined })
        usersCleared++
      }
    }

    return { booksCleared: vectors.length, usersCleared }
  },
})
