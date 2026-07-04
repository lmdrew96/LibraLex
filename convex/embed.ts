import { embedText, GeminiRateLimitedError } from "./gemini"

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
 *  Gemini failure — callers must preserve any existing stored vector rather
 *  than overwrite it with null (see convex/backfill.ts, convex/catalog.ts). */
export const embedBook = async (b: EmbeddableBook): Promise<number[] | null> =>
  embedText(embedInput(b), "RETRIEVAL_DOCUMENT")

// Defensive backoff in case Gemini rate-limits a large batch — wait out the
// window and retry rather than leaving a book permanently unembedded. Shared
// by the shelf backfill and the catalog seed, both of which embed many books
// in a loop and can afford to run slower rather than drop books.
const EMBED_RETRY_WAIT_MS = 10_000
const EMBED_MAX_ATTEMPTS = 4

export const embedBookWithRetry = async (b: EmbeddableBook): Promise<number[] | null> => {
  for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
    try {
      return await embedBook(b)
    } catch (err) {
      if (!(err instanceof GeminiRateLimitedError) || attempt === EMBED_MAX_ATTEMPTS) return null
      await new Promise((resolve) => setTimeout(resolve, EMBED_RETRY_WAIT_MS))
    }
  }
  return null
}
