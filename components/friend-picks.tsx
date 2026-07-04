"use client"

import { useEffect, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { FriendEndorsement, ScoredFriendCandidate } from "@/convex/discover"
import type { BookWithCover } from "@/lib/types"
import { moreLikeThisFromPool } from "@/lib/recommend"
import { bookKey } from "@/lib/book-key"
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
// (when there is one) the shared subjects that earned the content match. The
// vector-scored path has no subject-overlap concept, so it passes shared: [].
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
 *  book" (content-only nearest-neighbor over the TF-IDF pool — no taste vector
 *  needed); without it, "matches your taste" (Convex vector search over the
 *  taste vector — see convex/discover.friendPicksVector). Renders nothing when
 *  you have no friends, or none of their books fit. */
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
  const dismissed = useQuery(api.discover.dismissedKeys)
  const dismissedSet = new Set(dismissed ?? [])

  // Vector search only runs in a Convex action, so it isn't a live query — fetch
  // once on mount (and again if `target` toggles into/out of the pool path).
  const friendPicksVector = useAction(api.discover.friendPicksVector)
  const [vectorPicks, setVectorPicks] = useState<ScoredFriendCandidate[] | null>(null)
  useEffect(() => {
    if (target) return
    let cancelled = false
    void friendPicksVector({})
      .then((result) => {
        if (!cancelled) setVectorPicks(result)
      })
      .catch(() => {
        if (!cancelled) setVectorPicks([])
      })
    return () => {
      cancelled = true
    }
    // friendPicksVector's identity isn't guaranteed stable across renders, so
    // it's deliberately left out of the deps — only re-fetch when the mode
    // (target vs. taste vector) actually changes.
  }, [target])

  const limit = layout === "carousel" ? 12 : 10

  let items: { key: string; node: React.ReactNode }[]

  if (target) {
    if (!candidates || candidates.length === 0) return null
    const visible = candidates.filter((c) => !dismissedSet.has(bookKey(c)))
    if (visible.length === 0) return null
    const ranked = moreLikeThisFromPool(target, library, visible)
      .map((p) => ({ ...p, score: p.score * friendBoost(p.book.endorsers) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    if (ranked.length === 0) return null
    items = ranked.map((p) => ({
      key: p.book.dedupeKey,
      node: (
        <OffShelfPick
          book={p.book}
          reason={explain(p.book.endorsers, p.sharedSubjects)}
          endorsers={p.book.endorsers}
          layout={layout}
        />
      ),
    }))
  } else {
    if (!vectorPicks || vectorPicks.length === 0) return null
    const visible = vectorPicks.filter((c) => !dismissedSet.has(bookKey(c)))
    if (visible.length === 0) return null
    const ranked = visible
      .map((c) => ({ ...c, boosted: c.score * friendBoost(c.endorsers) }))
      .sort((a, b) => b.boosted - a.boosted)
      .slice(0, limit)
    if (ranked.length === 0) return null
    items = ranked.map((c) => ({
      key: c.dedupeKey,
      node: <OffShelfPick book={c} reason={explain(c.endorsers, [])} endorsers={c.endorsers} layout={layout} />,
    }))
  }

  return <PickShelf title={title} icon={Users} layout={layout} items={items} />
}
