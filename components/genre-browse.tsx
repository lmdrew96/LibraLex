"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery } from "convex/react"
import Link from "next/link"
import { Compass, SlidersHorizontal } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { DEFAULT_GENRE_IDS, genreById, type Genre } from "@/lib/genres"
import { bookKey } from "@/lib/book-key"
import { collapseEditions, editionKey } from "@/lib/collapse-editions"
import { useDiscover } from "@/lib/use-discover"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { PickShelf } from "@/components/pick-shelf"
import { Skeleton } from "@/components/ui/skeleton"

const ROW_LIMIT = 12
// How far the per-visit window start rotates into a row's owned buffer. Each visit
// shows a different `ROW_LIMIT`-wide slice (start cycles 0..ROTATION_RANGE-1), so the
// genre rows surface fresh books across visits without the cross-carousel ASSIGNMENT
// changing — a book never bounces between genres, only in/out of the visible window.
const ROTATION_RANGE = 6
// Ready picks kept beyond the rotated window for instant replenish. A single-subject
// genre query returns a shallow page (~14), so without a buffer a row has almost no
// surplus and visibly shrinks when a pick is added/declined before a slow refetch
// lands — the headroom Discover gets for free from its deeper multi-subject pool.
const REFILL_BUFFER = 6
// Prefetch depth: deep enough to cover the rotated window's start offset, the row
// itself, AND the replenish buffer, so both rotation and instant refill always hold.
const BUFFER_TARGET = ROW_LIMIT + ROTATION_RANGE + REFILL_BUFFER
// Per-visit counter persisted across sessions; each Search visit advances it so the
// rotation window moves on. Read in an effect (never during render) to avoid an
// SSR/hydration mismatch.
const VISIT_KEY = "libralex.genreBrowseVisit"

/** "Browse by genre" — the Search page's resting state. Shows a "Popular in <genre>"
 *  carousel for each of the user's favorite genres (or a default set until they pick
 *  some in Settings), drawn from the same catalog-discovery engine the Recs page
 *  uses. Books already on the shelf — or dismissed — are filtered out so it reads as
 *  "here's what you don't have yet". */
export function GenreBrowse() {
  const profile = useQuery(api.users.getMyProfile)
  const library = useQuery(api.books.listBooks, {})
  const dismissed = useQuery(api.discover.dismissedKeys)

  // Cross-carousel claim registry: each row reports the work keys in its candidate
  // pool; a work is owned by the EARLIEST genre (in the user's order) that surfaces
  // it, and suppressed from every later row. Keyed by row index, so assignment is
  // deterministic from genre order — not fetch timing — and stable across reloads.
  const [claims, setClaims] = useState<Record<number, string[]>>({})
  const reportKeys = useCallback((index: number, keys: string[]) => {
    setClaims((prev) => {
      const prevKeys = prev[index]
      if (
        prevKeys &&
        prevKeys.length === keys.length &&
        prevKeys.every((k, i) => k === keys[i])
      ) {
        return prev // unchanged — don't trigger a needless re-render
      }
      return { ...prev, [index]: keys }
    })
  }, [])
  const ownerByKey = useMemo(() => {
    const owner = new Map<string, number>()
    for (const index of Object.keys(claims)
      .map(Number)
      .sort((a, b) => a - b)) {
      for (const key of claims[index]) {
        if (!owner.has(key)) owner.set(key, index)
      }
    }
    return owner
  }, [claims])

  // Per-visit rotation seed. Starts at 0 (front window) for SSR + the first client
  // render so hydration matches, then advances a persisted counter once mounted, so
  // each visit to Search rotates the genre windows to a fresh slice.
  const [visitSeed, setVisitSeed] = useState(0)
  useEffect(() => {
    try {
      const prev = Number(window.localStorage.getItem(VISIT_KEY) ?? "0")
      const next = Number.isFinite(prev) ? prev + 1 : 1
      window.localStorage.setItem(VISIT_KEY, String(next))
      setVisitSeed(next)
    } catch {
      // localStorage blocked (private mode) — stay at 0, i.e. no rotation.
    }
  }, [])

  // Wait for the profile so we don't flash the default set then swap to the user's.
  if (profile === undefined) {
    return <GenreBrowseSkeleton />
  }

  const chosen = profile?.favoriteGenres?.length ? profile.favoriteGenres : null
  const usingDefaults = !chosen
  const genres = (chosen ?? DEFAULT_GENRE_IDS)
    .map(genreById)
    .filter((g): g is Genre => Boolean(g))

  const excluded = new Set<string>([
    ...(library ?? []).map(bookKey),
    ...(dismissed ?? []),
  ])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-teal">
          {usingDefaults
            ? "Popular books by genre — tap any to read about it or add it."
            : "Popular in your favorite genres — tap any to read about it or add it."}
        </p>
        <Link
          href="/settings"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-teal hover:text-ink hover:underline"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {usingDefaults ? "Pick favorites" : "Edit genres"}
        </Link>
      </div>

      <div className="flex flex-col gap-8">
        {genres.map((g, i) => (
          <GenreRow
            key={g.id}
            index={i}
            genre={g}
            excluded={excluded}
            ownerByKey={ownerByKey}
            reportKeys={reportKeys}
            visitSeed={visitSeed}
          />
        ))}
      </div>
    </div>
  )
}

// One genre's popular-books carousel. Each row independently drives the discovery
// hook for its subject, backfilling deeper catalog pages when shelf/dismissal
// exclusions thin it below the target count — the same pattern DiscoverPicks uses.
// Cross-carousel dedup: the row reports its candidate works to the parent registry
// and only renders the ones it OWNS (it's the earliest genre to surface them), so a
// book shared by two genres lands in exactly one row.
function GenreRow({
  index,
  genre,
  excluded,
  ownerByKey,
  reportKeys,
  visitSeed,
}: {
  index: number
  genre: Genre
  excluded: Set<string>
  ownerByKey: Map<string, number>
  reportKeys: (index: number, keys: string[]) => void
  visitSeed: number
}) {
  const { results, loading, loadMore, exhausted } = useDiscover([genre.subject])

  // This row's candidate pool: shelf/dismissal exclusions removed, then edition dupes
  // collapsed (within-row dedup — reuses the shared utility). Independent of other
  // rows, so it's a stable basis for the cross-row claim.
  const pool = useMemo(
    () => collapseEditions(results.filter((r) => !excluded.has(bookKey(r)))),
    [results, excluded],
  )
  const poolKeys = useMemo(() => pool.map(editionKey), [pool])

  // Report this row's claim whenever its pool changes. Joined into a primitive so the
  // effect only fires on a real change, not on array identity.
  const poolKeysJoined = poolKeys.join("|")
  useEffect(() => {
    reportKeys(index, poolKeys)
    // poolKeys captured via poolKeysJoined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, poolKeysJoined, reportKeys])

  // Works this row owns (earliest genre wins; an unseen key defaults to self so
  // nothing flashes empty on first paint). Held as a buffer deeper than the row so an
  // added/declined pick is replaced instantly from the surplus rather than the row
  // shrinking.
  const owned = pool.filter((p) => (ownerByKey.get(editionKey(p)) ?? index) === index)

  // Per-visit window into the owned buffer. The start is a FIXED offset (not a
  // length-dependent cyclic shift), so declining a pick just slides the next one in
  // rather than reshuffling the row. Clamped so the window always fills when the
  // buffer is deep enough; offset is staggered by row so genres don't all rotate in
  // lockstep.
  const maxStart = Math.max(0, owned.length - ROW_LIMIT)
  const start = Math.min((visitSeed + index) % ROTATION_RANGE, maxStart)
  const visible = owned.slice(start, start + ROW_LIMIT)

  useEffect(() => {
    // Prefetch until the owned buffer clears the rotated window plus its replenish
    // headroom, so both rotation and instant add/decline refill always hold. Bounded
    // by the hook's page cap; also refills after the catalog backfills a consumed pick.
    if (
      !loading &&
      !exhausted &&
      results.length > 0 &&
      owned.length < BUFFER_TARGET
    ) {
      loadMore()
    }
  }, [loading, exhausted, results.length, owned.length, loadMore])

  if (visible.length === 0) {
    return loading ? <GenreRowSkeleton label={genre.label} /> : null
  }

  return (
    <PickShelf
      title={`Popular in ${genre.label}`}
      icon={Compass}
      layout="carousel"
      items={visible.map((p) => ({
        key: p.workKey,
        node: <OffShelfPick book={p} reason={p.authors[0] ?? "Popular pick"} layout="carousel" />,
      }))}
    />
  )
}

function GenreRowSkeleton({ label }: { label: string }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-teal">
        <Compass className="h-4 w-4" />
        Popular in {label}
      </h2>
      <ul className="flex gap-4 overflow-x-hidden pb-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="w-32 shrink-0 sm:w-36">
            <Skeleton className="aspect-[2/3] w-full rounded-md" />
            <Skeleton className="mt-2 h-3 w-3/4 rounded" />
          </li>
        ))}
      </ul>
    </section>
  )
}

function GenreBrowseSkeleton() {
  return (
    <div>
      <Skeleton className="mb-5 h-4 w-2/3 rounded" />
      <div className="flex flex-col gap-8">
        {DEFAULT_GENRE_IDS.slice(0, 3).map((id) => (
          <GenreRowSkeleton key={id} label={genreById(id)?.label ?? ""} />
        ))}
      </div>
    </div>
  )
}
