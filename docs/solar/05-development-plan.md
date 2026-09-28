# E-Site Solar — Proposed Development Plan

**Status:** PROPOSAL for owner review · 2026-09-28
Each phase is a separate PR series with its own spec→plan→build→review cycle (the E-Site working
pattern). Nothing ships to production until the phase's verification list passes, including a
**signed-in walk from the empty state** by the owner (the step agents cannot do). Effort is in focused
build-days (one developer + agents); calendar time depends on review turnaround.

**Baseline:** the WM Solar web app. Every web feature is carried and fixed (functional spec §16); the
iOS app contributes nothing.

```
P0 prerequisites ─► P1 entitlement+skeleton ─► P2 tariff library ─┐
                                   ├────────► P3 load + schematics ┼─► P4 engine+yield+financials ─► P6 reports+proposal+portfolio ─► P7 operations
                                   ├────────► P5 layout (+3D) ─────┘
                                   └────────► P5b schedule (Gantt)                                     P8 WM data migration / retire WM Solar
```
P2, P3, P5 and P5b can run in parallel after P1. P4 needs P2 + P3 (P5 optional: manual-size cases work without it).

---

## P0 — Prerequisites and decisions (owner, ~1 day of owner time)

| # | Item | Why it blocks |
|---|---|---|
| 0.1 | ~~Make both Dropbox folders available offline~~ | **Done 2026-09-28**; both analysed (as-is/09, /10) |
| 0.2 | ~~Answer the P0 decisions~~ | **Done 2026-09-28** — see `06-open-decisions.md` (decision log) |
| 0.3 | ~~Contain the live WM Solar exposure~~ | **Done 2026-09-28** (D-24) |
| 0.4 | Rotate the WM Solar service-role key (D-28) — plan, owner approval, execute | Live risk; independent of the build |
| 0.5 | Download the 2026/27 NERSA municipal books + decision and Eskom 2026/27 schedule (D-29) — download list approved by owner first | Library would launch a year stale; P2 can start on 2025/26 meanwhile |
| 0.6 | PnP SCADA re-download (D-27) — owner signs in to the portal; per-site serial list approved; files filed per site and validated | Only blocks using the PnP sites as study data; not the build |
| 0.7 | Confirm whether the Solcast licence is commercial | Decides whether the forecast panel ships (P7) |

## P1 — Subscription, access control, schema skeleton, empty module (≈ 7 days)

Deliverables
- `FEATURE_PRICES.solar = {model:'org_subscription', interval:'annual', amountKobo:199900}`;
  `billing.org_addon_subscriptions`; Paystack annual plan `PAYSTACK_PLAN_SOLAR_ANNUAL`;
  `POST /api/paystack/solar-subscribe`; webhook branches (first charge, renewal, not_renew, disable,
  refund/reversal); callback type; one-time unlock route rejects subscription keys.
- `solar` schema with `studies`, `project_access`, `access_requests`, `audit_events`; helpers
  `org_has_solar`, `solar.access_level`, `can_view/can_edit/can_see_money`; grants; PostgREST PATCH; `@verify` blocks.
- Sidebar **Solar** entry always visible with per-project/per-user badge; `solar/locked` screen (Subscribe /
  Ask an admin / Request access / Withdraw); **Access panel** (grant levels, approve/decline requests, copy
  access from project); request/approval notifications (new types, full `notifications_type_check` re-declaration).
- `solar/(gated)/layout.tsx`; Overview with readiness engine (all steps grey); Site & Supply tab (§3) complete.
- `/settings/solar` skeleton seeded with the decided defaults (D-05, D-07, D-16).
- `docs/rbac-matrix.md` rows.
Verification
- Impersonation assertions (data §3.1) red first, then green — including **lapsed ⇒ hidden, rows unchanged**.
- Paystack **test-mode** annual subscription end to end on a throwaway org (not WM — the WM bypass hides the
  paywall); renewal, cancel and refund webhooks replayed; lapse hides and resubscribe restores.
- Owner walk: non-subscribed org → locked → subscribe (test mode) → member requests access → admin approves
  as View → member sees no money and cannot edit → upgraded to Edit + financials.

## P2 — Tariff library (≈ 10–12 days; parallel)

Deliverables
- `tariffs` schema (data §4), `tariff-sources` bucket, holiday reuse.
- Parsers written fresh per province layout (as-is/09 §7): NERSA province compendium XLSX (2025/26 **and** 2026/27), Eskom official xlsm (2025/26, 2026/27, incl. Homeflex, Gen-offset, loss factors). AI-assisted PDF extraction (server-side, platform key, draft-only) for metro books.
- E-Site-run application process (D-03): scheduled acquisition, automatic checks, YoY diff, `/admin/tariffs` review queue with source crops; **E-Site platform admin approves** before publish/supersede.
- TOU calendars (Eskom 2025/26+ windows incl. Sunday standard; municipal flagged `assumed_eskom`), Eskom SSEG/Gen-offset linkage, net-billing rules with carry-forward.
- **Bill engine** (engine §5) in `@esite/shared` with the 10 golden tariff cases + Eskom public worked examples.
- Tariff tab (§5) incl. resale overrides (D-10), escalation, bill check, user-supplied municipal export rate with provenance. Due-year cron.
Verification
- Every charge in the published year has a source locator; spot-check 30 random charges against the source.
- 10 golden cases exact; Eskom examples within ±1 %; unit test proving c/kWh vs R/kWh cannot be confused; net-billing carry-forward and FY-end reset tests.

## P3 — Load + Schematics (≈ 14 days; parallel)

Deliverables
- Direct-to-Storage upload, server parser (formats found in the hydrated folder; PnP SCADA first), review dialog, validation reports, sha256 dedupe, org meter library.
- `meter_readings` storage decision (D-23) proven with a volume test (≥ 2 M rows).
- Tenants sub-tab from `structure.nodes`, weights, auto-match, synthesis archetypes + densities.
- Site-profile builder (engine §2) incl. reference-year alignment, MD; charts; meter comparison overlay; CSV exports; Checks sub-tab.
- Schematics tab (functional §13): diagrams from project drawings (all pages), meter cards, connections, include-in-load toggle, reconciliation + double-count guard, sheet export; `solar.schematic_*` in `isAnnotated()`.
Verification
- Golden fixtures (as-is/10 §6.4 list + synthetic set): formats A/B/C; A interval-beginning vs B/C interval-ending; 30-min kWh vs kW same energy; `Calc` zeros → missing; body-hash duplicates across sites caught; cumulative with rollover; blanks → NULL; `24:00`; daily files excluded; PV generation on the import channel.
- One real mall (e.g. YARONA): Σ tenants vs bulk reconciliation shown; owner confirms the profile shape looks right.

## P4 — Engine, Yield & Scenarios, Financials (≈ 12–15 days)

Deliverables
- `@esite/shared/services/solar`: weather (PVGIS TMY fetch + cache, UTC→SAST), SPA, Perez transposition, NOCT/Faiman temperature, loss chain, inverter clipping, battery strategies, energy balance, KPIs, financial model (engine §6), sensitivity.
- Cases UI (§7), run route (`maxDuration` set), immutable runs with inputs hash + Stale banner, compare.
- Financials tab (§8), equipment catalogue (modules/inverters/batteries) with seed data.
Verification
- ±3 % of PVGIS PVcalc at 5 reference sites × 3 orientations (public references only, D-19); WM static-curve regression test fails as intended.
- All four finance models (cash, debt, PPA, lease) produce their own cashflow and KPIs side by side (D-15); 12B toggle off by default (D-16); insurance 0.5 %/yr with no ×12 (D-05).
- Financial model matches an independent XLSX to 4 s.f.
- Every KPI on every tab traced to one `case_runs` row (test asserts no client-side computation of displayed results).

## P5 — Layout on drawings (≈ 12 days; parallel after P1)

Deliverables
- `SolarCanvas` (Konva) on sheet primitives; roof/obstruction/north tools; auto-fill (engine §3.1); manual arrays; inverters; strings with voltage checks; BOM; undo/redo; drafts; save with stale-write refusal.
- `layout_objects` registered in `isAnnotated()`; drawing-changed warning.
- Satellite capture (if D-08 approves a provider) with stored m/px and attribution.
- Layout sheet PDF export (`solar_layout_sheet`); "Push to case".
- AC run → existing cable-route tracing (`cable_schedule` supply).
Verification
- Auto-fill counts checked by hand on 3 roofs (flat racked, pitched, irregular with obstructions).
- Touch/tablet walk (pinch, draw) on iPad.

## P5b — Schedule / Gantt (≈ 8 days; parallel after P1)

Deliverables: `solar_task` work-item type + Gantt side tables (segments, dependencies with type and lag,
baselines, milestones, filter presets per user); Schedule tab (functional §14) incl. template seeding,
import (CSV/XLSX/MS Project XML) and exports (PNG, PDF, XLSX, DOCX, ICS); critical path with all link
types and lag.
Verification: date round-trip test in `Africa/Johannesburg` (no −1 day drift); critical-path unit tests
for FS/SS/FF/SF with lag; cycle refusal; owner walk creating a programme from the template.

## P6 — Reports & Proposal + Portfolio (≈ 10–12 days)

Deliverables
- react-pdf `solar_feasibility` and `solar_technical` reports (WinAnsi-safe), read-gates, `SavedReportsPanel`.
- Proposal drafts, issue with frozen snapshot + hash, share token, portal view, accept/decline with stamping, notifications (new types, full CHECK re-declaration), withdraw/revise.
- Optional LLM narrative (D-17).
- Solar portfolio page `/solar` with map (functional §15).
Verification
- Portal figures byte-identical to PDF snapshot; tampering test (changed case after issue does not change issued proposal).
- Report glyph test (decoded content streams) for `kWp`, `m²`, `°`, and banned glyphs replaced.
- Probe with project email toggle off (WM projects resolve 12–13 real recipients).

## P7 — Operations (≈ 10 days)

Deliverables: installations, guarantee from the accepted case, idempotent generation ingestion, downtime
detection from sun position, `solar_monthly` reports with snapshot and separate commentary fields,
handover checklist linked to E-Site Documents, 7-day Solcast forecast panel (if licensed, D-08).
Verification: re-importing the same generation file changes nothing; a month straddling a year boundary
books to the right year; monthly report v2 leaves v1 untouched.

## P8 — WM Solar retirement (≈ 1 day; no data migration, D-25b)

Nothing moves into E-Site. Once E-Site Solar is live: export the 3 WM proposals as PDFs for the record,
set the WM Solar database read-only (revoke authenticated writes), point `wm-solar.vercel.app` at a notice
page linking to E-Site, and keep the database as an archive.

---

## Cross-cutting rules for every phase
- Spec → plan (`docs/superpowers/plans/`) → subagent build with per-task review → whole-branch review.
- Migration numbers claimed at apply time; `@verify` blocks; impersonation assertions red-then-green; three suites.
- Diagnostics in the first deploy (audit events, run error capture, import reports).
- CLAUDE.md "Current state" + Obsidian `sessions.md` updated at the end of each session.

## Rough total
P1–P6 incl. P5b ≈ 73–82 build-days (P1 grew by the access-grant model); P7 ≈ 10 and P8 ≈ 1 more.
The critical path is P1 → P2/P3 → P4 → P6. Owner actions still pending: D-28 key rotation, D-29 2026/27
download list, D-27 PnP sign-in, Solcast licence.
