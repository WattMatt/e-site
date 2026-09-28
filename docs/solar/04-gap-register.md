# E-Site Solar — Gap Register

**Status:** 2026-09-28 · Source evidence: `as-is/01…11` (every item cites `file:line` there).
All WM Solar findings come from **reading code** of the web app (`origin/main` of `WattMatt/greencalc-sa`
at `8e9208d8`, 2026-05-20) — the web app is the sole baseline; the iOS app is out of scope. **None has been probed against a live database.**
The NERSA (44 files) and meter-CSV (2,140 files) folders are **online-only Dropbox placeholders** and
could not be read — items marked ⛔ are blocked on hydrating them.

**Severity:** S1 = wrong numbers / data loss / security exposure · S2 = feature broken or unreachable ·
S3 = missing capability / UX dead end · S4 = hygiene.
**Disposition:** **LIVE** = affects the running WM Solar app today (outside the E-Site build) ·
**DESIGN** = resolved by the E-Site spec (section cited) · **PHASE n** = built in that phase of
`05-development-plan.md` · **DECISION D-nn** = owner answer needed.

---

## A. Live exposure in the running WM Solar apps (act regardless of the rebuild)

| ID | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| A1 | S1 | ~20 tables (proposals, tenants, meters, simulations, layouts, documents, generation segments, downtime) have `USING (true)` policies with no role clause — readable, writable and deletable with the **public anon key** that ships in the app bundle | as-is/01 §0, 04 S1, 05 §9, 06 exec §1, 07 D | **LIVE** — containment plan needed (D-24) |
| A2 | S1 | `projects` still carries the original four `TO authenticated USING (true)` policies, OR'd with the later org policies → org isolation is void; public self-signup is live | as-is/01 §0, 07 D | LIVE |
| A3 | S1 | 27 of 34 edge functions `verify_jwt=false`; only 2 check the caller. Includes `fetch-github-files` (reads any repo the server token reaches — **rotate the token**), `replicate-to-external` (copies ~49 tables incl. profiles/roles to another DB on request), `upload-tariff-file` (SSRF), `geocode-location` (service-role write to any project), paid-API proxies (Anthropic, Gemini, PDFShift, Solcast, Google Places) | as-is/07 B.1, D | LIVE |
| A4 | S1 | Public/anon storage buckets: `project-documents`, `tariff-uploads`, `project-schematics` (client drawings by URL) | as-is/01, 03, 07 B.4 | LIVE |
| A5 | S1 | Stored XSS: A0 layout export `document.write` of layout name; proposal print preview; map popups from project/site/municipality names | as-is/05 §9, 06 A, 07 D, 02 §0.5 | LIVE |
| A6 | S1 | `compile-latex` (no auth) sends client financials to public texlive.net | as-is/06 A | LIVE |
| A8 | S2 | Three Supabase refs in play (`zhhcwtftckdwfoactkea` in `config.toml`, `lyctmmqndqegptzkajhz` in `schema-dump.sql`, `rsdisaisxdglmdmzmkyw` sync source); live schema has an FK no migration creates | as-is/07 §0 | DECISION D-25 |
| A9 | S1 | Fixes for much of A1–A3 exist only on the unmerged PR #1 branch (`onboarding-standardization`, conflicting with main) | local RECONCILIATION.md | LIVE |

## B. Calculation correctness (why WM numbers cannot be reused)

| ID | Sev | Finding | Evidence | E-Site resolution |
|---|---|---|---|---|
| B1 | S1 | Hourly engine ignores irradiance source; uses a fixed location-independent curve ≈ 2,346 kWh/kWp/yr (realistic SA 1,550–1,850) | as-is/04 E1–E2 | DESIGN engine §3 + regression test §3.7 |
| B2 | S1 | KPI tiles from a simplified model disagree ~2× with the engine that drives money | 04 E3 | DESIGN functional §7.3 (one stored run) |
| B3 | S1 | Load fed to simulation = one averaged 24-h day repeated 365×; no weekday/weekend/season/holiday | 02 §0.2 | DESIGN engine §2.2 |
| B4 | S1 | kWh↔kW conversion inconsistent across 5 code paths (the 2026-05-20 fix is undone elsewhere); server profile halves 30-min data; kW labelled kWh inflated 2–4× | 02 §0.3, 10 §5 | DESIGN engine §2.1 + synthetic fixtures |
| B5 | S1 | Tariff units mixed (R/kWh vs c/kWh), engine ignores unit → imported plans 100× low | 03 §0.3, 09 | DESIGN data §4 (unit enum NOT NULL) |
| B6 | S1 | Bill model = blended energy × kWh + first basic + first demand; blocks at block 1 only; network, service/admin, GCC, reactive, VAT ignored; TOU plans excluded from cost estimates | 03 §0.4, 09 | DESIGN engine §5 + bill-check validation |
| B7 | S1 | Export valued at R0 (basic) and full retail (advanced, default ON) | 03, 04 E7 | DESIGN engine §5.7 + SSEG rules |
| B8 | S1 | Insurance = capex × rate × 12 (1 % → 12 %/yr) | 03 §8.4, 04 E8 | DECISION D-05; DESIGN engine §6 |
| B9 | S1 | Battery: "Self-consumption" label maps to "never discharge"; new projects SoC 0/0 → 0 kWh; no round-trip efficiency | 04 E5–E6 | DESIGN engine §4 |
| B10 | S1 | UTC weather treated as local → PV peaks 2 h early | 04 E10 | DESIGN engine §1.2 |
| B11 | S1 | TOU windows hard-coded/localStorage, three conflicting definitions, wrong vs Eskom 2025/26 (both seasons), no public holidays; "solar hours 0 % peak" claim false (849 peak h) | 03 §4, 09 §3.2 | DESIGN data §4 tou_calendar |
| B12 | S1 | Diversity multiplies every hour (cuts energy 20 %); per-browser setting | 02 §0.5 | DESIGN engine §2.5 |
| B13 | S1 | Multi-meter tenants averaged/summed inconsistently; "monthly kWh" computed 5 ways; 50 kWh/m² hard-coded fallback; 4.17 kW column default treated as real load | 01, 02 | DESIGN functional §4.4, engine §2.3 |
| B14 | S1 | Blank cells → 0; cumulative detection off above ~220 rows; decimal comma ×10; MM/DD misread; `24:00` aborts; browser TZ shifts a day; raw data truncated at 5,000 points | 02 D, 10 §5 | DESIGN engine §2.1–2.2 |
| B15 | S1 | Proposal: R/Wp 1000× too large; IRR/NPV scaled linearly by load-shedding stage; saved simulations don't carry the keys proposals read → yield falls back to kWp × 1,600, NPV/IRR/LCOE 0 | 06 A | DESIGN functional §9, engine §6 |
| B16 | S1 | Portal shows different assumptions (8 % esc., 25 y, 0.5 %) from the PDF (10 %, 20 y) | 06 A | DESIGN functional §9.4 (frozen snapshot) |
| B17 | S1 | PV layout: pitch foreshortening applied across the slope; strings/DC-AC double-count arrays with >1 cable; no north reference | 05 §9 | DESIGN functional §6, engine §3.1–3.3 |
| B18 | S1 | Generation CSV import additive (re-import doubles); months booked into UI-selected year; council import double-count | 06 D | DESIGN functional §10 (idempotent PK) |
| B20 | S2 | Advanced sections: Seasonal dead, Grid constraints display-only, Load growth display-only; overrides & 15 % reduction not persisted | 04 E4, E9 | DESIGN functional §7.2 |
| B21 | S2 | Calculator broken against current tariff schema; Quick Estimate/Sandbox use hard-coded assumptions | 04 §9 | DESIGN (folded into cases) |

## C. Broken / dead features in WM Solar (the E-Site version of each feature is specified working — see functional spec §16)

| ID | Finding | Evidence |
|---|---|---|
| C1 | Overview renders an inline component; `ProjectOverview.tsx` (1,169 lines) dead; ~9 load-profile components unreachable; `ShopTypesManager`, `SchematicViewer`, `ProposalBuilder`, `LayoutManagerModal`, `PVConfigModal` unreachable | 01, 02, 05, 06 |
| C2 | Six of 14 tab statuses are constants; blocked tabs clickable | 01 §0 |
| C3 | Proposal workflow cannot complete in the UI (status never changes → Share/Sign never appear); AI narrative never saved or printed; branding/template tabs disabled | 06 A |
| C4 | Monthly report is a `proposals` row with no period, snapshot or PDF; any edit freezes all sections; month picker capped at 1,000 rows | 06 E |
| C5 | Tariff Builder fails every save; Google-Sheet imports write dropped tables; Eskom named three ways; extraction wipes NERSA increase %; "reprise" deletes unbundled charges | 03 §0.6 |
| C6 | Gantt saves shift dates −1 day in SAST; critical path ignores link type/lag; undo/milestone/dependency edit stubs | 06 B |
| C7 | Second "New Design" can never save (unique name); module config not restored; proposal System Design page blank; `maybeSingle` throws with 2+ layouts | 05 §9 |
| C8 | Destructive one-click actions: delete tenant(s), clear assignments, "Fix 30-min", "Clear Processed", "Full Sync" (can delete every meter) | 01, 02 |
| C9 | Settings (financial, derating, diversity, TOU) stored per browser; VAT toggle does nothing; branding saved to the wrong row; "Delete account" only signs out; password change needs no current password | 07 A.6 |

## D. Source-data gaps

| ID | Sev | Gap | Disposition |
|---|---|---|---|
| D1 | ✅ | ~~NERSA folder unreadable~~ — **resolved 2026-09-28**: synced and analysed (as-is/09). 177 licensee sheets, ~7,650 valued rows, 2025/26 only. WM's parser/seed verified broken (Standard period missing on 307/325 TOU plans, off-peak tagged peak, 628 rows 100× low, 387 empty plans, seed SQL fails) — do not load | PHASE 2 fresh parsers + 10 golden cases |
| D2 | ✅ | ~~Meter-CSV folder unreadable~~ — **resolved 2026-09-28**: all 2,140 files read (as-is/10). Three data formats (A 1,242 · B PnP 703 · C PnP kWh 73) + artefacts; golden fixtures confirmed | PHASE 3 |
| D12 | S1 | **The PnP (B) folders are largely mis-filed:** 703 files hold 29 serials / 43 distinct series; one series appears under 121 filenames at six malls; none of Kuruman's 170 files is a Kuruman meter per the downloader log; Flamwood Value and Fourways share 5 identical series with swapped labels. 2,050 meter files = 1,311 distinct series | PHASE 3 identity panel + body-hash dedupe; owner to re-download the affected PnP sites **[D-27]** |
| D13 | S1 | YARONA "BULK METER" does not reconcile (Σ tenants ≈ 2.5×; it matches the anchor tenant) — labels are not trustworthy | Bulk must be confirmed as point of supply before S1 |
| D14 | S1 | WM's parser on real files: client bulk path **doubles every A-format file** (defaults kW to kWh; YARONA 388 vs 194 kW); server path treats the PnP line-1 serial as the header and returns `success:true` with 117 of 5,953 rows and dates in years 319–659; half-load confirmed only for C files; raw data cut at 5,000 points; negatives dropped but matching positive spikes kept | DESIGN engine §2.1 |
| D15 | S2 | 45.6 % of PnP rows are `Calc` (estimated), 80 % of those zero padding; 102 PnP files are daily averages; 242 files have gaps > 7 days, 88 cover < 30 days; one file has a W-instead-of-kW segment | DESIGN engine §2.1–2.2 |
| D3 | S1 | Tariff data is 2025/26; **2026/27 municipal (from 1 Jul 2026) and Eskom 2026/27 (from 1 Apr 2026) missing**; NERSA 2026/27 guideline recorded as 9.01 % (unverified) | PHASE 2 — acquire and ingest both years |
| D4 | S1 | Municipal export/SSEG rates: 1 SSEG tariff in 177 licensees, no export rates. Eskom Gen-offset export tariffs, loss factors and wheeling tables **are** in the Eskom 2025/26 workbook (WM never loaded them; its Eskom parser also misses Homeflex). Net-Billing Rules require monthly settlement with carry-forward to FY end — WM had no such model | PHASE 2 (Eskom now; municipal export = user-supplied with provenance until SSEG books sourced) |
| D10 | S2 | Source books carry unit errors (R/kWh labelled c/kWh at Buffalo City, Gamagara; Ekurhuleni unitless; City Power reactive labelled demand) and province-specific layouts | PHASE 2 — unit inference flagged for review, per-province parser rules |
| D11 | S3 | Municipal books give seasons but not TOU hours | Calendar marked `assumed_eskom` until by-laws are sourced |
| D5 | S2 | WM tariff DB not reproducible from migrations (~1,978 plans / ~6,092 rates loaded out-of-band; seed refs missing province UUIDs); no provenance per value | DESIGN — rebuild from source documents, not migrate |
| D6 | S2 | ~23 % of meter files identified only by serial/code → a meter register is needed | PHASE 3 — meter kind/label mapping UI + owner-supplied register |
| D7 | S3 | Meter filenames carry shop no. and (likely) area m² — unused by WM | DESIGN functional §4.3 filename hints |
| D8 | S3 | Consolidation_Summary files (27 sites) unexplained, unused by WM | ⛔ inspect after hydration |
| D9 | S3 | No NRS 097-2-x / SSEG registration documents in the folder | Owner to supply or accept summary-level treatment |

## E. E-Site platform gaps (must be built for the add-on)

| ID | Gap | Resolution |
|---|---|---|
| E1 | No per-project entitlement (all unlocks per org/user); unlock route charges the caller's oldest org, takes no project | PHASE 1 — `project_feature_unlocks`, `has_project_feature`, project-aware route, webhook/refund/callback branches (data §2) |
| E2 | Sidebar lock flags per primary org, not per project | PHASE 1 |
| E3 | No module's data tables enforce a paywall in RLS | PHASE 1 — Solar is the first (data §2.3.3) |
| E4 | No utility tariff, meter interval, load profile, yield or weather model anywhere in E-Site | PHASES 2–4 |
| E5 | `FEATURE_PRICES.model` has no `'project'`; org unlock route would accept any key | PHASE 1 |
| E6 | Pricing inconsistency (Pro R999 in CLAUDE.md vs R1,499 in code); Paystack live mode still KYC-pending → no live purchase test possible | DECISION D-01; Paystack outstanding item |
| E7 | New schemas need the PostgREST PATCH; `types.ts` hand-maintained | PHASE 1 (D-22) |
| E8 | Any table with drawing coordinates must join `isAnnotated()` | PHASE 5 (contract test enforces) |
| E9 | Report kinds must be declared in `REPORT_KIND_READ_ROLES` / `report_kind_is_sensitive()` | PHASE 6 |
| E10 | Stranded migration PRs (#191 `00201`, #193 `00202`) below the head; collision risk | Claim numbers at apply time |

## F. Capabilities WM Solar never had (new in E-Site)

F1 versioned tariff library with provenance + review workflow · F2 SSEG/export modelling · F3 full monthly
bill engine with bill-check validation · F4 real 8760 load from interval data with day-type alignment ·
F5 transposition + temperature PV model validated against PVGIS/PVsyst · F6 array auto-fill with setbacks,
obstructions and row spacing · F7 string/MPPT voltage checks · F8 north reference · F9 BOM · F10 case
comparison + sensitivity · F11 tax (12B) and debt/PPA finance models · F12 frozen, hashed proposal
snapshots with evidential acceptance · F13 idempotent generation ingestion and guarantee derived from the
accepted case · F14 per-project paid entitlement enforced in the database.

## G. Web features whose gaps are fixed while carrying them over (not dropped)

| ID | Web feature | Gaps fixed in E-Site | Spec |
|---|---|---|---|
| G1 | Schematics | Only page 1 of a PDF; card sizes and line waypoints not saved; delete leaves lines; public bucket; hierarchy unused by any calculation | functional §13 |
| G2 | Schedule (Gantt) | Dates shift −1 day per save in SAST; critical path ignores link type and lag; undo/redo, milestone edit and dependency edit are stubs; filter presets in the browser | functional §14 |
| G3 | Solar Forecast | Open proxy functions; UTC hours as local; forecast not tied to operations | functional §3.3, §10 |
| G4 | Handover checklist | Depends on exact folder/template names; open RLS | functional §10 |
| G5 | Monthly report | No period/snapshot/PDF; edits freeze numbers; placeholder equipment table; YTD rows repeat the month | functional §10 |
| G6 | Quick Estimate / Sandbox | Hard-coded assumptions; sweep never runs; promote stub; scenarios not reloaded | functional §16 (Manual case + Sweep) |
| G7 | Projects list + map | XSS in popups; no entitlement awareness | functional §15 |
| G8 | 3D layout view | Read-only viewer kept; driven by the fixed geometry | functional §6.3 |
