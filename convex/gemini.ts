// Thin client for Gemini's embeddings endpoint. Self-contained (no imports
// outside convex/) so it works from Convex actions. Requires GEMINI_API_KEY —
// set it in BOTH places:
//   .env.local                          (Next.js reads this, if ever needed there)
//   npx convex env set GEMINI_API_KEY … (Convex actions read their own env store)
//
// gemini-embedding-2 (not gemini-embedding-001 or the retired text-embedding-004)
// — recommended per Gemini's docs, and it auto-normalizes truncated-dimension
// output (verified empirically: a 1536-dim response has L2 norm ≈ 1.0), so no
// manual normalization step is needed here.

const GEMINI_MODEL = "gemini-embedding-2"
const GEMINI_TIMEOUT_MS = 15_000

// Convex vector indexes cap at 2048 dimensions; Gemini's default is 3072.
// 1536 is one of Gemini's three recommended truncation points (768/1536/3072)
// and comfortably under Convex's ceiling.
export const GEMINI_DIMENSIONS = 1536

type GeminiTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"

type GeminiResponse = {
  embedding?: { values?: number[] }
}

// Thrown (not swallowed to null) on a 429 so a bulk caller (the catalog seed)
// can wait out the window and retry instead of silently giving up on a book.
export class GeminiRateLimitedError extends Error {}

/** Embed one piece of text. `taskType` tells Gemini whether this is catalog
 *  content ("RETRIEVAL_DOCUMENT") or a user's free-text search
 *  ("RETRIEVAL_QUERY") — the model tunes the embedding differently for each.
 *  Returns null on a non-retryable failure (missing key, network error, empty
 *  input, non-429 API error) so callers can fall back to "no vector yet"
 *  instead of throwing. Throws GeminiRateLimitedError on a 429 specifically. */
export const embedText = async (
  text: string,
  taskType: GeminiTaskType,
): Promise<number[] | null> => {
  const input = text.trim()
  if (!input) return null

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: { parts: [{ text: input }] },
          taskType,
          outputDimensionality: GEMINI_DIMENSIONS,
        }),
      },
    )
    if (res.status === 429) throw new GeminiRateLimitedError(await res.text())
    if (!res.ok) {
      console.warn(`Gemini embeddings request failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as GeminiResponse
    return data.embedding?.values ?? null
  } catch (err) {
    if (err instanceof GeminiRateLimitedError) throw err
    console.warn(`Gemini embeddings request threw: ${String(err)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}
