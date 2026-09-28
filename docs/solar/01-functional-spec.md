# E-Site Solar — Functional Specification (target state)

**Status:** DRAFT for owner review · **Date:** 2026-09-28 · **Author:** Claude (review session)
**Scope:** the paid, per-project **Solar** add-on inside E-Site (`apps/web`, Next.js 15 App Router), plus its
platform tariff library and org settings. The mobile (Expo) scope is in §13.
**Companion documents:** `02-calculation-engine-spec.md` (every formula and default),
`03-data-model-and-security.md` (tables, RLS, entitlements), `04-gap-register.md` (what WM Solar does
wrong or lacks, and where each item is resolved), `05-development-plan.md`, `06-open-decisions.md`.
The as-built behaviour of WM Solar (every tab and button, with `file:line`) is in `as-is/01…11`.

> **How to read this document.** Every screen lists its controls in one table. A control that is
> not in a table does not exist. Any behaviour marked **[DECISION D-nn]** depends on an owner answer
> in `06-open-decisions.md`; the text gives the proposed default, which will be built unless the
> owner says otherwise. Nothing in this document is copied from WM Solar's code without being
> re-specified here: WM Solar is a behavioural reference, not a source to port (see gap register).

---

## 0. Conventions used throughout

### 0.1 Roles (E-Site roles, resolved per project by `user_effective_project_role`)

| Constant (new, in `packages/shared/src/types/index.ts`) | Members | Meaning in Solar |
|---|---|---|
| `SOLAR_WRITE_ROLES` | owner, admin, project_manager | Edit every Solar input, run simulations, generate reports, issue proposals |
| `SOLAR_TECH_READ_ROLES` | SOLAR_WRITE_ROLES + contractor, inspector | See Site, Load (without R values), Layout, Yield. **[D-04]** |
| `COST_VIEW_ROLES` (existing) | owner, admin, project_manager | See Tariff, Financials, any rand value, financial reports |
| `OWNER_ADMIN` (existing) | owner, admin | Buy the add-on; delete Solar data; change org Solar defaults |
| supplier | — | No Solar access |
| client_viewer | — | No admin-app access (bounced to `/portal` by `(admin)/layout.tsx`); sees only an **issued proposal** through the portal (§10.4) |

Every server action and API route re-checks role **and** entitlement; the page gate is never the only
gate (`app/api/*` sits outside `(admin)/layout.tsx`). `requireEffectiveRole` returns an object — every
call site checks `.ok`.

### 0.2 Entitlement states (per project) — see `03-data-model-and-security.md §2`

| State | How it arises | What the user sees |
|---|---|---|
| **Locked** | No active unlock row for the project, and no org-wide Solar subscription | Sidebar item "Solar" with a lock badge. Every `/solar/*` route redirects to `/solar/unlock`. |
| **Unlocked** | Active `billing.project_feature_unlocks(project_id, 'solar')` row, or org Solar subscription active **[D-01]**, or WM-Consulting internal org bypass | Full module per role |
| **Revoked** | Refund/chargeback sets `revoked_at` | **Read-only**: all tabs render, every mutating control is disabled with tooltip "Solar was refunded for this project — contact an owner/admin to re-activate". Existing reports stay downloadable. **[D-02]** |

### 0.3 Common page chrome (all gated Solar pages)

`app/(admin)/projects/[id]/solar/(gated)/layout.tsx` renders:

| Control | Type | Purpose | Behaviour | Enabled / roles |
|---|---|---|---|---|
| Tab bar: Overview · Site & Supply · Load · Tariff · Layout · Yield & Scenarios · Financials · Reports & Proposal · Operations | Link tabs (`?`-free URLs: `/solar/overview`, `/solar/site`, `/solar/load`, `/solar/tariff`, `/solar/layout`, `/solar/yield`, `/solar/financials`, `/solar/reports`, `/solar/operations`) | Move between steps of the study | Plain navigation; no auto-save on tab change (each tab saves explicitly — WM's "save on tab change" is dropped). Unsaved-changes guard: browser `beforeunload` + in-app confirm "Discard unsaved changes?" | Tariff + Financials hidden for roles outside `COST_VIEW_ROLES`. Operations hidden until **[D-12]** Phase 7 ships |
| Status dot on each tab | Indicator (grey = not started, amber = incomplete, green = complete, red = blocking error) | Show readiness at a glance | Computed server-side by `getSolarReadiness(projectId)` from the rules in §2.3 — **no hard-coded statuses** (WM shipped six constants). Tooltip = the exact rule outcome, e.g. "Load: 2 of 14 tenants unassigned" | All roles |
| "Stale" banner | Banner | Tell the user that results no longer match inputs | Shown on Yield, Financials and Reports when the selected case's stored `inputs_hash` ≠ hash of current inputs (engine spec §1.3). Button **Re-run selected case** (same as Yield → Run) | Button: `SOLAR_WRITE_ROLES` |
| Read-only banner | Banner | Explain why controls are disabled | Shown when entitlement = Revoked, or role ∉ `SOLAR_WRITE_ROLES` ("You can view this study; only owners, admins and project managers can change it") | — |

### 0.4 Rules that apply to every control

1. **Destructive actions** (delete, replace, clear, re-import over existing) use a two-step inline
   confirm (first press arms, second commits, 3 s auto-disarm) — never `window.confirm` (Safari
   suppresses it). Bulk destructive actions show the count ("Delete 12 meters?").
2. **Every save** carries `expectedUpdatedAt`; a stale write is refused with "Someone else changed this
   — reload to see their version" (the route-measurement pattern).
3. **Every number** shows its unit. Money is ZAR, VAT-exclusive unless the label says "incl. VAT".
   Energy kWh/MWh, power kW/kWp/kVA, area m². Units are stored, never inferred from magnitude.
4. **Every async action** disables its button, shows a spinner, and reports completion only after the
   server confirms (WM's "Done before the write" pattern is forbidden).
5. **Every failure** shows a human sentence, never a raw Postgres/PostgREST error.
6. **Every list** has an empty state with the one action that fills it.
7. **Strings reaching a PDF** pass through `winAnsiSafe` (react-pdf) — `kWp`, `m²`, `°` are safe;
   `Ω`, `≤`, `→`, `✓` are not and must be spelled out.
8. **Analytics:** each primary action emits a `product_events` row (`solar_*` verbs, widening the CHECK
   in the same migration).

---

## 1. Entry points and the unlock page

### 1.1 Sidebar entry

| Control | Type | Purpose | Behaviour | Roles |
|---|---|---|---|---|
| **Solar** (lucide `Sun` icon) in `projectNav(id)` (`Sidebar.tsx:71-90`), placed after "Medium Voltage" | Nav link | Open the Solar module for this project | → `/projects/[id]/solar` → redirects to `/solar/overview` (unlocked) or `/solar/unlock` (locked). Lock badge when Locked, computed per **project** (the layout must receive the project id; today lock flags are per primary org) | Visible to `SOLAR_TECH_READ_ROLES`; hidden for supplier. Always visible even when locked (JBCC UX) |

### 1.2 `/projects/[id]/solar/unlock` (outside the `(gated)` group so the redirect cannot loop)

Purpose: explain the add-on and let an owner/admin buy it for this project.

| Control | Type | Purpose | Behaviour | Data | Roles / enabled | States |
|---|---|---|---|---|---|---|
| Feature summary card | Static content | Tell the buyer what they get | Lists: tariff library access, meter-data load modelling, PV layout on project drawings, yield & battery simulation, financial model, branded feasibility report, client proposal with e-acceptance, (Phase 7) operations monitoring | — | All with access | — |
| Price line | Text | Show the price | Reads `FEATURE_PRICES.solar` (`model: 'project'`, amount **[D-01]**), VAT statement | `billing.service.ts` | — | — |
| **Unlock Solar for this project** | Primary button | Start payment | `POST /api/paystack/project-feature-unlock {projectId, featureKey:'solar'}` → Paystack `transaction/initialize` with metadata `{type:'project_feature_unlock', feature_key:'solar', project_id, org_id (derived from the project), return_to:'/projects/[id]/solar'}` → browser redirected to Paystack | Writes nothing until the webhook | `OWNER_ADMIN` of the **project's** org. Others see "Ask an owner or admin to unlock Solar" instead of the button | 409 "Already unlocked" → auto-redirect to overview; rate-limited 5/min; Paystack error → "Payment could not start — try again" |
| **Subscribe for all projects** | Secondary button | Org-wide option | Only rendered if **[D-01]** chooses to offer an org subscription. `POST /api/paystack/solar-subscribe` (MV-subscription pattern keyed on org) | — | `OWNER_ADMIN` | — |
| Return handling | — | After Paystack | `GET /api/paystack/callback` shows "Payment received — activating Solar…" and polls `has_project_feature` for up to 30 s; the **webhook** is the only writer of the unlock row | `billing.project_feature_unlocks` | — | Timeout → "We have not received confirmation from Paystack yet. This page will update when it arrives." |

---

## 2. Overview tab — `/solar/overview`

**Purpose.** The study's home page: where the project is in the workflow, what is missing, and the
headline answer from the **selected case** (the one design that reports and proposals use).

### 2.1 Layout (top to bottom)
1. Study header: project name, site address, supply authority + tariff (if chosen), selected case name.
2. Readiness checklist (§2.3).
3. Headline KPIs of the selected case (§2.4) — or an empty state.
4. Recent activity (last 10 `solar` audit events: imports, runs, reports, proposals).

### 2.2 Controls

| Control | Type | Purpose | Behaviour | Data | Roles | Empty / error |
|---|---|---|---|---|---|---|
| Checklist row (one per step) | Link row | Jump to the step that is incomplete | Navigates to the tab; shows the rule text and status dot | `getSolarReadiness` | All Solar roles | — |
| **Change selected case** | Select | Choose which case feeds reports/proposals | Lists cases with a completed run; sets `solar.studies.selected_case_id` | `solar.studies` | `SOLAR_WRITE_ROLES` | No completed runs → disabled, "Run a case on Yield & Scenarios first" |
| **Open case** | Link | Go to the case | → `/solar/yield?case=<id>` | — | Tech-read | — |
| **Generate feasibility report** | Button | Shortcut | Same action as Reports → Generate (§10.2) | — | `SOLAR_WRITE_ROLES` ∩ `COST_VIEW_ROLES` | Disabled while the selected case is Stale, with reason |
| Activity item | Link | See what changed | Opens the related object | `solar.audit_events` | All Solar roles | "No activity yet" |

### 2.3 Readiness rules (single source for tab dots and the checklist)

| Step | Complete (green) when | Incomplete (amber) when | Blocking (red) when |
|---|---|---|---|
| Site & Supply | coordinates set, supply authority set, connection capacity (NMD kVA) set | any of the three missing | coordinates outside South Africa's bounding box (warn, allow override) |
| Load | site load series exists covering ≥ 12 months at ≤ 60-min resolution **or** a synthesised profile has been accepted, and every non-vacant tenant is either metered or synthesised | coverage < 12 months, or tenants unassigned | an accepted import has a failing validation error (§4.3) |
| Tariff | a published tariff is pinned for the project and the export rule is set (credit or "no export credit") | tariff pinned but export rule missing | pinned tariff's year is superseded **and** no escalation path chosen |
| Layout | ≥ 1 array with ≥ 1 module and a north reference; **or** the case uses "manual system size" | layout started but no north reference | an array lies outside every roof area |
| Yield & Scenarios | selected case exists, last run succeeded, not Stale | cases exist but none selected, or Stale | last run failed |
| Financials | selected case has capex > 0 and a finance model | capex default untouched (warn "using org defaults") | — |
| Reports & Proposal | a feasibility report version exists for the selected case's current run | — | — |

### 2.4 Headline KPIs (all from the selected case's stored run — never recomputed in the browser)

PV size (kWp DC / kW AC) · Battery (kWh / kW) · Year-1 PV yield (MWh, and kWh/kWp) · Self-consumption % ·
Solar fraction of load % · Export (MWh) · Year-1 bill before / after (R, excl. VAT) · Year-1 saving (R) ·
Simple payback (years) · IRR (%) · NPV (R) · LCOE (R/kWh). Rand values hidden for roles outside
`COST_VIEW_ROLES`. Empty state: "No case has been run yet — start at Site & Supply."

---

## 3. Site & Supply tab — `/solar/site`

**Purpose.** Everything about *where* the system goes and *how it connects*. Replaces WM's
Overview system-config panel, the Solar Forecast map and part of Schematics.

### 3.1 Sections
A. Location · B. Supply authority & connection · C. Roof sources (drawings) · D. Site constraints.

### 3.2 Controls

| Control | Type | Purpose | Behaviour | Data | Roles | Validation / states |
|---|---|---|---|---|---|---|
| Address (read-only, from project) | Text | Show the project address | Copied from `projects.projects`; link "Edit in project settings" | projects | all | — |
| **Locate from address** | Button | Get coordinates | Server action geocodes the project address (server-held key; **[D-08]** provider) and proposes lat/lng; user must press **Use these coordinates** | `solar.studies.latitude/longitude` | `SOLAR_WRITE_ROLES` | No match → "Address not found — drop a pin instead" |
| Map with draggable pin | Map | Set/adjust exact site location | Drag pin → shows new lat/lng → **Save location** | same | write | Outside SA bounds → warning (not a block) |
| Latitude / Longitude | Number inputs (6 dp) | Manual entry | Validated −35..−22 / 16..33 (warning outside) | same | write | — |
| Elevation (m) | Number | Used by weather & temperature model | Auto-filled from PVGIS response when weather is fetched; editable | `solar.studies.elevation_m` | write | — |
| Supply authority | Searchable select | Which licensee bills the site | Lists `tariffs.licensee` (Eskom + municipalities/metros), filtered by the province of the coordinates first | `solar.studies.licensee_id` | write | Changing it clears the pinned tariff after confirm |
| Customer type | Select: Eskom direct / Municipal / Private (embedded network, e.g. landlord resale) | Determines which tariff family and SSEG rules apply | Private shows extra field "Resale tariff basis" **[D-10]** | `solar.studies.supply_type` | write | — |
| Notified maximum demand (NMD, kVA) | Number | Network-access charge basis and export cap | Pre-filled from the main incomer node's `rating_kva` if present (`structure.nodes`, kind `main_board`/`mini_sub`), else blank | `solar.studies.nmd_kva` | write | Required for readiness |
| Supply voltage | Select: LV 400 V / MV 11 kV / MV 22 kV / other (V) | Tariff voltage band + export limits | — | `supply_voltage_v` | write | — |
| Point of connection node | Select from `structure.nodes` (main boards, mini-subs, RMUs) | Where the inverter AC output connects | Shows node rating; used for the export-limit check and to create an AC cable-schedule supply later (§7.6) | `poc_node_id` | write | Optional |
| Transformer / mini-sub rating (kVA) | Number (auto from node) | Hosting-capacity check | Engine flags PV AC > 75 % of transformer kVA **[D-09 the %]** as an NRS 097-2-3 simplified-connection warning | derived | — | Warning only |
| **Export allowed?** | Select: Yes (net billing) / Yes (no credit) / No (zero-export controller) | How surplus energy is treated | Drives the engine's export handling (engine spec §6) and Tariff tab export rule default | `export_mode` | write | — |
| Export limit (kW) | Number | Zero/limited export | Shown when export allowed; default = min(NMD × 0.9?, authority SSEG cap) **[D-09]** | `export_limit_kw` | write | — |
| Roof sources list | Table of linked drawings | Choose which project drawings are roof plans | Row: drawing name, page, calibrated? (✓/✗ scale), north set? Links to Layout. **Add roof drawing** opens a picker over `tenants.floor_plans` of this project (no upload here — uploads go through Floor Plans/Documents so Dropbox sync keeps working) | `solar.roof_sources(floor_plan_id, page_index)` | write | Empty: "Add the roof plan from the project's drawings" |
| **Calibrate scale** (per roof source) | Button | Set pixels-per-metre | Opens the existing calibration flow (`calibrateFloorPlanAction`, per page, role-gated) | `tenants.floor_plan_page_scales` | write | — |
| Satellite image source | Button **Capture satellite view** | Roof background when no drawing exists **[D-08]** | Server fetches a static satellite tile for the coordinates at known zoom, stores it as a file in Storage, records metres-per-pixel from the tile maths and bearing 0 (north up) — no html2canvas | `solar.roof_sources(kind='satellite', storage_path, m_per_px)` | write | Attribution text stored and printed |
| Site constraints notes | Textarea | Record shading objects, structural limits, access | Free text, printed in the report appendix | `solar.studies.constraints_note` | write | — |

---

## 4. Load tab — `/solar/load`

**Purpose.** Build the site's **consumption time series** (8,760 hourly values for one reference year,
kW average per hour, with the true 15/30-min maximum demand kept separately for demand charges).
Replaces WM's Tenants tab, Load Profile tab and the global Load Profiles page.

### 4.1 Sub-tabs
**Meters** (import & library) · **Tenants** (assignment & synthesis) · **Site profile** (result & charts) · **Checks** (validation reports).

### 4.2 Load sources (a study may combine them; precedence is explicit)

| Source | When to use | Result |
|---|---|---|
| **S1 Bulk/council meter** interval data | The site has a bulk or incomer meter | Site load = bulk meter series (minus any existing PV export channel) |
| **S2 Tenant meters** | Sub-meters per tenant | Site load = Σ tenant series × (1 + common-area allowance %) — used when no bulk meter, and as a reconciliation check when there is one |
| **S3 Synthesised** from the tenant schedule | Design stage, no meter data | For each tenant node: `shop_area_m2` × category density (W/m²) × archetype 8760 shape (engine spec §2.4) |
| **S4 Monthly bills** | Only monthly kWh (and kVA) known | Archetype shape scaled so each month's energy equals the bill (and the peak equals the billed kVA × PF) |

`Load basis` select at the top of the tab: **Bulk meter (S1)** / **Sum of tenants (S2 + S3 for unmetered tenants)** / **Monthly bills (S4)**. The engine only ever reads the resulting site series.

### 4.3 Meters sub-tab

Purpose: get raw meter exports in, understand them, and turn them into clean interval channels.

| Control | Type | Purpose | Behaviour | Data | Roles | Validation / states |
|---|---|---|---|---|---|---|
| **Upload meter files** | Button + drop zone (multi-file: .csv .txt .xls .xlsx, ≤ 50 MB each) | Bring in meter exports | Browser uploads **directly to Storage** (`solar-meter-raw/<org>/<project>/<sha256>.<ext>`) — never through a Vercel function (4.5 MB cap). Then `POST /api/projects/[id]/solar/meter-files/parse {fileIds}` parses server-side from Storage | `solar.meter_files` | write | Duplicate sha256 → "Already imported on <date> as <meter>" (skipped, not re-imported) |
| **Import from Dropbox folder** | Button | Pull a site's meter folder | Lists files under the project's cloud-storage mapping filtered to meter extensions; user ticks files → same pipeline | cloud-sync | write | Hidden if the project has no cloud mapping |
| **Copy from org meter library** | Button | Reuse a meter already imported for another study in the same org | Dialog: search by site/label/serial; copying creates a *reference* (no data duplication) | `solar.study_meters` | write | Only same-org meters are listed (WM leaked every project's meters) |
| Import review dialog (opens per file after parse) | Dialog, one step per file | Let the user confirm what the parser guessed | Shows: detected format (e.g. "PnP SCADA"), delimiter, header row, date order (YMD/DMY/MDY — **must be confirmed when ambiguous**), interval, timezone convention (interval-ending default), every channel with quantity/unit/direction, the **primary channel** (import energy by default; export for meters labelled solar/PV/generation), cumulative vs interval, filename hints (site, shop no., label, area m², serial) | — | write | — |
| Channel unit override | Select per channel: kWh, Wh, MWh, kW, W, MW, kVA, kVAh, kvarh, A, V, PF | Correct a wrong guess | Re-runs normalisation preview | — | write | — |
| Meter kind | Select: tenant / bulk / council / generator / solar / common area / vacant / unknown | Tells the load builder what the meter measures | Solar and generator meters are **excluded from load** automatically | `solar.meters.kind` | write | Required |
| Link to tenant | Select from tenant schedule (`structure.nodes`) | Tie the meter to a shop | Pre-selected by shop number from the filename hint | `solar.meters.node_id` | write | — |
| Validation summary (inside the dialog) | Panel | Show data quality before commit | Period, completeness %, longest gap, zero runs ≥ 6 h, negatives, duplicates, spikes, `24:00` rows, rollovers, implied W/m² vs area | `solar.meter_import_reports` | — | **Errors block commit** (unparseable timestamps, <50 % completeness); warnings do not |
| **Accept & import** | Button | Commit the file | Writes channels + readings (NULL + quality flag for gaps, never 0) | `meter_channels`, `meter_readings` | write | Only after every error cleared |
| **Skip this file** | Button | Leave a file out | Keeps the raw file (auditable), marks it `skipped` | `meter_files.status` | write | — |
| Meters table | Table: label, kind, tenant, period, interval, completeness, peak kW (true interval max), annual kWh, status | Overview of all meters in the study | Row click → meter detail drawer | `solar.meters` | tech-read | Empty: "Upload meter exports or synthesise load from the tenant schedule" |
| Meter detail drawer → **Chart** | Line chart (zoomable, full resolution) | Inspect raw data | Toggle channel; shows gaps shaded | readings | tech-read | — |
| → **Heatmap** | Day × time-of-day heatmap | See patterns and gaps | — | derived | tech-read | — |
| → **Edit mapping** | Button | Reopen the review dialog | Re-normalises from the stored raw file; previous version kept in history | — | write | — |
| → **Remove from study** | Button (two-step) | Drop a meter | Removes the study link; the org library copy stays unless it has no other study (then offered: "Also delete from library?") | — | write (library delete: OWNER_ADMIN) | — |
| → **Download normalised CSV** | Button | Export clean data | `ts_end (SAST), value, unit, quality` | — | tech-read | — |

### 4.4 Tenants sub-tab

Purpose: decide, per tenant, where its load comes from.

| Control | Type | Purpose | Behaviour | Data | Roles | States |
|---|---|---|---|---|---|---|
| Tenant table (from `structure.nodes` kind `tenant_db`, not deleted) | Table: shop no., name, category, area m², source (Metered / Synthesised / Excluded), meter(s), annual kWh, W/m² average, peak kW | See every tenant's load basis | Read from the tenant schedule — **no separate tenant list** (WM kept its own) | `structure.nodes`, `solar.tenant_load_basis` | tech-read | Empty: "No tenants in the tenant schedule — import one on the Tenant Schedule page, or use Bulk meter / Monthly bills basis" |
| Source select per row | Select | Choose metered/synthesised/excluded | Metered requires ≥ 1 linked meter | `tenant_load_basis.source` | write | — |
| **Assign meters** per row | Dialog: pick one or more meters + weight per meter (default 1.0, sum shown) | Tenants with several meters | Tenant series = Σ(weight × meter series) — **sum, weighted, explicit** (WM averaged) | `tenant_load_basis.meters jsonb` | write | Weight ≤ 0 refused |
| Category (read-only, from node) + **Override density (W/m²)** | Number | Correct a synthesised tenant | Default from org defaults (§11) per category | `tenant_load_basis.density_override` | write | — |
| Archetype | Select: retail, fast food, restaurant, supermarket (refrigeration), bank/office, gym, anchor (24 h), vacant | Daily/seasonal shape for synthesis | Defaults from category mapping **[D-06]** | same | write | — |
| Occupancy start (from BO date) | Date (read-only from `tenant_details`) | Ramp load in from beneficial occupation | Synthesised load is 0 before BO date in year 1 (engine spec §2.4) | — | — | — |
| **Auto-match meters** | Button | Link meters to tenants in bulk | Matches filename shop numbers and labels to nodes; shows proposed pairs with confidence; user ticks and **Apply** | — | write | Never auto-applies |
| **Exclude vacant** | Bulk action | Quickly exclude vacant shops | Sets source = Excluded for nodes named/flagged vacant | — | write | Two-step confirm with count |
| Common-area allowance (%) | Number | Load not on tenant meters (malls: lighting, HVAC, lifts) | Added to Σ tenants for basis S2 | `solar.studies.common_area_pct` | write | 0–100 |

### 4.5 Site profile sub-tab

| Control | Type | Purpose | Behaviour | Data | Roles |
|---|---|---|---|---|---|
| Load basis select (see §4.2) | Select | Choose how the site series is built | Saving recomputes `solar.site_load` (server) and marks cases Stale | `studies.load_basis` | write |
| Reference year select | Select (years present in data) | Which calendar year's weekday/holiday pattern to use | Multi-year data is aligned to the reference year by day-type (engine spec §2.2) | `studies.reference_year` | write |
| Load growth (%/yr) | Number | Future consumption change | Applied in the 20/25-year cashflow only | `studies.load_growth_pct` | write |
| Diversity factor | Number 0.5–1.0 (default 1.0) | Reduce the design peak of synthesised tenants | Affects only the synthesised design maximum demand (engine spec §2.5) — energy is never reduced. Disabled when the basis is measured data | `studies.diversity_factor` | write |
| **Rebuild site profile** | Button | Force a recompute | Server job; shows progress | — | write |
| Charts: Annual (8760 line), Average day by month (12 × 24), Weekday/Saturday/Sunday profiles, Monthly energy bars, Load duration curve | Charts | Understand the load | Hover shows kW/kWh; legend toggles; **Download PNG**, **Download CSV** per chart | derived | tech-read |
| KPI strip: annual kWh, peak kW (interval max), load factor, day/night split %, TOU split % (per pinned tariff calendar) | Stats | Summary | — | derived | tech-read (TOU split visible to all; R values none here) |
| Reconciliation card (when bulk + tenants both exist) | Stats | Check data consistency | Monthly Σ tenants vs bulk (%), flag > ±10 % | derived | tech-read |

### 4.6 Checks sub-tab
List of every import report and every site-level check (period alignment across meters, bulk vs tenant
reconciliation, duplicates by sha256/serial, PV meters excluded). Each row: severity, message, link to the
object. **Mark as acknowledged** (write roles) records who accepted a warning.

---

## 5. Tariff tab — `/solar/tariff` (COST_VIEW_ROLES only)

**Purpose.** Pin the exact published tariff the site pays, see every charge, and set the export
credit rule. Reference data is **read-only** here; a project can hold an explicit override copy.

| Control | Type | Purpose | Behaviour | Data | Roles | States |
|---|---|---|---|---|---|---|
| Licensee (read-only from Site & Supply) | Text + link | Context | — | — | — | Missing → "Choose the supply authority on Site & Supply" |
| Financial year | Select (published years for the licensee) | Pick the tariff year | Defaults to the year covering today; superseded years labelled "(superseded)" | `tariffs.tariff_year` | write | Latest year missing → amber note "2026/27 not yet published in the library — using 2025/26 with escalation" |
| Tariff | Searchable select, grouped by category (domestic, commercial, industrial, agricultural, bulk, SSEG) with filters: metering, phase, voltage band, amp/kVA range | Choose the tariff | Shows only tariffs whose eligibility matches NMD/voltage (others under "Show all") | `solar.studies.tariff_id` | write | — |
| Charges table | Table: component, season, TOU period, block range, amount, unit, source (document + page/cell link) | See exactly what will be billed | Every stored charge — nothing hidden. **View source** opens the stored tariff book at the cited page | `tariffs.charge` | cost-view | — |
| TOU calendar | Clock/grid diagram (weekday, Saturday, Sunday × high/low season) + public-holiday list | Show TOU windows | From `tariffs.tou_calendar` — never browser storage | — | cost-view | Non-TOU tariff → "Flat-rate tariff (no time-of-use)" |
| Export / SSEG rule | Panel: crediting method (net billing / none), export rate(s) by season/TOU, settlement period, cap rule, requirements (bidirectional meter, TOU tariff) | How exported kWh is valued | From `tariffs.sseg_rule` + export-credit charges; if none published: select **"No export credit (R0)"** (default) or **"Enter export rate manually"** | `solar.studies.export_rule` | write | Missing rule blocks Tariff readiness |
| **Create project override** | Button | Adjust a rate for a negotiated/landlord tariff | Copies the pinned tariff into `solar.tariff_overrides` (charge rows editable, each with a reason). Engine uses the override; the report prints "Project-specific rates" | override tables | write | — |
| Override row edit | Inline number + unit (unit select, required) + reason | Change one rate | Validation: same plausibility ranges as ingestion | — | write | — |
| **Revert to published tariff** | Button (two-step) | Drop the override | — | — | write | — |
| Escalation path | Table: year n → % (default: approved increase for published years, then org default **[D-07]**) | Future tariff increases | Used by the cashflow | `studies.escalation` | write | — |
| Bill check | Panel: upload/enter one real monthly bill (kWh by TOU, kVA, total R) | Prove the tariff model | Engine costs that month's load on the pinned tariff and shows modelled vs actual, % difference | `solar.bill_checks` | write | > ±5 % → amber "Model differs from the bill" |
| **Report a tariff error** | Link | Send a correction to the library maintainers | Creates a work item of type `solar_action` assigned to platform tariff admins with tariff id + note | work items | cost-view | — |

---

## 6. Layout tab — `/solar/layout`

**Purpose.** Design the PV arrays on the project's calibrated roof drawings (or a satellite
capture), producing the array list (modules, kWp, tilt, azimuth, strings) that the simulation uses.
Built on E-Site's sheet primitives (`use-sheet-image`, `use-sheet-viewport`, `draft-store`) and a new
Konva `SolarCanvas`, sibling of `RouteCanvas`. WM's hand-written canvas is **not** ported.

### 6.1 Layout
Left: layout list + layer panel. Centre: canvas. Right: properties of the selection, and the
Summary (kWp, modules, inverters, strings, DC/AC ratio, checks).

### 6.2 Layout list

| Control | Type | Purpose | Behaviour | Data | Roles |
|---|---|---|---|---|---|
| Layout list | List | Several design options per project | Each layout: name, roof source, kWp, updated | `solar.layouts` | tech-read |
| **New layout** | Button | Start a design | Dialog: name (unique per study, validated **before** save), roof source (from §3), module type, default tilt | — | write |
| **Duplicate** | Button | Branch a design | Copies all objects | — | write |
| **Rename** / **Delete** | Buttons | Housekeeping | Delete is two-step; refused if a case uses the layout ("Used by case X — change the case first") | — | write |

### 6.3 Toolbar (every tool)

| Tool / control | Key | Purpose | Behaviour |
|---|---|---|---|
| Select / move | V | Select, move, multi-select (shift/drag box) | Transformer handles for rotate; **one undo step per drag (committed on release)** |
| Pan / zoom | Space-drag, wheel, pinch, **Fit** | Navigate | From `use-sheet-viewport`; touch supported |
| **Set north** | N | North reference | Click two points or type bearing (° clockwise from sheet-up). Required before azimuths are valid. Satellite sources default to 0° |
| **Roof area** | R | Draw a roof plane polygon | Click vertices, double-click/Enter to close. Properties: name, roof type (flat / pitched / carport / ground), pitch °, pitch direction (azimuth, auto from north + drawn fall-line), height m, edge setback m (default per org), max load kg/m² (note only) |
| **Obstruction / keep-out** | O | Plant, skylights, walkways, shade objects | Polygon or circle; setback m; height m (for inter-row/near shading estimate, engine spec §3.6) |
| **Auto-fill array** | F | Place modules in a roof area | Dialog: module (from catalogue), orientation (portrait/landscape), layout (flat-mount / tilted racking rows with tilt °), row spacing = auto (no shading at winter-solstice solar noon ± N hours **[D-11]**) or manual pitch m, module gaps mm, setback respected, obstructions respected. Preview → **Place**. Algorithm: engine spec §3.1 |
| **Place array (manual)** | A | Draw a rectangular block of modules | Drag rectangle → rows × columns filled, snapped to roof edge |
| **Delete modules** | Del / Backspace | Remove selected modules or objects | Works on every object type (WM missed cables) |
| **Inverter** | I | Place an inverter symbol | Pick from catalogue; properties: AC kW, MPPTs, max DC V, MPPT V range, max input current |
| **Assign strings** | S | Group modules into series strings on an MPPT | Click modules in order or **Auto-string** (fills strings of the recommended length per engine spec §3.3). Shows Voc(cold) and Vmp(hot) per string with pass/fail |
| **Battery / DB / combiner** | B | Place equipment symbols | Link DB symbols to existing `structure.nodes` (not free-floating) |
| **Trace AC cable** | — | Inverter → point of connection | Opens the existing route-tracing tool for a new `cable_schedule` supply (§7.6); no separate cable model in Solar |
| **Measure** | M | Distance check | Temporary; not saved |
| Undo / Redo | ⌘Z / ⇧⌘Z | — | Snapshot history (`route-history` pattern) |
| **Save** | ⌘S | Persist | Writes changed objects with `expectedUpdatedAt`; local IndexedDB draft autosaves every change (`draft-store`); leaving with unsaved changes prompts |
| **3D preview** | — | Visual check | Read-only extrusion of roof planes and tilted modules **[D-13: keep or drop]** |
| **Export layout sheet** | — | Deliverable | Server renders a PDF (drawing crop + arrays + string colours + legend + north arrow + scale bar + title block) into `projects.reports` kind `solar_layout_sheet`, versioned |

### 6.4 Properties panel (selection-dependent) and Summary

Array: module type, count, orientation, tilt °, azimuth ° (derived from north + roof, overridable), mounting
(flush/racked), row pitch, kWp. Inverter: model, AC kW, strings per MPPT. Summary: DC kWp, AC kW, DC/AC
ratio, module count by type, inverter count, string checks (pass/fail count), roof utilisation %, BOM
(**Download BOM CSV**: module, inverter, mounting estimate, DC cable estimate). **Push to case** button:
creates/updates a case's system definition from this layout (§7.2) — explicit, never silent.

### 6.5 Rules
- Coordinates are image pixels of the drawing page at the fixed scale-2 raster, anchored to
  `floor_plan_id + page_index + file_path + source_revision_id` (the `floor_plan_markups` pattern). If
  the drawing file changes, the layout shows "The drawing has changed since this layout was drawn"
  and does not auto-realign.
- `solar.layout_objects` **must be added to `isAnnotated()`** in `cloud-sync-project` so Dropbox
  auto-adopt never swaps the drawing under a layout (the schema-derived contract test enforces it).
- Metres come from the page scale at draw time, stored per object (`pixels_per_meter` snapshot).

---

## 7. Yield & Scenarios tab — `/solar/yield`

**Purpose.** Define **cases** (design options), run the one engine on each, and compare them.
Replaces WM's Simulation, Solar Forecast, Quick Estimate, Sandbox and Calculator — **one engine, one
set of numbers**.

### 7.1 Case list

| Control | Type | Purpose | Behaviour | Data | Roles |
|---|---|---|---|---|---|
| Case list (cards) | List | See every option | Card: name, kWp, battery, last run time, status (Not run / Running / Done / Failed / Stale), headline yield & saving (saving hidden outside cost-view) | `solar.cases`, `solar.case_runs` | tech-read |
| **New case** | Button | Add an option | Dialog: name; start from (layout X / manual size / copy of case Y) | — | write |
| **Duplicate**, **Rename**, **Delete** | Buttons | Housekeeping | Delete refused for the selected case and for cases referenced by an issued proposal | — | write |
| **Set as selected** | Button | Choose the case for reports/proposals | Same as Overview select | `studies.selected_case_id` | write |
| **Compare** | Button (select 2–4 cases) | Side-by-side | Table of every KPI and a monthly energy chart per case | — | tech-read (R rows cost-view) |

### 7.2 Case editor — sections and controls

| Section | Controls (type → purpose → default) |
|---|---|
| **PV system** | Source: *From layout* (select layout → arrays, tilt, azimuth, modules, inverters copied read-only; **Refresh from layout** button) or *Manual* (DC kWp, AC kW, tilt °, azimuth °, module type). DC/AC ratio shown (derived, not an input). |
| **Losses** | Mode *Standard* (soiling 2 %, near shading 3 % or computed from obstructions, mismatch 1 %, DC wiring 1.5 %, AC wiring 1 %, LID/LeTID 1.5 %, availability 1 %, inverter efficiency from catalogue curve, temperature from model) or *Detailed* (full loss chain per engine spec §3.5). Every loss is an input with its default shown; **Reset to defaults**. |
| **Degradation** | Year-1 % (default 2.0), annual %/yr (default 0.5), from module datasheet when available. |
| **Weather** | Source: **PVGIS TMY (default)** — **Fetch** button (server fetch, cached per rounded lat/lng, UTC→SAST conversion); *Upload measured weather* (CSV: GHI, DHI, temp, wind hourly); GSA PVOUT shown as a sanity check ("PVGIS 1,690 vs GSA 1,712 kWh/kWp — within 5 %"). Solcast is **not** a yield source **[D-08]**. |
| **Battery** | Enabled toggle. Usable capacity kWh, max charge kW, max discharge kW, round-trip efficiency % (default 90), SoC min/max % (default 10/95), initial SoC %, strategy: *Self-consumption* / *TOU arbitrage* / *Peak shaving (target kW)*, *Allow grid charging* (default off; on only for arbitrage), backup reserve % (for load-shedding value). Replacement year and cost (Financials). |
| **Grid / export** | Export mode and limit (inherited from Site & Supply, overridable per case), inverter AC cap. |
| **Load** | Inherited site load (read-only summary); case-level load adjustment % for "what-if". |
| **Load-shedding value** (optional) | Toggle; stage scenario **[D-14]**; hours/year avoided × value R/kWh — reported **separately**, never merged into the base IRR. |

Buttons: **Save case** (validates; marks Stale), **Run** (server `POST /api/projects/[id]/solar/cases/[caseId]/run`,
`runtime='nodejs'`, `maxDuration` 60 s; stores inputs snapshot, `inputs_hash`, engine version, outputs),
**Cancel** (while running), **Discard changes**.

### 7.3 Results (per completed run)

| Element | Content | Controls |
|---|---|---|
| KPI strip | Specific yield kWh/kWp, PR %, annual PV MWh, self-consumed MWh, export MWh, curtailed MWh, grid import before/after MWh, solar fraction %, self-consumption %, peak demand before/after kW (interval) | — |
| Energy flow chart | Typical day per month (PV, load, import, export, battery) | Month select, day-type select |
| Annual chart | 8760 zoomable | Zoom, **Download CSV (8760 hourly: load, PV AC, self-use, export, import, battery SoC)** |
| Monthly table | Per month: PV, load, import, export, TOU split of import before/after, max demand before/after | **Download CSV** |
| Loss waterfall | Every loss step from irradiation to AC output | — |
| Checks | String voltage checks, DC/AC ratio (warn outside 1.0–1.4), export > limit hours, transformer loading | — |
| Provenance footer | Engine version, weather source + fetch date, tariff id + year, inputs hash, run by, run at | — |

**Every KPI anywhere in the module comes from this stored run.** No parallel "simplified estimate" is shown.

---

## 8. Financials tab — `/solar/financials` (COST_VIEW_ROLES)

**Purpose.** Capital cost, running costs, finance structure and the resulting cashflow for the
selected (or chosen) case.

| Section | Controls | Behaviour / defaults |
|---|---|---|
| Case select | Select | Financials are per case (stored with the case) |
| **Capex** | Line-item table: category (modules, inverters, mounting, DC BOS, AC BOS, battery, grid connection/protection, civils, labour, design & professional fees, project management, contingency), qty, unit, rate, amount; **Add line**, **Delete line**, **Apply org rate card** (fills R/Wp, R/kWh defaults from org settings §11), **Import BOM from layout** | Totals: excl. VAT; VAT shown separately; R/Wp (**correct scale**: capex ÷ DC Wp) |
| **Opex** | O&M (R/kWp/yr or % of capex, default from org), insurance (% of capex **per year** — no ×12 **[D-05]**), monitoring/data (R/yr), inverter replacement (year, % of inverter cost), battery replacement (year, % of battery cost), escalation of opex (%/yr, default CPI) | — |
| **Finance model** | Select: *Cash purchase* / *Debt-financed* (loan %, rate, term, grace) / *PPA* (tariff R/kWh, escalation, term — for a third-party-owned view) / *Lease* **[D-15]** | Changes cashflow composition |
| **Analysis settings** | Analysis period (default 25 y), discount rate (default org WACC **[D-07]**), tariff escalation (from Tariff tab), load growth (from Load), tax treatment (Section 12B accelerated allowance toggle, company tax rate) **[D-16]** | — |
| **Run financials** | Button | Pure computation on stored energy results (no re-simulation needed) — fast |
| Results | KPI: capex, year-1 saving, simple payback, discounted payback, IRR, NPV, LCOE, cumulative saving; Cashflow table (year rows: energy saving, export income, demand saving, opex, replacements, debt service, tax, net, cumulative); cashflow chart | **Download XLSX** (every assumption + year table) |
| **Sensitivity** | Tornado on ±20 % of capex, tariff escalation, yield, discount rate, export rate | Computed server-side |

---

## 9. Reports & Proposal tab — `/solar/reports`

### 9.1 Report kinds (all in `projects.reports`, versioned with supersede chain, listed in `SavedReportsPanel`)

| Kind | Content | Read roles |
|---|---|---|
| `solar_feasibility` | Cover, executive summary, site & supply, load analysis, tariff, system design (layout image, arrays, strings), yield (monthly table, loss waterfall), financials (cashflow, sensitivity), assumptions & provenance, disclaimers | `COST_VIEW_ROLES` (declared in `REPORT_KIND_READ_ROLES` + `report_kind_is_sensitive()`) |
| `solar_technical` | Same without any rand value (for contractors/inspectors) | `SOLAR_TECH_READ_ROLES` |
| `solar_layout_sheet` | From Layout export (§6.3) | Tech-read |
| `solar_proposal` | Client-facing proposal PDF (issued version only) | Cost-view + client via portal |
| `solar_monthly` | Operations monthly report (§10) | Cost-view |

### 9.2 Controls

| Control | Type | Purpose | Behaviour | Roles | States |
|---|---|---|---|---|---|
| **Generate feasibility report** | Button | Produce the PDF | Server renders from the **selected case's stored run** (never recomputes); stores PDF + `summary` JSON (headline figures) + optional revision note | write ∩ cost-view | Disabled when Stale ("Re-run the case first") or not selected |
| **Generate technical report** | Button | Same, no money | — | write | — |
| Revision note | Text input | Record why a new version exists | Saved in `projects.reports.note` | write | — |
| Saved reports panel | Existing `SavedReportsPanel` | Download/delete versions, see author, headline figures | Delete: `OWNER_ADMIN` | per kind | "No reports yet" |
| Report options | Checkboxes: include layout sheet, include 8760 appendix (CSV attachment in ZIP), include bill check | Tailor the pack | — | write | — |
| Branding | Uses org branding (logo, colours, company details) — **no hard-coded Watson Mattheus fallbacks**; missing branding → neutral template + warning | — | — | — |

### 9.3 Proposal (client-facing)

| Control | Type | Purpose | Behaviour | Roles | States |
|---|---|---|---|---|---|
| **New proposal** | Button | Draft a client offer | Creates a draft from the selected case: offer price (from capex + margin % input), finance option(s) shown to client, validity date, terms text (org template), inclusions/exclusions | write ∩ cost-view | — |
| Draft editor | Form sections: Summary text, Scope, Price & payment terms, Assumptions, Exclusions, Validity | Author the offer | Structured fields — no free LaTeX. **Draft narrative** button (optional LLM, server-side, org key, result inserted as editable text and saved) **[D-17]** | write | — |
| **Preview PDF** | Button | Check the output | Renders server-side (react-pdf) | write | — |
| **Issue proposal** | Button (two-step) | Freeze and send | Freezes a snapshot (JSON + PDF), computes SHA-256 of the PDF, creates a share link (random token, expiry default 30 days), status `issued`. Optional **Email to client** (recipient list from project client contacts; uses `send-email`) | write ∩ cost-view | Refused if case Stale |
| Status | Chip: draft / issued / viewed / accepted / declined / expired / withdrawn | Track | Server-set only | — | — |
| **Withdraw** | Button | Cancel an issued proposal | Link stops working; status withdrawn | write | — |
| **Revise** | Button | New version | Copies to a new draft v(n+1); prior stays immutable | write | — |
| Acceptance record | Panel | Evidence | Shows accepter name, email, IP, user agent, timestamp, PDF hash accepted | cost-view | — |

### 9.4 Client portal view (`/portal/projects/[id]/solar/proposals/[token]` or public token page **[D-18]**)

| Control | Purpose | Behaviour |
|---|---|---|
| Proposal PDF viewer + key figures | Client reads the offer | Shows exactly the frozen snapshot — the same numbers as the PDF (WM showed different assumptions in portal vs PDF) |
| **Accept** | Client acceptance | Requires typed full name, email, tick "I have authority to accept on behalf of <company>", optional drawn signature; server stamps time/IP/UA + PDF hash; notifies proposer (bell + email) |
| **Decline** (with optional reason) | Client decline | Same stamping, notification |
| **Download PDF** | Keep a copy | Signed URL, 7-day |
| **Ask a question** | Contact | Creates an RFI-like message thread to the proposer **[D-18]** |
Expired/withdrawn token → "This proposal is no longer available — contact <proposer>".

---

## 10. Operations tab — `/solar/operations` (Phase 7, **[D-12]**)

**Purpose.** After installation: actual generation vs the guarantee, downtime, and a monthly report
that records exactly what the client received.

| Control | Type | Purpose | Behaviour | Data | Roles |
|---|---|---|---|---|---|
| Commissioning date + installed system (from accepted proposal case, editable as-built) | Form | Baseline | — | `solar.installations` | write |
| Guarantee basis | Select: P50 of the accepted case / manual monthly kWh / % of modelled | Expected generation | Auto-derived per month from the case run (no retyping each month) | `solar.guarantees` | write |
| **Import generation data** | Upload (same meter pipeline, meter kind `solar`) or inverter-portal CSV | Actuals | **Idempotent by timestamp** — re-import replaces the same interval, never adds; month/year from the data, not the UI | readings | write |
| Monthly performance table | Table: expected, actual, variance %, PR, irradiation-corrected expected (if weather uploaded), downtime hours | Track | — | derived | tech-read |
| Downtime log | Table + **Add downtime** (start, end, cause, excluded from guarantee?) | Record outages | Auto-detected candidates (zero output during daylight from the weather file's sun position, not a fixed 06:00–17:30 window) proposed for confirmation | `solar.downtime` | write |
| **Generate monthly report** | Button | Client monthly report | Month select → `projects.reports` kind `solar_monthly` with period, metric snapshot JSON and PDF; regenerating a month creates v2, never edits v1 | reports | write ∩ cost-view |

---

## 11. Org settings — `/settings/solar` (OWNER_ADMIN)

Defaults every new case copies (a case always stores its own snapshot, so later changes to defaults never
alter past results).

| Section | Controls |
|---|---|
| Rate card | R/Wp DC for PV (by size band), R/kWh battery, inverter R/kW, BOS %, fees %, PM %, contingency %, margin % |
| Opex defaults | O&M R/kWp/yr, insurance %/yr of capex, monitoring R/yr, replacement years and % |
| Finance defaults | Discount rate, CPI, default tariff escalation beyond published years, analysis period, tax rate, 12B toggle default |
| Loss defaults | All standard-mode losses; edge setback m; row-spacing rule |
| Load densities | W/m² per tenant category and archetype mapping (seeded from GCR's category densities where applicable) |
| Equipment catalogue | Modules (Pmax, Voc, Isc, Vmp, Imp, temp coefficients, dimensions, bifacial?), inverters (AC kW, efficiency curve/Euro-eff, MPPTs, V ranges, max I), batteries (usable kWh, kW, RTE, warranty cycles). **Add**, **Edit**, **Retire** (never delete — cases reference them), **Import from CSV / PAN-OND file [D-19]** |
| Branding for Solar reports | Uses org branding; Solar-specific disclaimer and terms templates |

---

## 12. Platform tariff library — `/admin/tariffs` (platform tariff admins only **[D-03]**)

**Purpose.** Maintain the authoritative, versioned South African tariff data every Solar study reads.

| Screen / control | Purpose | Behaviour |
|---|---|---|
| Licensee registry | Eskom, metros, municipalities, private distributors | Add/edit licensee (name, MDB code, province, NERSA licence no.) |
| Source documents | Store every tariff book / NERSA decision / Eskom schedule | **Upload source** (to `tariff-sources` bucket, sha256, financial year, status draft/final/NERSA-approved) |
| **Ingest** | Parse a source into a draft tariff year | Deterministic parser per format family (NERSA province compendium XLSX, Eskom schedule XLSX); **AI-assisted extraction** only for PDF-only books, output always lands as draft |
| Review queue | Human check | Each charge shown beside a rendered crop of its source page/cell; **Approve**, **Edit**, **Reject**; automatic checks listed (units, VAT, block continuity, TOU completeness, plausible ranges, YoY % vs approved increase) |
| Year-on-year diff | Catch errors | New / removed / changed tariffs and % change per charge; outliers flagged |
| **Publish year** | Make it live | Flips state to published; previous year → superseded (never deleted); projects pinned to the old year see "a newer tariff year is available" |
| TOU calendars & holidays | Maintain TOU windows | Edit windows per season/day type; public holidays per year (reuse the existing SA holiday table) |
| SSEG rules | Export crediting per licensee/year | Crediting method, export rates, caps, requirements, source citation |
| Due-year monitor | Alerts | Cron on 1 April (Eskom) and 1 July (municipal): alert when a licensee has no published year covering today |

---

## 13. Mobile (Expo) scope — Phase 7

Field capture only; no modelling on the device.

| Screen | Controls | Purpose |
|---|---|---|
| Solar site survey (per project, entitlement-checked server-side) | Roof photos (tagged: roof, DB, meter, inverter location, obstruction), compass bearing + tilt (device sensors) per photo, GPS stamp, roof type/condition, notes | Collect site facts for the office |
| Meter reading capture | Meter select, reading value + unit, photo of the register | Spot readings / validation |
| Handover checklist | Checklist from the Solar handover template with photos + signature | As-built handover |
| Read-only views | Selected case KPIs (no rand for non-cost roles), issued proposal status, operations summary | Awareness on site |
Offline queue only for these captures (PowerSync); nothing else.

---

## 14. What is deliberately NOT rebuilt from WM Solar (and why)

| WM Solar feature | Decision | Reason / E-Site replacement |
|---|---|---|
| Own projects list, auth, orgs, invites, profile, PWA, tours, code-review suite, dashboards of tariff counts | Drop | E-Site owns these |
| Schedule (Gantt) tab | Drop **[D-20]** | E-Site work items + due dates; a Gantt is a platform decision, not a Solar one |
| Documents tab | Drop | E-Site Documents + Dropbox sync |
| Handover checklist | Rebuild as a Site-forms / handover template | Reuse E-Site forms/handover modules |
| Schematics tab (SLD card editor) | Drop for v1 **[D-21]** | Board hierarchy already in `structure.nodes`; SLD drawings live in Floor Plans |
| Quick Estimate, Sandbox, Calculator | Fold into cases | One engine; a "Manual" case is the quick estimate |
| Solcast forecast card | Drop from yield **[D-08]** | Forecasting is an operations concern, not a design input |
| LaTeX / texlive.net, pdfmake, PDFShift, print popups | Drop | Server-side react-pdf/pdf-lib only |
| Global cross-project "meter library" with file-name dedupe | Replace | Org-scoped library, sha256 dedupe |
| Browser-stored settings (localStorage) | Replace | Org defaults in DB + per-case snapshot |
| AI infographics / tour content | Drop | No product value |
| External project/site sync (`sync-external-*`, `replicate-to-external`) | Drop | E-Site reads its own tenant schedule |
