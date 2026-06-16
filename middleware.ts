import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

// Everything is private except the auth pages and the MCP proxy. Unauthenticated
// visitors are sent to /login explicitly — we mount Clerk's <SignIn> there (not
// Clerk's default /sign-in), so we redirect by hand rather than relying on
// auth.protect()'s default sign-in resolution (which 404s when no signInUrl is
// configured). `/mcp/*` is public because it's rewritten to the Convex MCP door,
// which does its own per-token auth; the caller (Claude) has no Clerk session, so
// Clerk-gating it would bounce every request to /login.
const isPublicRoute = createRouteMatcher(["/login(.*)", "/signup(.*)", "/mcp(.*)"])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId } = await auth()
    if (!userId) {
      // Preserve the intended destination (e.g. an /add/<code> share link) so
      // Clerk's <SignIn> returns the visitor there after auth. redirect_url takes
      // precedence over the fallback redirect set on <ClerkProvider>.
      const loginUrl = new URL("/login", req.url)
      const dest = req.nextUrl.pathname + req.nextUrl.search
      if (dest && dest !== "/") loginUrl.searchParams.set("redirect_url", dest)
      return NextResponse.redirect(loginUrl)
    }
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
