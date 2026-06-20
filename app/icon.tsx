import { ImageResponse } from "next/og"
import { bookMark } from "@/lib/brand-mark"

// Favicon — served at the stable /icon route; Next auto-injects the <link rel="icon">.
export const size = { width: 32, height: 32 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(bookMark(size.width), { ...size })
}
