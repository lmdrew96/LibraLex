"use client"

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

type CoverSize = "S" | "M" | "L"

type BookCoverProps = {
  coverUrl?: string // user-uploaded cover (Convex storage) — takes precedence over all
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

/**
 * The one place cover URLs get built. Renders from Google Books' thumbnail URL,
 * falling through to a styled spine-colored placeholder if none resolves. The
 * 2:3 box is always reserved so nothing shifts while the image loads.
 */
export function BookCover({
  coverUrl,
  coverUrlFallback,
  title,
  size = "M",
  className,
}: BookCoverProps) {
  // Ordered candidate sources: a user-uploaded cover wins, then Google's thumbnail.
  const sources = useMemo(() => {
    const list: string[] = []
    if (coverUrl) list.push(coverUrl)
    if (coverUrlFallback) list.push(coverUrlFallback)
    return list
  }, [coverUrl, coverUrlFallback])

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
