// Thin client for Voyage AI's embeddings endpoint. Self-contained (no imports
// outside convex/) so it works from both a Convex action and the Next.js
// /api/enrich route. Requires VOYAGE_API_KEY — set it in BOTH places:
//   .env.local                          (Next.js reads this)
//   npx convex env set VOYAGE_API_KEY … (Convex actions read their own env store)

const VOYAGE_MODEL = "voyage-4"
const VOYAGE_TIMEOUT_MS = 10_000

// Voyage-4 defaults to 1024 dims but supports 256/512/1024/2048 — pinned
// explicitly (not left to the API default) since the Convex vector index below
// is declared with a fixed dimension count that every stored vector must match.
export const VOYAGE_DIMENSIONS = 1024

type VoyageResponse = {
  data?: Array<{ embedding: number[]; index: number }>
}

// Thrown (not swallowed to null) so a bulk caller — the backfill — can wait out
// the window and retry instead of silently giving up. A Voyage account with no
// payment method on file is capped at 3 requests/minute, which a catalog-sized
// batch blows through immediately.
export class VoyageRateLimitedError extends Error {}

/** Embed one piece of text. `input_type` tells Voyage whether this is catalog
 *  content ("document") or a user's free-text search ("query") — Voyage tunes
 *  the embedding differently for each. Returns null on a non-retryable failure
 *  (missing key, network error, empty input, non-429 API error) so callers can
 *  fall back to "no vector yet" instead of throwing — mirrors enrichBook's
 *  best-effort resilience. Throws VoyageRateLimitedError on a 429 specifically. */
export const embedText = async (
  text: string,
  inputType: "document" | "query",
): Promise<number[] | null> => {
  const input = text.trim()
  if (!input) return null

  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS)
  try {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        model: VOYAGE_MODEL,
        input_type: inputType,
        output_dimension: VOYAGE_DIMENSIONS,
      }),
    })
    if (res.status === 429) throw new VoyageRateLimitedError(await res.text())
    if (!res.ok) {
      console.warn(`Voyage embeddings request failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = (await res.json()) as VoyageResponse
    return data.data?.[0]?.embedding ?? null
  } catch (err) {
    if (err instanceof VoyageRateLimitedError) throw err
    console.warn(`Voyage embeddings request threw: ${String(err)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}
