import { ImageResponse } from "next/og"
import { bookMark } from "@/lib/brand-mark"

// Stable 192×192 PNG for the PWA manifest (the file conventions can't expose a
// fixed URL the manifest can reference, so this route handler does).
export function GET() {
  return new ImageResponse(bookMark(192), { width: 192, height: 192 })
}
