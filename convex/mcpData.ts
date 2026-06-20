import { internalMutation, internalQuery } from "./_generated/server"
import { v } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import { normalizeAuthors, sanitizeYear } from "./normalize"

// Data layer for the MCP door (convex/http.ts). Every function here is INTERNAL —
// callable only from other Convex functions, never the public internet. The sole
// caller is the token-gated MCP httpAction, which resolves token → userId BEFORE
// calling these. That's why they take `userId` explicitly: an MCP request carries
// no Clerk session, so the usual "derive identity from ctx.auth" rule doesn't apply
// here — the door upstream has already authenticated.
//
// Reads mirror the public queries in books.ts but project to a compact, chat-
// friendly shape and never leak internal ids. Timestamps stay raw (ms); the action
// layer formats dates with a real clock (Date.now() isn't available in queries).

const ownershipValidator = v.union(
  v.literal("owned"),
  v.literal("wishlist"),
  v.literal("library"),
  v.literal("none"),
)
const readStatusValidator = v.union(
  v.literal("unread"),
  v.literal("reading"),
  v.literal("read"),
)

export type McpBook = {
  title: string
  authors: string[]
  ownership: Doc<"books">["ownership"]
  readStatus: Doc<"books">["readStatus"]
  firstPublishYear?: number
  pageCount?: number
  rating?: number
  isbn?: string
}

const toMcpBook = (b: Doc<"books">): McpBook => ({
  title: b.title,
  authors: b.authors,
  ownership: b.ownership,
  readStatus: b.readStatus,
  firstPublishYear: b.firstPublishYear,
  pageCount: b.pageCount,
  rating: b.rating,
  isbn: b.isbn,
})

// All of the user's books, optionally filtered, newest first. Picks the most
// selective index for the filter — same strategy as books.listBooks.
export const listBooksForUser = internalQuery({
  args: {
    userId: v.string(),
    ownership: v.optional(ownershipValidator),
    readStatus: v.optional(readStatusValidator),
  },
  handler: async (ctx, { userId, ownership, readStatus }) => {
    let rows: Doc<"books">[]
    if (ownership) {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", ownership))
        .collect()
    } else if (readStatus) {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user_readStatus", (q) => q.eq("userId", userId).eq("readStatus", readStatus))
        .collect()
    } else {
      rows = await ctx.db
        .query("books")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    }
    if (ownership && readStatus) rows = rows.filter((b) => b.readStatus === readStatus)
    return rows.sort((a, b) => b.addedAt - a.addedAt).map(toMcpBook)
  },
})

// Books currently being read, most-recently-started first.
export const currentlyReadingForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_readStatus", (q) => q.eq("userId", userId).eq("readStatus", "reading"))
      .collect()
    return rows
      .sort((a, b) => (b.startedAt ?? b.addedAt) - (a.startedAt ?? a.addedAt))
      .map(toMcpBook)
  },
})

// The user's wishlist, newest first.
export const wishlistForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", "wishlist"))
      .collect()
    return rows.sort((a, b) => b.addedAt - a.addedAt).map(toMcpBook)
  },
})

// Active library loans (not yet returned), soonest due first. Raw dueDate/
// checkoutDate ms — the action computes days-until with a real clock.
export const activeLoansForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) => q.eq("userId", userId).eq("ownership", "library"))
      .collect()
    return rows
      .filter((b) => b.returned !== true)
      .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
      .map((b) => ({
        title: b.title,
        authors: b.authors,
        readStatus: b.readStatus,
        libraryName: b.libraryName,
        checkoutDate: b.checkoutDate,
        dueDate: b.dueDate,
      }))
  },
})

// The caller's stored IANA timezone (e.g. "America/New_York"), or undefined if
// they haven't synced a profile yet. The action layer uses it to count loan
// due-days on the user's local calendar, not UTC.
export const timeZoneForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique()
    return profile?.timeZone
  },
})

// Default library loan period: 3 weeks. Mirrors books.LOAN_PERIOD_MS — duplicated
// (not imported) because that one is module-private to books.ts. Keep in sync.
const LOAN_PERIOD_MS = 21 * 24 * 60 * 60 * 1000

const normalizeTitle = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

// Compact identifier for an ambiguous-match list — enough for chat to ask the user
// "which one?" without leaking ids.
const briefBook = (b: Doc<"books">) => ({
  title: b.title,
  authors: b.authors,
  ownership: b.ownership,
  readStatus: b.readStatus,
  firstPublishYear: b.firstPublishYear,
})

// Resolve a chat-supplied title (the user says "Dune", not a book id) to the
// matching rows within `rows`. Exact normalized-title match wins; only when there's
// no exact hit do we broaden to substring, so "Dune" lands on "Dune" even when
// "Dune Messiah" is also on the shelf. An optional author narrows the pool first.
// Returns 0 (not found), 1 (act on it), or >1 (ambiguous — let chat disambiguate).
const matchBooksByTitle = (
  rows: Doc<"books">[],
  title: string,
  author?: string,
): Doc<"books">[] => {
  const qt = normalizeTitle(title)
  const qa = author ? normalizeTitle(author) : undefined
  const scoped = qa
    ? rows.filter((b) => b.authors.some((a) => normalizeTitle(a).includes(qa)))
    : rows
  const exact = scoped.filter((b) => normalizeTitle(b.title) === qt)
  if (exact.length) return exact
  return scoped.filter((b) => normalizeTitle(b.title).includes(qt))
}

type MatchResult =
  | { status: "not_found"; title: string }
  | { status: "ambiguous"; matches: ReturnType<typeof briefBook>[] }
  | { status: "ok"; book: Doc<"books"> }

const resolveOne = (rows: Doc<"books">[], title: string, author?: string): MatchResult => {
  const matches = matchBooksByTitle(rows, title, author)
  if (matches.length === 0) return { status: "not_found", title }
  if (matches.length > 1) return { status: "ambiguous", matches: matches.map(briefBook) }
  return { status: "ok", book: matches[0] }
}

// Add a book to any shelf from chat ("add Dune to my wishlist", "add X, I own it",
// "I'm reading Y"). Idempotent on title WITHIN the target shelf: a same-title entry
// already on that shelf returns { status: "exists" } instead of stacking a dup.
// Library adds capture a checkout + a default due date, mirroring books.addBook.
// Bibliographic fields are best-effort — the door enriches via Open Library first,
// falling back to bare title + author.
export const addBookForUser = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    authors: v.array(v.string()),
    isbn: v.optional(v.string()),
    coverId: v.optional(v.number()),
    coverUrlFallback: v.optional(v.string()),
    workKey: v.optional(v.string()),
    firstPublishYear: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    ownership: ownershipValidator,
    readStatus: v.optional(readStatusValidator),
    libraryName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) =>
        q.eq("userId", args.userId).eq("ownership", args.ownership),
      )
      .collect()
    const dup = existing.find((b) => normalizeTitle(b.title) === normalizeTitle(args.title))
    if (dup) return { status: "exists" as const, title: dup.title, ownership: args.ownership }

    const now = Date.now()
    const base = {
      userId: args.userId,
      title: args.title,
      // Normalize on write — the MCP door's OL enrichment emits junk too.
      authors: normalizeAuthors(args.authors),
      isbn: args.isbn,
      coverId: args.coverId,
      coverUrlFallback: args.coverUrlFallback,
      workKey: args.workKey,
      firstPublishYear: sanitizeYear(args.firstPublishYear),
      pageCount: args.pageCount,
      ownership: args.ownership,
      readStatus: args.readStatus ?? ("unread" as const),
      addedAt: now,
    }

    if (args.ownership === "library") {
      await ctx.db.insert("books", {
        ...base,
        checkoutDate: now,
        dueDate: now + LOAN_PERIOD_MS,
        returned: false,
        libraryName: args.libraryName,
      })
    } else {
      await ctx.db.insert("books", base)
    }
    return { status: "added" as const, title: args.title, ownership: args.ownership }
  },
})

// Update a book's reading state from chat ("I finished Dune, 5 stars", "I started
// the Hobbit"). Resolves the book by title across the WHOLE shelf, then applies the
// same transitions as books.updateBook: starting stamps startedAt once, finishing
// stamps finishedAt once. Rating/review are validated by the door (1–5).
export const setReadingStatusForUser = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    readStatus: v.optional(readStatusValidator),
    rating: v.optional(v.number()),
    review: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()
    const match = resolveOne(rows, args.title, args.author)
    if (match.status !== "ok") return match

    const book = match.book
    const now = Date.now()
    const updates: Partial<Doc<"books">> = {}
    if (args.readStatus !== undefined) {
      updates.readStatus = args.readStatus
      if (args.readStatus === "reading" && !book.startedAt) updates.startedAt = now
      if (args.readStatus === "read" && !book.finishedAt) updates.finishedAt = now
    }
    if (args.rating !== undefined) updates.rating = args.rating
    if (args.review !== undefined) updates.review = args.review

    await ctx.db.patch(book._id, updates)
    return {
      status: "updated" as const,
      title: book.title,
      readStatus: updates.readStatus ?? book.readStatus,
      rating: updates.rating ?? book.rating,
    }
  },
})

// Mark an active library loan returned ("I returned the Hobbit"). Scoped to the
// library shelf's un-returned loans, so it never matches an owned copy of the same
// title. Mirrors books.returnBook.
export const returnLoanForUser = internalMutation({
  args: { userId: v.string(), title: v.string(), author: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) =>
        q.eq("userId", args.userId).eq("ownership", "library"),
      )
      .collect()
    const active = rows.filter((b) => b.returned !== true)
    const match = resolveOne(active, args.title, args.author)
    if (match.status !== "ok") return match

    await ctx.db.patch(match.book._id, { returned: true })
    return { status: "returned" as const, title: match.book.title }
  },
})

// Extend an active loan's due date ("renew Dune"). The door computes the absolute
// newDueDate (it has the clock + the user's timezone); this just persists it.
// Mirrors books.renewLoan.
export const renewLoanForUser = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    author: v.optional(v.string()),
    newDueDate: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("books")
      .withIndex("by_user_ownership", (q) =>
        q.eq("userId", args.userId).eq("ownership", "library"),
      )
      .collect()
    const active = rows.filter((b) => b.returned !== true)
    const match = resolveOne(active, args.title, args.author)
    if (match.status !== "ok") return match

    await ctx.db.patch(match.book._id, { dueDate: args.newDueDate, returned: false })
    return { status: "renewed" as const, title: match.book.title, dueDate: args.newDueDate }
  },
})
