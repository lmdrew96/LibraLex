"use client"

import { useState, type ReactNode } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { ArrowLeft, BookPlus, Loader2, ScanBarcode, Search } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { BookSearchResult, Ownership } from "@/lib/types"
import { bookArgs, enrichInBackground } from "@/lib/enrich-on-add"
import { defaultDueDate, dueLabel, fromDateInput, toDateInput } from "@/lib/loans"
import { useBookSearch } from "@/lib/use-book-search"
import { BarcodeScanner } from "@/components/barcode-scanner"
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

type Step = "search" | "scan" | "ownership" | "manual"

export function AddBookDialog({ trigger }: { trigger?: ReactNode }) {
  const addBook = useMutation(api.books.addBook)
  const applyEnrichment = useMutation(api.books.applyEnrichment)

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("search")

  // search state — query is local; results/searching/error come from the shared hook
  const [query, setQuery] = useState("")
  const { results, searching, error: searchError } = useBookSearch(query)

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

  // barcode-scan state
  const [scannedIsbn, setScannedIsbn] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)

  const reset = () => {
    setStep("search")
    setQuery("")
    setSelected(null)
    setLibraryMode(false)
    setCheckoutInput(toDateInput(Date.now()))
    setDueInput(toDateInput(defaultDueDate()))
    setMTitle("")
    setMAuthor("")
    setMYear("")
    setMPages("")
    setScannedIsbn(null)
    setLooking(false)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) reset()
  }

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
      isbn: scannedIsbn ?? undefined,
      firstPublishYear: mYear ? Number(mYear) : undefined,
      pageCount: mPages ? Number(mPages) : undefined,
    })
  }

  // Barcode → ISBN lookup. Drops the match straight into the ownership picker;
  // on a miss, hands off to manual entry with the scanned ISBN preserved.
  const handleScanned = async (isbn: string) => {
    setLooking(true)
    try {
      const res = await fetch(`/api/search?isbn=${encodeURIComponent(isbn)}`)
      const data = (await res.json()) as { results?: BookSearchResult[] }
      const match = data.results?.[0]
      if (match) {
        pick(match)
      } else {
        setScannedIsbn(isbn)
        setStep("manual")
        toast("We couldn't find that book — add its details.", { icon: "📖" })
      }
    } catch {
      setScannedIsbn(isbn)
      setStep("manual")
      toast.error("Lookup failed — add the book's details manually.")
    } finally {
      setLooking(false)
    }
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
      const id = await addBook({ ...bookArgs(selected), ownership, ...extra })
      const where =
        ownership === "owned" ? "your shelf" : ownership === "wishlist" ? "your wishlist" : "your loans"
      toast.success(`Added “${title}” to ${where}.`)
      // Enrich once in the background — the book is already on the shelf.
      void enrichInBackground(id, selected, applyEnrichment)
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
            {step === "ownership"
              ? "Add to which shelf?"
              : step === "manual"
                ? "Add manually"
                : step === "scan"
                  ? "Scan a barcode"
                  : "Add a book"}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {step === "ownership"
              ? "Pick where this book lives."
              : step === "manual"
                ? "For the indie and obscure ones search can't find."
                : step === "scan"
                  ? "Point your camera at the barcode on the back cover."
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
              onScan={() => setStep("scan")}
            />
          )}

          {step === "scan" &&
            (looking ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Loader2 className="h-7 w-7 animate-spin text-teal" />
                <p className="text-sm text-teal">Looking up the scanned book…</p>
              </div>
            ) : (
              <BarcodeScanner onDetected={handleScanned} onManual={() => setStep("search")} />
            ))}

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
              scannedIsbn={scannedIsbn}
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
  onScan,
}: {
  query: string
  setQuery: (v: string) => void
  results: BookSearchResult[]
  searching: boolean
  searchError: string | null
  onPick: (b: BookSearchResult) => void
  onManual: () => void
  onScan: () => void
}) {
  const showEmpty = !searching && query.trim().length >= 2 && results.length === 0 && !searchError
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
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
        <button
          type="button"
          onClick={onScan}
          aria-label="Scan a barcode"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal text-surface transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50"
        >
          <ScanBarcode className="h-5 w-5" />
        </button>
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
  scannedIsbn,
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
  scannedIsbn: string | null
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
      {scannedIsbn && (
        <p className="rounded-xl bg-lavender/40 px-3 py-2 font-mono text-xs text-teal">
          Scanned ISBN {scannedIsbn} — we&apos;ll keep it on the book.
        </p>
      )}
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
