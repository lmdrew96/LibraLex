import type React from "react"
import type { Metadata, Viewport } from "next"
import { Fraunces, Space_Grotesk, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { Toaster } from "sonner"
import { ConvexClientProvider } from "@/components/providers/convex-client-provider"
import "./globals.css"

// Fraunces is a variable font — load it as variable (no pinned weight) with the
// SOFT + WONK axes included so the brand `font-variation-settings` takes effect.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
})

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600"],
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  title: "LibraLex",
  description: "Your shelf, digitized — catalog what you own, want, and borrow.",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/login"
    >
      <html lang="en">
        <body
          className={`${fraunces.variable} ${spaceGrotesk.variable} ${geistMono.variable} antialiased`}
        >
          <ConvexClientProvider>
            {children}
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
                  background: "var(--color-card)",
                  color: "var(--color-ink)",
                  border: "1px solid var(--color-lavender)",
                  fontFamily: "var(--font-body)",
                },
              }}
            />
          </ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
