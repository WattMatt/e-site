# Tariff explorer, TOU visuals, area-of-supply map, annual update process (E7)

**Date:** 2026-10-05 · **Branch:** `feat/tariff-explorer` · **Prompt:** Dev Prompts 2026-10-05 / E7
**Owner decisions:** D1 audience = all signed-in orgs (default). D2 map = MapLibre + open tiles now, Mapbox later (default).

## 1. What exists, and what the data actually holds (checked 2026-10-05)

| Fact | Evidence |
|---|---|
| Library: 179 licensees, 239 aliases, 98 licensees with a published year (42 on 2026/27, 56 on 2025/26), 222 years `in_review`, 29 `superseded`. | Live DB counts. |
| **No TOU calendar exists.** `tariffs.tou_calendar` has 0 rows; 130 published tariffs are TOU. | Live DB. |
| **No licensee has an MDB code.** `tariffs.licensee.mdb_code` is NULL for all 179. | Live DB. |
| **Every tariffs read is Solar-gated in the database.** The SELECT policies in 00210 admit `is_platform_tariff_admin() OR caller_has_any_solar_org()`. A non-Solar org reads nothing, whatever the UI does. | `00210_tariffs_schema.sql` §5. |
| Solar case runs refuse a study whose licensee has no calendar of its own (`TARIFF_REASONS.noCalendar`, no Eskom fallback). With zero calendars, every case run is refused today. | `apps/web/src/lib/solar/cases/tariff.ts`. Out of scope; flagged. |
| The "12 unparsed RfDs" line is stale: PR #229 read 6. Six remain, each with a stated reason. | PR #229 body, "What's left". |

## 2. Scope

1. **Explorer** `/tariffs`: alias-aware licensee search → `/tariffs/[licenseeId]?fy=` (year picker, tariffs grouped by category) → `/tariffs/[licenseeId]/[tariffId]`: every charge grouped by component, with season, TOU period, day type, block, amount + unit, VAT basis, **YoY %** against the licensee's previous published/superseded year, and a **citation** (document title + page, or sheet + cell) with *View source* (signed URL, the cited page rendered and highlighted by the existing `SourceViewer`).
2. **TOU visuals** on a TOU tariff: the season × day type × 48 half-hour matrix (existing `TouCalendarDiagram`), a 24-hour clock per season/day type, and an energy-rate-by-period bar chart. The calendar is the licensee's own; otherwise Eskom's, labelled *hours assumed equal to Eskom*. Public holidays follow the calendar's holiday rule.
3. **Map** `/tariffs/map`: MDB municipal boundaries, coloured by supply status, click → the licensee's tariffs. The Eskom-direct limitation is stated on the map.
4. **Compare** `/tariffs/compare?t=…`: one monthly consumption profile priced across 2–4 tariffs with the shared bill engine; the profile builder is the E8 hand-off.
5. **Update cycle** `/admin/tariffs/cycle` (tariff admins): due years per regime, ingest status, review queue, blocking issues, publish history, one-click diff to the previous year. Runbook in `docs/tariffs/annual-update-runbook.md`.

Out of scope: municipal calendars (each needs its own published hours or an admin decision to assume Eskom's), the six remaining RfDs (logged in the runbook), the Solar `noCalendar` fallback.

## 3. Data and access — migration `00224` (number re-checked at merge)

- `public.caller_can_read_tariff_library()` — SECURITY DEFINER, `search_path = ''`: tariff admin, or active in any organisation. REVOKE from PUBLIC and anon.
- The seven reference/year SELECT policies are dropped and re-created **under the same names**, PERMISSIVE, on the new helper. `tariff_year_select` keeps the published/superseded restriction for non-admins. `tariff`, `charge`, `loss_factor`, `sseg_rule` already inherit through `EXISTS` on their parent and are unchanged. Writes are unchanged. 00210's `@verify` block names these policies only by name and kind, so it stays green.
- Seed Eskom's TOU calendar (hours and holiday treatment from the Eskom 2026/27 tariff book, cited in the migration).
- Seed `licensee.mdb_code` for municipal and metro licensees (fill NULL only), from a reviewed mapping committed beside the GeoJSON.
- `@verify`: helper exists, anon has no EXECUTE, each policy present, behaviour probes (a non-Solar active member reads a published year and not an in_review one; a caller with no active org reads nothing), the Eskom calendar tiles every season × day type, mdb codes present.

## 4. Units of code

| Unit | Where | Purpose |
|---|---|---|
| `explorer/search.ts` | shared | `searchLicensees(query, list)` over names and aliases, normalised like `licensee_alias`. |
| `explorer/charge-rows.ts` | shared | Charges → display rows grouped by component; YoY % keyed by `chargeKey`; citation text. |
| `explorer/tou-visual.ts` | shared | Clock arcs from the calendar; rate-by-period series from energy charges. |
| `explorer/profile.ts` | shared | `buildProfileMonths(profile, highSeasonMonths)` → 12 `MonthUsage` (**E8 hand-off**). |
| `explorer/compare.ts` | shared | Price one profile across tariffs with `costPeriod`; annual totals, not-modelled lines. |
| `explorer/supply-status.ts` | shared | MDB feature → status + licensee, for the map. |
| `lib/tariffs/explorer-data.ts` | web | Server reads through the caller's session. |
| `actions/tariff-explorer.actions.ts` | web | Signed URL for a cited source (active-org gate, read through RLS, signed by the service client). |
| `app/(admin)/tariffs/**` | web | Pages and client components. |
| `app/(admin)/admin/tariffs/cycle` | web | Update-cycle dashboard. |

## 5. Error handling

Every read failure renders a sentence and logs `[tariff-explorer]` with the table and error code, never the raw message. A tariff with no charges, a year with no previous year, a TOU tariff with no calendar anywhere, a municipality with no licensee: each has its own stated empty state. The map renders polygons on a plain background if the tile host fails.

## 6. Testing

TDD on every shared unit. Page render tests for the explorer pages and empty states. A contract test that the sidebar shows *Tariffs* to every org role. Migration dry-run red→green against the live schema with impersonated callers. **Three tariffs checked against their sources** (Eskom Megaflex and Homeflex against the 2026/27 xlsm cells, one municipal TOU against its RfD page), recorded in `docs/tariffs/explorer-verification-2026-10.md`.
