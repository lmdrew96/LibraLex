import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { normalizeAuthors, sanitizeYear } from "./normalize"

// One-off (re-runnable) normalization backfill for the existing shelf. INTERNAL —
// not client-exposed; run from the CLI against whichever deployment holds the real
// data:
//   npx convex run backfill:normalizeAllBooks '{"dryRun": true}'   # preview
//   npx convex run backfill:normalizeAllBooks '{"dryRun": false}'  # apply
//
// Requires GOOGLE_BOOKS_API_KEY in the Convex deployment's env (keyless Google
// Books 429s on the shared quota): npx convex env set GOOGLE_BOOKS_API_KEY <key>
// The key must NOT be HTTP-referrer-restricted — Convex actions send no Referer.

const GOOGLE_TIMEOUT_MS = 4000

// Parse a 4-digit year out of a Google Books publishedDate ("2014", "2014-09").
const parseYear = (publishedDate: string | undefined): number | undefined => {
  const m = publishedDate?.match(/^\d{4}/)
  return m ? Number(m[0]) : undefined
}

// Google Books lists only the primary author for comics/graphic novels, dropping
// the artist — a legit co-creator. So we must NOT overwrite authors from GB for
// those; we detect them via categories and keep the stored creators instead.
const isComicCategory = (categories: string[]): boolean =>
  categories.some((c) => /comics|graphic novel|manga/i.test(c))

// Google Books by exact ISBN — clean edition data (prose authors without
// narrators/translators, the edition's publish year, + a comics flag). Returns
// null on miss/error.
const fetchGoogleByIsbn = async (
  isbn: string,
): Promise<{ authors: string[]; year: number | undefined; isComic: boolean } | null> => {
  try {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY
    const keyParam = apiKey ? `&key=${apiKey}` : ""
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1${keyParam}`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      )
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = (await res.json()) as {
      items?: Array<{
        volumeInfo?: { authors?: string[]; publishedDate?: string; categories?: string[] }
      }>
    }
    const info = data.items?.[0]?.volumeInfo
    if (!info) return null
    return {
      authors: info.authors ?? [],
      year: parseYear(info.publishedDate),
      isComic: isComicCategory(info.categories ?? []),
    }
  } catch {
    return null
  }
}

export const _allBooks = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"books">[]> => ctx.db.query("books").collect(),
})

export const _applyNormalization = internalMutation({
  args: {
    id: v.id("books"),
    authors: v.array(v.string()),
    firstPublishYear: v.optional(v.number()),
  },
  handler: async (ctx, { id, authors, firstPublishYear }) => {
    await ctx.db.patch(id, { authors, firstPublishYear })
  },
})

const sameAuthors = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

type BackfillChange = {
  title: string
  before: { authors: string[]; year: number | undefined }
  after: { authors: string[]; year: number | undefined }
  gb: boolean
}
type BackfillResult = {
  dryRun: boolean
  total: number
  changed: number
  changes: BackfillChange[]
}

// Normalize every book: pure cleanup always, plus a Google Books re-fetch by ISBN
// that overwrites authors (clean editions) and year (trusted edition year). Pass
// { dryRun: true } to preview the diff without writing.
export const normalizeAllBooks = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun = true }): Promise<BackfillResult> => {
    const books = await ctx.runQuery(internal.backfill._allBooks, {})
    const changes: BackfillChange[] = []

    for (const b of books) {
      let authors = normalizeAuthors(b.authors)
      let year = sanitizeYear(b.firstPublishYear)
      let usedGb = false

      if (b.isbn) {
        const gb = await fetchGoogleByIsbn(b.isbn)
        if (gb) {
          usedGb = true
          // Overwrite authors from GB only for prose — for comics GB drops the
          // artist, so keep the (pure-normalized) stored creators.
          if (!gb.isComic && gb.authors.length > 0) authors = normalizeAuthors(gb.authors)
          const gy = sanitizeYear(gb.year)
          if (gy !== undefined) year = gy // trust Google Books' edition year
        }
      }

      const authorsChanged = !sameAuthors(authors, b.authors)
      const yearChanged = year !== b.firstPublishYear
      if (!authorsChanged && !yearChanged) continue

      changes.push({
        title: b.title,
        before: { authors: b.authors, year: b.firstPublishYear },
        after: { authors, year },
        gb: usedGb,
      })
      if (!dryRun) {
        await ctx.runMutation(internal.backfill._applyNormalization, {
          id: b._id,
          authors,
          firstPublishYear: year,
        })
      }
    }

    return {
      dryRun,
      total: books.length,
      changed: changes.length,
      changes,
    }
  },
})
