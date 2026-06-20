import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

// Scheduled jobs. Keep daily / low-frequency background work here.
const crons = cronJobs()

// Refresh the genre discovery cache once a day — a subject's popular books barely move
// day to day, so daily is plenty. The genre browse carousels read the result straight
// from Convex (via /api/discover), so this is what keeps them instant without ever
// touching OL at render time. 09:00 UTC is off-peak for the catalog.
crons.daily(
  "refresh-discovery-cache",
  { hourUTC: 9, minuteUTC: 0 },
  internal.discoverCache.refreshAll,
)

export default crons
