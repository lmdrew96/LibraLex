"use client"

import { useEffect } from "react"
import { initPwa } from "@/lib/pwa"

// Mounted once in the root layout: registers the service worker and captures the
// browser's install event before any page needs it. Renders nothing.
export function PwaRegister(): null {
  useEffect(() => {
    initPwa()
  }, [])
  return null
}
