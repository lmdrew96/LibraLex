// Loan due-date math. All comparisons happen on LOCAL calendar-day boundaries —
// never UTC — so "due in N days" never drifts by one across timezones/DST.

const MS_PER_DAY = 24 * 60 * 60 * 1000

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Whole days from today until `dueDate`, on local day boundaries.
 * Positive = days remaining, 0 = due today, negative = overdue by |n| days.
 */
export const daysUntilDue = (dueDate: number, now: number = Date.now()): number =>
  Math.round((startOfLocalDay(dueDate) - startOfLocalDay(now)) / MS_PER_DAY)

export type LoanStatus = "comfortable" | "soon" | "overdue"

/** comfortable (>5 days) · soon (0–5 days) · overdue (<0). Calm, not alarmist. */
export const loanStatus = (dueDate: number, now?: number): LoanStatus => {
  const days = daysUntilDue(dueDate, now)
  if (days < 0) return "overdue"
  if (days <= 5) return "soon"
  return "comfortable"
}

/** Human label for a due date, e.g. "Due in 3 days", "Due today", "Overdue by 2 days". */
export const dueLabel = (dueDate: number, now?: number): string => {
  const days = daysUntilDue(dueDate, now)
  if (days === 0) return "Due today"
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`
  return `Due in ${days} day${days === 1 ? "" : "s"}`
}

/** Default loan period (3 weeks) added to a checkout time. */
export const defaultDueDate = (checkout: number = Date.now()): number =>
  checkout + 21 * MS_PER_DAY

// ── <input type="date"> bridges — always LOCAL, never UTC parsing ──────────────

/** ms-epoch → "YYYY-MM-DD" in local time (for an <input type="date"> value). */
export const toDateInput = (ms: number): string => {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** "YYYY-MM-DD" → ms-epoch at LOCAL midnight (avoids the UTC off-by-one of `new Date(str)`). */
export const fromDateInput = (value: string): number => {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d).getTime()
}
