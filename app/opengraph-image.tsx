import { ImageResponse } from "next/og"
import { bookMark } from "@/lib/brand-mark"

// Social share card — Next auto-injects og:image + twitter:image. Wordmark +
// tagline on the twilight gradient; the book mark is wrapped in a rounded tile.
export const alt = "LibraLex — your shelf, digitized"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          justifyContent: "center",
          padding: 90,
          background: "linear-gradient(135deg, #455079 0%, #2a5c68 60%, #5598a2 100%)",
          color: "#edf3f1",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", borderRadius: 32, overflow: "hidden", marginBottom: 40 }}>
          {bookMark(132)}
        </div>
        <div style={{ display: "flex", fontSize: 118, fontWeight: 700, letterSpacing: -3 }}>
          LibraLex
        </div>
        <div style={{ display: "flex", fontSize: 46, color: "#a3caa2", marginTop: 6 }}>
          Your shelf, digitized
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#cfe0dd", marginTop: 28, maxWidth: 880 }}>
          Catalog what you own, want, and borrow from the library — with due-date tracking Goodreads doesn&apos;t do.
        </div>
      </div>
    ),
    { ...size },
  )
}
