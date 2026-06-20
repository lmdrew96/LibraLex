// Shared LibraLex book-mark, drawn with inline styles so it renders inside
// `next/og` ImageResponse (Satori) for every generated raster: the favicon
// (app/icon.tsx), the iOS icon (app/apple-icon.tsx), and the PWA manifest
// icons (app/icon-192 / app/icon-512 route handlers). Colors mirror the brand
// trio in app/globals.css (Twilight Indigo / Warm Cerulean / Meadow Rush).
//
// Satori constraint: any element with more than one child MUST set display:flex.

/** A standing book — cerulean spine, meadow "text" lines — centered on the
 *  twilight gradient, sized to an `s`×`s` square. */
export function bookMark(s: number): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        width: s,
        height: s,
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #455079 0%, #2a5c68 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          width: s * 0.46,
          height: s * 0.6,
          background: "#edf3f1",
          borderRadius: s * 0.05,
          boxShadow: `0 ${s * 0.02}px ${s * 0.05}px rgba(0,0,0,0.35)`,
          overflow: "hidden",
        }}
      >
        {/* spine */}
        <div style={{ width: s * 0.1, height: "100%", background: "#5598a2" }} />
        {/* page lines */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            left: s * 0.17,
            top: s * 0.16,
            gap: s * 0.06,
          }}
        >
          <div style={{ width: s * 0.2, height: s * 0.025, background: "#a3caa2", borderRadius: s * 0.02 }} />
          <div style={{ width: s * 0.15, height: s * 0.025, background: "#a3caa2", borderRadius: s * 0.02 }} />
        </div>
      </div>
    </div>
  )
}
