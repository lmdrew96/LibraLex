"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

type CoverSize = "S" | "M" | "L"

type BookCoverProps = {
  coverUrl?: string // user-uploaded cover (Convex storage) — takes precedence over all
  coverId?: number
  coverUrlFallback?: string
  title: string
  size?: CoverSize
  className?: string
}

const placeholderText: Record<CoverSize, string> = {
  S: "text-[10px] leading-tight p-1.5",
  M: "text-xs leading-snug p-2",
  L: "text-sm leading-snug p-3",
}

// Fetch a higher-res Open Library variant than the display box so covers stay
// crisp on retina screens. OL's `M` is only 180px wide; `L` is ~320px. Tiny
// search thumbnails (S) fetch M; grids and detail (M/L) fetch full-res L.
const OL_RESOLUTION: Record<CoverSize, "S" | "M" | "L"> = { S: "M", M: "L", L: "L" }

/**
 * The one place cover URLs get built. Renders from Open Library's cover_i
 * (rate-limit-free) — never from ISBN. Tries the OL by-id image first, then the
 * Google Books fallback URL, then a styled spine-colored placeholder. The 2:3
 * box is always reserved so nothing shifts while the image loads.
 */
export function BookCover({
  coverUrl,
  coverId,
  coverUrlFallback,
  title,
  size = "M",
  className,
}: BookCoverProps) {
  // Ordered candidate sources: a user-uploaded cover wins, then OL by-id (with
  // ?default=false so a missing cover 404s and triggers onError instead of
  // returning a blank), then the Google Books fallback URL.
  const sources = useMemo(() => {
    const list: string[] = []
    if (coverUrl) list.push(coverUrl)
    if (coverId !== undefined) {
      list.push(
        `https://covers.openlibrary.org/b/id/${coverId}-${OL_RESOLUTION[size]}.jpg?default=false`,
      )
    }
    if (coverUrlFallback) list.push(coverUrlFallback)
    return list
  }, [coverUrl, coverId, coverUrlFallback, size])

  const [idx, setIdx] = useState(0)
  // Reset the source chain if the book (its cover inputs) changes.
  useEffect(() => setIdx(0), [sources])

  const src = sources[idx]

  return (
    <div
      className={cn(
        "relative aspect-[2/3] w-full overflow-hidden rounded-md bg-lavender shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          onError={() => setIdx((i) => i + 1)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={cn(
            "cover-placeholder flex h-full w-full items-center justify-center text-center font-medium",
            placeholderText[size],
          )}
        >
          <span className="line-clamp-5">{title}</span>
        </div>
      )}
    </div>
  )
}
