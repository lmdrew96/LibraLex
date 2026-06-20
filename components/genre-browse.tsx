"use client"

import { useEffect } from "react"
import { useQuery } from "convex/react"
import Link from "next/link"
import { Compass, SlidersHorizontal } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { DEFAULT_GENRE_IDS, genreById, type Genre } from "@/lib/genres"
import { bookKey } from "@/lib/book-key"
import { useDiscover } from "@/lib/use-discover"
import { OffShelfPick } from "@/components/off-shelf-pick"
import { PickShelf } from "@/components/pick-shelf"
import { Skeleton } from "@/components/ui/skeleton"

const ROW_LIMIT = 12

/** "Browse by genre" — the Search page's resting state. Shows a "Popular in <genre>"
 *  carousel for each of the user's favorite genres (or a default set until they pick
 *  some in Settings), drawn from the same catalog-discovery engine the Recs page
 *  uses. Books already on the shelf — or dismissed — are filtered out so it reads as
 *  "here's what you don't have yet". */
export function GenreBrowse() {
  const profile = useQuery(api.users.getMyProfile)
  const library = useQuery(api.books.listBooks, {})
  const dismissed = useQuery(api.discover.dismissedKeys)

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
        {genres.map((g) => (
          <GenreRow key={g.id} genre={g} excluded={excluded} />
        ))}
      </div>
    </div>
  )
}

// One genre's popular-books carousel. Each row independently drives the discovery
// hook for its subject, backfilling deeper catalog pages when shelf/dismissal
// exclusions thin it below the target count — the same pattern DiscoverPicks uses.
function GenreRow({ genre, excluded }: { genre: Genre; excluded: Set<string> }) {
  const { results, loading, loadMore, exhausted } = useDiscover([genre.subject])
  const pool = results.filter((r) => !excluded.has(bookKey(r)))
  const visible = pool.slice(0, ROW_LIMIT)

  useEffect(() => {
    if (!loading && !exhausted && results.length > 0 && visible.length < ROW_LIMIT) {
      loadMore()
    }
  }, [loading, exhausted, results.length, visible.length, loadMore])

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
