import { describe, expect, it } from "vitest"
import {
  moreLikeThis,
  moreLikeThisFromPool,
  recommendForYou,
  recommendFromPool,
  readNext,
  tasteSourceCount,
  tokenize,
  topTasteSubjects,
  type RecBook,
} from "./recommend"

// Terse fixture builder — sensible defaults so each test states only what matters.
const book = (over: Partial<RecBook> & { _id: string; title: string }): RecBook => ({
  authors: [],
  subjects: [],
  ownership: "owned",
  readStatus: "unread",
  ...over,
})

describe("tokenize", () => {
  it("namespaces, lowercases, dedupes, and buckets", () => {
    const toks = tokenize({
      subjects: ["Fantasy", "fantasy", " Magic "],
      authors: ["J.R.R. Tolkien"],
      firstPublishYear: 1954,
      pageCount: 423,
    })
    expect(toks).toContain("subj:fantasy")
    expect(toks).toContain("subj:magic")
    expect(toks).toContain("author:j.r.r. tolkien")
    expect(toks).toContain("decade:1950s")
    expect(toks).toContain("len:medium") // 250–500 pages
    expect(toks.filter((t) => t === "subj:fantasy")).toHaveLength(1) // deduped
  })

  it("buckets length and drops empty/invalid fields", () => {
    expect(tokenize({ pageCount: 120 })).toContain("len:short")
    expect(tokenize({ pageCount: 800 })).toContain("len:long")
    expect(tokenize({ pageCount: 0 })).toEqual([]) // no signal at all
  })
})

describe("topTasteSubjects", () => {
  it("ranks subjects by rating-weighted frequency over taste sources", () => {
    const lib = [
      book({ _id: "1", title: "A", subjects: ["fantasy", "magic"], readStatus: "read", rating: 5 }),
      book({ _id: "2", title: "B", subjects: ["fantasy"], readStatus: "read", rating: 4 }),
      book({ _id: "3", title: "C", subjects: ["mystery"], readStatus: "read", rating: 1 }),
      book({ _id: "4", title: "D", subjects: ["scifi"], readStatus: "unread" }), // not a taste source
    ]
    const top = topTasteSubjects(lib, 4)
    expect(top[0]).toBe("fantasy") // 2.0 + 1.5
    expect(top).toContain("magic") // 2.0
    expect(top).toContain("mystery") // 0.25
    expect(top).not.toContain("scifi") // unread owned, includeWishlist=false
  })
})

describe("recommendForYou", () => {
  it("ranks unread owned/wishlist by taste and explains the match", () => {
    const lib = [
      book({ _id: "r1", title: "Loved Fantasy", subjects: ["fantasy", "dragons"], readStatus: "read", rating: 5 }),
      book({ _id: "c1", title: "New Dragon Book", subjects: ["fantasy", "dragons"], readStatus: "unread" }),
      book({ _id: "c2", title: "Cookbook", subjects: ["cooking"], readStatus: "unread" }),
    ]
    const recs = recommendForYou(lib)
    expect(recs[0].book._id).toBe("c1")
    expect(recs[0].explanation).toContain("Loved Fantasy")
    expect(recs.find((r) => r.book._id === "c2")).toBeUndefined() // shares nothing → score 0
  })

  it("returns nothing without a taste signal (cold start)", () => {
    const lib = [book({ _id: "c1", title: "X", subjects: ["fantasy"], readStatus: "unread" })]
    expect(recommendForYou(lib)).toEqual([])
  })
})

describe("moreLikeThis", () => {
  it("finds nearest neighbours by shared content, no ratings needed", () => {
    const lib = [
      book({ _id: "t", title: "Target", subjects: ["space", "robots"] }),
      book({ _id: "near", title: "Near", subjects: ["space", "robots"] }),
      book({ _id: "far", title: "Far", subjects: ["romance"] }),
    ]
    const out = moreLikeThis("t", lib)
    expect(out[0].book._id).toBe("near")
    expect(out.find((r) => r.book._id === "far")).toBeUndefined()
  })
})

describe("recommendFromPool", () => {
  it("ranks an off-shelf pool by taste, folding in wishlist signal", () => {
    const library = [
      book({ _id: "w", title: "Wished SciFi", subjects: ["scifi", "space"], ownership: "wishlist", readStatus: "unread" }),
    ]
    const pool = [
      { title: "Space Opera", subjects: ["scifi", "space"] },
      { title: "Garden Guide", subjects: ["gardening"] },
    ]
    const ranked = recommendFromPool(library, pool)
    expect(ranked[0].book.title).toBe("Space Opera")
    expect(ranked[0].sharedSubjects).toContain("scifi")
    expect(ranked.find((r) => r.book.title === "Garden Guide")).toBeUndefined()
  })

  it("returns nothing when there's no taste yet", () => {
    const library = [book({ _id: "u", title: "Unread Owned", subjects: ["scifi"], readStatus: "unread" })]
    expect(recommendFromPool(library, [{ title: "X", subjects: ["scifi"] }])).toEqual([])
  })
})

describe("moreLikeThisFromPool", () => {
  it("ranks a pool by similarity to one target book", () => {
    const library = [book({ _id: "l", title: "Lib", subjects: ["history"] })]
    const target = { subjects: ["history", "war"] }
    const pool = [
      { title: "WWII", subjects: ["history", "war"] },
      { title: "Baking", subjects: ["cooking"] },
    ]
    const ranked = moreLikeThisFromPool(target, library, pool)
    expect(ranked[0].book.title).toBe("WWII")
    expect(ranked.find((r) => r.book.title === "Baking")).toBeUndefined()
  })
})

describe("readNext", () => {
  it("floats a soon-due library loan that also matches taste", () => {
    const now = new Date(2025, 5, 15, 12).getTime()
    const lib = [
      book({ _id: "read", title: "Loved", subjects: ["fantasy"], readStatus: "read", rating: 5 }),
      book({ _id: "owned", title: "Owned Fantasy", subjects: ["fantasy"], readStatus: "unread" }),
      book({
        _id: "loan",
        title: "Due Soon Fantasy",
        subjects: ["fantasy"],
        readStatus: "unread",
        ownership: "library",
        dueDate: new Date(2025, 5, 17, 12).getTime(), // 2 days out
      }),
    ]
    const picks = readNext(lib, now)
    expect(picks[0].book._id).toBe("loan")
    expect(picks[0].urgency).toBeGreaterThan(0)
  })
})

describe("tasteSourceCount", () => {
  it("counts read + reading books", () => {
    const lib = [
      book({ _id: "1", title: "A", readStatus: "read" }),
      book({ _id: "2", title: "B", readStatus: "reading" }),
      book({ _id: "3", title: "C", readStatus: "unread" }),
    ]
    expect(tasteSourceCount(lib)).toBe(2)
  })
})
