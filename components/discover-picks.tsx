"use client"

import { useQuery } from "convex/react"
import { Compass } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookWithCover } from "@/lib/types"
import { moreLikeThisFromPool, recommendFromPool, topTasteSubjects } from "@/lib/recommend"
import { bookKey } from "@/lib/book-key"
import { useDiscover } from "@/lib/use-discover"
import { useIdle } from "@/lib/use-idle"
import { useInView } from "@/lib/use-in-view"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { PickShelf } from "@/components/pick-shelf"
import { Skeleton } from "@/components/ui/skeleton"

// "Shared: fantasy, mystery" off a target book, or "Popular in fantasy" off taste.
const explain = (shared: string[], hasTarget: boolean): string => {
  if (shared.length === 0) return hasTarget ? "Similar themes" : "Popular with readers like you"
  return hasTarget ? `Shared: ${shared.join(", ")}` : `Popular in ${shared.join(", ")}`
}

/** Open-ended discovery from the Open Library catalog — books beyond your shelf
 *  and your friends', surfaced by subject. With `target` it's "more like this
 *  book"; without it, "matches your taste" (needs read history). Layered BENEATH
 *  friend picks: anything already on your shelf or a friend's is filtered out.
 *
 *  The catalog call is SLOW (Open Library's subjects endpoint runs several seconds),
 *  so it never blocks the page. Two deferral modes:
 *   • eager  — load proactively once the page is idle after paint (everything else
 *              renders first, then discovery fills in on its own). For the home shelf.
 *   • lazy   — wait until the section scrolls into view. For a book detail page,
 *              where discovery sits at the very bottom and is often not reached.
 *  Either way the route caches results, so a second viewing is instant. */
export function DiscoverPicks({
  library,
  target,
  title,
  layout,
  eager = false,
}: {
  library: BookWithCover[]
  target?: BookWithCover
  title: string
  layout: "carousel" | "grid"
  eager?: boolean
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  const idle = useIdle()
  // Eager: start after the page is idle. Lazy: start when scrolled near. Until
  // then there are no subjects, so useDiscover makes no request.
  const active = eager ? idle : inView
  const subjects = active
    ? target
      ? (target.subjects ?? []).slice(0, 4)
      : topTasteSubjects(library)
    : []
  const { results, loading } = useDiscover(subjects)
  // Shared with FriendPicks' subscription (Convex dedupes identical queries), so
  // this is free — we read it only to exclude books already shown as friend picks.
  const friendCandidates = useQuery(api.discover.friendCandidates)

  const excluded = new Set<string>([
    ...library.map(bookKey),
    ...(friendCandidates ?? []).map(bookKey),
  ])
  const pool = results.filter((r) => !excluded.has(bookKey(r)))
  const limit = layout === "carousel" ? 12 : 10
  const ranked = (
    target ? moreLikeThisFromPool(target, library, pool) : recommendFromPool(library, pool)
  ).slice(0, limit)

  // The wrapper is always rendered so the observer has something to watch; content
  // swaps in once the catalog responds.
  return (
    <div ref={ref}>
      {ranked.length > 0 ? (
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
      ) : active && loading ? (
        <DiscoverSkeleton title={title} layout={layout} />
      ) : (
        // Idle sentinel — 1px so the observer has measurable area to detect.
        <span className="block h-px" aria-hidden />
      )}
    </div>
  )
}

function DiscoverSkeleton({ title, layout }: { title: string; layout: "carousel" | "grid" }) {
  const tiles = Array.from({ length: layout === "carousel" ? 5 : 5 })
  return (
    <section className={layout === "grid" ? "mt-10 border-t border-lavender pt-6" : undefined}>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-teal">
        <Compass className="h-4 w-4" />
        {title}
      </h2>
      <ul
        className={
          layout === "carousel"
            ? "flex gap-4 overflow-x-hidden pb-2"
            : "grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5"
        }
      >
        {tiles.map((_, i) => (
          <li key={i} className={layout === "carousel" ? "w-32 shrink-0 sm:w-36" : undefined}>
            <Skeleton className="aspect-[2/3] w-full rounded-md" />
            <Skeleton className="mt-2 h-3 w-3/4 rounded" />
          </li>
        ))}
      </ul>
    </section>
  )
}
