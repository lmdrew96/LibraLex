import { httpRouter } from "convex/server"
import { httpAction } from "./_generated/server"
import { internal } from "./_generated/api"
import type { ActionCtx } from "./_generated/server"

/**
 * LibraLex's MCP door — lets Claude siblings (Coru on claude.ai, Cody in the CLI,
 * …) reach into the caller's shelf: "what am I reading?", "what's due soon?",
 * "have I read X?", "add Dune to my wishlist".
 *
 * Hand-rolled JSON-RPC 2.0 (no @modelcontextprotocol/sdk), mirroring Folio / Tangle
 * / pctx. Per-user, not single-tenant: the secret in the URL path is each account's
 * own mcpToken (minted in Settings), resolved back to a userId before any read.
 *
 * URL shape:  https://<deployment>.convex.site/mcp/<token>
 * The token rides the path (not a header) because claude.ai's connector UI can't
 * reliably send custom headers upstream — same constraint Folio documents.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
}

const rpcOk = (id: unknown, result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: CORS })

const rpcErr = (id: unknown, code: number, message: string): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: CORS,
  })

/** Wrap any payload as an MCP tool result (text content block). */
const textContent = (payload: unknown) => ({
  content: [
    {
      type: "text",
      text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    },
  ],
})

const SERVER_INFO = {
  name: "libralex-mcp",
  version: "1.0.0",
  protocolVersion: "2024-11-05",
}

const TOOLS = [
  {
    name: "list_books",
    description:
      "List the user's books, optionally filtered. Each book: title, authors, ownership (owned|wishlist|library|none, where none = read but not owned), readStatus (unread|reading|read), year, pages, rating, isbn. Use the filters to answer 'what do I own?', 'what have I finished?', etc.",
    inputSchema: {
      type: "object",
      properties: {
        ownership: {
          type: "string",
          enum: ["owned", "wishlist", "library", "none"],
          description: "Only books on this shelf. 'none' = read/encountered but not owned.",
        },
        readStatus: {
          type: "string",
          enum: ["unread", "reading", "read"],
          description: "Only books with this reading status.",
        },
      },
    },
  },
  {
    name: "currently_reading",
    description:
      "The books the user is reading right now (readStatus = reading), most-recently-started first. Answers 'what am I reading?'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wishlist",
    description:
      "The user's wishlist — books they want but don't own yet, newest first. Answers 'what's on my wishlist?'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "active_loans",
    description:
      "Active library loans (not yet returned), soonest due first. Each carries dueDate, dueInDays, and an overdue flag, so you can answer 'what's due soon?' / 'anything overdue?'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_to_wishlist",
    description:
      "Add a book to the user's wishlist by title (optionally with author to disambiguate). Best-effort enriches with cover/year from Open Library. Idempotent across the whole shelf: a book already on the wishlist isn't duplicated, and a copy already on another shelf (owned/library) is moved to the wishlist instead of creating a second row.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title to add." },
        author: { type: "string", description: "Author name, to pick the right edition." },
      },
      required: ["title"],
    },
  },
  {
    name: "add_book",
    description:
      "Add a book to a specific shelf by title — use this (not add_to_wishlist) when the user owns it, is reading it, has read it, or borrowed it from the library. Set ownership and optionally readStatus. Best-effort enriches with cover/year from Open Library. Idempotent across the whole shelf: a book already on that shelf isn't duplicated, and a copy already on a DIFFERENT shelf is moved to this one (not duplicated) — moving onto 'library' starts a 3-week loan; moving off 'library' clears the loan.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title to add." },
        author: { type: "string", description: "Author name, to pick the right edition." },
        ownership: {
          type: "string",
          enum: ["owned", "wishlist", "library", "none"],
          description:
            "Which shelf. 'owned' = on their shelf, 'library' = borrowed (starts a loan), 'wishlist' = want it, 'none' = read but don't own.",
        },
        readStatus: {
          type: "string",
          enum: ["unread", "reading", "read"],
          description: "Reading status. Defaults to 'unread'. Use 'reading' or 'read' when the user says so.",
        },
        libraryName: {
          type: "string",
          description: "For library adds: which library it's borrowed from.",
        },
      },
      required: ["title", "ownership"],
    },
  },
  {
    name: "update_reading_status",
    description:
      "Update a book the user already has on a shelf: mark it reading/read/unread, set a 1–5 star rating, and/or save a review. Resolves the book by title. Use for 'I started X', 'I finished X', 'I'd give X 4 stars'. Provide at least one of readStatus, rating, or review.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of a book already on a shelf." },
        author: { type: "string", description: "Author, to disambiguate same-titled books." },
        readStatus: {
          type: "string",
          enum: ["unread", "reading", "read"],
          description: "New reading status. 'reading' stamps a start date; 'read' stamps a finish date.",
        },
        rating: { type: "number", description: "Star rating, integer 1–5." },
        review: { type: "string", description: "Free-text review/notes." },
      },
      required: ["title"],
    },
  },
  {
    name: "return_loan",
    description:
      "Mark an active library loan as returned, by title. Only searches the user's current (un-returned) library loans. Use for 'I returned X', 'took X back to the library'.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of a book currently on loan." },
        author: { type: "string", description: "Author, to disambiguate." },
      },
      required: ["title"],
    },
  },
  {
    name: "renew_loan",
    description:
      "Renew (extend) an active library loan, by title. Pushes the due date out by `days` from today (default 21, a standard loan period). Use for 'renew X', 'extend my loan on X'.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of a book currently on loan." },
        author: { type: "string", description: "Author, to disambiguate." },
        days: {
          type: "number",
          description: "How many days to extend from today. Defaults to 21. Convert weeks to days (2 weeks = 14).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "search_books",
    description:
      "Search the global book catalog (Open Library) by title/author/keyword — NOT the user's shelf. Use to find a book, confirm an exact title/author, or disambiguate before add_book. Returns up to ~8 matches with title, authors, year, pages, isbn.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Title, author, or keywords to search for." },
        limit: { type: "number", description: "Max results, 1–10. Defaults to 8." },
      },
      required: ["query"],
    },
  },
  {
    name: "recommend_books",
    description:
      "Suggest what the user should read next. Prefers books their friends have vouched for (rated/read), then fills from the catalog using the user's taste (the subjects they read most). Excludes books already on their shelf or marked 'not interested'. Each pick carries a short reason. Answers 'what should I read next?'.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many to suggest, 1–20. Defaults to 8." },
      },
    },
  },
  {
    name: "recommendation_inbox",
    description:
      "Books friends have recommended to the user, newest first — each with who sent it and any note. Answers 'did anyone recommend me a book?'. To add one, call add_book with the title.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "send_recommendation",
    description:
      "Recommend a book to one of the user's friends, identified by their name. Use for 'recommend Dune to Maya', 'tell Sam to read X'. Only works for accepted friends.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title to recommend." },
        to: { type: "string", description: "The friend's name (as it appears in their friend list)." },
        author: { type: "string", description: "Author, to pick the right book." },
        message: { type: "string", description: "Optional note to send with the recommendation." },
      },
      required: ["title", "to"],
    },
  },
  {
    name: "reading_stats",
    description:
      "The user's reading stats: books read all-time and this year, pages read, currently-reading and to-read counts, average rating + rating distribution, and shelf totals (owned/wishlist/active loans). Answers 'how's my reading year going?', 'how many books have I read?'.",
    inputSchema: { type: "object", properties: {} },
  },
] as const

/** Pull the token out of the path: /mcp/<token> (query stripped, trailing / trimmed). */
function tokenFromPath(req: Request): string {
  const path = new URL(req.url).pathname
  const marker = "/mcp/"
  const i = path.indexOf(marker)
  if (i === -1) return ""
  return path.slice(i + marker.length).replace(/\/+$/, "")
}

const asEnum = <T extends string>(val: unknown, allowed: readonly T[]): T | undefined =>
  typeof val === "string" && (allowed as readonly string[]).includes(val) ? (val as T) : undefined

/** Trim a string arg to undefined when empty/absent. */
const optStr = (val: unknown): string | undefined =>
  typeof val === "string" && val.trim() ? val.trim() : undefined

/** Require a non-empty `title` arg, with a tool-named error if missing. */
const reqTitle = (args: Record<string, unknown>, tool: string): string => {
  const title = optStr(args.title)
  if (!title) throw new Error(`${tool} requires a non-empty title`)
  return title
}

const DAY_MS = 24 * 60 * 60 * 1000

// ── Loan date-math (TZ-aware) ────────────────────────────────────────────────
// Convex runs in UTC, but "due in N days" is a calendar-day count on the USER'S
// local zone — comparing a midnight-ish dueDate against a mid-day `now` in UTC
// floors a 21-day gap to 20 at the timezone boundary. So we resolve each instant
// to its civil (wall-clock) date in the user's stored zone, then diff those dates.
// Mirrors lib/loans.daysUntilDue on the client. If the runtime lacks IANA tz data
// (or no zone is stored), we fall back to UTC — still correct for same-zone-as-UTC
// users and for any daytime checkout.

/** Civil date "YYYY-MM-DD" for `ms` in `tz`; UTC if tz is missing/unsupported.
 *  (Convex returns an absent optional as null, so accept that too.) */
const civilDate = (ms: number, tz?: string | null): string => {
  if (tz) {
    try {
      // en-CA formats as ISO-style YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ms))
    } catch {
      // runtime without full ICU, or an unknown zone — fall through to UTC
    }
  }
  return new Date(ms).toISOString().slice(0, 10)
}

/** Whole calendar days from `now` until `dueDate`, on the user's local day
 *  boundaries. Positive = days left, 0 = due today, negative = overdue. */
const daysUntilDue = (dueDate: number, now: number, tz?: string | null): number => {
  const due = Date.parse(`${civilDate(dueDate, tz)}T00:00:00Z`)
  const today = Date.parse(`${civilDate(now, tz)}T00:00:00Z`)
  return Math.round((due - today) / DAY_MS)
}

// ── Open Library enrichment for add_to_wishlist ──────────────────────────────────
// A slim, fault-tolerant cousin of /api/search (which can't be shared across the
// Next/Convex boundary). Top OL result only; any failure falls back to bare insert.
const OL_FIELDS = "title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median,key"

type EnrichedBook = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  workKey?: string
  firstPublishYear?: number
  pageCount?: number
}

async function lookupBook(title: string, author?: string): Promise<EnrichedBook | null> {
  const q = [title, author].filter(Boolean).join(" ")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=1&fields=${OL_FIELDS}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "LibraLex-MCP/1.0 (libra.adhdesigns.dev)",
          Accept: "application/json",
        },
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      docs?: Array<{
        title?: string
        author_name?: string[]
        isbn?: string[]
        cover_i?: number
        first_publish_year?: number
        number_of_pages_median?: number
        key?: string
      }>
    }
    const doc = data.docs?.[0]
    if (!doc?.title) return null
    return {
      title: doc.title,
      authors: doc.author_name ?? (author ? [author] : []),
      isbn: doc.isbn?.[0],
      coverId: doc.cover_i,
      workKey: doc.key,
      firstPublishYear: doc.first_publish_year,
      pageCount: doc.number_of_pages_median,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Catalog search (search_books + recommend_books fallback) ─────────────────
// A richer cousin of lookupBook: many results, carries subjects for the recommender.
const OL_SEARCH_FIELDS =
  "key,title,author_name,isbn,cover_i,first_publish_year,number_of_pages_median,subject"

type OLSearchDoc = {
  key?: string
  title?: string
  author_name?: string[]
  isbn?: string[]
  cover_i?: number
  first_publish_year?: number
  number_of_pages_median?: number
  subject?: string[]
}

type CatalogResult = {
  title: string
  authors: string[]
  isbn?: string
  coverId?: number
  firstPublishYear?: number
  pageCount?: number
  workKey?: string
  subjects?: string[]
}

const mapSearchDoc = (d: OLSearchDoc): CatalogResult | null => {
  if (!d.title) return null
  return {
    title: d.title,
    authors: d.author_name ?? [],
    isbn: d.isbn?.[0],
    coverId: typeof d.cover_i === "number" && d.cover_i > 0 ? d.cover_i : undefined,
    firstPublishYear: d.first_publish_year,
    pageCount:
      typeof d.number_of_pages_median === "number" ? d.number_of_pages_median : undefined,
    workKey: d.key,
    subjects: d.subject?.slice(0, 12),
  }
}

/** Run one Open Library search.json query; [] on any failure (fault-tolerant). */
async function olSearch(qs: string, timeoutMs = 9000): Promise<CatalogResult[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(
      `https://openlibrary.org/search.json?${qs}&fields=${OL_SEARCH_FIELDS}`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "LibraLex-MCP/1.0 (libra.adhdesigns.dev)",
          Accept: "application/json",
        },
      },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { docs?: OLSearchDoc[] }
    return (data.docs ?? []).map(mapSearchDoc).filter((r): r is CatalogResult => r !== null)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Cross-shelf identity for a catalog hit — MUST match discover.dedupeKey so we
 *  can filter against the user's shelf + dismissed keys. */
const catalogKey = (c: CatalogResult): string => {
  const work = c.workKey?.trim()
  if (work) return `w:${work}`
  const isbn = c.isbn?.replace(/[^0-9Xx]/g, "").toLowerCase()
  if (isbn) return `i:${isbn}`
  return `t:${c.title.trim().toLowerCase()}|${(c.authors[0] ?? "").trim().toLowerCase()}`
}

// Catalog candidates for taste subjects — mirrors /api/discover (readinglog rank,
// English, 1980+ recency floor) so chat recs match the in-app Discover row.
async function catalogBySubjects(
  subjects: string[],
  need: number,
  exclude: Set<string>,
): Promise<CatalogResult[]> {
  const yearCeil = new Date(Date.now()).getUTCFullYear() + 1
  const out: CatalogResult[] = []
  const seen = new Set<string>(exclude)
  for (const subject of subjects.slice(0, 2)) {
    if (out.length >= need) break
    const q = `subject:"${subject.replace(/"/g, "")}" AND language:eng AND first_publish_year:[1980 TO ${yearCeil}]`
    const cands = await olSearch(`q=${encodeURIComponent(q)}&sort=readinglog&limit=14`)
    for (const c of cands) {
      const key = catalogKey(c)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
      if (out.length >= need) break
    }
  }
  return out
}

// ── Friend resolution (send_recommendation) ──────────────────────────────────
type FriendLite = { userId: string; displayName: string }
type FriendResolution =
  | { status: "ok"; userId: string; displayName: string }
  | { status: "not_found"; to: string; yourFriends: string[] }
  | { status: "ambiguous"; matches: string[] }

// Resolve a chat-supplied name to one friend: exact (case-insensitive) wins, else
// substring. 0 → not_found (echo the friend list), >1 → ambiguous (let chat ask).
const resolveFriend = (friends: FriendLite[], query: string): FriendResolution => {
  const q = query.trim().toLowerCase()
  const exact = friends.filter((f) => f.displayName.trim().toLowerCase() === q)
  const pool = exact.length
    ? exact
    : friends.filter((f) => f.displayName.toLowerCase().includes(q))
  if (pool.length === 0) {
    return { status: "not_found", to: query, yourFriends: friends.map((f) => f.displayName) }
  }
  if (pool.length > 1) return { status: "ambiguous", matches: pool.map((f) => f.displayName) }
  return { status: "ok", userId: pool[0].userId, displayName: pool[0].displayName }
}

// Human-readable "why" for a friend-vouched pick: "Maya rated it 5★; Sam is reading it".
const friendWhy = (
  endorsers: { displayName: string; rating?: number; readStatus: string }[],
): string => {
  const phrase = (e: { displayName: string; rating?: number; readStatus: string }): string => {
    if (typeof e.rating === "number") return `${e.displayName} rated it ${e.rating}★`
    if (e.readStatus === "read") return `${e.displayName} read it`
    if (e.readStatus === "reading") return `${e.displayName} is reading it`
    return `${e.displayName} has it on their shelf`
  }
  const top = endorsers.slice(0, 2).map(phrase).join("; ")
  return endorsers.length > 2 ? `${top} +${endorsers.length - 2} more` : top
}

/** Clamp a numeric arg into [min,max], rounding; falls back to dflt when absent/bad. */
const clampInt = (val: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof val === "number" ? Math.round(val) : NaN
  if (!Number.isFinite(n)) return dflt
  return Math.min(Math.max(n, min), max)
}

/** Route a tools/call to the matching internal function, scoped to userId. */
async function dispatch(
  ctx: ActionCtx,
  name: string,
  args: Record<string, unknown>,
  userId: string,
) {
  switch (name) {
    case "list_books": {
      const books = await ctx.runQuery(internal.mcpData.listBooksForUser, {
        userId,
        ownership: asEnum(args.ownership, ["owned", "wishlist", "library", "none"] as const),
        readStatus: asEnum(args.readStatus, ["unread", "reading", "read"] as const),
      })
      return textContent({ count: books.length, books })
    }

    case "currently_reading": {
      const books = await ctx.runQuery(internal.mcpData.currentlyReadingForUser, { userId })
      return textContent({ count: books.length, books })
    }

    case "wishlist": {
      const books = await ctx.runQuery(internal.mcpData.wishlistForUser, { userId })
      return textContent({ count: books.length, books })
    }

    case "active_loans": {
      const loans = await ctx.runQuery(internal.mcpData.activeLoansForUser, { userId })
      const tz = await ctx.runQuery(internal.mcpData.timeZoneForUser, { userId })
      const now = Date.now()
      const formatted = loans.map((l) => {
        const dueInDays = l.dueDate !== undefined ? daysUntilDue(l.dueDate, now, tz) : undefined
        return {
          title: l.title,
          authors: l.authors,
          readStatus: l.readStatus,
          libraryName: l.libraryName,
          dueDate: l.dueDate !== undefined ? civilDate(l.dueDate, tz) : undefined,
          dueInDays,
          // Overdue once the due calendar day has passed — "due today" (0) is not
          // overdue. Matches lib/loans.loanStatus on the client.
          overdue: dueInDays !== undefined && dueInDays < 0,
        }
      })
      return textContent({ count: formatted.length, loans: formatted })
    }

    case "add_to_wishlist": {
      const title = reqTitle(args, "add_to_wishlist")
      const author = optStr(args.author)
      const found = await lookupBook(title, author)
      const book = found ?? { title, authors: author ? [author] : [] }
      const result = await ctx.runMutation(internal.mcpData.addBookForUser, {
        userId,
        ...book,
        ownership: "wishlist",
      })
      return textContent(
        result.status === "exists"
          ? { ok: true, alreadyOnWishlist: true, title: result.title }
          : result.status === "moved"
            ? { ok: true, moved: true, title: result.title, from: result.from, to: "wishlist" }
            : { ok: true, added: true, title: result.title, enriched: Boolean(found) },
      )
    }

    case "add_book": {
      const title = reqTitle(args, "add_book")
      const author = optStr(args.author)
      const ownership = asEnum(args.ownership, ["owned", "wishlist", "library", "none"] as const)
      if (!ownership) throw new Error("add_book requires ownership (owned|wishlist|library|none)")
      const readStatus = asEnum(args.readStatus, ["unread", "reading", "read"] as const)
      const libraryName = optStr(args.libraryName)
      const found = await lookupBook(title, author)
      const book = found ?? { title, authors: author ? [author] : [] }
      const result = await ctx.runMutation(internal.mcpData.addBookForUser, {
        userId,
        ...book,
        ownership,
        readStatus,
        libraryName,
      })
      return textContent(
        result.status === "exists"
          ? { ok: true, alreadyOnShelf: true, title: result.title, ownership: result.ownership }
          : result.status === "moved"
            ? {
                ok: true,
                moved: true,
                title: result.title,
                from: result.from,
                ownership: result.ownership,
              }
            : {
                ok: true,
                added: true,
                title: result.title,
                ownership: result.ownership,
                enriched: Boolean(found),
              },
      )
    }

    case "update_reading_status": {
      const title = reqTitle(args, "update_reading_status")
      const author = optStr(args.author)
      const readStatus = asEnum(args.readStatus, ["unread", "reading", "read"] as const)
      const review = optStr(args.review)
      let rating: number | undefined
      if (args.rating !== undefined && args.rating !== null) {
        const r = Number(args.rating)
        if (!Number.isInteger(r) || r < 1 || r > 5) {
          throw new Error("rating must be an integer from 1 to 5")
        }
        rating = r
      }
      if (readStatus === undefined && rating === undefined && review === undefined) {
        throw new Error("update_reading_status needs at least one of readStatus, rating, or review")
      }
      const result = await ctx.runMutation(internal.mcpData.setReadingStatusForUser, {
        userId,
        title,
        author,
        readStatus,
        rating,
        review,
      })
      return textContent(result.status === "updated" ? { ok: true, ...result } : result)
    }

    case "return_loan": {
      const title = reqTitle(args, "return_loan")
      const author = optStr(args.author)
      const result = await ctx.runMutation(internal.mcpData.returnLoanForUser, {
        userId,
        title,
        author,
      })
      return textContent(result.status === "returned" ? { ok: true, ...result } : result)
    }

    case "renew_loan": {
      const title = reqTitle(args, "renew_loan")
      const author = optStr(args.author)
      const days =
        typeof args.days === "number" && args.days > 0 ? Math.round(args.days) : 21
      const now = Date.now()
      const newDueDate = now + days * DAY_MS
      const result = await ctx.runMutation(internal.mcpData.renewLoanForUser, {
        userId,
        title,
        author,
        newDueDate,
      })
      if (result.status !== "renewed") return textContent(result)
      const tz = await ctx.runQuery(internal.mcpData.timeZoneForUser, { userId })
      return textContent({
        ok: true,
        renewed: true,
        title: result.title,
        dueDate: civilDate(newDueDate, tz),
        dueInDays: daysUntilDue(newDueDate, now, tz),
      })
    }

    case "search_books": {
      const query = typeof args.query === "string" ? args.query.trim() : ""
      if (query.length < 2) throw new Error("search_books needs a query of at least 2 characters")
      const limit = clampInt(args.limit, 1, 10, 8)
      const results = await olSearch(`q=${encodeURIComponent(query)}&limit=${limit}`)
      return textContent({ count: results.length, results })
    }

    case "recommend_books": {
      const limit = clampInt(args.limit, 1, 20, 8)
      const inputs = await ctx.runQuery(internal.mcpData.recommendInputsForUser, { userId })

      const recommendations: Array<{
        title: string
        authors: string[]
        firstPublishYear?: number
        source: "friends" | "catalog"
        why: string
      }> = []

      for (const p of inputs.friendPicks.slice(0, limit)) {
        recommendations.push({
          title: p.title,
          authors: p.authors,
          firstPublishYear: p.firstPublishYear,
          source: "friends",
          why: friendWhy(p.endorsers),
        })
      }

      // Fill from the catalog (taste subjects) when friends didn't supply enough.
      if (recommendations.length < limit && inputs.tasteSubjects.length > 0) {
        const exclude = new Set<string>([
          ...inputs.onShelfKeys,
          ...inputs.dismissedKeys,
          ...inputs.friendPicks.map((p) => p.dedupeKey),
        ])
        const catalog = await catalogBySubjects(
          inputs.tasteSubjects,
          limit - recommendations.length,
          exclude,
        )
        const why = `Matches your taste: ${inputs.tasteSubjects.join(", ")}`
        for (const c of catalog) {
          recommendations.push({
            title: c.title,
            authors: c.authors,
            firstPublishYear: c.firstPublishYear,
            source: "catalog",
            why,
          })
        }
      }

      return textContent({
        count: recommendations.length,
        recommendations,
        basis: {
          fromFriends: inputs.friendPicks.length > 0,
          tasteSubjects: inputs.tasteSubjects,
        },
      })
    }

    case "recommendation_inbox": {
      const recommendations = await ctx.runQuery(internal.mcpData.inboxForUser, { userId })
      return textContent({ count: recommendations.length, recommendations })
    }

    case "send_recommendation": {
      const title = reqTitle(args, "send_recommendation")
      const to = optStr(args.to)
      if (!to) throw new Error("send_recommendation requires `to` (a friend's name)")
      const author = optStr(args.author)
      const message = optStr(args.message)

      const friends = await ctx.runQuery(internal.mcpData.friendsForUser, { userId })
      const recipient = resolveFriend(friends, to)
      if (recipient.status !== "ok") return textContent(recipient)

      // Prefer the sender's own copy (keeps their cover/biblio); else enrich from OL.
      const snapshot = await ctx.runQuery(internal.mcpData.findBookSnapshotForUser, {
        userId,
        title,
        author,
      })
      const found = snapshot ? null : await lookupBook(title, author)
      const book = snapshot ?? found ?? { title, authors: author ? [author] : [] }

      const result = await ctx.runMutation(internal.mcpData.sendRecForUser, {
        userId,
        toUserId: recipient.userId,
        ...book,
        message,
      })
      return textContent(
        result.status === "sent"
          ? { ok: true, sent: true, to: recipient.displayName, title: book.title }
          : result,
      )
    }

    case "reading_stats": {
      const tz = await ctx.runQuery(internal.mcpData.timeZoneForUser, { userId })
      const now = Date.now()
      const year = Number(civilDate(now, tz).slice(0, 4))
      const startOfYear = Date.parse(`${year}-01-01T00:00:00Z`)
      const stats = await ctx.runQuery(internal.mcpData.readingStatsForUser, {
        userId,
        startOfYear,
      })
      return textContent({ year, ...stats })
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

const mcp = httpAction(async (ctx, req) => {
  // Resolve the URL-path token to a userId up front — gates every method, so an
  // unauthorized caller can't even list the tools.
  const token = tokenFromPath(req)
  const userId = token
    ? await ctx.runQuery(internal.mcpAuth.userIdForToken, { token })
    : null
  if (!userId) {
    return rpcErr(null, -32600, "Unauthorized — invalid or missing MCP token in the URL.")
  }

  let body: { method?: string; params?: unknown; id?: unknown }
  try {
    body = await req.json()
  } catch {
    return rpcErr(null, -32700, "Parse error: invalid JSON")
  }
  const { method, params, id } = body

  if (method === "initialize") {
    return rpcOk(id, {
      protocolVersion: SERVER_INFO.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    })
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (method === "tools/list") {
    return rpcOk(id, { tools: TOOLS })
  }

  if (method === "tools/call") {
    const { name, arguments: args } = (params ?? {}) as {
      name?: string
      arguments?: Record<string, unknown>
    }
    if (!name) return rpcErr(id, -32602, "tools/call requires `name`")
    try {
      const result = await dispatch(ctx, name, args ?? {}, userId)
      return rpcOk(id, result)
    } catch (e) {
      return rpcErr(id, -32603, e instanceof Error ? e.message : "Internal error")
    }
  }

  return rpcErr(id, -32601, `Unknown method: ${method}`)
})

const http = httpRouter()

http.route({ pathPrefix: "/mcp/", method: "POST", handler: mcp })

// CORS preflight for browser-based MCP clients.
http.route({
  pathPrefix: "/mcp/",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    })
  }),
})

export default http
