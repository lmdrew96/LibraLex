import { fetchJsonWithTimeout, isSameBook, stripHtml } from "./googleBooks"
import { isLikelyEnglish } from "./normalize"

// Open Library — the backup catalog behind Google Books. Google stays primary
// everywhere; this only fills what Google left blank: the barcode lookup and
// typed search when Google fails or misses (app/api/search), and description /
// subjects / cover in enrichBook (convex/enrich.ts). Keyless, so it costs no Google quota. Every
// helper is fault-tolerant — null on a miss or any failure, never throws.
// Self-contained (imports only from convex/) like googleBooks.ts, so both the
// Convex bundle and the Next.js API route can import it.

const OL = "https://openlibrary.org"
const TIMEOUT_MS = 4000

const toHttps = (url: string): string => url.replace(/^http:\/\//, "https://")
const coverUrl = (id: number | undefined): string | undefined =>
  id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : undefined

const getJson = async (url: string): Promise<unknown> => {
  const { ok, json } = await fetchJsonWithTimeout(url, TIMEOUT_MS)
  return ok ? json : null
}

/** What the barcode lookup needs — the shape of a `/api/search` result. */
export type OpenLibraryHit = {
  title: string
  authors: string[]
  isbn: string
  coverUrlFallback?: string
  firstPublishYear?: number
  pageCount?: number
}

type BooksApiData = {
  title?: string
  subtitle?: string
  authors?: Array<{ name?: string }>
  number_of_pages?: number
  publish_date?: string
  cover?: { small?: string; medium?: string; large?: string }
}

/** Barcode fallback for ISBNs Google doesn't index. */
export const fetchOpenLibraryByIsbn = async (isbn: string): Promise<OpenLibraryHit | null> => {
  try {
    const json = (await getJson(
      `${OL}/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`,
    )) as Record<string, BooksApiData> | null
    const book = json?.[`ISBN:${isbn}`]
    if (!book?.title) return null
    const year = book.publish_date?.match(/\d{4}/)?.[0]
    const cover = book.cover?.large ?? book.cover?.medium
    return {
      title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
      authors: (book.authors ?? []).map((a) => a.name).filter((n): n is string => Boolean(n)),
      isbn,
      coverUrlFallback: cover ? toHttps(cover) : undefined,
      firstPublishYear: year ? Number(year) : undefined,
      pageCount: book.number_of_pages && book.number_of_pages > 0 ? book.number_of_pages : undefined,
    }
  } catch (err) {
    console.error("Open Library ISBN lookup failed:", err instanceof Error ? err.message : err)
    return null
  }
}

type SearchApiDoc = {
  title?: string
  author_name?: string[]
  isbn?: string[]
  cover_i?: number
  first_publish_year?: number
  number_of_pages_median?: number
}

/** Typed-search fallback when Google errors or returns nothing that matches.
 *  `[]` when Open Library has no match, null when it couldn't be reached. */
export const searchOpenLibrary = async (
  query: string,
): Promise<Array<Omit<OpenLibraryHit, "isbn"> & { isbn?: string }> | null> => {
  try {
    const params = new URLSearchParams({
      q: query,
      fields: "title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median",
      limit: "10",
    })
    const json = (await getJson(`${OL}/search.json?${params}`)) as { docs?: SearchApiDoc[] } | null
    if (!json) return null
    return (json.docs ?? [])
      .filter((d): d is SearchApiDoc & { title: string } => Boolean(d.title))
      .map((d) => {
        const isbn = pickIsbn(d.isbn)
        return {
          title: d.title,
          authors: d.author_name ?? [],
          isbn,
          coverUrlFallback:
            coverUrl(d.cover_i) ??
            (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : undefined),
          firstPublishYear: d.first_publish_year,
          pageCount: positive(d.number_of_pages_median),
        }
      })
  } catch (err) {
    console.error("Open Library search failed:", err instanceof Error ? err.message : err)
    return null
  }
}

/** The enrichment fields Open Library can fill. */
export type OpenLibraryDetails = {
  description?: string
  subjects?: string[]
  coverUrlFallback?: string
  isbn?: string
  firstPublishYear?: number
  pageCount?: number
}

// Description comes as a plain string or { type, value }. Open Library appends
// source credits and markdown link refs — trim those, and keep English only
// (same guard as Google's descriptions).
const cleanDescription = (raw: unknown): string | undefined => {
  const text =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" && raw !== null && typeof (raw as { value?: unknown }).value === "string"
        ? (raw as { value: string }).value
        : undefined
  if (!text) return undefined
  const cleaned = stripHtml(text)
    .split(/\n-{3,}/)[0] // "----------" divider before "Contains:"/source sections
    .replace(/\(\[source\]\[\d+\]\)/gi, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // markdown bold — the book page renders plain text
    .replace(/^\s*\[\d+\]:\s*\S+\s*$/gm, "") // markdown link-ref lines
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return cleaned && isLikelyEnglish(cleaned) ? cleaned : undefined
}

type Work = { description?: unknown; subjects?: string[]; covers?: number[] }
type Edition = {
  description?: unknown
  subjects?: string[]
  covers?: number[]
  works?: Array<{ key?: string }>
  number_of_pages?: number
  publish_date?: string
}

const fromWork = async (workKey: string | undefined): Promise<Work | null> =>
  workKey ? ((await getJson(`${OL}${workKey}.json`)) as Work | null) : null

// Trailing volume marker on a series entry: "…, Book 1", "… Vol. 2", "… T3",
// "… (Tome 1)", "… #4". Captures the volume number.
const VOLUME_SUFFIX = /[\s,:\-–—(]+(?:book|vol\.?|volume|tome|t|part|no\.?|#)\s*(\d+)\)?\s*$/i

type SearchDoc = {
  key?: string
  title?: string
  author_name?: string[]
  cover_i?: number
  isbn?: string[]
  first_publish_year?: number
  number_of_pages_median?: number
}

// A work lists every edition's ISBN; any ISBN-13 is a real edition of it.
const pickIsbn = (isbns: string[] | undefined): string | undefined =>
  isbns?.find((i) => i.length === 13) ?? isbns?.[0]
const positive = (n: number | undefined): number | undefined => (n && n > 0 ? n : undefined)

/** The search doc that is the wanted book: an exact title match, else the
 *  earliest volume of a series whose base title matches ("Stand Still Stay
 *  Silent" → "Stand Still - Stay Silent, Book 1", not "… T3"). First authors
 *  must agree either way. */
export const pickOpenLibraryMatch = (
  want: { title: string; authors: string[] },
  docs: SearchDoc[],
): SearchDoc | undefined => {
  let best: { doc: SearchDoc; volume: number } | undefined
  for (const d of docs) {
    if (!d.key || !d.title) continue
    const authors = d.author_name ?? []
    const volMatch = d.title.match(VOLUME_SUFFIX)
    const volume = isSameBook(want, { title: d.title, authors })
      ? 0
      : volMatch && isSameBook(want, { title: d.title.slice(0, volMatch.index), authors })
        ? Number(volMatch[1])
        : undefined
    if (volume !== undefined && (!best || volume < best.volume)) best = { doc: d, volume }
  }
  return best?.doc
}

/** Description / subjects / cover for a book: by ISBN (edition, then its work),
 *  else by title + author search. Null when Open Library has nothing useful. */
export const fetchOpenLibraryDetails = async (book: {
  isbn?: string
  title: string
  author?: string
}): Promise<OpenLibraryDetails | null> => {
  try {
    let edition: Edition | null = null
    let workKey: string | undefined
    let coverId: number | undefined
    let match: SearchDoc | undefined

    if (book.isbn) {
      edition = (await getJson(`${OL}/isbn/${book.isbn}.json`)) as Edition | null
      workKey = edition?.works?.[0]?.key
      coverId = edition?.covers?.[0]
    }
    // Title search only with an author: title alone matches the wrong book far
    // too easily ("Diana" → a Princess Diana biography).
    if (!edition && book.author) {
      const params = new URLSearchParams({
        title: book.title,
        fields: "key,title,author_name,cover_i,isbn,first_publish_year,number_of_pages_median",
        limit: "5",
      })
      params.set("author", book.author)
      const found = (await getJson(`${OL}/search.json?${params}`)) as { docs?: SearchDoc[] } | null
      // Strict same-book check (title equal up to a volume suffix, first authors
      // agree) — a loose title match would attach another book's description
      // ("Diana" vs "Diana: Her True Story").
      match = pickOpenLibraryMatch({ title: book.title, authors: [book.author] }, found?.docs ?? [])
      if (!match) return null
      workKey = match.key
      coverId = match.cover_i
    }

    if (!workKey && !edition) return null
    const work = await fromWork(workKey)
    const description = cleanDescription(edition?.description) ?? cleanDescription(work?.description)
    // Work subjects first: they're curated across editions, while a single
    // edition's are often mislabeled. Capped — the long tail is noise.
    // "collectionid:…" / "nyt:…" are machine tags, not subjects.
    const subjects = (work?.subjects?.length ? work.subjects : edition?.subjects)
      ?.filter((s) => !s.includes(":"))
      .slice(0, 8)
    const details: OpenLibraryDetails = {
      description,
      subjects: subjects?.length ? subjects : undefined,
      // Sparse editions often lack a cover their work has.
      coverUrlFallback: coverUrl(coverId) ?? coverUrl(work?.covers?.find((c) => c > 0)),
      // Bibliographic blanks: the scanned edition's, else the matched work's.
      isbn: book.isbn ? undefined : pickIsbn(match?.isbn),
      firstPublishYear: match?.first_publish_year ?? positive(Number(edition?.publish_date?.match(/\d{4}/)?.[0])),
      pageCount: positive(edition?.number_of_pages) ?? positive(match?.number_of_pages_median),
    }
    return Object.values(details).some((v) => v !== undefined) ? details : null
  } catch (err) {
    console.error("Open Library details lookup failed:", err instanceof Error ? err.message : err)
    return null
  }
}
