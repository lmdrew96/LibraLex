"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { ArrowLeft, BookPlus, Search } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookSearchResult, Ownership } from "@/lib/types"
import { defaultDueDate, dueLabel, fromDateInput, toDateInput } from "@/lib/loans"
import { BookCover } from "@/components/book-cover"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

type Step = "search" | "ownership" | "manual"

// Map a search result to the addBook mutation's bibliographic args.
const bookArgs = (b: BookSearchResult) => ({
  title: b.title,
  authors: b.authors,
  isbn: b.isbn,
  coverId: b.coverId,
  coverUrlFallback: b.coverUrlFallback,
  workKey: b.workKey,
  firstPublishYear: b.firstPublishYear,
  pageCount: b.pageCount,
})

export function AddBookDialog({ trigger }: { trigger?: ReactNode }) {
  const addBook = useMutation(api.books.addBook)

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("search")

  // search state
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<BookSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // selection + library checkout state
  const [selected, setSelected] = useState<BookSearchResult | null>(null)
  const [libraryMode, setLibraryMode] = useState(false)
  const [checkoutInput, setCheckoutInput] = useState(toDateInput(Date.now()))
  const [dueInput, setDueInput] = useState(toDateInput(defaultDueDate()))
  const [saving, setSaving] = useState(false)

  // manual-entry fields
  const [mTitle, setMTitle] = useState("")
  const [mAuthor, setMAuthor] = useState("")
  const [mYear, setMYear] = useState("")
  const [mPages, setMPages] = useState("")

  const reset = () => {
    setStep("search")
    setQuery("")
    setResults([])
    setSearching(false)
    setSearchError(null)
    setSelected(null)
    setLibraryMode(false)
    setCheckoutInput(toDateInput(Date.now()))
    setDueInput(toDateInput(defaultDueDate()))
    setMTitle("")
    setMAuthor("")
    setMYear("")
    setMPages("")
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) reset()
  }

  // Debounced search (~300ms). Aborts the in-flight request when the query moves on.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }
    setSearching(true)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        })
        const data = (await res.json()) as { results?: BookSearchResult[]; error?: string }
        if (!res.ok) {
          setResults([])
          setSearchError(data.error ?? "Search is unavailable right now.")
        } else {
          setResults(data.results ?? [])
          setSearchError(null)
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setSearchError("Search failed. Check your connection.")
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  const pick = (book: BookSearchResult) => {
    setSelected(book)
    setLibraryMode(false)
    setCheckoutInput(toDateInput(Date.now()))
    setDueInput(toDateInput(defaultDueDate()))
    setStep("ownership")
  }

  const submitManual = () => {
    const title = mTitle.trim()
    const author = mAuthor.trim()
    if (!title || !author) return
    pick({
      title,
      authors: [author],
      firstPublishYear: mYear ? Number(mYear) : undefined,
      pageCount: mPages ? Number(mPages) : undefined,
    })
  }

  const save = async (ownership: Ownership) => {
    if (!selected || saving) return
    setSaving(true)
    const title = selected.title
    const extra =
      ownership === "library"
        ? {
            checkoutDate: fromDateInput(checkoutInput),
            dueDate: fromDateInput(dueInput),
          }
        : {}
    // Close optimistically — Convex's live query lands the book on the shelf.
    handleOpenChange(false)
    try {
      await addBook({ ...bookArgs(selected), ownership, ...extra })
      const where =
        ownership === "owned" ? "your shelf" : ownership === "wishlist" ? "your wishlist" : "your loans"
      toast.success(`Added “${title}” to ${where}.`)
    } catch {
      toast.error(`Couldn't add “${title}”. Try again.`)
    } finally {
      setSaving(false)
    }
  }

  const defaultTrigger = (
    <Button>
      <BookPlus className="h-5 w-5" />
      Add book
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent>
        {/* Header */}
        <div className="border-b border-lavender px-6 pb-4 pt-6">
          {step !== "search" && (
            <button
              onClick={() => setStep("search")}
              className="mb-2 inline-flex items-center gap-1 text-sm text-teal hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to search
            </button>
          )}
          <DialogTitle>
            {step === "ownership" ? "Add to which shelf?" : step === "manual" ? "Add manually" : "Add a book"}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {step === "ownership"
              ? "Pick where this book lives."
              : step === "manual"
                ? "For the indie and obscure ones search can't find."
                : "Search by title or author — covers and details fill in automatically."}
          </DialogDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "search" && (
            <SearchStep
              query={query}
              setQuery={setQuery}
              results={results}
              searching={searching}
              searchError={searchError}
              onPick={pick}
              onManual={() => setStep("manual")}
            />
          )}

          {step === "ownership" && selected && (
            <OwnershipStep
              book={selected}
              libraryMode={libraryMode}
              setLibraryMode={setLibraryMode}
              checkoutInput={checkoutInput}
              setCheckoutInput={(v) => {
                setCheckoutInput(v)
                setDueInput(toDateInput(defaultDueDate(fromDateInput(v))))
              }}
              dueInput={dueInput}
              setDueInput={setDueInput}
              saving={saving}
              onSave={save}
            />
          )}

          {step === "manual" && (
            <ManualStep
              title={mTitle}
              setTitle={setMTitle}
              author={mAuthor}
              setAuthor={setMAuthor}
              year={mYear}
              setYear={setMYear}
              pages={mPages}
              setPages={setMPages}
              onSubmit={submitManual}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Step: search ────────────────────────────────────────────────────────────
function SearchStep({
  query,
  setQuery,
  results,
  searching,
  searchError,
  onPick,
  onManual,
}: {
  query: string
  setQuery: (v: string) => void
  results: BookSearchResult[]
  searching: boolean
  searchError: string | null
  onPick: (b: BookSearchResult) => void
  onManual: () => void
}) {
  const showEmpty = !searching && query.trim().length >= 2 && results.length === 0 && !searchError
  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-teal" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or author…"
          className="h-12 w-full rounded-full border border-lavender bg-card pl-12 pr-4 text-base text-ink placeholder:text-teal/60 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
        />
      </div>

      {searching && (
        <ul className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-16 w-11 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {searchError && <p className="text-sm text-[var(--color-overdue)]">{searchError}</p>}

      {!searching && results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((b, i) => (
            <li key={`${b.workKey ?? b.title}-${i}`}>
              <button
                onClick={() => onPick(b)}
                className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-lavender/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
              >
                <div className="w-11 shrink-0">
                  <BookCover coverId={b.coverId} coverUrlFallback={b.coverUrlFallback} title={b.title} size="S" />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{b.title}</span>
                  <span className="block truncate text-sm text-teal">
                    {b.authors[0] ?? "Unknown author"}
                    {b.firstPublishYear ? ` · ${b.firstPublishYear}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showEmpty && (
        <p className="text-sm text-teal">No matches found. Try a different search, or add it manually.</p>
      )}

      <button
        onClick={onManual}
        className="mt-1 self-start text-sm font-medium text-teal underline-offset-4 hover:underline"
      >
        Can&apos;t find it? Add manually →
      </button>
    </div>
  )
}

// ── Step: ownership ─────────────────────────────────────────────────────────
function OwnershipStep({
  book,
  libraryMode,
  setLibraryMode,
  checkoutInput,
  setCheckoutInput,
  dueInput,
  setDueInput,
  saving,
  onSave,
}: {
  book: BookSearchResult
  libraryMode: boolean
  setLibraryMode: (v: boolean) => void
  checkoutInput: string
  setCheckoutInput: (v: string) => void
  dueInput: string
  setDueInput: (v: string) => void
  saving: boolean
  onSave: (ownership: Ownership) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <div className="w-16 shrink-0">
          <BookCover coverId={book.coverId} coverUrlFallback={book.coverUrlFallback} title={book.title} size="M" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-ink">{book.title}</p>
          <p className="text-sm text-teal">
            {book.authors[0] ?? "Unknown author"}
            {book.firstPublishYear ? ` · ${book.firstPublishYear}` : ""}
          </p>
        </div>
      </div>

      {!libraryMode ? (
        <div className="flex flex-col gap-2.5">
          <Button variant="primary" size="md" className="w-full" disabled={saving} onClick={() => onSave("owned")}>
            I own this
          </Button>
          <Button variant="calm" size="md" className="w-full" disabled={saving} onClick={() => onSave("wishlist")}>
            Add to wishlist
          </Button>
          <Button variant="outline" size="md" className="w-full" disabled={saving} onClick={() => setLibraryMode(true)}>
            Borrowed from the library
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border border-lavender bg-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-teal">Checked out</span>
              <input
                type="date"
                value={checkoutInput}
                onChange={(e) => setCheckoutInput(e.target.value)}
                className="h-11 rounded-xl border border-lavender bg-surface px-3 text-ink focus:border-teal focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-teal">Due back</span>
              <input
                type="date"
                value={dueInput}
                onChange={(e) => setDueInput(e.target.value)}
                className="h-11 rounded-xl border border-lavender bg-surface px-3 text-ink focus:border-teal focus:outline-none"
              />
            </label>
          </div>
          <p className="text-sm text-teal">{dueLabel(fromDateInput(dueInput))} · 3-week default, editable.</p>
          <Button variant="primary" className="w-full" disabled={saving} onClick={() => onSave("library")}>
            Add to library loans
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Step: manual entry ──────────────────────────────────────────────────────
function ManualStep({
  title,
  setTitle,
  author,
  setAuthor,
  year,
  setYear,
  pages,
  setPages,
  onSubmit,
}: {
  title: string
  setTitle: (v: string) => void
  author: string
  setAuthor: (v: string) => void
  year: string
  setYear: (v: string) => void
  pages: string
  setPages: (v: string) => void
  onSubmit: () => void
}) {
  const inputClass =
    "h-11 w-full rounded-xl border border-lavender bg-card px-3 text-ink placeholder:text-teal/50 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/30"
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-teal">
        Title <span className="text-[var(--color-overdue)]">*</span>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} required />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-teal">
        Author <span className="text-[var(--color-overdue)]">*</span>
        <input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputClass} required />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-teal">
          Year
          <input
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
            className={inputClass}
            placeholder="2024"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-teal">
          Pages
          <input
            inputMode="numeric"
            value={pages}
            onChange={(e) => setPages(e.target.value.replace(/\D/g, ""))}
            className={inputClass}
            placeholder="320"
          />
        </label>
      </div>
      <Button type="submit" className="mt-2 w-full" disabled={!title.trim() || !author.trim()}>
        Continue
      </Button>
    </form>
  )
}
