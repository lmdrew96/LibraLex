import { HOUR, RateLimiter } from "@convex-dev/rate-limiter"
import { components } from "./_generated/api"

// App-level rate limits (Convex component — see convex/convex.config.ts).
//
// friendCodeLookup: every friend-code resolution (the /add/[code] landing +
// "Send request" by code) spends one token, keyed per user. A real person tries
// a handful of codes a day; a script walking the code space hits the wall fast.
// Callers must NOT throw after consuming a token on a miss — a thrown mutation
// rolls the consumption back, which would make failed guesses free.
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  friendCodeLookup: { kind: "token bucket", rate: 20, period: HOUR, capacity: 10 },
})
