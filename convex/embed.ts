import { embedText } from "./voyage"

/** The fields a book needs to be embedded — a subset of EnrichedBook, but kept
 *  separate so callers don't have to have run the full enrich pipeline first. */
export type EmbeddableBook = {
  title: string
  authors: string[]
  description?: string
  subjects?: string[]
}

// Description is the richest signal (usually a paragraph of real prose); title/
// authors/subjects round it out and carry the whole book when there's no
// description yet (a manual add, or a source that came back empty).
export const embedInput = (b: EmbeddableBook): string =>
  [b.title, b.authors.join(", "), b.description, (b.subjects ?? []).join(", ")]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n")

/** Embed a book for the catalog (document-side). Null on empty input or a
 *  Voyage failure — callers must preserve any existing stored vector rather
 *  than overwrite it with null (see convex/backfill.ts). */
export const embedBook = async (b: EmbeddableBook): Promise<number[] | null> =>
  embedText(embedInput(b), "document")
