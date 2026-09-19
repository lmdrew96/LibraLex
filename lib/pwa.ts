"use client"

import { useSyncExternalStore } from "react"

// Chromium's install event isn't in the TS DOM lib yet.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallState =
  | "installed" // already running as an installed app
  | "available" // browser offered an install prompt we can trigger
  | "ios" // iOS Safari: no prompt API, install via Share → Add to Home Screen
  | "unsupported" // nothing we can do from here (e.g. Firefox desktop)

// Module-level store. The browser fires `beforeinstallprompt` once, early, on
// whatever page loads first — so it's captured globally (initPwa, mounted in the
// root layout) and read later by whichever screen offers the Install button.
let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

const isStandalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const isIos = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS reports itself as Mac; touch support gives it away.
  (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)

let initialized = false

/** Register the service worker and start listening for install events. Idempotent. */
export const initPwa = (): void => {
  if (initialized || typeof window === "undefined") return
  initialized = true

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault() // we show our own button instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener("appinstalled", () => {
    installed = true
    deferred = null
    emit()
  })

  // Dev is skipped so a stale worker never masks hot-reload changes.
  if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      // Non-fatal: the app works fine without it, it just loses the offline page.
      console.warn("[LibraLex] service worker registration failed", err)
    })
  }
}

const getState = (): InstallState => {
  if (installed || isStandalone()) return "installed"
  if (deferred) return "available"
  if (isIos()) return "ios"
  return "unsupported"
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Current install state plus a trigger for the native prompt (when available). */
export const useInstallPrompt = (): {
  state: InstallState | null
  install: () => Promise<void>
} => {
  // null on the server so the UI renders nothing until we know.
  const state = useSyncExternalStore(subscribe, getState, () => null)

  const install = async (): Promise<void> => {
    if (!deferred) return
    const prompt = deferred
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    // A prompt can only be used once either way.
    deferred = null
    if (outcome === "accepted") installed = true
    emit()
  }

  return { state, install }
}
