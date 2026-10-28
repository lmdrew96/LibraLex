import { internalMutation } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import { profileFor } from "./users"

// Per-user taste vector: a running mean of embeddings for books the user has
// finished or is reading. Rolled in incrementally on the read/reading
// transition (see convex/books.updateBook + applyEnrichment) rather than
// recomputed from scratch — cheap, per the patch spec's "rolling update"
// call. Known trade-off: un-reading or deleting a taste-source book doesn't
// retract its contribution (there's no stored per-book weight to subtract),
// so the vector only gets more informed forward, never corrects backward.
export const rollTasteVector = async (
  ctx: MutationCtx,
  userId: string,
  embedding: number[],
): Promise<void> => {
  const profile = await profileFor(ctx, userId)
  if (!profile) return
  const n = profile.tasteVectorCount ?? 0
  const prevMean = profile.tasteVector
  const nextN = n + 1
  // Running mean: newMean[i] = oldMean[i] + (x[i] - oldMean[i]) / nextN. A
  // dimension mismatch (shouldn't happen — one model, one index) restarts from
  // this embedding rather than mixing incompatible vectors.
  const nextMean =
    prevMean && prevMean.length === embedding.length
      ? prevMean.map((v, i) => v + (embedding[i] - v) / nextN)
      : embedding
  await ctx.db.patch(profile._id, { tasteVector: nextMean, tasteVectorCount: nextN })
}

// Roll a book into its owner's taste vector at most once: stamps
// books.tasteCountedAt, and skips a book that already has it.
export const countTowardTaste = async (
  ctx: MutationCtx,
  book: Doc<"books">,
  embedding: number[],
): Promise<void> => {
  if (book.tasteCountedAt) return
  await rollTasteVector(ctx, book.userId, embedding)
  await ctx.db.patch(book._id, { tasteCountedAt: Date.now() })
}

// One-off seed for existing data: recompute every user's taste vector from
// scratch as a plain mean over their read/reading books that already carry an
// embedding. Run once after the embedding backfill so the vector rec engine
// has something to search with immediately, instead of waiting for future
// rate/finish events to build it up one book at a time. Also stamps
// books.tasteCountedAt to match — re-run it to backfill that field and clear
// drift from books counted twice before it existed:
//   npx convex run tasteVector:seedAllTasteVectors
export const seedAllTasteVectors = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ usersSeeded: number }> => {
    const users = await ctx.db.query("users").collect()
    let usersSeeded = 0
    for (const user of users) {
      const books = await ctx.db
        .query("books")
        .withIndex("by_user", (q) => q.eq("userId", user.userId))
        .collect()
      const sources: number[][] = []
      const now = Date.now()
      for (const b of books) {
        const vec =
          b.readStatus === "read" || b.readStatus === "reading"
            ? await ctx.db
                .query("bookEmbeddings")
                .withIndex("by_book", (q) => q.eq("bookId", b._id))
                .unique()
            : null
        // tasteCountedAt mirrors exactly what went into this mean, so later
        // status toggles can't count a book twice.
        if (vec?.embedding.length) {
          sources.push(vec.embedding)
          if (!b.tasteCountedAt) await ctx.db.patch(b._id, { tasteCountedAt: now })
        } else if (b.tasteCountedAt) {
          await ctx.db.patch(b._id, { tasteCountedAt: undefined })
        }
      }
      if (sources.length === 0) {
        if (user.tasteVector) await ctx.db.patch(user._id, { tasteVector: undefined, tasteVectorCount: undefined })
        continue
      }

      const dims = sources[0].length
      const mean = new Array(dims).fill(0)
      for (const vec of sources) {
        for (let i = 0; i < dims; i++) mean[i] += vec[i] / sources.length
      }
      await ctx.db.patch(user._id, { tasteVector: mean, tasteVectorCount: sources.length })
      usersSeeded++
    }
    return { usersSeeded }
  },
})
