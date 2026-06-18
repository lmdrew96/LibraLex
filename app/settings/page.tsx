"use client"

import { useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { Bot, Copy, Loader2, Palette, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { AppShell } from "@/components/app-shell"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export default function SettingsPage() {
  const token = useQuery(api.mcpAuth.getMyMcpToken)
  const generate = useAction(api.mcpAuth.generateMcpToken)
  const revoke = useMutation(api.mcpAuth.revokeMcpToken)
  const [busy, setBusy] = useState(false)

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
      !confirm(
        "Revoke your MCP link? Any Claude connected with it loses access until you generate a new one.",
      )
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

      <section className="rounded-[24px] border border-lavender bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Bot className="h-5 w-5 text-teal" />
          <h2 className="text-sm font-semibold text-teal">Connect to Claude (MCP)</h2>
        </div>
        <p className="mb-4 max-w-prose text-sm text-teal/90">
          Generate a private link that lets Claude read your shelf — ask “what am I reading?”,
          “what’s due soon?”, “have I read this?”, or “add Dune to my wishlist” right in chat. Add
          the URL as a custom MCP connector in Claude.
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
                Treat this URL like a password — anyone with it can read your shelf. Revoke and
                regenerate if it ever leaks.
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
    </AppShell>
  )
}
