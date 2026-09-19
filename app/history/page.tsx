import { redirect } from "next/navigation"

// Folded into the Shelf page in v0.50 — kept so old links and bookmarks land.
export default function HistoryRedirect(): never {
  redirect("/?view=history")
}
