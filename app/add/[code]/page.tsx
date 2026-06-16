"use client"

import { use, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { UserPlus } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { AppShell } from "@/components/app-shell"
import { FriendAvatar } from "@/components/friend-avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export default function AddByCodePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = use(params)
  const profile = useQuery(api.users.getProfileByCode, { code })
  const sendRequest = useMutation(api.friends.sendRequestByCode)
  const router = useRouter()
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (sending) return
    setSending(true)
    try {
      const { result } = await sendRequest({ code })
      toast.success(result === "accepted" ? "You're now friends!" : "Friend request sent.")
      router.push("/friends")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send request.")
      setSending(false)
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-md py-10">
        {profile === undefined ? (
          <div className="flex flex-col items-center gap-4 rounded-[24px] border border-lavender bg-card p-8 text-center">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-7 w-40 rounded" />
            <Skeleton className="h-11 w-44 rounded-full" />
          </div>
        ) : profile === null ? (
          <div className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-lavender bg-card/50 p-8 text-center">
            <h1 className="text-2xl font-semibold text-ink">That code didn&apos;t match</h1>
            <p className="max-w-sm text-teal">
              This friend code isn&apos;t valid, or it&apos;s your own. Double-check it
              and try adding from the Friends page.
            </p>
            <Button asChild variant="calm" size="sm" className="mt-1">
              <Link href="/friends">Go to Friends</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-[24px] border border-lavender bg-card p-8 text-center">
            <FriendAvatar
              name={profile.displayName}
              avatarUrl={profile.avatarUrl}
              size="lg"
            />
            <div>
              <h1 className="text-2xl font-semibold text-ink">{profile.displayName}</h1>
              <p className="mt-1 text-teal">wants to swap shelves with you</p>
            </div>
            <Button onClick={send} disabled={sending} className="mt-1">
              <UserPlus className="h-5 w-5" />
              Send friend request
            </Button>
            <Link href="/friends" className="text-sm text-teal underline-offset-4 hover:underline">
              Not now
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  )
}
