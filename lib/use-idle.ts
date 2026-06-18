"use client"

import { useEffect, useState } from "react"

/** Flips true once the browser is idle after first paint (requestIdleCallback,
 *  with a setTimeout fallback + a timeout cap). For kicking off non-critical
 *  background work — e.g. the slow catalog fetch — only after the page has
 *  rendered and become interactive, so it never competes with the initial load. */
export function useIdle(timeout = 1500): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    type RIC = (cb: () => void, opts?: { timeout: number }) => number
    const w = window as unknown as {
      requestIdleCallback?: RIC
      cancelIdleCallback?: (id: number) => void
    }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setReady(true), 200)
    return () => clearTimeout(t)
  }, [timeout])

  return ready
}
