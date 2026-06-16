"use client"

import { useEffect } from "react"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { Sparkles, X } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { AppShell } from "@/components/app-shell"
import { BookCover } from "@/components/book-cover"
import { EmptyState } from "@/components/empty-state"
import { FriendAvatar } from "@/components/friend-avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export default function RecsPage() {
  const inbox = useQuery(api.recs.getInbox)
  const markAllRead = useMutation(api.recs.markAllRead)
  const addToShelf = useMutation(api.recs.addRecToShelf)
  const dismiss = useMutation(api.recs.dismissRec)

  // Clear the unread badge once the inbox is open. Idempotent, so a strict-mode
  // double-invoke is harmless.
  useEffect(() => {
    void markAllRead({})
  }, [markAllRead])

  const add = async (recId: Id<"recommendations">, ownership: "owned" | "wishlist", title: string) => {
    try {
      await addToShelf({ recId, ownership })
      toast.success(
        `Added “${title}” to your ${ownership === "owned" ? "shelf" : "wishlist"}.`,
      )
    } catch {
      toast.error("Couldn't add that book.")
    }
  }

  const remove = async (recId: Id<"recommendations">) => {
    try {
      await dismiss({ recId })
    } catch {
      toast.error("Couldn't dismiss that rec.")
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Recommendations</h1>
        <p className="mt-1 text-teal">Books your friends thought you&apos;d love.</p>
      </div>

      {inbox === undefined ? (
        <ul className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex gap-4 rounded-[24px] border border-lavender bg-card p-4">
              <Skeleton className="h-28 w-20 shrink-0" />
              <div className="flex-1 space-y-3 pt-1">
                <Skeleton className="h-5 w-2/3 rounded" />
                <Skeleton className="h-4 w-1/3 rounded" />
                <Skeleton className="h-9 w-40 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : inbox.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No recommendations yet"
          message="When a friend sends you a book, it lands here. Open a friend's shelf, or recommend something from your own book pages to get the swap going."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {inbox.map((rec) => (
            <li
              key={rec._id}
              className="relative flex gap-4 rounded-[24px] border border-lavender bg-card p-4"
            >
              <div className="w-20 shrink-0">
                <BookCover
                  coverId={rec.coverId}
                  coverUrlFallback={rec.coverUrlFallback}
                  title={rec.title}
                  size="M"
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="mb-1.5 flex items-center gap-2 text-xs text-teal">
                  <FriendAvatar
                    name={rec.from?.displayName ?? "A friend"}
                    avatarUrl={rec.from?.avatarUrl}
                    size="sm"
                  />
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink">
                      {rec.from?.displayName ?? "A friend"}
                    </span>{" "}
                    · {formatDistanceToNow(rec.createdAt, { addSuffix: true })}
                  </span>
                </div>

                <p className="font-medium text-ink">{rec.title}</p>
                <p className="text-sm text-teal">{rec.authors[0] ?? "Unknown author"}</p>

                {rec.message && (
                  <p className="mt-2 rounded-2xl bg-lavender/40 px-3 py-2 text-sm italic text-ink">
                    “{rec.message}”
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="calm" size="sm" onClick={() => add(rec._id, "owned", rec.title)}>
                    I own it
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => add(rec._id, "wishlist", rec.title)}
                  >
                    Add to wishlist
                  </Button>
                </div>
              </div>

              <button
                onClick={() => remove(rec._id)}
                aria-label={`Dismiss recommendation of ${rec.title}`}
                className="absolute right-3 top-3 rounded-full p-1.5 text-teal/60 transition-colors hover:bg-lavender hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}
