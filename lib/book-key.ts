// Stable cross-shelf identity for a book, so the same title from different sources
// (your shelf, a friend's shelf, a catalog result) collapses to one. Prefer the OL
// work key, then a normalized ISBN, then title + first author.
//
// MUST stay in lockstep with convex/discover.ts `dedupeKey` (the server can't
// import this client lib, so the logic is mirrored — change both together).
export const bookKey = (b: {
  workKey?: string
  isbn?: string
  title: string
  authors: string[]
}): string => {
  const work = b.workKey?.trim()
  if (work) return `w:${work}`
  const isbn = b.isbn?.replace(/[^0-9Xx]/g, "").toLowerCase()
  if (isbn) return `i:${isbn}`
  return `t:${b.title.trim().toLowerCase()}|${(b.authors[0] ?? "").trim().toLowerCase()}`
}
