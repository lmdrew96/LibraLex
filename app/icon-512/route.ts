import { ImageResponse } from "next/og"
import { bookMark } from "@/lib/brand-mark"

// Stable 512×512 PNG for the PWA manifest (also used as the maskable icon — the
// mark sits well within the safe zone).
export function GET() {
  return new ImageResponse(bookMark(512), { width: 512, height: 512 })
}
