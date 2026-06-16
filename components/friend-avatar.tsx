import { cn } from "@/lib/utils"

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-xl",
} as const

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?"

/** A friend's avatar — Clerk image when present, brand-gradient initials otherwise. */
export function FriendAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: {
  name: string
  avatarUrl?: string
  size?: keyof typeof sizeClasses
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full",
        sizeClasses[size],
        className,
      )}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="cover-placeholder flex h-full w-full items-center justify-center font-semibold">
          {initials(name)}
        </div>
      )}
    </div>
  )
}
