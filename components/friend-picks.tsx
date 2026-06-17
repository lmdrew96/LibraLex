"use client"

import { useQuery } from "convex/react"
import { Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { FriendEndorsement } from "@/convex/discover"
import type { BookWithCover } from "@/lib/types"
import { moreLikeThisFromPool, recommendFromPool } from "@/lib/recommend"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { PickShelf } from "@/components/pick-shelf"

// Endorsement → ranking multiplier applied on top of the content-similarity score.
// A friend who LOVED a book pulls it above one merely owned; extra endorsers add a
// small bump. (convex/discover's endorsementStrength only orders the overflow cap;
// the taste-aware ranking lives here.)
const endorsementWeight = (e: FriendEndorsement): number => {
  if (e.rating === 5) return 1.5
  if (e.rating === 4) return 1.3
  if (e.rating === 3) return 1.05
  if (e.rating === 2) return 0.85
  if (e.rating === 1) return 0.6
  if (e.readStatus === "read") return 1.15
  if (e.readStatus === "reading") return 1.05
  return 1.0
}

const friendBoost = (endorsers: FriendEndorsement[]): number => {
  const best = Math.max(...endorsers.map(endorsementWeight))
  const others = Math.min(endorsers.length - 1, 3) * 0.05
  return best + others
}

// "Maya loved this · fantasy, mystery" — social verb from the lead endorser, then
// the shared subjects that earned the content match.
const explain = (endorsers: FriendEndorsement[], shared: string[]): string => {
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

/** Recommendations drawn from your friends' shelves — books they own/loved that
 *  match your taste and you don't have yet. With `target` it's "more like this
 *  book" (content-only); without it, "matches your taste" (needs read history).
 *  Renders nothing when you have no friends, or none of their books fit. */
export function FriendPicks({
  library,
  target,
  title,
  layout,
}: {
  library: BookWithCover[]
  target?: BookWithCover
  title: string
  layout: "carousel" | "grid"
}) {
  const candidates = useQuery(api.discover.friendCandidates)
  if (!candidates || candidates.length === 0) return null

  const limit = layout === "carousel" ? 12 : 10
  const ranked = (
    target
      ? moreLikeThisFromPool(target, library, candidates)
      : recommendFromPool(library, candidates)
  )
    .map((p) => ({ ...p, score: p.score * friendBoost(p.book.endorsers) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (ranked.length === 0) return null

  return (
    <PickShelf
      title={title}
      icon={Users}
      layout={layout}
      items={ranked.map((p) => ({
        key: p.book.dedupeKey,
        node: (
          <OffShelfPick
            book={p.book}
            reason={explain(p.book.endorsers, p.sharedSubjects)}
            endorsers={p.book.endorsers}
            layout={layout}
          />
        ),
      }))}
    />
  )
}
