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
    // Proxy /mcp/* to the Convex HTTP-actions endpoint so the link users hand to
    // Claude rides our own origin (https://libra.adhdesigns.dev/mcp/<token>) instead
    // of the raw deployment host. Next forwards the POST (method + body) through.
    //
    // Derive the …convex.site host from the canonical cloud URL rather than a
    // separately-set SITE_URL env: a cloud deployment's HTTP-actions host is just
    // its .convex.cloud host with .convex.site, and NEXT_PUBLIC_CONVEX_URL is always
    // correct (the client can't connect otherwise). This avoids the prod failure
    // where a stale NEXT_PUBLIC_CONVEX_SITE_URL pointed at localhost and Vercel
    // refused to proxy to a private address (DNS_HOSTNAME_RESOLVED_PRIVATE). Local
    // dev (127.0.0.1:3210 → :3211, a port swap not a domain swap) keeps the explicit
    // SITE_URL fallback.
    const cloud = process.env.NEXT_PUBLIC_CONVEX_URL
    const convexSite =
      cloud && cloud.includes(".convex.cloud")
        ? cloud.replace(".convex.cloud", ".convex.site")
        : process.env.NEXT_PUBLIC_CONVEX_SITE_URL
    if (!convexSite) return []
    return [{ source: "/mcp/:path*", destination: `${convexSite}/mcp/:path*` }]
  },
}

export default nextConfig
