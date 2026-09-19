import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { rollTasteVector } from "./tasteVector"

// Book vectors live in their own table (see schema.ts `bookEmbeddings`). Every
// read/write of a book's embedding goes through these helpers.

export const embeddingFor = async (
  ctx: QueryCtx | MutationCtx,
  bookId: Id<"books">,
): Promise<Doc<"bookEmbeddings"> | null> =>
  await ctx.db
    .query("bookEmbeddings")
    .withIndex("by_book", (q) => q.eq("bookId", bookId))
    .unique()

export const hasEmbedding = async (
  ctx: QueryCtx | MutationCtx,
  bookId: Id<"books">,
): Promise<boolean> => (await embeddingFor(ctx, bookId)) !== null

// Upsert a book's vector. An empty vector is ignored (never overwrite a good one
// with nothing). A read/reading book's FIRST vector also joins the owner's taste
// vector — the embedding-arrives-after-the-status-change case.
export const saveEmbedding = async (
  ctx: MutationCtx,
  book: Doc<"books">,
  embedding: number[],
): Promise<void> => {
  if (embedding.length === 0) return
  const existing = await embeddingFor(ctx, book._id)
  if (existing) {
    await ctx.db.patch(existing._id, { embedding })
    return
  }
  await ctx.db.insert("bookEmbeddings", { bookId: book._id, userId: book.userId, embedding })
  if (book.readStatus === "read" || book.readStatus === "reading") {
    await rollTasteVector(ctx, book.userId, embedding)
  }
}

export const deleteEmbedding = async (ctx: MutationCtx, bookId: Id<"books">): Promise<void> => {
  const existing = await embeddingFor(ctx, bookId)
  if (existing) await ctx.db.delete(existing._id)
}
