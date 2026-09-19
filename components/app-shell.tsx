"use client"

import { type ReactNode, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { UserButton, useUser } from "@clerk/nextjs"
import { BookMarked, Library, Search, Settings, Sparkles, Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { loanStatus } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { AddBookDialog } from "@/components/add-book-dialog"
import { ThemeQuickToggle } from "@/components/theme-toggle"

// Five tabs so the rail fits a 375px phone without scrolling. Wishlist and
// History are views inside Shelf (/?view=…), not tabs of their own.
const NAV = [
  { href: "/", label: "Shelf", icon: BookMarked },
  { href: "/search", label: "Search", icon: Search },
  { href: "/loans", label: "Loans", icon: Library },
  { href: "/friends", label: "Friends", icon: Users },
  { href: "/recs", label: "Recs", icon: Sparkles },
] as const

// Keeps the caller's profile (and friend code) minted + in sync with Clerk on
// every authenticated load. Invisible — this is the universal authed wrapper, so
// it's the natural place to guarantee a profile exists before any social view.
function useProfileSync() {
  const { user, isLoaded } = useUser()
  const ensureProfile = useMutation(api.users.ensureProfile)

  const displayName =
    user?.fullName || user?.firstName || user?.username || "Reader"
  const avatarUrl = user?.imageUrl

  useEffect(() => {
    if (!isLoaded || !user) return
    // Capture the browser's IANA zone so server-side surfaces (the MCP loan
    // countdown) can do date-math on the user's local day boundaries, not UTC.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    void ensureProfile({ displayName, avatarUrl, timeZone })
  }, [isLoaded, user, displayName, avatarUrl, ensureProfile])
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  useProfileSync()

  const loans = useQuery(api.books.listLoans)
  const incoming = useQuery(api.friends.getIncomingRequests)
  const unreadRecs = useQuery(api.recs.unreadCount)

  // Loans badge = loans needing attention (due within 5 days or overdue).
  const dueSoon = (loans ?? []).filter(
    (b) => b.dueDate !== undefined && loanStatus(b.dueDate) !== "comfortable",
  ).length

  // Spoken with the badge count, e.g. "Loans, 2 due soon".
  const badgeNoun = (href: string, n: number): string =>
    href === "/loans"
      ? "due soon"
      : href === "/friends"
        ? `friend request${n === 1 ? "" : "s"}`
        : `new recommendation${n === 1 ? "" : "s"}`

  const badgeFor = (href: string): number => {
    if (href === "/loans") return dueSoon
    if (href === "/friends") return incoming?.length ?? 0
    if (href === "/recs") return unreadRecs ?? 0
    return 0
  }

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-30 border-b border-lavender bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl font-semibold text-ink">
            LibraLex
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <AddBookDialog compact />
            <ThemeQuickToggle />
            <Link
              href="/settings"
              aria-label="Settings"
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-teal text-surface"
                  : "text-ink/85 hover:bg-lavender/60",
              )}
            >
              <Settings className="h-5 w-5" />
            </Link>
            <UserButton />
          </div>
        </div>
        {/* overflow-x-auto is only a safety net — five tabs fit a 375px phone. */}
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
            const badge = badgeFor(href)
            // Loans uses the overdue accent (an alert); social badges are a neutral ink nudge.
            const alertBadge = href === "/loans"
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={badge > 0 ? `${label}, ${badge} ${badgeNoun(href, badge)}` : label}
                className={cn(
                  "relative flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium transition-colors sm:px-4",
                  active ? "bg-teal text-surface" : "text-ink/85 hover:bg-lavender/60",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {/* On phones the rail collapses to icons to de-crowd; the active
                    tab keeps its label as the "you are here" anchor, and every tab
                    shows its label again at sm+. aria-label covers screen readers. */}
                <span className={cn(!active && "hidden sm:inline")}>{label}</span>
                {badge > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                      active
                        ? "bg-surface text-teal"
                        : alertBadge
                          ? "bg-[var(--color-overdue)] text-surface"
                          : "bg-ink text-surface",
                    )}
                  >
                    {badge}
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
