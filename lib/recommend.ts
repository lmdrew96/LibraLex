// Content-based recommender (v1) — pure functions, no LLM, no external calls.
// Runs client-side over the already-loaded books array (N is tiny). Each book is a
// document of namespaced tokens (subjects, authors, decade, length bucket); TF-IDF
// over the user's library weights rare signals high and ubiquitous ones low; a
// rating-weighted taste profile is scored by cosine similarity against candidates.
//
// Three entry points back the three surfaces:
//   recommendForYou — top unread/wishlist by taste, each with a plain explanation
//   moreLikeThis    — nearest neighbours of one book (works with zero ratings)
//   readNext        — single best pick weighing taste against due-date urgency

// The minimal book shape the engine needs. Doc<"books"> / BookWithCover satisfy it
// structurally, so callers pass their full records and get them back unchanged.
export type RecBook = {
  _id: string
  title: string
  authors: string[]
  subjects?: string[]
  firstPublishYear?: number
  pageCount?: number
  ownership: "owned" | "wishlist" | "library"
  readStatus: "unread" | "reading" | "read"
  rating?: number
  dueDate?: number
  returned?: boolean
}

const DAY_MS = 86_400_000

// ── Feature extraction ────────────────────────────────────────────────────────

const lengthBucket = (pages: number | undefined): string | null =>
  pages == null || pages <= 0 ? null : pages < 250 ? "short" : pages > 500 ? "long" : "medium"

const decadeOf = (year: number | undefined): string | null =>
  year == null || year <= 0 ? null : `${Math.floor(year / 10) * 10}s`

/** Namespaced, deduped feature tokens for a book. Subjects are the primary signal;
 *  authors/decade/length round out the profile. */
export const tokenize = (b: RecBook): string[] => {
  const tokens = new Set<string>()
  for (const s of b.subjects ?? []) {
    const v = s.trim().toLowerCase()
    if (v) tokens.add(`subj:${v}`)
  }
  for (const a of b.authors ?? []) {
    const v = a.trim().toLowerCase()
    if (v) tokens.add(`author:${v}`)
  }
  const d = decadeOf(b.firstPublishYear)
  if (d) tokens.add(`decade:${d}`)
  const l = lengthBucket(b.pageCount)
  if (l) tokens.add(`len:${l}`)
  return [...tokens]
}

// Smoothed IDF across the whole library: log((N+1)/(df+1)) + 1. Never zero, so a
// token shared by every book still contributes a little; rare tokens dominate.
const computeIdf = (books: RecBook[]): Map<string, number> => {
  const df = new Map<string, number>()
  for (const b of books) for (const tok of tokenize(b)) df.set(tok, (df.get(tok) ?? 0) + 1)
  const idf = new Map<string, number>()
  const n = books.length
  for (const [tok, d] of df) idf.set(tok, Math.log((n + 1) / (d + 1)) + 1)
  return idf
}

// Book vector = IDF weight per present token (term frequency is 1 — tokens are a set).
const bookVector = (b: RecBook, idf: Map<string, number>): Map<string, number> => {
  const v = new Map<string, number>()
  for (const tok of tokenize(b)) v.set(tok, idf.get(tok) ?? 0)
  return v
}

// Higher rating → stronger pull; read-but-unrated counts as a mild positive.
const ratingWeight = (b: RecBook): number => {
  switch (b.rating) {
    case 5: return 2.0
    case 4: return 1.5
    case 3: return 1.0
    case 2: return 0.5
    case 1: return 0.25
    default: return 1.0
  }
}

// Taste profile = Σ ratingWeight · bookVector over read/reading books.
const tasteProfile = (books: RecBook[], idf: Map<string, number>): Map<string, number> => {
  const profile = new Map<string, number>()
  for (const b of books) {
    if (b.readStatus !== "read" && b.readStatus !== "reading") continue
    const w = ratingWeight(b)
    for (const [tok, val] of bookVector(b, idf)) profile.set(tok, (profile.get(tok) ?? 0) + w * val)
  }
  return profile
}

const cosine = (a: Map<string, number>, b: Map<string, number>): number => {
  if (a.size === 0 || b.size === 0) return 0
  // Iterate the smaller map for the dot product.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  for (const [k, va] of small) {
    const vb = large.get(k)
    if (vb) dot += va * vb
  }
  let na = 0
  for (const v of a.values()) na += v * v
  let nb = 0
  for (const v of b.values()) nb += v * v
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ── Surfaces ──────────────────────────────────────────────────────────────────

/** Number of books that feed the taste profile — callers use this for cold-start. */
export const tasteSourceCount = (books: RecBook[]): number =>
  books.filter((b) => b.readStatus === "read" || b.readStatus === "reading").length

// Build the "Because you loved X — shared: a, b" line: the read book sharing the
// most IDF-weighted tokens with the candidate (ties lean to higher ratings).
const explain = (
  candVec: Map<string, number>,
  readBooks: RecBook[],
  idf: Map<string, number>,
): string => {
  let best: { book: RecBook; subjects: [string, number][] } | null = null
  let bestScore = 0
  for (const rb of readBooks) {
    const rbVec = bookVector(rb, idf)
    let shared = 0
    const subjects: [string, number][] = []
    for (const [tok, val] of candVec) {
      if (!rbVec.has(tok)) continue
      shared += val
      if (tok.startsWith("subj:")) subjects.push([tok.slice(5), val])
    }
    if (shared <= 0) continue
    const weighted = shared * (1 + (rb.rating ?? 3) / 10)
    if (weighted > bestScore) {
      bestScore = weighted
      best = { book: rb, subjects }
    }
  }
  if (!best) return "Matches the themes across your shelf."
  const top = best.subjects.sort((x, y) => y[1] - x[1]).slice(0, 3).map((s) => s[0])
  const verb = (best.book.rating ?? 0) >= 4 ? "loved" : "read"
  const shared = top.length ? ` — shared: ${top.join(", ")}` : ""
  return `Because you ${verb} ${best.book.title}${shared}`
}

export type Recommendation<T extends RecBook> = { book: T; score: number; explanation: string }

/** Top unread owned + wishlist books by taste similarity, each explained. Empty
 *  when there's no taste signal yet (caller shows the cold-start nudge instead). */
export const recommendForYou = <T extends RecBook>(books: T[], limit = 8): Recommendation<T>[] => {
  const idf = computeIdf(books)
  const profile = tasteProfile(books, idf)
  if (profile.size === 0) return []
  const readBooks = books.filter((b) => b.readStatus === "read")
  const candidates = books.filter(
    (b) => b.readStatus === "unread" && (b.ownership === "owned" || b.ownership === "wishlist"),
  )
  return candidates
    .map((book) => {
      const vec = bookVector(book, idf)
      return { book, score: cosine(profile, vec), explanation: explain(vec, readBooks, idf) }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Nearest neighbours of one book by cosine over the rest of the library. Needs no
 *  ratings, so it works on a cold/unrated shelf. */
export const moreLikeThis = <T extends RecBook>(
  targetId: string,
  books: T[],
  limit = 5,
): { book: T; score: number }[] => {
  const idf = computeIdf(books)
  const target = books.find((b) => b._id === targetId)
  if (!target) return []
  const targetVec = bookVector(target, idf)
  return books
    .filter((b) => b._id !== targetId)
    .map((book) => ({ book, score: cosine(targetVec, bookVector(book, idf)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// Library-loan urgency in [0,1]: overdue = 1, ramps down to ~0 three weeks out.
// Non-loans (owned/wishlist, no due date) have no urgency — pure taste.
const urgencyScore = (b: RecBook, now: number): number => {
  if (b.ownership !== "library" || b.dueDate == null || b.returned) return 0
  const days = (b.dueDate - now) / DAY_MS
  if (days <= 0) return 1
  if (days >= 21) return 0.1
  return 1 - days / 21
}

export type ReadNextPick<T extends RecBook> = {
  book: T
  score: number
  taste: number
  urgency: number
}

/** Unread books ranked by w1·taste + w2·urgency (taste normalized to the candidate
 *  set). Floats a soon-due loan that also matches taste; the caller surfaces [0]. */
export const readNext = <T extends RecBook>(
  books: T[],
  now: number,
  w1 = 0.6,
  w2 = 0.4,
): ReadNextPick<T>[] => {
  const idf = computeIdf(books)
  const profile = tasteProfile(books, idf)
  const candidates = books.filter((b) => b.readStatus === "unread")
  if (candidates.length === 0) return []
  const tasteRaw = candidates.map((b) => (profile.size ? cosine(profile, bookVector(b, idf)) : 0))
  const maxTaste = Math.max(...tasteRaw, 1e-9)
  return candidates
    .map((book, i) => {
      const taste = tasteRaw[i] / maxTaste
      const urgency = urgencyScore(book, now)
      return { book, taste, urgency, score: w1 * taste + w2 * urgency }
    })
    .sort((a, b) => b.score - a.score)
}
