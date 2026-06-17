"use client"

import { type ReactNode, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { Check, Send, Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import { BookCover } from "@/components/book-cover"
import { FriendAvatar } from "@/components/friend-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// The bibliographic snapshot a rec carries. Accepts a stored Doc<"books"> or a
// SharedBook from a friend's shelf — both structurally satisfy this. coverUrl is
// for the dialog's own preview; coverStorageId rides along to the rec so the
// recipient sees your uploaded cover (present only when recommending your own book).
export type RecommendableBook = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  coverUrlFallback?: string
  coverUrl?: string
  coverStorageId?: Id<"_storage">
  workKey?: string
  firstPublishYear?: number
  pageCount?: number
}

export function RecommendDialog({
  book,
  trigger,
}: {
  book: RecommendableBook
  trigger: ReactNode
}) {
  const friends = useQuery(api.friends.getFriends)
  const sendRec = useMutation(api.recs.sendRec)

  const [open, setOpen] = useState(false)
  const [toUserId, setToUserId] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)

  const reset = () => {
    setToUserId(null)
    setMessage("")
    setSending(false)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) reset()
  }

  const send = async () => {
    if (!toUserId || sending) return
    setSending(true)
    const recipient = friends?.find((f) => f.userId === toUserId)
    handleOpenChange(false)
    try {
      await sendRec({
        toUserId,
        title: book.title,
        authors: book.authors,
        isbn: book.isbn,
        coverId: book.coverId,
        coverUrlFallback: book.coverUrlFallback,
        coverStorageId: book.coverStorageId,
        workKey: book.workKey,
        firstPublishYear: book.firstPublishYear,
        pageCount: book.pageCount,
        message: message.trim() || undefined,
      })
      toast.success(
        `Recommended “${book.title}”${recipient ? ` to ${recipient.displayName}` : ""}.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send that rec.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <div className="border-b border-lavender px-6 pb-4 pt-6">
          <DialogTitle>Recommend a book</DialogTitle>
          <DialogDescription className="mt-1">
            Send “{book.title}” to a friend with a note.
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Book being recommended */}
          <div className="mb-5 flex items-center gap-4">
            <div className="w-14 shrink-0">
              <BookCover
                coverUrl={book.coverUrl}
                coverId={book.coverId}
                coverUrlFallback={book.coverUrlFallback}
                title={book.title}
                size="S"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{book.title}</p>
              <p className="truncate text-sm text-teal">
                {book.authors[0] ?? "Unknown author"}
              </p>
            </div>
          </div>

          {friends === undefined ? (
            <p className="py-6 text-center text-sm text-teal">Loading friends…</p>
          ) : friends.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-lavender bg-card/50 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-lavender/60 text-teal">
                <Users className="h-6 w-6" />
              </div>
              <p className="text-sm text-teal">
                Add a friend first — then you can pass books their way.
              </p>
              <Button asChild variant="calm" size="sm">
                <Link href="/friends" onClick={() => handleOpenChange(false)}>
                  Go to Friends
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <h3 className="mb-2 text-sm font-semibold text-teal">To</h3>
              <ul className="flex flex-col gap-1.5">
                {friends.map((f) => {
                  const selected = toUserId === f.userId
                  return (
                    <li key={f.userId}>
                      <button
                        type="button"
                        onClick={() => setToUserId(f.userId)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors",
                          selected
                            ? "border-teal bg-teal/10"
                            : "border-lavender hover:bg-lavender/40",
                        )}
                      >
                        <FriendAvatar name={f.displayName} avatarUrl={f.avatarUrl} size="sm" />
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">
                          {f.displayName}
                        </span>
                        {selected && <Check className="h-5 w-5 shrink-0 text-teal" />}
                      </button>
                    </li>
                  )
                })}
              </ul>

              <h3 className="mb-2 mt-5 text-sm font-semibold text-teal">
                Note <span className="font-normal text-teal/60">(optional)</span>
              </h3>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Why they'll love it…"
                rows={3}
                maxLength={500}
                className="w-full rounded-2xl border border-lavender bg-card p-3 text-ink placeholder:text-teal/50 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20"
              />

              <Button
                className="mt-4 w-full"
                disabled={!toUserId || sending}
                onClick={send}
              >
                <Send className="h-4 w-4" />
                Send recommendation
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
