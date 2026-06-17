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
      "List the user's books, optionally filtered. Each book: title, authors, ownership (owned|wishlist|library), readStatus (unread|reading|read), year, pages, rating, isbn. Use the filters to answer 'what do I own?', 'what have I finished?', etc.",
    inputSchema: {
      type: "object",
      properties: {
        ownership: {
          type: "string",
          enum: ["owned", "wishlist", "library"],
          description: "Only books on this shelf.",
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
      "Add a book to the user's wishlist by title (optionally with author to disambiguate). Best-effort enriches with cover/year from Open Library. Idempotent: a book already on the wishlist isn't duplicated.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title to add." },
        author: { type: "string", description: "Author name, to pick the right edition." },
      },
      required: ["title"],
    },
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
        ownership: asEnum(args.ownership, ["owned", "wishlist", "library"] as const),
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
      const title = typeof args.title === "string" ? args.title.trim() : ""
      if (!title) throw new Error("add_to_wishlist requires a non-empty title")
      const author = typeof args.author === "string" ? args.author.trim() || undefined : undefined
      const found = await lookupBook(title, author)
      const book = found ?? { title, authors: author ? [author] : [] }
      const result = await ctx.runMutation(internal.mcpData.addWishlistBook, { userId, ...book })
      return textContent(
        result.status === "exists"
          ? { ok: true, alreadyOnWishlist: true, title: result.title }
          : { ok: true, added: true, title: result.title, enriched: Boolean(found) },
      )
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
