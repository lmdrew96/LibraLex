import type { MetadataRoute } from "next"

// Web app manifest — makes LibraLex installable. Next auto-injects the
// <link rel="manifest">. Colors mirror the brand trio in app/globals.css.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LibraLex",
    short_name: "LibraLex",
    description:
      "Your shelf, digitized — catalog what you own, want, and borrow from the library.",
    start_url: "/",
    display: "standalone",
    background_color: "#ebeed5", // surface (light)
    theme_color: "#41386b", // Twilight Wisteria
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
