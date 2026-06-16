import { SignUp } from "@clerk/nextjs"

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-surface px-6 py-12">
      <div className="text-center">
        <h1 className="text-4xl font-semibold">LibraLex</h1>
        <p className="mt-2 text-teal">Your shelf, digitized.</p>
      </div>
      <SignUp
        appearance={{
          variables: {
            colorPrimary: "#dfa649",
            colorBackground: "#ffffff",
            borderRadius: "16px",
            fontFamily: "var(--font-space-grotesk), system-ui, sans-serif",
          },
        }}
      />
    </main>
  )
}
