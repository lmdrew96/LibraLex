# LibraLex

Your shelf, digitized — a personal book catalog that tracks what you **own**, **want**, and **borrow from the library**. The library-loan tracking (due dates, overdue states, renew/return) is the thing Goodreads and StoryGraph don't do.

Production target: **libra.adhdesigns.dev** · ChaosPatch slug: `chaosshelf`

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript strict
- **Convex** — realtime DB + serverless functions (single `books` table)
- **Clerk** — auth (shared ADHDesigns instance)
- **Tailwind v4** + ADHDesigns brand theme
- Open Library (primary) + Google Books (cover fallback) for search/autofill

## Architecture

```
app/
  page.tsx              Shelf (home) — owned books, filter chips, sort
  reading/page.tsx      Currently Reading (readStatus: "reading", all shelves)
  wishlist/page.tsx     Wishlist — one-tap "I got this" → owned
  loans/page.tsx        Library Loans — due states, return, renew  ← the differentiator
  book/[id]/page.tsx    Detail + edit (autosave: status, rating, review, ownership, delete)
  login, signup         Clerk auth pages
  api/search/route.ts   Server-side Open Library + Google Books search
convex/
  schema.ts             single denormalized `books` table + 4 indexes
  books.ts              queries (listBooks/getBook/listLoans) + mutations (CRUD/checkout/renew/return)
  auth.config.ts        Clerk JWT validation (CLERK_JWT_ISSUER_DOMAIN)
components/
  book-cover.tsx        renders covers by Open Library coverId (rate-limit-free) → fallback → placeholder
  add-book-dialog.tsx   search → ownership picker → save (with manual-entry escape hatch)
  app-shell.tsx         header + nav (loans due-soon badge)
  book-card, book-grid, empty-state, ui/*
lib/
  loans.ts              due-date math on LOCAL day boundaries (no UTC off-by-one)
  types.ts, utils.ts
```

All Convex functions are auth-scoped (`identity.tokenIdentifier`). Queries return empty/null before auth resolves; mutations throw.

## Local development

```bash
pnpm install
npx convex dev          # runs the backend, regenerates convex/_generated, watches for changes
pnpm dev                # in a second terminal — http://localhost:3000
```

`.env.local` (gitignored) needs Clerk keys + the Convex vars (`npx convex dev` writes the Convex ones for you). See `.env.example`. Local dev currently uses a **local Convex deployment** and the shared ADHDesigns Clerk dev instance (`enhanced-shad-4`).

The Convex deployment also needs the Clerk issuer set:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://enhanced-shad-4.clerk.accounts.dev
```

### Cover search

Open Library `cover_i` ids render covers with no rate limit (primary path). Google Books backfills covers OL lacks — keyless requests share a daily quota (HTTP 429 when exhausted), at which point those books just show a styled placeholder. Set `GOOGLE_BOOKS_API_KEY` to raise the limit; no code change needed.

## Deploy (pending)

1. **Convex prod:** `npx convex deploy` → set `CLERK_JWT_ISSUER_DOMAIN` on the prod deployment.
2. **Clerk:** add `libra.adhdesigns.dev` to allowed origins/redirects on the shared instance.
3. **Vercel:** new project, add the `libra.adhdesigns.dev` domain, set env vars (Convex prod URL, Clerk keys, optional Google Books key).
