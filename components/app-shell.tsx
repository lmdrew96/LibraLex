"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { UserButton } from "@clerk/nextjs"
import { BookMarked, BookOpen, Heart, Library } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { loanStatus } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { AddBookDialog } from "@/components/add-book-dialog"

const NAV = [
  { href: "/", label: "Shelf", icon: BookMarked },
  { href: "/reading", label: "Reading", icon: BookOpen },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/loans", label: "Loans", icon: Library },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const loans = useQuery(api.books.listLoans)
  // Badge = loans needing attention (due within 5 days or overdue).
  const dueSoon = (loans ?? []).filter(
    (b) => b.dueDate !== undefined && loanStatus(b.dueDate) !== "comfortable",
  ).length

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-30 border-b border-lavender bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-2xl font-semibold text-ink">
            LibraLex
          </Link>
          <div className="flex items-center gap-3">
            <AddBookDialog />
            <UserButton />
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  active ? "bg-teal text-surface" : "text-ink/70 hover:bg-lavender/60",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {href === "/loans" && dueSoon > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                      active ? "bg-surface text-teal" : "bg-[var(--color-overdue)] text-surface",
                    )}
                  >
                    {dueSoon}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
