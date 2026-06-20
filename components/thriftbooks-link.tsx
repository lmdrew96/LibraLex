"use client"

import { ShoppingBag } from "lucide-react"
import { buildThriftBooksUrl, type ThriftBooksTarget } from "@/lib/thriftbooks"
import { Button } from "@/components/ui/button"

type ThriftBooksLinkProps = {
  book: ThriftBooksTarget
  /** Visible button text. Default "Find on ThriftBooks"; pass a shorter label on
   *  tight surfaces (e.g. "ThriftBooks" on narrow wishlist cards). */
  label?: string
  className?: string
}

/** "Find on ThriftBooks" deep link — opens a used-copy search in a new tab.
 *  Renders nothing when there's nothing to search (no ISBN and no title). */
export function ThriftBooksLink({
  book,
  label = "Find on ThriftBooks",
  className,
}: ThriftBooksLinkProps) {
  const url = buildThriftBooksUrl(book)
  if (!url) return null

  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Find “${book.title}” on ThriftBooks`}
      >
        <ShoppingBag className="h-4 w-4" />
        {label}
      </a>
    </Button>
  )
}
