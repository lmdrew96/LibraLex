"use client"

import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { Check, X } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"

type Step = {
  key: "addedBook" | "setStatus" | "addedFriend" | "pickedGenres" | "connectedClaude"
  label: string
  hint: string
  href?: string
}

// Ordered by what unlocks the most: books → taste signal → social → tuning → extras.
const STEPS: Step[] = [
  { key: "addedBook", label: "Add your first book", hint: "Search pulls in the cover and details.", href: "/search" },
  {
    key: "setStatus",
    label: "Mark a book Reading or Read",
    hint: "Open any book and set its status. It's what your recommendations learn from.",
  },
  {
    key: "addedFriend",
    label: "Add a friend",
    hint: "Swap friend codes to see each other's shelves and send recs.",
    href: "/friends",
  },
  {
    key: "pickedGenres",
    label: "Pick your favorite genres",
    hint: "Shapes the browse rows on Search.",
    href: "/settings#genres",
  },
  {
    key: "connectedClaude",
    label: "Connect Claude (optional)",
    hint: "Ask Claude about your shelf, loans, and recs.",
    href: "/settings#mcp",
  },
]

/** A short "Getting started" checklist at the top of the Shelf. Steps tick off
 *  from real data (users.onboardingStatus); the card disappears once every step
 *  is done or the user closes it. One quiet card, never a modal or a tour. */
export function GettingStarted() {
  const status = useQuery(api.users.onboardingStatus)
  const dismiss = useMutation(api.users.dismissOnboarding)

  if (!status) return null
  const doneCount = STEPS.filter((s) => status[s.key]).length
  if (doneCount === STEPS.length) return null

  const close = async () => {
    try {
      await dismiss()
    } catch {
      toast.error("Couldn't hide it. Try again.")
    }
  }

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="rounded-[24px] border border-lavender bg-card p-5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-heading" className="font-display text-lg font-semibold text-ink">
            Getting started
          </h2>
          <p className="text-sm text-teal">
            {doneCount} of {STEPS.length} done
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Hide getting started"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-teal transition-colors hover:bg-lavender focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ol className="flex flex-col gap-1">
        {STEPS.map((step) => {
          const done = status[step.key]
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  done ? "border-teal bg-teal text-surface" : "border-lavender",
                )}
              >
                {done && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className={cn("block font-medium", done ? "text-teal line-through" : "text-ink")}>
                  {step.label}
                  <span className="sr-only">{done ? " (done)" : ""}</span>
                </span>
                {!done && <span className="block text-sm text-teal">{step.hint}</span>}
              </span>
            </>
          )
          return (
            <li key={step.key}>
              {step.href && !done ? (
                <Link
                  href={step.href}
                  className="flex gap-3 rounded-2xl p-2 transition-colors hover:bg-lavender/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex gap-3 p-2">{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
