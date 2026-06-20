"use client"

import { useEffect } from "react"

// Last-resort boundary for errors thrown by the ROOT layout itself. It replaces
// everything (including <html>/<body>), so globals.css and the theme tokens
// aren't available here — styles are inlined with brand hex values. The common
// case (a page throwing) is handled by app/error.tsx with the full themed shell.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#edf3f1",
          color: "#455079",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.5rem", fontWeight: 600 }}>
            Something broke
          </h1>
          <p style={{ color: "#2a5c68", lineHeight: 1.5, margin: "0 0 1.5rem" }}>
            LibraLex hit an unexpected error. Try reloading — your shelf is safe.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#455079",
              color: "#edf3f1",
              border: "none",
              borderRadius: 9999,
              padding: "0.7rem 1.6rem",
              fontSize: "1rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
