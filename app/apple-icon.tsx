import { ImageResponse } from "next/og"
import { bookMark } from "@/lib/brand-mark"

// iOS home-screen icon — Next auto-injects <link rel="apple-touch-icon">. iOS
// masks the corners itself, so the mark fills the square (no border radius).
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(bookMark(size.width), { ...size })
}
