"use client"

import { useEffect, useRef, useState, type RefObject } from "react"

/** One-shot in-view detector. Returns [ref, inView]; once the element comes within
 *  `rootMargin` of the viewport it latches `true` and disconnects. Used to defer
 *  below-the-fold work (e.g. the slow catalog discovery fetch) until it's actually
 *  approached, so it never competes with a page's initial load. */
export function useInView<T extends Element = HTMLDivElement>(
  rootMargin = "300px",
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    // SSR/old browsers without IO: just enable.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          obs.disconnect()
        }
      },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView, rootMargin])

  return [ref, inView]
}
