import { createRequire } from "module"

// Read the app version from package.json at build time and expose it to the
// client (NEXT_PUBLIC_*), so the UI can show it without bundling package.json.
const require = createRequire(import.meta.url)
const { version } = require("./package.json")

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  images: {
    // Open Library + Google Books cover hosts. <BookCover> uses a plain <img>
    // (covers are external, sized by CSS), but allow these if we ever switch to
    // next/image.
    remotePatterns: [
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
    ],
  },
  async rewrites() {
    // The MCP server is a Convex HTTP action, served from the …convex.site domain.
    // Proxy it under our own origin so the link users hand to Claude is
    // https://libra.adhdesigns.dev/mcp/<token>, not the raw deployment host. Next
    // forwards the POST (method + body) straight through. No-op if the Convex site
    // URL isn't configured.
    const convexSite = process.env.NEXT_PUBLIC_CONVEX_SITE_URL
    if (!convexSite) return []
    return [{ source: "/mcp/:path*", destination: `${convexSite}/mcp/:path*` }]
  },
}

export default nextConfig
