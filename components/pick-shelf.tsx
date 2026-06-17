import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

/** Shared chrome for a row of off-shelf picks (friends or catalog). A horizontal
 *  carousel for the home shelf, a wrapping grid for a detail page — same header,
 *  same item shape. Each item carries its own stable key. */
export function PickShelf({
  title,
  icon: Icon,
  layout,
  items,
}: {
  title: string
  icon: LucideIcon
  layout: "carousel" | "grid"
  items: { key: string; node: ReactNode }[]
}) {
  if (layout === "carousel") {
    return (
      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-teal">
          <Icon className="h-4 w-4" />
          {title}
        </h2>
        <ul className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {items.map(({ key, node }) => (
            <li key={key} className="shrink-0">
              {node}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="mt-10 border-t border-lavender pt-6">
      <h2 className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-teal">
        <Icon className="h-4 w-4" />
        {title}
      </h2>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5">
        {items.map(({ key, node }) => (
          <li key={key}>{node}</li>
        ))}
      </ul>
    </section>
  )
}
