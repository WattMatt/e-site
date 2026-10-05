# Rate library from priced BOQs — design (E6)

**Date:** 2026-10-05 · **Status:** approved under the session autonomy grant (owner defaults D1 CPI, D2 median) · **Plan:** `docs/superpowers/plans/2026-10-05-rate-library.md`

## Why
Every priced BOQ WM receives carries a contractor's rates. Today they stay in one project's `projects.boq_items` or in a spreadsheet. The rate library collects them into one catalogue so a new estimate can be priced from what contractors actually charged, in today's money.

## Dependency note
The prompt assumed E5 (tender portal) slice A was on `main`. It is not, and nothing of it exists yet. The library is therefore source-agnostic: `rate_sources.kind` already reserves `tender_submission`, and E5 adds that adapter. Today's sources are E-Site BOQ imports and historical priced files.

## Data model (migration, all in `public`, no new schema)
| Table | Role |
|---|---|
| `rate_items` | The catalogue. `code` (unique per org), `category`, `description`, `unit`, `attributes` jsonb, `signature` (canonical key, unique per org). |
| `rate_sources` | One priced document: contractor, project (nullable FK + label), province, `priced_on` (escalation base) and its basis, file, totals, reconciliation. Unique per (org, kind, source_ref). |
| `rate_source_lines` | Every parsed line, content immutable: section path, code, description, unit, qty, supply/install/rate/amount, sheet + row. Carries the review state: `match_status`, suggestion, confidence, method, `group_key`. |
| `rate_observations` | Confirmed (item, rate) facts. Immutable by trigger. Identical rates in one source collapse into one row with `occurrences`. A correction is a new row with `supersedes_id`; a retraction is a `void` row. |
| `rate_index_values` | Monthly index values per series (`statssa_cpi_headline`, Dec 2024 = 100, Jan 2015 onward), with the citation. |
| `rate_library_access_log` | Who viewed or exported what, and when. |

**Access.** An active member of the owning org whose org role is owner, admin or project_manager (`COST_VIEW_ROLES`). Contractors, suppliers, inspectors and client viewers never see a row. Policies are PERMISSIVE and per verb, with FORCE RLS. Only owner/admin read the access log.

## Matcher (`@esite/shared` `rate-library/`)
1. Normalise text: decimal commas, mm²/mm2, Ø, whitespace.
2. Rules read the **section heading and the description together**, because BOQ lines are terse ("20mm Ø" under CONDUIT). Each rule yields a category plus attributes such as size, cores, conductor, rating, poles and component.
3. A rule that fills every required attribute gives a **signature**. That line is auto-confirmed, and its catalogue item is created if new.
4. A partial rule gives a **suggestion** for the review queue. No rule leaves the line **unmatched** in the queue.
5. Provisional sums, PC sums, percentages and zero rates are **excluded** because they are not rates.
6. AI suggestions are optional and only ever propose. They are off when `ANTHROPIC_API_KEY` is absent.

Precision is measured on a labelled sample kept as a fixture with descriptions only, no rates or contractor names. A test computes it.

## Escalation
escalated = nominal × CPI(to month) ÷ CPI(base month). The base month is the source's `priced_on`, and "to" is the latest published month. Both figures are shown. When the base is later than the latest index, the factor is 1 and flagged.

## Statistics and UI
- `/rates` lists each item with n, min, median, P75, max and latest, nominal or escalated. Filters cover date range, province, contractor and category.
- `/rates/[itemId]` shows stats by province, a trend chart (inline SVG) and observations that drill to the source line.
- `/rates/review` is the queue. Reviewers confirm, assign, create or exclude, a group at a time.
- `/rates/sources` lists sources with their reconciliation.
- **Budget export** is a CSV keyed by catalogue code with median or P75 (median by default), escalated. Every export is logged.
- **Price from library** on a project's Rates tab previews library rates against the BOQ lines and applies on confirm.

## Backfill
`apps/web/scripts/rate-library-backfill.ts` reads KINGSWALK (AEEC) and MAMAILA PH2 (SIYAYA) from `projects.boq_items`, and Sunbird (MVL) from a local rows file. It writes only `rate_*` tables, can be rerun, and prints a reconciliation per source that must match the source total to the cent.

## Out of scope
Tender submission ingestion (E5). Construction indices beyond CPI, though the series column allows them. Editing observations in place.
