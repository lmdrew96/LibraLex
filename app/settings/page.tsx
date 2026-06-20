"use client"

import { useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { Bot, Copy, History, Loader2, Palette, RefreshCw, ShieldAlert, Tags, Trash2 } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { GENRES } from "@/lib/genres"
import { cn } from "@/lib/utils"
import { AppShell } from "@/components/app-shell"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsPage() {
  const token = useQuery(api.mcpAuth.getMyMcpToken)
  const generate = useAction(api.mcpAuth.generateMcpToken)
  const revoke = useMutation(api.mcpAuth.revokeMcpToken)
  const undateReadBooks = useMutation(api.books.undateReadBooks)
  const profile = useQuery(api.users.getMyProfile)
  const setFavoriteGenres = useMutation(api.users.setFavoriteGenres)
  const { confirm, confirmDialog } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [undating, setUndating] = useState(false)
  // Optimistic genre selection so chips toggle instantly; falls back to the live
  // profile value until the first edit, and reverts on a failed save.
  const [genreDraft, setGenreDraft] = useState<string[] | null>(null)
  const selectedGenres = genreDraft ?? profile?.favoriteGenres ?? []

  const toggleGenre = async (id: string) => {
    const next = selectedGenres.includes(id)
      ? selectedGenres.filter((g) => g !== id)
      : [...selectedGenres, id]
    const prev = selectedGenres
    setGenreDraft(next)
    try {
      await setFavoriteGenres({ genres: next })
    } catch {
      setGenreDraft(prev)
      toast.error("Couldn't save your genres.")
    }
  }

  // Build the link from the app's own origin (libra.adhdesigns.dev in prod). A
  // Next rewrite proxies /mcp/* to the Convex HTTP-actions endpoint, so the URL we
  // hand to Claude stays on-brand instead of exposing the raw …convex.site host.
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const mcpUrl = token ? `${origin}/mcp/${token}` : ""

  const onGenerate = async () => {
    setBusy(true)
    try {
      await generate({})
      toast.success(token ? "Generated a fresh MCP link." : "Your MCP link is ready.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't generate a link.")
    } finally {
      setBusy(false)
    }
  }

  const onRevoke = async () => {
    if (
      !(await confirm({
        title: "Revoke your MCP link?",
        message: "Any Claude connected with it loses access until you generate a new one.",
        confirmLabel: "Revoke",
        destructive: true,
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      await revoke({})
      toast.success("MCP link revoked.")
    } catch {
      toast.error("Couldn't revoke the link.")
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl)
      toast.success("MCP URL copied.")
    } catch {
      toast.error("Couldn't copy — select the URL and copy it manually.")
    }
  }

  const onUndate = async () => {
    if (
      !(await confirm({
        title: "Clear all finish dates?",
        message:
          "This clears the finish date on every book marked read. Your all-time count stays the same; your “read this year” stats drop to only the books you re-date afterward. This can't be undone in bulk.",
        confirmLabel: "Clear dates",
        destructive: true,
      }))
    ) {
      return
    }
    setUndating(true)
    try {
      const { cleared } = await undateReadBooks({})
      toast.success(
        cleared === 0
          ? "No dated reads to clear."
          : `Cleared finish dates on ${cleared} book${cleared === 1 ? "" : "s"}.`,
      )
    } catch {
      toast.error("Couldn't clear finish dates.")
    } finally {
      setUndating(false)
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="mt-1 text-teal">Personalize your shelf and connect it to Claude.</p>
      </div>

      <section className="mb-5 rounded-[24px] border border-lavender bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Palette className="h-5 w-5 text-teal" />
          <h2 className="text-sm font-semibold text-teal">Appearance</h2>
        </div>
        <p className="mb-4 max-w-prose text-sm text-teal/90">
          Choose a theme. “System” follows your device’s light or dark setting automatically.
        </p>
        <ThemeToggle />
      </section>

      <section className="mb-5 rounded-[24px] border border-lavender bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Tags className="h-5 w-5 text-teal" />
          <h2 className="text-sm font-semibold text-teal">Favorite genres</h2>
        </div>
        <p className="mb-4 max-w-prose text-sm text-teal/90">
          Pick the genres you read most. The Search page shows popular books in each
          one — and skips ones you don’t choose. Leave them all off to see a default
          mix.
        </p>
        {profile === undefined ? (
          <div className="flex flex-wrap gap-2">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-24 rounded-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {GENRES.map((g) => {
              const on = selectedGenres.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGenre(g.id)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40",
                    on
                      ? "border-teal bg-teal text-surface"
                      : "border-lavender bg-card text-ink/80 hover:bg-lavender/50",
                  )}
                >
                  {g.label}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-lavender bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Bot className="h-5 w-5 text-teal" />
          <h2 className="text-sm font-semibold text-teal">Connect to Claude (MCP)</h2>
        </div>
        <p className="mb-4 max-w-prose text-sm text-teal/90">
          Generate a private link that lets Claude read <em>and update</em> your shelf — ask “what
          am I reading?”, “what should I read next?”, “how’s my reading year going?”, or tell it “I
          finished Dune, 5 stars”, “add The Hobbit to my shelf”, “recommend it to Maya” right in
          chat. Add the URL as a custom MCP connector in Claude.
        </p>

        {token === undefined ? (
          <Skeleton className="h-11 w-44 rounded-full" />
        ) : token === null ? (
          <Button onClick={onGenerate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            Generate MCP link
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-xl bg-lavender/40 px-3 py-2 text-xs text-teal">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Treat this URL like a password — anyone with it can read and change your shelf.
                Revoke and regenerate if it ever leaks.
              </span>
            </div>
            <code className="block overflow-x-auto whitespace-nowrap rounded-xl border border-lavender bg-surface px-3 py-2.5 font-mono text-xs text-ink">
              {mcpUrl}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={copy}>
                <Copy className="h-4 w-4" />
                Copy URL
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={onGenerate}>
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={onRevoke}>
                <Trash2 className="h-4 w-4" />
                Revoke
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="mb-5 rounded-[24px] border border-lavender bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <History className="h-5 w-5 text-teal" />
          <h2 className="text-sm font-semibold text-teal">Reading history</h2>
        </div>
        <p className="mb-4 max-w-prose text-sm text-teal/90">
          Marking a book read stamps today’s date, which feeds your “read this year” stats. If you
          added a back-catalog of older books all at once, that inflates this year — clear the
          finish dates here, then re-date just the ones you actually finished this year from their
          detail page. Undated reads still count in your all-time total.
        </p>
        <Button variant="outline" size="sm" disabled={undating} onClick={onUndate}>
          {undating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <History className="h-4 w-4" />
          )}
          Clear finish dates on read books
        </Button>
      </section>
      {confirmDialog}
    </AppShell>
  )
}
