"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme, type Theme } from "@/components/theme-provider"

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
]

/** Full three-way appearance control for the Settings page. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-full border border-lavender bg-card p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            theme === value ? "bg-teal text-surface" : "text-ink/70 hover:bg-lavender/50",
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

/** Compact header toggle: flips between light and dark, showing the icon for the
 *  theme you'd switch TO. (Choosing here sets an explicit theme; the finer
 *  "System" option lives in Settings.) */
export function ThemeQuickToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
      className="flex h-9 w-9 items-center justify-center rounded-full text-ink/70 transition-colors hover:bg-lavender/60"
    >
      {resolvedTheme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  )
}
