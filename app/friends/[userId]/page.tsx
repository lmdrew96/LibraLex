"use client"

import { use, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "convex/react"
import { ArrowLeft, Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { SharedBook } from "@/convex/shelf"
import { cn } from "@/lib/utils"
import { AppShell } from "@/components/app-shell"
import { FriendAvatar } from "@/components/friend-avatar"
import { FriendBookCard } from "@/components/friend-book-card"
import { Skeleton } from "@/components/ui/skeleton"

type Tab = "owned" | "wishlist" | "reading" | "read"

const TABS: { key: Tab; label: string; match: (b: SharedBook) => boolean }[] = [
  { key: "owned", label: "Owned", match: (b) => b.ownership === "owned" },
  { key: "wishlist", label: "Wishlist", match: (b) => b.ownership === "wishlist" },
  { key: "reading", label: "Reading", match: (b) => b.readStatus === "reading" },
  { key: "read", label: "Read", match: (b) => b.readStatus === "read" },
]

export default function FriendShelfPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = use(params)
  const shelf = useQuery(api.shelf.getFriendShelf, { friendUserId: userId })
  const [tab, setTab] = useState<Tab>("owned")

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { owned: 0, wishlist: 0, reading: 0, read: 0 }
    if (shelf) for (const t of TABS) c[t.key] = shelf.books.filter(t.match).length
    return c
  }, [shelf])

  const shown = useMemo(() => {
    if (!shelf) return []
    const matcher = TABS.find((t) => t.key === tab)!.match
    return shelf.books.filter(matcher)
  }, [shelf, tab])

  return (
    <AppShell>
      <Link
        href="/friends"
        className="mb-4 inline-flex items-center gap-1 text-sm text-teal hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Friends
      </Link>

      {shelf === undefined ? (
        <ShelfSkeleton />
      ) : shelf === null ? (
        <div className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-lavender bg-card/50 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-lavender/60 text-teal">
            <Users className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold text-ink">Shelf unavailable</h1>
          <p className="max-w-sm text-teal">
            You can only see a shelf once you&apos;re friends. Send a request from
            the Friends page.
          </p>
          <Link href="/friends" className="mt-1 font-medium text-teal underline">
            Back to Friends
          </Link>
        </div>
      ) : (
        <>
          <header className="mb-6 flex items-center gap-4">
            <FriendAvatar
              name={shelf.profile.displayName}
              avatarUrl={shelf.profile.avatarUrl}
              size="lg"
            />
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-semibold">
                {shelf.profile.displayName}
              </h1>
              <p className="mt-0.5 text-teal">
                {shelf.books.length} {shelf.books.length === 1 ? "book" : "books"} on the shelf
              </p>
            </div>
          </header>

          <div className="mb-5 flex flex-wrap gap-2">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  tab === key
                    ? "bg-ink text-surface"
                    : "bg-lavender/50 text-ink hover:bg-lavender",
                )}
              >
                {label}
                <span className={cn("ml-1.5", tab === key ? "text-surface/70" : "text-ink/50")}>
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="py-12 text-center text-teal">
              Nothing on the {TABS.find((t) => t.key === tab)!.label.toLowerCase()} shelf yet.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {shown.map((book) => (
                <li key={book._id}>
                  <FriendBookCard book={book} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  )
}

function ShelfSkeleton() {
  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-44 rounded" />
          <Skeleton className="h-4 w-24 rounded" />
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton className="h-3.5 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </li>
        ))}
      </ul>
    </>
  )
}
