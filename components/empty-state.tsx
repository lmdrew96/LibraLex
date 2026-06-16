import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

/** Warm, specific empty state with a clear next action. Never a blank screen. */
export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-lavender bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-lavender/60 text-teal">
        <Icon className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold text-ink">{title}</h2>
      <p className="max-w-sm text-teal">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
