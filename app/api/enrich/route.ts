import { NextResponse } from "next/server"
import { enrichBook, type EnrichedBook } from "@/convex/enrich"

// Enrich-once endpoint: takes a picked search/scan candidate and returns the full
// merged + normalized record (description, categories, subjects, author bios) to
// cache on the Convex book. Called once at add-time and by the detail page's
// "re-fetch metadata" action — never on a plain read. POST so the candidate
// (arrays + several fields) rides in the body cleanly.
export const maxDuration = 30

export async function POST(request: Request): Promise<NextResponse> {
  let candidate: EnrichedBook
  try {
    candidate = (await request.json()) as EnrichedBook
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  if (!candidate?.title) {
    return NextResponse.json({ error: "A title is required." }, { status: 400 })
  }

  try {
    const enriched = await enrichBook({ ...candidate, authors: candidate.authors ?? [] })
    return NextResponse.json({ book: enriched })
  } catch {
    // Enrichment is best-effort — never block an add. Fall back to the candidate.
    return NextResponse.json({ book: candidate })
  }
}
