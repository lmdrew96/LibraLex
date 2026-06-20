"use client"

import { useEffect } from "react"
import { TriangleAlert } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

// Route-segment error boundary. Renders inside the root layout (theme + fonts
// still apply), replacing the failed page with the calm shell instead of Next's
// default error screen. `reset()` re-renders the segment; the hard link home is
// the escape hatch when a re-render won't recover.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the digest in the console for debugging; no user-facing noise.
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md">
        <EmptyState
          icon={TriangleAlert}
          title="Something went sideways"
          message="That page hit an error — it's not you. Try again, and if it keeps happening, head back to your shelf."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => reset()}>Try again</Button>
              <Button variant="outline" asChild>
                <a href="/">Back to shelf</a>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  )
}
