# LibraLex

Your shelf, digitized — a personal book catalog that tracks what you **own**, **want**, and **borrow from the library**. The library-loan tracking (due dates, overdue states, renew/return) is the thing Goodreads and StoryGraph don't do.

Production target: **libra.adhdesigns.dev** · ChaosPatch slug: `chaosshelf`

## Stack

- **Next.js 16** (App Router, Turbopack) · React 19 · TypeScript strict
- **Convex** — realtime DB + serverless functions (`books` + `users`/`friendships`/`recommendations`/`dismissedBooks`)
- **Clerk** — auth (shared ADHDesigns instance)
- **Tailwind v4** + ADHDesigns brand theme
- Open Library (primary) + Google Books (cover fallback) for search/autofill

## Architecture

```
app/
  page.tsx                Shelf (home) — owned books, status filter, sort, "Read next" card
  search/page.tsx         Search the catalog + browse popular books by favorite genre
  history/page.tsx        Reading / Read tabs across every shelf (your nightstand + log)
  wishlist/page.tsx       Wishlist — one-tap "I got this" → owned
  loans/page.tsx          Library Loans — due states, return, renew  ← the differentiator
  recs/page.tsx           Recommendations — for-you · friends' shelves · catalog discovery + friend-sent inbox
  friends/page.tsx        Friends — codes, requests; friends/[friendId] views a friend's shelf
  author/[name]/page.tsx  An author's catalog (popular-first)
  book/[id]/page.tsx      Detail + edit (autosave: status, rating, finish date, review, ownership, cover, delete)
  add/[code]/page.tsx     Friend-code deep link (add-by-shared-link)
  settings/page.tsx       Theme · favorite genres · MCP connection link · reading-history maintenance
  login, signup           Clerk auth pages
  api/search/route.ts     Server-side Open Library + Google Books search (+ author lookup)
  api/book-info/route.ts  On-demand enrichment for the detail view (cache-miss fallback)
  api/enrich/route.ts     Re-run the enrich pipeline for one book ("Re-fetch metadata")
  api/discover/route.ts   Catalog discovery feed (taste-subject expansion)
  icon · apple-icon · opengraph-image · manifest   Generated brand assets (next/og)
  error · not-found · global-error                  Branded error boundaries
convex/
  schema.ts             books + users + friendships + recommendations + dismissedBooks (+ indexes)
  books.ts              queries (list/get/loans) + mutations (CRUD, checkout/renew/return, cover upload, community rating)
  friends.ts            friend requests, accept/decline, remove; the areFriends gate
  shelf.ts              getFriendShelf — a friend's shelf, loan logistics stripped
  recs.ts               friend-sent recommendation inbox (send / add-to-shelf / dismiss)
  discover.ts           friend-candidate pool + "not interested" dismissals + shared rec helpers
  mcpData.ts            internal data layer for the MCP door (compact, chat-friendly shapes)
  http.ts               the MCP server — hand-rolled JSON-RPC 2.0, per-user token auth (16 tools)
  mcpAuth.ts            mint / resolve / revoke the per-user MCP token
  enrich.ts · normalize.ts · backfill.ts   enrich-once pipeline + monotonic data cleanup
  users.ts              profile sync (display name, friend code, timezone, favorite genres)
  util.ts               shared auth helpers + LOAN_PERIOD_MS
  auth.config.ts        Clerk JWT validation (CLERK_JWT_ISSUER_DOMAIN)
components/
  book-cover.tsx        renders covers by Open Library coverId (rate-limit-free) → fallback → placeholder
  add-book-dialog.tsx   search → ownership picker → save (with manual-entry escape hatch + barcode scan)
  app-shell.tsx         header + nav (loans / friends / recs badges), profile sync
  discover-picks · friend-picks · recommended-for-you · read-next · more-like-this · genre-browse
  book-card · book-grid · empty-state · ui/* (button, dialog, skeleton, confirm-dialog)
lib/
  loans.ts              due-date math on LOCAL day boundaries (no UTC off-by-one) + LOAN_PERIOD_MS
  recommend.ts          content-based recommender engine (TF-IDF + cosine, pure, no LLM)
  genres.ts             curated genre list → Open Library subjects
  enrich-on-add.ts · book-key.ts · types.ts · utils.ts · use-*.ts hooks
```

All Convex functions are auth-scoped (`identity.tokenIdentifier`); the MCP door resolves its own per-user token before any read. Queries return empty/null before auth resolves; mutations throw.

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
