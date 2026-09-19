import { internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"

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

// v0.49 one-off: move each book's legacy `books.embedding` into the
// `bookEmbeddings` table, then clear it off the book. Pages through `books` in
// small batches (each legacy row carries ~12KB of floats) and re-schedules
// itself until done, so no single run nears the read limit. Idempotent — a book
// that already has a bookEmbeddings row just gets its legacy field cleared.
// Taste vectors are untouched (they're already computed from these same vectors).
//   npx convex run migrations:moveEmbeddingsToTable
export const moveEmbeddingsToTable = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), moved: v.optional(v.number()) },
  handler: async (ctx, { cursor = null, moved = 0 }): Promise<{ scheduledNext: boolean; moved: number }> => {
    const page = await ctx.db.query("books").paginate({ cursor, numItems: 50 })
    for (const b of page.page) {
      if (!b.embedding) continue
      if (b.embedding.length > 0) {
        const existing = await ctx.db
          .query("bookEmbeddings")
          .withIndex("by_book", (q) => q.eq("bookId", b._id))
          .unique()
        if (!existing) {
          await ctx.db.insert("bookEmbeddings", {
            bookId: b._id,
            userId: b.userId,
            embedding: b.embedding,
          })
          moved++
        }
      }
      await ctx.db.patch(b._id, { embedding: undefined })
    }
    if (page.isDone) {
      console.log(`moveEmbeddingsToTable: done — ${moved} vectors moved`)
      return { scheduledNext: false, moved }
    }
    await ctx.scheduler.runAfter(0, internal.migrations.moveEmbeddingsToTable, {
      cursor: page.continueCursor,
      moved,
    })
    return { scheduledNext: true, moved }
  },
})
