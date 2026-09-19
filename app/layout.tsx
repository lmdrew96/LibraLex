import type React from "react"
import type { Metadata, Viewport } from "next"
import { Fraunces, Libre_Franklin, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"
import { Toaster } from "sonner"
import { ConvexClientProvider } from "@/components/providers/convex-client-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { PwaRegister } from "@/components/pwa-register"
import "./globals.css"

// Runs synchronously before first paint to set the .dark class from the saved
// choice (or the OS preference when unset/"system"), so there's no flash of the
// wrong theme on load. Mirrors the storage key + logic in components/theme-provider.tsx.
const themeInitScript = `
(function(){try{var t=localStorage.getItem('libralex-theme');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();
`

// Fraunces is a variable font — load it as variable (no pinned weight) with the
// SOFT + WONK axes included so the brand `font-variation-settings` takes effect.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["SOFT", "WONK", "opsz"],
})

const libreFranklin = Libre_Franklin({
  subsets: ["latin"],
  variable: "--font-libre-franklin",
  weight: ["400", "500", "600"],
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://libra.adhdesigns.dev"),
  title: {
    default: "LibraLex",
    template: "%s · LibraLex",
  },
  description: "Your shelf, digitized — catalog what you own, want, and borrow.",
  applicationName: "LibraLex",
  appleWebApp: { capable: true, title: "LibraLex", statusBarStyle: "default" },
  openGraph: {
    type: "website",
    siteName: "LibraLex",
    title: "LibraLex",
    description: "Your shelf, digitized — catalog what you own, want, and borrow from the library.",
  },
  twitter: {
    card: "summary_large_image",
    title: "LibraLex",
    description: "Your shelf, digitized — catalog what you own, want, and borrow from the library.",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mirrors the surface/background tokens in app/globals.css so the mobile
  // browser chrome matches the active theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ebeed5" },
    { media: "(prefers-color-scheme: dark)", color: "#201c36" },
  ],
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
      <html
        lang="en"
        suppressHydrationWarning
        className={`${fraunces.variable} ${libreFranklin.variable} ${geistMono.variable}`}
      >
        <body className="antialiased">
          <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
          <PwaRegister />
          <ThemeProvider>
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
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
