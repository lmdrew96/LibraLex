"use client"

import { useState } from "react"
import Link from "next/link"
import type { BookInfo as BookInfoData } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/** Renders fetched book enrichment — summary, subject chips, author bios. Shows
 *  skeletons while loading and a quiet note when a book simply has no extra data. */
export function BookInfo({
  data,
  loading,
}: {
  data: BookInfoData | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
      </div>
    )
  }

  const hasDescription = Boolean(data?.description)
  const subjects = data?.subjects ?? []
  const authorsWithBios = (data?.authors ?? []).filter((a) => a.bio)
  const isEmpty = !hasDescription && subjects.length === 0 && authorsWithBios.length === 0

  if (isEmpty) {
    return <p className="text-sm text-teal/90">No extra details found for this book.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {hasDescription && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-teal">About this book</h3>
          <Expandable text={data!.description!} clamp="line-clamp-6" />
        </section>
      )}

      {subjects.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-teal">Subjects</h3>
          <ul className="flex flex-wrap gap-1.5">
            {subjects.map((s) => (
              <li
                key={s}
                className="rounded-full bg-lavender/60 px-2.5 py-1 text-xs font-medium text-ink"
              >
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {authorsWithBios.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-teal">
            About the author{authorsWithBios.length > 1 ? "s" : ""}
          </h3>
          <div className="flex flex-col gap-4">
            {authorsWithBios.map((a) => (
              <div key={a.name}>
                <Link
                  href={`/author/${encodeURIComponent(a.name)}`}
                  className="mb-1 inline-block font-medium text-ink underline-offset-2 hover:text-teal hover:underline"
                >
                  {a.name}
                </Link>
                <Expandable text={a.bio!} clamp="line-clamp-4" />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// Long text with a read-more toggle. The clamp only kicks in for genuinely long
// passages so short blurbs never sprout a pointless toggle.
function Expandable({ text, clamp }: { text: string; clamp: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 280
  return (
    <div>
      <p
        className={cn(
          "whitespace-pre-line text-sm leading-relaxed text-ink/90",
          !open && long && clamp,
        )}
      >
        {text}
      </p>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-xs font-medium text-teal underline-offset-2 hover:underline"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  )
}
