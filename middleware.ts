import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

// Everything is private except the auth pages. Unauthenticated visitors are sent
// to /login explicitly — we mount Clerk's <SignIn> there (not Clerk's default
// /sign-in), so we redirect by hand rather than relying on auth.protect()'s
// default sign-in resolution (which 404s when no signInUrl is configured).
const isPublicRoute = createRouteMatcher(["/login(.*)", "/signup(.*)"])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
