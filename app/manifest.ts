import type { MetadataRoute } from "next"

// Web app manifest — makes LibraLex installable. Next auto-injects the
// <link rel="manifest">. Colors mirror the surface token in app/globals.css.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LibraLex",
    short_name: "LibraLex",
    description:
      "Your shelf, digitized — catalog what you own, want, and borrow from the library.",
    start_url: "/",
    display: "standalone",
    background_color: "#ebeed5", // surface (light)
    // Matches layout.tsx's viewport themeColor (the page surface), so an installed
    // app's title bar is the same color as the page under it, not a dark band.
    theme_color: "#ebeed5",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
