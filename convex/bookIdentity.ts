// The one "same book" rule, shared by the server (add-dedupe, friend/vector recs,
// MCP, chat recs) and the client (shelf/dismiss hiding, edition collapsing,
// wishlist grouping) — the client imports it from here, so the two can't drift.
//
// A book has up to three identities: its Google Books volume id (workKey), its
// ISBN, and its title + first author. Volume ids and ISBNs are per EDITION, so no
// single one of them recognizes a different edition of the same book; the
// title + author key does. Two books are the same when ANY of their keys match.
//
// The title key strips format noise only ("[large print]", "unabridged", ": A
// Novel"), never a real subtitle or volume number — "Mistborn: The Final Empire"
// and "Mistborn: The Well of Ascension" stay different books.

export type BookIdentity = {
  workKey?: string
  isbn?: string
  title: string
  authors: string[]
}

// Edition-noise phrases that describe a FORMAT, never a different work. Matched
// anywhere in the title (bracketed or bare).
const EDITION_NOISE: RegExp[] = [
  /\blarge print\b/g,
  /\blarge type\b/g,
  /\bunabridged\b/g,
  /\babridged\b/g,
  /\baudio\s?book\b/g,
  /\baudio cd\b/g,
  /\bcompact disc\b/g,
  /\bmedia tie[-\s]?in\b/g,
  /\bmovie tie[-\s]?in\b/g,
  /\b(?:deluxe|anniversary|revised|expanded|illustrated|annotated|collector'?s|special|reprint|reissue)\s+edition\b/g,
]

// Generic format subtitles that never distinguish two works — always safe to drop.
const FORMAT_SUBTITLE = /:\s*(?:a|an|the)\s+(?:novel|memoir|novella|story|biography|play)\b.*$/

// A token marking an installment within a series. A bracket carrying one —
// "(The Lord of the Rings, Book 1)" — is structural and kept. No `g` flag, so
// `.test` stays stateless.
const VOLUME_MARKER =
  /\bvol(?:ume)?\b|\bbook\b|\bpart\b|\bno\.?\b|#\s*\d|\b\d+\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i

// Drop a bracket/paren group ONLY when it is pure edition noise.
const stripNoiseBrackets = (t: string): string =>
  t.replace(/[([][^)\]]*[)\]]/g, (group) => {
    if (VOLUME_MARKER.test(group)) return group
    let inner = group.slice(1, -1)
    for (const re of EDITION_NOISE) inner = inner.replace(re, "")
    return inner.replace(/[^a-z0-9]/g, "") === "" ? " " : group
  })

/** A title reduced to its identity form: lowercased, format noise removed,
 *  punctuation flattened. Subtitles and volume numbers survive. */
export const identityTitle = (rawTitle: string): string => {
  let t = rawTitle.toLowerCase()
  t = stripNoiseBrackets(t)
  for (const re of EDITION_NOISE) t = t.replace(re, " ")
  t = t.replace(FORMAT_SUBTITLE, "")
  return t.replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim()
}

// "J. K. Rowling" and "J.K. Rowling" are one author.
const identityAuthor = (name: string | undefined): string => (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")

const workKeyOf = (b: BookIdentity): string | undefined => {
  const work = b.workKey?.trim()
  return work ? `w:${work}` : undefined
}
const isbnKeyOf = (b: BookIdentity): string | undefined => {
  const isbn = b.isbn?.replace(/[^0-9Xx]/g, "").toLowerCase()
  return isbn ? `i:${isbn}` : undefined
}
const titleKeyOf = (b: BookIdentity): string | undefined => {
  const title = identityTitle(b.title)
  return title ? `t:${title}|${identityAuthor(b.authors[0])}` : undefined
}

/** The primary key — workKey, else ISBN, else title + author. What gets stored
 *  (dismissals) and used as a React/list key. Its own `bookKeys` always include it. */
export const bookKey = (b: BookIdentity): string =>
  workKeyOf(b) ?? isbnKeyOf(b) ?? titleKeyOf(b) ?? `t:|${identityAuthor(b.authors[0])}`

/** Every identity key a book has. */
export const bookKeys = (b: BookIdentity): string[] =>
  [workKeyOf(b), isbnKeyOf(b), titleKeyOf(b)].filter((k): k is string => k !== undefined)

/** All keys of a set of books — for "hide anything already on my shelf". */
export const keySetOf = (books: BookIdentity[]): Set<string> => new Set(books.flatMap(bookKeys))

/** Whether any of a book's keys is in the set (from `keySetOf`, or stored
 *  dismissal keys, which are primary `bookKey`s). */
export const inKeySet = (set: Set<string>, b: BookIdentity): boolean => bookKeys(b).some((k) => set.has(k))

/** The same book? Any shared key — plus, when either side has no author at all,
 *  a matching title (a hand-entered book without an author is still that book). */
export const sameBook = (a: BookIdentity, b: BookIdentity): boolean => {
  const theirs = new Set(bookKeys(b))
  if (bookKeys(a).some((k) => theirs.has(k))) return true
  if (a.authors[0] && b.authors[0]) return false
  const title = identityTitle(a.title)
  return Boolean(title) && title === identityTitle(b.title)
}

/** Group books that are the same book (any shared key, transitively), keeping
 *  first-seen order of groups and members. */
export const groupSameBooks = <T extends BookIdentity>(items: T[]): T[][] => {
  const groups: T[][] = []
  const groupOfKey = new Map<string, number>()
  for (const item of items) {
    const keys = bookKeys(item)
    const hits = [...new Set(keys.map((k) => groupOfKey.get(k)).filter((g): g is number => g !== undefined))]
    let target: number
    if (hits.length === 0) {
      target = groups.push([]) - 1
    } else {
      // An item can bridge two groups (shares an ISBN with one, a title with
      // another) — fold them into the earliest.
      target = Math.min(...hits)
      for (const g of hits) {
        if (g === target) continue
        groups[target].push(...groups[g])
        for (const member of groups[g]) for (const k of bookKeys(member)) groupOfKey.set(k, target)
        groups[g] = []
      }
    }
    groups[target].push(item)
    for (const k of keys) groupOfKey.set(k, target)
  }
  return groups.filter((g) => g.length > 0)
}
