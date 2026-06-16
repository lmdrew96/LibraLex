import { cn } from "@/lib/utils"

/** Shimmer placeholder. Pair with aspect-[2/3] for cover-shaped loading states. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />
}
