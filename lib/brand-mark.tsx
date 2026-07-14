// Shared LibraLex book-mark, drawn with inline styles so it renders inside
// `next/og` ImageResponse (Satori) for every generated raster: the favicon
// (app/icon.tsx), the iOS icon (app/apple-icon.tsx), and the PWA manifest
// icons (app/icon-192 / app/icon-512 route handlers). Colors mirror the brand
// trio in app/globals.css (Twilight Wisteria / Wisteria Bloom / Sage Leaf).
//
// Satori constraint: any element with more than one child MUST set display:flex.

/** A standing book — wisteria spine, sage "text" lines — centered on the
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
        background: "linear-gradient(145deg, #41386b 0%, #464e3e 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          width: s * 0.46,
          height: s * 0.6,
          background: "#ebeed5",
          borderRadius: s * 0.05,
          boxShadow: `0 ${s * 0.02}px ${s * 0.05}px rgba(0,0,0,0.35)`,
          overflow: "hidden",
        }}
      >
        {/* spine */}
        <div style={{ width: s * 0.1, height: "100%", background: "#7a70ba" }} />
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
          <div style={{ width: s * 0.2, height: s * 0.025, background: "#b0c49c", borderRadius: s * 0.02 }} />
          <div style={{ width: s * 0.15, height: s * 0.025, background: "#b0c49c", borderRadius: s * 0.02 }} />
        </div>
      </div>
    </div>
  )
}
