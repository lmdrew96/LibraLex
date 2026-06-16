"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { Check, ChevronRight, Copy, Link2, UserPlus, Users, X } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { AppShell } from "@/components/app-shell"
import { EmptyState } from "@/components/empty-state"
import { FriendAvatar } from "@/components/friend-avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export default function FriendsPage() {
  const profile = useQuery(api.users.getMyProfile)
  const friends = useQuery(api.friends.getFriends)
  const incoming = useQuery(api.friends.getIncomingRequests)

  const respond = useMutation(api.friends.respondToRequest)
  const remove = useMutation(api.friends.removeFriend)
  const sendRequest = useMutation(api.friends.sendRequestByCode)

  const [code, setCode] = useState("")
  const [adding, setAdding] = useState(false)

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied.`)
    } catch {
      toast.error("Couldn't copy — copy it manually.")
    }
  }

  const shareLink = (friendCode: string): string =>
    typeof window !== "undefined"
      ? `${window.location.origin}/add/${encodeURIComponent(friendCode)}`
      : ""

  const submitCode = async () => {
    const value = code.trim()
    if (!value || adding) return
    setAdding(true)
    try {
      const { result } = await sendRequest({ code: value })
      toast.success(
        result === "accepted"
          ? "You're now friends!"
          : "Friend request sent.",
      )
      setCode("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send request.")
    } finally {
      setAdding(false)
    }
  }

  const accept = async (friendshipId: Id<"friendships">) => {
    try {
      await respond({ friendshipId, accept: true })
      toast.success("Friend added.")
    } catch {
      toast.error("Couldn't accept — they may have cancelled.")
    }
  }

  const decline = async (friendshipId: Id<"friendships">) => {
    try {
      await respond({ friendshipId, accept: false })
    } catch {
      toast.error("Couldn't decline.")
    }
  }

  const unfriend = async (friendshipId: Id<"friendships">, name: string) => {
    if (!confirm(`Remove ${name} from your friends?`)) return
    try {
      await remove({ friendshipId })
      toast.success(`Removed ${name}.`)
    } catch {
      toast.error("Couldn't remove friend.")
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Friends</h1>
        <p className="mt-1 text-teal">
          Swap shelves and pass books back and forth.
        </p>
      </div>

      {/* Your friend code */}
      <section className="mb-6 rounded-[24px] border border-lavender bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-teal">Your friend code</h2>
        <p className="mb-3 text-sm text-teal/70">
          Share this so a friend can add you. They paste the code, or open your link.
        </p>
        {profile === undefined ? (
          <Skeleton className="h-12 w-48 rounded-full" />
        ) : profile === null ? (
          <p className="text-sm text-teal">Setting up your profile…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-full bg-lavender/50 px-5 py-2.5 font-mono text-lg font-semibold tracking-wider text-ink">
              {profile.friendCode}
            </code>
            <Button variant="outline" size="sm" onClick={() => copy(profile.friendCode, "Code")}>
              <Copy className="h-4 w-4" />
              Copy code
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(shareLink(profile.friendCode), "Share link")}
            >
              <Link2 className="h-4 w-4" />
              Copy link
            </Button>
          </div>
        )}
      </section>

      {/* Add by code */}
      <section className="mb-6 rounded-[24px] border border-lavender bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-teal">Add a friend by code</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitCode()
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SHELF-XXXX"
            autoCapitalize="characters"
            className="h-11 min-w-0 flex-1 rounded-full border border-lavender bg-surface px-4 font-mono uppercase tracking-wider text-ink placeholder:text-teal/50 placeholder:tracking-normal focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20"
          />
          <Button type="submit" disabled={!code.trim() || adding}>
            <UserPlus className="h-4 w-4" />
            Send request
          </Button>
        </form>
      </section>

      {/* Incoming requests */}
      {incoming && incoming.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-teal">
            Requests · {incoming.length}
          </h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((req) => (
              <li
                key={req.friendshipId}
                className="flex items-center gap-3 rounded-2xl border border-lavender bg-card p-3"
              >
                <FriendAvatar name={req.displayName} avatarUrl={req.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{req.displayName}</p>
                  <p className="text-xs text-teal">wants to be friends</p>
                </div>
                <Button variant="calm" size="sm" onClick={() => accept(req.friendshipId)}>
                  <Check className="h-4 w-4" />
                  Accept
                </Button>
                <button
                  onClick={() => decline(req.friendshipId)}
                  aria-label={`Decline ${req.displayName}`}
                  className="rounded-full p-2 text-teal transition-colors hover:bg-lavender focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Friends list */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-teal">
          Your friends{friends && friends.length > 0 ? ` · ${friends.length}` : ""}
        </h2>
        {friends === undefined ? (
          <ul className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl border border-lavender bg-card p-3">
                <Skeleton className="h-11 w-11 rounded-full" />
                <Skeleton className="h-5 w-1/3 rounded" />
              </li>
            ))}
          </ul>
        ) : friends.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No friends yet"
            message="Share your friend code above, or add someone by theirs. Once you're connected you'll see each other's shelves and can trade recommendations."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((friend) => (
              <li
                key={friend.friendshipId}
                className="flex items-center gap-3 rounded-2xl border border-lavender bg-card p-3 transition-colors hover:bg-lavender/30"
              >
                <Link
                  href={`/friends/${encodeURIComponent(friend.userId)}`}
                  className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none"
                >
                  <FriendAvatar name={friend.displayName} avatarUrl={friend.avatarUrl} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">
                      {friend.displayName}
                    </span>
                    <span className="text-xs text-teal">View shelf</span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-teal/60" />
                </Link>
                <button
                  onClick={() => unfriend(friend.friendshipId, friend.displayName)}
                  aria-label={`Remove ${friend.displayName}`}
                  className="rounded-full p-2 text-teal/70 transition-colors hover:bg-lavender hover:text-[var(--color-overdue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}
