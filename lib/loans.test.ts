import { afterEach, describe, expect, it } from "vitest"
import {
  daysUntilDue,
  defaultDueDate,
  dueLabel,
  fromDateInput,
  LOAN_PERIOD_MS,
  loanStatus,
  toDateInput,
} from "./loans"

// Loan math is all LOCAL-calendar-day arithmetic, so the bugs it can grow are
// timezone/DST drift. Node re-reads process.env.TZ on each Date call (via tzset),
// so swapping the zone around a block genuinely exercises a different offset.
const ORIGINAL_TZ = process.env.TZ
const withTZ = (tz: string, fn: () => void): void => {
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = ORIGINAL_TZ
  }
}
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})

// A range of offsets: UTC, US Eastern (DST), India (+5:30, no DST), and +14.
const ZONES = ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Kiritimati"]

// Local-midday epoch for a Y-M-D in the *current* process TZ (midday avoids any
// ambiguity right at a DST jump; the functions normalize to local midnight anyway).
const localNoon = (y: number, m: number, d: number): number =>
  new Date(y, m - 1, d, 12, 0, 0, 0).getTime()

describe("daysUntilDue", () => {
  it("is 0 for the same calendar day regardless of clock time, in every zone", () => {
    for (const tz of ZONES)
      withTZ(tz, () => {
        const now = new Date(2025, 5, 15, 9, 30).getTime()
        expect(daysUntilDue(new Date(2025, 5, 15, 23, 0).getTime(), now)).toBe(0)
        expect(daysUntilDue(new Date(2025, 5, 15, 0, 5).getTime(), now)).toBe(0)
      })
  })

  it("counts whole local days ahead and behind, in every zone", () => {
    for (const tz of ZONES)
      withTZ(tz, () => {
        const now = localNoon(2025, 6, 15)
        expect(daysUntilDue(localNoon(2025, 6, 18), now)).toBe(3)
        expect(daysUntilDue(localNoon(2025, 6, 14), now)).toBe(-1)
        expect(daysUntilDue(localNoon(2025, 7, 6), now)).toBe(21)
      })
  })

  it("does not drift across the US spring-forward boundary (23-hour day)", () => {
    withTZ("America/New_York", () => {
      // 2025-03-09 02:00 → 03:00. Mar 8 → Mar 12 is still 4 calendar days.
      expect(daysUntilDue(localNoon(2025, 3, 12), localNoon(2025, 3, 8))).toBe(4)
    })
  })

  it("does not drift across the US fall-back boundary (25-hour day)", () => {
    withTZ("America/New_York", () => {
      // 2025-11-02 02:00 → 01:00. Oct 31 → Nov 4 is still 4 calendar days.
      expect(daysUntilDue(localNoon(2025, 11, 4), localNoon(2025, 10, 31))).toBe(4)
    })
  })
})

describe("loanStatus", () => {
  it("classifies overdue / soon / comfortable on local-day boundaries", () => {
    withTZ("America/New_York", () => {
      const now = localNoon(2025, 6, 15)
      expect(loanStatus(localNoon(2025, 6, 14), now)).toBe("overdue") // -1
      expect(loanStatus(localNoon(2025, 6, 15), now)).toBe("soon") // 0 — due today
      expect(loanStatus(localNoon(2025, 6, 20), now)).toBe("soon") // 5 — boundary
      expect(loanStatus(localNoon(2025, 6, 21), now)).toBe("comfortable") // 6
    })
  })
})

describe("dueLabel", () => {
  it("signs and pluralizes the human label", () => {
    withTZ("UTC", () => {
      const now = localNoon(2025, 6, 15)
      expect(dueLabel(localNoon(2025, 6, 15), now)).toBe("Due today")
      expect(dueLabel(localNoon(2025, 6, 16), now)).toBe("Due in 1 day")
      expect(dueLabel(localNoon(2025, 6, 18), now)).toBe("Due in 3 days")
      expect(dueLabel(localNoon(2025, 6, 14), now)).toBe("Overdue by 1 day")
      expect(dueLabel(localNoon(2025, 6, 13), now)).toBe("Overdue by 2 days")
    })
  })
})

describe("defaultDueDate", () => {
  it("is exactly the loan period after checkout and reads as 21 days out", () => {
    withTZ("UTC", () => {
      const checkout = localNoon(2025, 6, 1)
      expect(defaultDueDate(checkout)).toBe(checkout + LOAN_PERIOD_MS)
      expect(daysUntilDue(defaultDueDate(checkout), checkout)).toBe(21)
    })
  })
})

describe("date-input bridges", () => {
  it("round-trips YYYY-MM-DD at LOCAL midnight in every zone (no UTC off-by-one)", () => {
    for (const tz of ZONES)
      withTZ(tz, () => {
        const ms = fromDateInput("2025-06-15")
        expect(toDateInput(ms)).toBe("2025-06-15")
        const d = new Date(ms)
        expect(d.getHours()).toBe(0)
        expect(d.getFullYear()).toBe(2025)
        expect(d.getMonth()).toBe(5) // June (0-indexed)
        expect(d.getDate()).toBe(15)
      })
  })
})
