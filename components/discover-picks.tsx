"use client"

import { useQuery } from "convex/react"
import { Compass } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookWithCover } from "@/lib/types"
import { moreLikeThisFromPool, recommendFromPool, topTasteSubjects } from "@/lib/recommend"
import { bookKey } from "@/lib/book-key"
import { useDiscover } from "@/lib/use-discover"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { PickShelf } from "@/components/pick-shelf"

// "Shared: fantasy, mystery" off a target book, or "Popular in fantasy" off taste.
const explain = (shared: string[], hasTarget: boolean): string => {
  if (shared.length === 0) return hasTarget ? "Similar themes" : "Popular with readers like you"
  return hasTarget ? `Shared: ${shared.join(", ")}` : `Popular in ${shared.join(", ")}`
}

/** Open-ended discovery from the Open Library catalog — books beyond your shelf
 *  and your friends', surfaced by subject. With `target` it's "more like this
 *  book"; without it, "matches your taste" (needs read history). Layered BENEATH
 *  friend picks: anything already on your shelf or a friend's is filtered out, so
 *  the higher-trust friend signal always wins a tie. Renders nothing while the
 *  catalog call is in flight or when nothing new fits. */
export function DiscoverPicks({
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
  const subjects = target ? (target.subjects ?? []).slice(0, 4) : topTasteSubjects(library)
  const { results } = useDiscover(subjects)
  // Shared with FriendPicks' subscription (Convex dedupes identical queries), so
  // this is free — we read it only to exclude books already shown as friend picks.
  const friendCandidates = useQuery(api.discover.friendCandidates)

  if (results.length === 0) return null

  const excluded = new Set<string>([
    ...library.map(bookKey),
    ...(friendCandidates ?? []).map(bookKey),
  ])
  const pool = results.filter((r) => !excluded.has(bookKey(r)))
  if (pool.length === 0) return null

  const limit = layout === "carousel" ? 12 : 10
  const ranked = (
    target ? moreLikeThisFromPool(target, library, pool) : recommendFromPool(library, pool)
  ).slice(0, limit)
  if (ranked.length === 0) return null

  return (
    <PickShelf
      title={title}
      icon={Compass}
      layout={layout}
      items={ranked.map((p) => ({
        key: p.book.workKey,
        node: (
          <OffShelfPick
            book={p.book}
            reason={explain(p.sharedSubjects, Boolean(target))}
            layout={layout}
          />
        ),
      }))}
    />
  )
}
