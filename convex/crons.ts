import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

// Scheduled jobs. Keep daily / low-frequency background work here.
const crons = cronJobs()

// Refresh the genre discovery cache once a day — a subject's popular books barely move
// day to day, so daily is plenty. The genre browse carousels read the result straight
// from Convex (via /api/discover), so this is what keeps them instant without ever
// touching Google Books at render time. 09:00 UTC is off-peak for the catalog.
crons.daily(
  "refresh-discovery-cache",
  { hourUTC: 9, minuteUTC: 0 },
  internal.discoverCache.refreshAll,
)

// Embed any book that slipped through add-time enrichment (a Gemini hiccup, or a
// row that predates server-side enrichment) — small hourly batches, so unembedded
// books still reach the taste vector and vector recs without a manual backfill.
crons.hourly("embed-missing-books", { minuteUTC: 17 }, internal.shelfAdd.embedMissing, {})

export default crons
