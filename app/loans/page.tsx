"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Library, RotateCcw, CalendarClock } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookWithCover } from "@/lib/types"
import { defaultDueDate, dueLabel, fromDateInput, loanStatus, toDateInput } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { AppShell } from "@/components/app-shell"
import { AddBookDialog } from "@/components/add-book-dialog"
import { BookCover } from "@/components/book-cover"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

// Calm, non-alarmist badge styling per status.
const badgeStyle: Record<string, string> = {
  comfortable: "bg-mint/40 text-teal",
  soon: "bg-[var(--color-due-soon)]/20 text-[var(--color-due-soon)]",
  overdue: "bg-[var(--color-overdue)]/15 text-[var(--color-overdue)]",
}

export default function LoansPage() {
  const loans = useQuery(api.books.listLoans)

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-semibold">Library loans</h1>
        <p className="mt-1 text-teal">What&apos;s borrowed and when it&apos;s due back.</p>
      </div>

      {loans === undefined ? (
        <ul className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <li key={i} className="flex gap-4 rounded-[24px] border border-lavender bg-card p-4">
              <Skeleton className="h-24 w-16 shrink-0" />
              <div className="flex-1 space-y-3 pt-1">
                <Skeleton className="h-5 w-2/3 rounded" />
                <Skeleton className="h-6 w-32 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : loans.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No active loans"
          message="Borrowed something from the library? Add it as a library book and LibraLex will track the due date for you."
          action={<AddBookDialog />}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <li key={loan._id}>
              <LoanRow loan={loan} />
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  )
}

function LoanRow({ loan }: { loan: BookWithCover }) {
  const returnBook = useMutation(api.books.returnBook)
  const renewLoan = useMutation(api.books.renewLoan)

  const [renewing, setRenewing] = useState(false)
  const [renewInput, setRenewInput] = useState(toDateInput(defaultDueDate()))

  const status = loan.dueDate !== undefined ? loanStatus(loan.dueDate) : "comfortable"

  const doReturn = async () => {
    try {
      await returnBook({ id: loan._id })
      toast.success(`Returned “${loan.title}”.`)
    } catch {
      toast.error("Couldn't mark it returned. Try again.")
    }
  }

  const doRenew = async () => {
    try {
      await renewLoan({ id: loan._id, newDueDate: fromDateInput(renewInput) })
      toast.success(`Renewed “${loan.title}”.`)
      setRenewing(false)
    } catch {
      toast.error("Couldn't renew it. Try again.")
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[24px] border border-lavender bg-card p-4 sm:flex-row">
      <Link href={`/book/${loan._id}`} className="w-16 shrink-0">
        <BookCover coverUrl={loan.coverUrl} coverId={loan.coverId} coverUrlFallback={loan.coverUrlFallback} title={loan.title} size="M" />
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/book/${loan._id}`} className="font-medium text-ink hover:underline">
          {loan.title}
        </Link>
        <p className="text-sm text-teal">{loan.authors[0] ?? "Unknown author"}</p>
        {loan.libraryName && <p className="mt-0.5 text-xs text-teal">{loan.libraryName}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {loan.dueDate !== undefined && (
            <span className={cn("rounded-full px-3 py-1 text-sm font-medium", badgeStyle[status])}>
              {dueLabel(loan.dueDate)}
            </span>
          )}
          {loan.dueDate !== undefined && (
            <span className="text-xs text-teal/90">due {format(loan.dueDate, "MMM d, yyyy")}</span>
          )}
        </div>

        {renewing && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-lavender bg-surface p-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-teal">
              New due date
              <input
                type="date"
                value={renewInput}
                onChange={(e) => setRenewInput(e.target.value)}
                className="h-10 rounded-xl border border-lavender bg-card px-3 text-ink focus:border-teal focus:outline-none"
              />
            </label>
            <Button size="sm" onClick={doRenew}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRenewing(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {!renewing && (
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <Button size="sm" variant="secondary" className="flex-1" onClick={doReturn}>
            <RotateCcw className="h-4 w-4" />
            Return
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => {
              setRenewInput(toDateInput(defaultDueDate()))
              setRenewing(true)
            }}
          >
            <CalendarClock className="h-4 w-4" />
            Renew
          </Button>
        </div>
      )}
    </div>
  )
}
