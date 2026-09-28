# E-Site Solar — Decision Log

All decisions below were taken by the owner on **2026-09-28**, top-down in one session. Each "Build rule"
is what the specs now say. A change to any of these is a new decision recorded here with its date.

## 1. Live WM Solar (outside E-Site)

| ID | Decision | Build rule / action | Status |
|---|---|---|---|
| D-25 | Live WM Solar production database = **`lyctmmqndqegptzkajhz`** ("Mattheus Power"; 48 projects, 810 tenants, 182 meters, 23 simulations, 3 proposals, 3 users). `zhhcwtftckdwfoactkea` (Lovable) is not in the account | — | Confirmed |
| D-24 | **Contain now, all steps** | Done 2026-09-28: 168 anon/public policies → authenticated, anon write grants revoked, RLS on `tariff_uploads`, `tariff-uploads` + `project-schematics` private, signup disabled, `verify_jwt` on all 34 functions. Verified from outside (anon reads 0 rows, writes 401, functions 401, signup 422); data intact. Restore: `WM_Solar_Web/_containment-2026-09-28/`. Accepted breakage: client share links, schematic images | **Done** — owner to confirm signed-in use still works |
| D-28 | **Rotate the service-role key** (shipped in iOS TestFlight builds) | Done 2026-09-28: web app moved to the new publishable key (Vercel env + `vercel redeploy` of the same source), legacy JWT keys disabled (old service_role and anon now refused), two stray full-access secret keys (`anthropic_api_key`, `image_generation`) deleted; no user sessions lost. Rollback: re-enable legacy keys / `vercel rollback` | **Done** — owner to exercise a server-side feature once |
| D-25b | **Migrate nothing** into E-Site | WM Solar stays as a read-only archive; Phase 8 reduces to archiving | Decided |

## 2. Commercial

| ID | Decision | Build rule |
|---|---|---|
| D-01 | **Org-wide annual subscription, R1,999 per year excl. VAT**, unlocks Solar on every project of the org. No per-project purchase | `FEATURE_PRICES.solar = {model:'org_subscription', interval:'annual', amountKobo:199900}`; MV-subscription pattern keyed on the **org** (`billing.org_addon_subscriptions`); Paystack recurring plan; renew/cancel/refund webhooks |
| D-02 | Refund, chargeback, lapse or cancel → **hidden but kept** | Module locks (tab visible with lock, content hidden); all data retained; everything returns on resubscribe. RLS denies reads and writes while inactive |

## 3. Access

| ID | Decision | Build rule |
|---|---|---|
| D-03 | Tariff library maintained **by E-Site as an application process**: auto-ingest and automatic checks, **E-Site platform admin approves** each year before publishing | Platform role `is_platform_tariff_admin()` (E-Site staff), ingestion jobs + review queue; customers never edit reference data |
| D-03b | Library readable by **subscribed orgs only** | Read policy on `tariffs.*` = caller's org has an active Solar subscription (or is a platform admin) |
| D-04 | Solar access **granted per user by the project owner** | New `solar.project_access(project_id, user_id, level)`; levels **View / Edit / Edit + financials**; grantors = **org owner and org admin** of the project's org |
| D-04b | Users without access **still see the Solar tab** | Locked tab with two actions: **Request access** (notifies org owners/admins, who approve with a level) and, if the org is not subscribed, **Subscribe** (visible to owner/admin; others see "Ask an admin to subscribe") |

## 4. Scope and timing

| ID | Decision | Build rule |
|---|---|---|
| D-12 | Operations tab **after the design workflow** | Phase 7 |
| D-20 | Schedule tasks are **E-Site work items** (type `solar_task`) + Gantt side table | Functional §14 |
| D-26 | **No wheeling / off-site PV in v1** | Engine hook and Eskom loss/wheeling tables kept for later |
| D-13, D-21 | 3D view and Schematics **carried** (web features) | Functional §6.3, §13 |

## 5. Architecture

| ID | Decision | Build rule |
|---|---|---|
| D-22 | **New `solar` + `tariffs` schemas** | Full new-schema checklist incl. PostgREST `db_schema` PATCH |
| D-23 | Meter readings storage **decided by a Phase 3 volume test** | Measured 2026-09-28 on a production dry run (`scripts/db/solar-readings-volume-test.sql` inside `dry-run-migration.sh`'s rolled-back transaction, 00207 + 00210 applied in-transaction, zero residue read back), **scaled** to stay under the owner's 500,000-row production cap: 27 channels × 17,520 = 473,040 rows bulk-inserted in 6,535 ms (→ 2,102,400 rows ≈ 29,044 ms, linear); write_readings 17,520 rows in 323 ms = 54,158 rows/s; one channel-year read under RLS 6.2 ms; hourly aggregate of one channel 12.9 ms; site monthly energy (28 channels, under RLS) 357 ms (→ 121 channels ≈ 1,544 ms, linear); 71,401,472 bytes for 490,560 rows = 145.6 bytes/row (→ 2,119,920 rows ≈ 309 MB). The per-channel read and aggregate are one PK index scan in one partition and do not grow with table size except via index depth. Cross-check at full scale on local plain PostgreSQL 17 (no RLS, no auth, same partitioned DDL + FK): 2,102,400 rows bulk-inserted in 17,642 ms; 121st channel upsert 17,520 rows in 57 ms; channel-year read 8.6 ms; hourly aggregate 5.6 ms; site monthly (121 channels) 162 ms; 329,097,216 bytes = 155.2 bytes/row, which confirms the linear size extrapolation within 7 %. **Decision: keep the partitioned table** (all under the limits: read 6.2 ms ≪ 500 ms, write 54,158 ≫ 10,000 rows/s; a 121-channel mall-year ≈ 0.31 GB, so 25 % of an 8 GB disk, the reference used because the plan's disk size was not read here, holds ≈ 6 such mall-years; the database is 81 MB today). Size is the limit that binds first: re-check the projected corpus against the actual disk before onboarding more than a handful of full malls. Switch criterion: RLS channel-year read > 500 ms, or write_readings < 10,000 rows/s, or projected size > 25 % of the DB plan. |

## 6. Numbers and proposals

| ID | Decision | Build rule |
|---|---|---|
| D-05 | Insurance = **annual % of capex, default 0.5 %**, no ×12 | Engine §6 |
| D-07 | Defaults: **discount 11 %, CPI 5 %, tariff escalation 9 % → 7 % by year 10 → CPI + 1 %, O&M R150/kWp/yr, 25-year analysis** | Org settings seed |
| D-16 | **Excl. VAT; company tax + Section 12B optional toggle, default off** | Engine §6 |
| D-15 | **All four finance options in v1** — cash, debt-financed, PPA, lease/rent-to-own — **selectable per proposal** (one or several offered side by side) | Functional §8, §9.3 |
| D-14 | Load-shedding value = **separate line, not in IRR** | Engine §6 |
| D-10 | Landlord resale tariffs **via project override** in v1 | Functional §5 |
| D-18 | Clients open proposals by **secure expiring link, no login**; portal users also see them in the portal | Functional §9.4 |
| D-17 | **Optional AI narrative button**, editable, saved | Functional §9.3 |

## 7. Data and providers

| ID | Decision | Build rule / action |
|---|---|---|
| D-29 | **2026/27 tariffs downloaded by Claude.** Eskom 2026/27: 7 files done (`005. NERSA TARIFFS/2026-27/ESKOM/`, manifest with sha256). Municipal: **all** NERSA 2026/27 decisions, collected by a paced background job (NERSA rate-limits); no consolidated 2026/27 province workbook found — per-municipality decision PDFs | Eskom done; municipal in progress |
| D-27 | **PnP SCADA re-download — parked.** Finding (2026-09-28, thukela-kadesh.pnpscada.com, 1,029 meters / 34 meter accounts): the portal's "Download Profile CSV" (`_DataDownload`) is a meter-*account* export and **ignores the requested meter**, silently substituting the "closest" account (five Kuruman meters returned byte-identical data; Merino Checkers returned a Kuruman logger's data; others fell back to "Parkdene Generator DB1.2"). This is the root cause of the mis-filed PnP folders. Per-meter half-hour data needs a provider-side bulk export (Thukela Metering) or the portal's per-meter tools (CRF2/bulk) — not attempted. 3 suspect files quarantined in `PNP-2026-09/_UNVERIFIED-do-not-use/` | Parked by owner |
| D-08b | **Solcast is a free/hobbyist tier → the 7-day forecast panel is dropped** (free terms do not permit commercial use) | Functional §10, §16 |
| D-19 | Validation against **public references only**: PVGIS PVcalc (5 sites × 3 orientations, ±3 %) and the 10 hand-computed tariff cases; no PVsyst/real-bill dependency | Engine §3.7, §5 |
| D-08 | Providers: **keep WM's set** — Mapbox (maps, geocoding, satellite roof capture), PVGIS + Global Solar Atlas; Solcast 7-day forecast only if the licence is commercial | All server-side |
| D-11 | Row spacing: **no inter-row shade 09:00–15:00 on 21 June** | Engine §3.1 |
| D-09 | Grid-connection warning when **PV AC > 75 % of transformer/mini-sub rating** (warning only) | Functional §3.2 |
| D-06 | Synthesised load **seeded from GCR kW/m² densities + 8 archetypes**, owner reviews the table once | Engine §2.4 |

## Still open (small, non-blocking)
- Owner review of the seeded density/archetype table (Phase 3).
- Owner to confirm WM Solar still works when signed in (after containment + key rotation).
- PnP per-meter data route (parked, D-27).
