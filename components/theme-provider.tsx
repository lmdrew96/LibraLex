"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export type Theme = "system" | "light" | "dark"
type Resolved = "light" | "dark"

// Mirrors the key the anti-FOUC script in app/layout.tsx reads pre-paint. Keep
// the two in sync — the script can't import this constant (it runs as raw text).
const STORAGE_KEY = "libralex-theme"

type ThemeContextValue = {
  theme: Theme // the user's choice, including "system"
  resolvedTheme: Resolved // what's actually applied right now
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches

const resolve = (theme: Theme): Resolved =>
  theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme

const applyClass = (resolved: Resolved): void => {
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

const readStored = (): Theme => {
  if (typeof window === "undefined") return "system"
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === "light" || v === "dark" || v === "system" ? v : "system"
}

/** Owns the theme choice and keeps the .dark class on <html> in sync. The inline
 *  script in the layout has already set the class before first paint; this just
 *  hydrates the choice into React state so the toggles reflect (and can change)
 *  it. Server and first client render both start at "system" to avoid a
 *  hydration mismatch, then the mount effect reconciles to the stored value. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = useState<Resolved>("light")

  // Hydrate from storage on mount (localStorage is client-only).
  useEffect(() => {
    const stored = readStored()
    setThemeState(stored)
    setResolvedTheme(resolve(stored))
  }, [])

  // Re-resolve + apply whenever the choice changes.
  useEffect(() => {
    const r = resolve(theme)
    setResolvedTheme(r)
    applyClass(r)
  }, [theme])

  // While following the system, track OS theme changes live.
  useEffect(() => {
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const r: Resolved = mq.matches ? "dark" : "light"
      setResolvedTheme(r)
      applyClass(r)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode / blocked storage — the choice still applies for this session.
    }
    setThemeState(next)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
