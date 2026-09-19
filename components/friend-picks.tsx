"use client"

import { useEffect, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { ScoredFriendCandidate } from "@/convex/discover"
import type { BookWithCover } from "@/lib/types"
import { moreLikeThisFromPool } from "@/lib/recommend"
import { bookKey } from "@/lib/book-key"
import { friendBoost, explainEndorsement } from "@/lib/friend-endorsement"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { PickShelf } from "@/components/pick-shelf"

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
          reason={explainEndorsement(p.book.endorsers, p.sharedSubjects)}
          endorsers={p.book.endorsers}
          layout={layout}
        />
      ),
    }))
  } else {
    if (!vectorPicks || vectorPicks.length === 0) return null
    // The vector picks are a one-shot fetch, not a live query, so a book added from
    // this row (or anywhere) must be filtered out against the live library here.
    const mine = new Set(library.map(bookKey))
    const visible = vectorPicks.filter((c) => !dismissedSet.has(bookKey(c)) && !mine.has(bookKey(c)))
    if (visible.length === 0) return null
    const ranked = visible
      .map((c) => ({ ...c, boosted: c.score * friendBoost(c.endorsers) }))
      .sort((a, b) => b.boosted - a.boosted)
      .slice(0, limit)
    if (ranked.length === 0) return null
    items = ranked.map((c) => ({
      key: c.dedupeKey,
      node: <OffShelfPick book={c} reason={explainEndorsement(c.endorsers, [])} endorsers={c.endorsers} layout={layout} />,
    }))
  }

  return <PickShelf title={title} icon={Users} layout={layout} items={items} />
}
