# E-Site Solar — Proposed Development Plan

**Status:** PROPOSAL for owner review · 2026-09-28
Each phase is a separate PR series with its own spec→plan→build→review cycle (the E-Site working
pattern). Nothing ships to production until the phase's verification list passes, including a
**signed-in walk from the empty state** by the owner (the step agents cannot do). Effort is in focused
build-days (one developer + agents); calendar time depends on review turnaround.

```
P0 prerequisites ─► P1 entitlement+skeleton ─► P2 tariff library ─┐
                                   └────────► P3 load ────────────┼─► P4 engine+yield+financials ─► P6 reports+proposal ─► P7 operations+mobile
                                                P5 layout ─────────┘                                                      P8 WM data migration / retire WM Solar
```
P2, P3 and P5 can run in parallel after P1. P4 needs P2 + P3 (P5 optional: manual-size cases work without it).

---

## P0 — Prerequisites and decisions (owner, ~1 day of owner time)

| # | Item | Why it blocks |
|---|---|---|
| 0.1 | Make `005. NERSA TARIFFS` and `006. METER CSV` (at least the 29 summaries + YARONA, SEGONYANA, WHITE RIVER, KURUMAN MALL) **available offline** in Dropbox | Parsers and golden fixtures cannot be written against placeholders (gap D1, D2) |
| 0.2 | Supply the 2026/27 NERSA municipal decision + province books and Eskom 2026/27 schedule (or approve downloading them) | Library would launch a year stale (D3) |
| 0.3 | Answer the **P0 decisions** in `06-open-decisions.md` (D-01, D-02, D-03, D-04, D-05, D-07, D-12, D-22, D-24, D-25) | Pricing, access, schema shape, scope |
| 0.4 | Provide validation references: 2–3 PVsyst reports for WM projects, 3–5 real electricity bills with the matching meter data (D-19) | Engine acceptance tests |
| 0.5 | **Separately from E-Site:** decide containment for the live WM Solar exposure (gap section A) — rotate the iOS service-role key and the GitHub token, turn on JWT verification, drop anon policies | Live risk independent of this build |

Exit: folders readable, decisions recorded, references received.

## P1 — Entitlement, schema skeleton, empty module (≈ 5 days)

Deliverables
- `FEATURE_PRICES.solar` (`model:'project'`), `billing.project_feature_unlocks`, `has_project_feature()`,
  `POST /api/paystack/project-feature-unlock`, webhook/callback/refund branches; org unlock route rejects project-model keys.
- `solar` schema (or `projects`, D-22) with `studies`, `audit_events`, grants, PostgREST PATCH, `@verify` blocks.
- Role constants `SOLAR_WRITE_ROLES`, `SOLAR_TECH_READ_ROLES`; sidebar **Solar** entry with per-project lock.
- `solar/unlock` page; `solar/(gated)/layout.tsx`; Overview with readiness engine (all steps grey); Site & Supply tab (§3) complete.
- `/settings/solar` skeleton (org defaults JSON + editor for rate card and finance defaults).
- `docs/rbac-matrix.md` rows.
Verification
- Impersonation assertions: locked project refuses solar writes; contractor reads Site but not write; other-org user reads nothing; revoked = read-only.
- Paystack **test-mode** purchase end to end on a throwaway org (not WM — the WM bypass hides the paywall); refund revokes.
- Owner walk: sidebar → locked → unlock (test mode) → Overview → Site & Supply save.

## P2 — Tariff library (≈ 10–12 days; parallel)

Deliverables
- `tariffs` schema (data §4), `tariff-sources` bucket, holiday reuse.
- Parsers: NERSA province compendium XLSX (2025/26 **and** 2026/27), Eskom schedule XLSX (2025/26, 2026/27). AI-assisted PDF extraction (server-side, org key, draft-only) for metro books.
- Automatic checks, YoY diff, `/admin/tariffs` review UI with source crops, publish/supersede.
- TOU calendars (Eskom 2025/26+ windows incl. Sunday standard; municipal per book), SSEG rules where published.
- **Bill engine** (engine §5) in `@esite/shared` with the 3–5 real-bill tests.
- Tariff tab (§5) incl. overrides, escalation, bill check. Due-year cron.
Verification
- Every charge in the published 2026/27 year has a source locator; spot-check 30 random charges against the source (owner or delegate).
- Bill tests within ±2 %; unit test proving c/kWh vs R/kWh cannot be confused (unit NOT NULL + conversion test).

## P3 — Load (≈ 10 days; parallel)

Deliverables
- Direct-to-Storage upload, server parser (formats found in the hydrated folder; PnP SCADA first), review dialog, validation reports, sha256 dedupe, org meter library.
- `meter_readings` storage decision (D-23) proven with a volume test (≥ 2 M rows).
- Tenants sub-tab from `structure.nodes`, weights, auto-match, synthesis archetypes + densities.
- Site-profile builder (engine §2) incl. reference-year alignment, MD; charts; CSV exports; Checks sub-tab.
Verification
- Golden fixtures (as-is/10 §6.4 list + synthetic set): 30-min kWh vs kW same energy; cumulative with rollover; blanks → NULL; decimal comma; `24:00`; 15-min; solar meter export channel.
- One real mall (e.g. YARONA): Σ tenants vs bulk reconciliation shown; owner confirms the profile shape looks right.

## P4 — Engine, Yield & Scenarios, Financials (≈ 12–15 days)

Deliverables
- `@esite/shared/services/solar`: weather (PVGIS TMY fetch + cache, UTC→SAST), SPA, Perez transposition, NOCT/Faiman temperature, loss chain, inverter clipping, battery strategies, energy balance, KPIs, financial model (engine §6), sensitivity.
- Cases UI (§7), run route (`maxDuration` set), immutable runs with inputs hash + Stale banner, compare.
- Financials tab (§8), equipment catalogue (modules/inverters/batteries) with seed data.
Verification
- ±3 % of PVGIS PVcalc at 5 reference sites × 3 orientations; ±5 % of supplied PVsyst reports; WM static-curve regression test fails as intended.
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

## P6 — Reports & Proposal (≈ 8–10 days)

Deliverables
- react-pdf `solar_feasibility` and `solar_technical` reports (WinAnsi-safe), read-gates, `SavedReportsPanel`.
- Proposal drafts, issue with frozen snapshot + hash, share token, portal view, accept/decline with stamping, notifications (new types, full CHECK re-declaration), withdraw/revise.
- Optional LLM narrative (D-17).
Verification
- Portal figures byte-identical to PDF snapshot; tampering test (changed case after issue does not change issued proposal).
- Report glyph test (decoded content streams) for `kWp`, `m²`, `°`, and banned glyphs replaced.
- Probe with project email toggle off (WM projects resolve 12–13 real recipients).

## P7 — Operations + mobile field capture (≈ 10–12 days; only if D-12 = in scope)

Deliverables: installations, guarantee from accepted case, idempotent generation ingestion, downtime
detection from sun position, `solar_monthly` reports with snapshot; Expo screens (survey, meter reading,
handover checklist) with server-side entitlement.

## P8 — WM Solar data migration and retirement (≈ 3–5 days; only if D-25 says migrate)

Supervised script (not an edge function): chosen projects → E-Site projects mapping; meter raw files
re-imported through the P3 pipeline (not copied from WM's jsonb); simulations **not** migrated (numbers
are wrong — re-run in E-Site); signed proposals archived as PDFs with their acceptance evidence. Then
freeze WM Solar read-only and retire.

---

## Cross-cutting rules for every phase
- Spec → plan (`docs/superpowers/plans/`) → subagent build with per-task review → whole-branch review.
- Migration numbers claimed at apply time; `@verify` blocks; impersonation assertions red-then-green; three suites.
- Diagnostics in the first deploy (audit events, run error capture, import reports).
- CLAUDE.md "Current state" + Obsidian `sessions.md` updated at the end of each session.

## Rough total
P1–P6 ≈ 57–64 build-days; P7 + P8 ≈ 13–17 more. The critical path is P0 data access → P2/P3 → P4.
