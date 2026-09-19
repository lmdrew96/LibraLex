import { describe, expect, it } from "vitest"
import { isSameBook, pickTitleMatch } from "@/convex/googleBooks"

const vol = (title: string, thumbnail?: string) => ({ title, thumbnail })

describe("pickTitleMatch", () => {
  it("ignores volumes whose title doesn't match", () => {
    expect(pickTitleMatch([vol("Something Else", "x")], "The Martian")).toBeNull()
  })

  it("takes the first title match by default, cover or not", () => {
    const v = [vol("The Silent Patient"), vol("The Silent Patient", "cover")]
    expect(pickTitleMatch(v, "The Silent Patient")?.thumbnail).toBeUndefined()
  })

  it("prefers a matching volume that has a cover when asked", () => {
    const v = [vol("Nimona"), vol("Unrelated", "nope"), vol("Nimona", "cover")]
    expect(pickTitleMatch(v, "Nimona", { prefer: (v) => Boolean(v.thumbnail) })?.thumbnail).toBe("cover")
  })

  it("still returns a cover-less match when none has a cover", () => {
    const v = [vol("Monstress. Volume 1")]
    expect(pickTitleMatch(v, "Monstress, Vol. 1", { prefer: (v) => Boolean(v.thumbnail) })?.title).toBe("Monstress. Volume 1")
  })
})

import { sharperGoogleCover } from "@/components/book-cover"

describe("sharperGoogleCover", () => {
  const stored =
    "https://books.google.com/books/content?id=P8i2DwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api"

  it("asks Google for a wider render and drops the page curl", () => {
    const u = new URL(sharperGoogleCover(stored, 400)!)
    expect(u.searchParams.get("fife")).toBe("w400")
    expect(u.searchParams.has("edge")).toBe(false)
    expect(u.searchParams.get("id")).toBe("P8i2DwAAQBAJ")
  })

  it("leaves non-Google covers alone", () => {
    expect(sharperGoogleCover("https://is1-ssl.mzstatic.com/image/cover.jpg", 400)).toBeNull()
    expect(sharperGoogleCover("not a url", 400)).toBeNull()
  })
})

describe("isSameBook", () => {
  it("matches the same title + author regardless of punctuation/case", () => {
    expect(
      isSameBook(
        { title: "Harry Potter and the Philosopher's Stone", authors: ["J. K. Rowling"] },
        { title: "Harry Potter and the Philosophers Stone", authors: ["J.K. Rowling"] },
      ),
    ).toBe(true)
  })

  it("rejects a different book with an overlapping title", () => {
    expect(
      isSameBook({ title: "Dune", authors: ["Frank Herbert"] }, { title: "Dune Messiah", authors: ["Frank Herbert"] }),
    ).toBe(false)
  })

  it("rejects the same title by a different author", () => {
    expect(
      isSameBook({ title: "Speak", authors: ["Laurie Halse Anderson"] }, { title: "Speak", authors: ["Louisa Hall"] }),
    ).toBe(false)
  })
})
