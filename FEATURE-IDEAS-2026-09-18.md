# LibraLex — New Feature Recommendations

**Date:** 2026-09-18 · **Version reviewed:** v0.42.0
**Source:** Feature audit (ChaosPatch `libralex` → "feature audit"). Fixes to _existing_ features were filed as patches tagged `audit-2026-09`; this file is only for _new_ features.

Every idea here builds on something LibraLex already has. Ranked by value-for-effort.

| # | Feature | Effort | Priority |
|---|---|---|---|
| 1 | Reading stats / year-in-review page | Half-day | High |
| 2 | Goodreads/StoryGraph import + library export | Multi-day | High |
| 3 | Loan due-date reminders | Multi-day | Medium-high |
| 4 | Lending tracker ("lent to Maya") | Multi-day | Medium |
| 5 | Sent-recs outbox + outcomes | Half-day | Medium |
| 6 | MCP parity tools | Half-day | Medium |
| 7 | Friend activity feed | Half-day–multi-day | Medium |
| 8 | Reading progress + re-read log | Half-day / multi-day | Low-medium |
| 9 | Annual reading goal | Quick (after #1) | Low |

---

## 1. Reading stats / year-in-review page

**What:** A web Stats page showing books and pages read this year, rating distribution, and counts for currently reading and to-read.

**Why it fits:** The math already exists. `readingStatsForUser` computes it for the MCP (`convex/mcpData.ts:402-448`). The web UI even mentions "read this year" stats in Settings and on the book page, but there's nowhere to see them. Exposing it is mostly a public query plus one page.

**Depends on:** the timezone patch ("Use local timezone for finish dates…") so year boundaries are right.

## 2. Goodreads/StoryGraph CSV import + library export

**What:** Bulk import from a Goodreads or StoryGraph export, bringing in shelves, ratings and finish dates. Also a one-click export of your library for backup.

**Why it fits:** `undateReadBooks` in Settings exists because entering a back-catalog by hand is painful and skews the stats. Import solves that at the source. Imported books would run through the existing enrich/embed pipeline, and `seedAllTasteVectors` would seed recommendations immediately. Export gives users a way to take their data with them.

**Depends on:** the web-dedupe and enrich-every-add-path patches, or an import will create duplicates and books with no embeddings.

## 3. Loan due-date reminders

**What:** A daily cron that sends "due in 2 days" and "overdue" notifications, by web push (now possible with the PWA service worker) or by email.

**Why it fits:** `users.timeZone` is already stored for exactly this kind of local-day math (`convex/http.ts:269-287`). Right now the only signal is a badge in the nav, and only if you open the app. Remembering due dates for you is the most ADHD-relevant feature on this list.

## 4. Lending tracker ("lent to Maya")

**What:** Track owned books you've lent out: who has it and when you want it back.

**Why it fits:** It's the mirror image of library loans. The due-date UI and `lib/loans` math can be reused, and the borrower can link to a friend profile.

## 5. Sent-recs outbox + outcomes

**What:** Senders can see what they recommended and whether the friend added it, read it, or rated it.

**Why it fits:** Right now recs are deleted when accepted or dismissed (`convex/recs.ts:149,160`), so the sender never finds out what happened. Keeping a status instead of deleting closes that loop.

## 6. MCP parity tools

**What:** New tools for the Claude connector:
- `find_book`: "Have I read X?" without dumping the whole `list_books`
- `friend_shelf`: "What's Maya reading?"
- `remove_book`
- `not_interested`
- `ask_for_a_book`: semantic catalog search via `convex/search.ts`
- `set_finish_date`

(Accept/dismiss rec tools are already filed as a patch.)

**Why it fits:** The MCP is a core feature, and each of these wraps logic that already exists on the web side.

## 7. Friend activity feed

**What:** "Maya finished _X_, 5★" and "Sam started _Y_."

**Why it fits:** The data is already on friends' book rows (`startedAt`, `finishedAt`, `rating`, `review`), and privacy is already respected through `hiddenShelfSet`. It gives people a reason to open the app beyond the rec inbox.

**ND note:** make it a calm "since you last looked" list, not an infinite scroll or engagement bait.

## 8. Reading progress + re-read log

**What:** Current page or % for books you're reading, plus a log of start/finish dates for each time you read a book.

**Why it fits:** `pageCount` is already stored and the Reading nightstand exists. The read log is the full fix for the re-read patch and makes pages-read stats accurate.

## 9. Annual reading goal

**What:** Set a books-per-year target and track progress on the Stats page.

**Why it fits:** A small add-on to #1 that reuses `booksReadThisYear`.

**ND note:** frame it as optional and non-punishing. No streaks and no "you're behind" guilt.
