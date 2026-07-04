import type { FriendEndorsement } from "@/convex/discover"

// Endorsement → ranking multiplier applied on top of a content-similarity score.
// A friend who LOVED a book pulls it above one merely owned; extra endorsers add
// a small bump. (convex/discover's endorsementStrength only orders the overflow
// cap; taste-aware ranking surfaces use this instead.) Shared by FriendPicks and
// the "ask for a book" search — both rank a pool of friend-endorsed candidates.
export const endorsementWeight = (e: FriendEndorsement): number => {
  if (e.rating === 5) return 1.5
  if (e.rating === 4) return 1.3
  if (e.rating === 3) return 1.05
  if (e.rating === 2) return 0.85
  if (e.rating === 1) return 0.6
  if (e.readStatus === "read") return 1.15
  if (e.readStatus === "reading") return 1.05
  return 1.0
}

export const friendBoost = (endorsers: FriendEndorsement[]): number => {
  const best = Math.max(...endorsers.map(endorsementWeight))
  const others = Math.min(endorsers.length - 1, 3) * 0.05
  return best + others
}

// "Maya loved this · fantasy, mystery" — social verb from the lead endorser, then
// (when there is one) the shared subjects that earned the content match. Vector-
// scored callers have no subject-overlap concept, so they pass shared: [].
export const explainEndorsement = (endorsers: FriendEndorsement[], shared: string[] = []): string => {
  const lead = [...endorsers].sort((a, b) => endorsementWeight(b) - endorsementWeight(a))[0]
  const others = endorsers.length - 1
  const who = others > 0 ? `${lead.displayName} +${others}` : lead.displayName
  const verb =
    lead.rating && lead.rating >= 4
      ? "loved"
      : lead.readStatus === "read"
        ? "read"
        : lead.readStatus === "reading"
          ? "is reading"
          : "has"
  const subjects = shared.length ? ` · ${shared.join(", ")}` : ""
  return `${who} ${verb} this${subjects}`
}
