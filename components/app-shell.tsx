"use client"

import { type ReactNode, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { UserButton, useUser } from "@clerk/nextjs"
import { BookMarked, BookOpen, Heart, Library, Search, Settings, Sparkles, Users } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { loanStatus } from "@/lib/loans"
import { cn } from "@/lib/utils"
import { AddBookDialog } from "@/components/add-book-dialog"

const NAV = [
  { href: "/", label: "Shelf", icon: BookMarked },
  { href: "/search", label: "Search", icon: Search },
  { href: "/history", label: "History", icon: BookOpen },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
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
          <Link href="/" className="text-2xl font-semibold text-ink">
            LibraLex
          </Link>
          <div className="flex items-center gap-3">
            <AddBookDialog />
            <Link
              href="/settings"
              aria-label="Settings"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-teal text-surface"
                  : "text-ink/70 hover:bg-lavender/60",
              )}
            >
              <Settings className="h-5 w-5" />
            </Link>
            <UserButton />
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
            const badge = badgeFor(href)
            // Loans uses the overdue accent (an alert); social badges use gold (a nudge).
            const alertBadge = href === "/loans"
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
                {badge > 0 && (
                  <span
                    className={cn(
                      "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                      active
                        ? "bg-surface text-teal"
                        : alertBadge
                          ? "bg-[var(--color-overdue)] text-surface"
                          : "bg-gold text-ink",
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
