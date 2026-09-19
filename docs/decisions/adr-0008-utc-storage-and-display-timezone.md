# ADR-0008 — UTC storage, organization timezone for display

- Status: Accepted
- Date: 2026-09-19
- Deciders: Implementation team, ratified by ALOLA blueprint revision 2.0
- Scope: Data

## Context

Time correctness is financially material in this product. An installment due date decides whether a
penalty applies. The mandatory reminder fires 15 days before a due date. A financial period close
decides whether an entry is permitted. A unit hold expires at a specific moment and releases inventory.
Attendance, overtime, and payroll cut-offs depend on local working days.

Storing local times, or letting each server or browser interpret a timestamp in its own zone, produces
reminders that fire on the wrong day, holds that expire early or late, and entries that land in the
wrong accounting period.

## Decision

1. **Store every instant in UTC.** All timestamps are UTC in the database, in logs, in queue payloads,
   and in API responses (ISO-8601 with explicit `Z`).
2. **Display in the configured organization timezone.** The timezone is organization configuration, not
   a per-user preference and not inferred from the browser. Inference would mean two users disagree
   about which day an installment is due.
3. **Distinguish instants from calendar dates.** These are different types and must not be conflated:
   - An **instant** (created, approved, published, logged in) is UTC.
   - A **business date** (due date, contract date, maturity date, accounting period, attendance day) is
     a calendar date with no time and no zone, stored as a date-only value.

   Storing a due date as a UTC instant is the defect this rule prevents: `2026-03-01T00:00:00Z` viewed
   in a UTC+2 zone is still 1 March, but `2026-03-01T22:00:00Z` is 2 March — and a due date that shifts
   by a day changes penalty liability.
4. **Scheduled work computes boundaries in the organization timezone, then converts to UTC.**
   "15 days before the due date" is a calendar calculation in the organization's zone; the resulting
   fire time is stored in UTC. Reminders additionally respect configured quiet hours in the organization zone.
5. **Never use the server's local timezone.** Server processes run with `TZ=UTC`. Code must not call
   locale/zone-dependent date functions without an explicit zone argument.
6. **Fiscal periods and calendars are configuration**, including weekend days and holidays, which differ
   from Western defaults in the operating region and affect attendance, overtime, and due-date handling.
7. **Locale-aware rendering.** Dates render according to locale and direction, using the locale's
   calendar preference. Arabic and English render the same instant differently; both must be tested.

## Consequences

**Accepted benefits**

- One unambiguous instant per event; logs, audit records, and provider events correlate exactly.
- Due dates and accounting periods are stable regardless of viewer or server location.
- Daylight-saving and zone-policy changes do not corrupt stored history.

**Accepted costs**

- Two date types instead of one, and developers must choose correctly. Mitigation: distinct TypeScript
  types in `packages/contracts/` for `Instant` and `BusinessDate`, so the wrong one fails typecheck.
- Every date-handling site needs an explicit zone argument. Accepted.

## Compliance

- Server processes set `TZ=UTC`; CI asserts it.
- A business date typed or stored as a timestamp is a defect.
- Reminder scheduling tests cover a due date at a month boundary, across a DST transition, and with
  quiet hours configured, asserting the correct local calendar day.
- Financial period boundary tests assert that an entry at the first and last instant of a period lands
  in the intended period.

## References

- `docs/MASTER-MAPPING.md` §7, §8 COL-REMIND
- `CLAUDE.md` — "Use UTC for storage and the configured organization timezone for display."
- [ADR-0007](adr-0007-decimal-safe-money.md), [../architecture/data-model-conventions.md](../architecture/data-model-conventions.md)
