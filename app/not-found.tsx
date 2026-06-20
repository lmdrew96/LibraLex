import Link from "next/link"
import { BookMarked } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

// 404 — a calm, on-brand dead end with one clear way back, instead of Next's
// default not-found page.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md">
        <EmptyState
          icon={BookMarked}
          title="Page not found"
          message="That page isn't on the shelf — it may have moved, or never existed."
          action={
            <Button asChild>
              <Link href="/">Back to shelf</Link>
            </Button>
          }
        />
      </div>
    </div>
  )
}
