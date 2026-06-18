import { Star } from "lucide-react"
import { cn } from "@/lib/utils"

// One averaged source: the rounded stars plus a human descriptor of how many
// ratings stand behind it (e.g. "12,847 Google Books", "3 LibraLex readers").
type RatingRow = { average: number; descriptor: string }

/** Public rating summary for a book — the Google Books community average and the
 *  LibraLex cross-user average, side by side. Each source renders only when it
 *  has at least one rating; the whole section disappears when neither does, so a
 *  freshly added or niche book never shows an empty shell. */
export function RatingsSummary({
  googleAverage,
  googleCount,
  communityAverage,
  communityCount,
}: {
  googleAverage?: number
  googleCount?: number
  communityAverage?: number
  communityCount?: number
}) {
  const rows: RatingRow[] = []
  if (typeof googleAverage === "number" && googleCount && googleCount > 0) {
    rows.push({
      average: googleAverage,
      descriptor: `${googleCount.toLocaleString()} Google Books`,
    })
  }
  if (typeof communityAverage === "number" && communityCount && communityCount > 0) {
    rows.push({
      average: communityAverage,
      descriptor: `${communityCount.toLocaleString()} LibraLex ${
        communityCount === 1 ? "reader" : "readers"
      }`,
    })
  }
  if (rows.length === 0) return null

  return (
    <section className="mt-4">
      <h2 className="mb-2 text-sm font-semibold text-teal">Ratings</h2>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <RatingLine key={row.descriptor} {...row} />
        ))}
      </div>
    </section>
  )
}

function RatingLine({ average, descriptor }: RatingRow) {
  const rounded = Math.round(average)
  return (
    <div
      className="flex items-center gap-2 text-sm"
      aria-label={`${average.toFixed(1)} out of 5 from ${descriptor}`}
    >
      <div className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={cn(
              "h-4 w-4",
              n <= rounded ? "fill-gold text-gold" : "fill-transparent text-lavender",
            )}
          />
        ))}
      </div>
      <span className="font-semibold text-ink">{average.toFixed(1)}</span>
      <span className="text-teal">({descriptor})</span>
    </div>
  )
}
