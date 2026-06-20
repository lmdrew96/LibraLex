// ThriftBooks "find a used copy" deep link.
//
// ThriftBooks has no public API and doesn't expose constructable work-page URLs,
// so ISBN search is the robust path: an ISBN query resolves straight to the
// matching book's page, and a title+author query returns a relevant result list.
// Both go through the same `b.search` param (confirmed live, 2026-06). Live-price
// scraping is intentionally out of scope — the link always lands the user on the
// current price, which is the whole point.

const THRIFTBOOKS_SEARCH = "https://www.thriftbooks.com/browse/"

// Optional affiliate query fragment, appended to every ThriftBooks link when set.
// Kept as a raw `key=value` config fragment (not hardcoded in code) so a tag can
// be added later — or the affiliate format changed — without a code change. Empty
// = plain links. Must be NEXT_PUBLIC_* to be readable from the client components
// that build the link. Any leading `?`/`&` is stripped so either form works.
const AFFILIATE = (process.env.NEXT_PUBLIC_THRIFTBOOKS_AFFILIATE ?? "")
  .trim()
  .replace(/^[?&]+/, "")

export type ThriftBooksTarget = {
  isbn?: string
  title: string
  authors?: string[]
}

/** Build a ThriftBooks search URL for a book. Prefers the ISBN (resolves directly
 *  to the book's page); falls back to a `title author` text search when no ISBN is
 *  stored. Returns null only when there's nothing searchable (no ISBN, no title) —
 *  callers render nothing in that case. */
export const buildThriftBooksUrl = ({ isbn, title, authors }: ThriftBooksTarget): string | null => {
  const query = isbn?.trim() || [title, authors?.[0]].filter(Boolean).join(" ").trim()
  if (!query) return null
  const base = `${THRIFTBOOKS_SEARCH}?${new URLSearchParams({ "b.search": query }).toString()}`
  return AFFILIATE ? `${base}&${AFFILIATE}` : base
}
