# WM Solar review 01: the project shell, Overview, Tenants and Schematics

**Source:** read-only export of `origin/main` of `WattMatt/greencalc-sa` at `scratchpad/wmsolar-main`.
**Scope:** `src/pages/ProjectDetail.tsx` (shell), plus the tabs `overview`, `tenants` and `schematics`, and everything they import.
**Method:** every file below was read. Every claim cites `file:line`. Nothing was executed against a database. Wherever a behaviour comes from the code rather than from an observed run, the text says so.

Path abbreviations used throughout:

| Abbrev | Path |
|---|---|
| PD | `src/pages/ProjectDetail.tsx` |
| PLM | `src/components/projects/ProjectLocationMap.tsx` |
| PO | `src/components/projects/ProjectOverview.tsx` (dead, see §2.0) |
| TM | `src/components/projects/TenantManager.tsx` |
| TPM | `src/components/projects/TenantProfileMatcher.tsx` |
| TCM | `src/components/projects/TenantColumnMapper.tsx` |
| MLID | `src/components/projects/MeterLibraryImportDialog.tsx` |
| SIW | `src/components/projects/ScadaImportWizard.tsx` |
| MMS | `src/components/projects/MultiMeterSelector.tsx` |
| SMP | `src/components/projects/ScaledMeterPreview.tsx` |
| STM | `src/components/projects/ShopTypesManager.tsx` (dead) |
| AB | `src/components/simulation/AccuracyBadge.tsx` |
| CSV2LP | `src/components/loadprofiles/utils/csvToLoadProfile.ts` |
| CSVS | `src/components/loadprofiles/utils/csvStorage.ts` |
| MLP | `src/utils/meterLabelParser.ts` |
| ST | `src/components/projects/SchematicsTab.tsx` |
| SE | `src/components/schematic/SchematicEditor.tsx` |
| QMD | `src/components/schematic/QuickMeterDialog.tsx` |
| MCM | `src/components/schematic/MeterConnectionsManager.tsx` |
| SV | `src/pages/SchematicViewer.tsx` (dead, unrouted) |
| PVGIS | `src/hooks/usePVGISProfile.ts` |
| GEO | `supabase/functions/geocode-location/index.ts` |

---

## 0. The findings that matter most for a rebuild (read first)

1. **The "Overview" tab does not render `ProjectOverview.tsx`.** PD imports `ProjectOverview` (PD:25) and never uses it. The Overview tab renders `DashboardTabContent`, an inline component in PD (PD:160-704, mounted PD:1310-1319). `ProjectOverview.tsx` (1169 lines, including its own hard-coded financial model) is dead code. Likewise `ShopTypesManager` is referenced nowhere, `SchematicViewer` has no route in `src/App.tsx`, `MeterFormFields` is unused, and the zustand `useProjectStore` hook (387 lines) is imported by nothing except a code-review file browser.
2. **The data layer is effectively world-readable and world-writable.** The effective RLS, computed by replaying every CREATE and DROP POLICY across the 97 migrations:
   - `project_tenants`, `project_tenant_meters`, `shop_types` and `project_solar_data` carry `FOR ALL … USING (true)` with **no role restriction**, which includes the **anon** key.
   - `projects` still carries the four `TO authenticated USING (true)` policies from `20251215032623`. Those are OR'd with the org policies added in `20260318090000`, so **the org isolation is void**. Every signed-in user can read, update and delete every project.
   - `scada_imports`, `project_schematics`, `project_schematic_meter_positions`, `project_schematic_lines` and `project_meter_connections` are open to **any authenticated user** across all orgs.
3. **`geocode-location` lets anyone overwrite any project's coordinates.** It runs with `verify_jwt = false` (`supabase/config.toml:60-61`). When given `save_to_project: true` it writes `projects.latitude/longitude` for any `project_id` using the **service-role key** (GEO:288-301), with no caller check.
4. **Tenant CSV imports leak into, and collide in, a cross-project "global library".** `handleWizardComplete` writes every uploaded meter twice: once project-scoped and once as a global row with `project_id = null` (TM:845-879). The global row is de-duplicated by **`file_name` only** (TM:854-859), so two projects that both upload `Meter 1.csv` silently overwrite each other's global library entry. The "Global" profile scope in the tenant table is also not "library only". It is `SELECT * FROM scada_imports` with no filter (TM:351-353), so it shows **every other project's private meters** too.
5. **Destructive single-click actions with no confirmation:** delete tenant (TM:1633-1639), bulk delete tenants (TM:1201-1209), "Clear all profile assignments" (TM:1306-1323).
6. **Several controls do nothing:**
   - `TenantProfileMatcher` → "Assign…" is a `TODO` that only calls `console.log` (TPM:237-240).
   - The Overview's "Workflow Progress" steps 5–9 are hard-coded `pending` (PD:293-297).
   - The system-config toggles and the calendar claim to "save immediately", but they call a stale closure, so the immediate save is a no-op (§2.4).
   - `MultiMeterSelector.updateWeight` exists with no UI (MMS:224).
   - The schematic "connections" hierarchy is consumed by nothing outside the schematic editor.
7. **The tab-status system is mostly decorative:**
   - 6 of 14 statuses are constants: overview and costs are always `complete`; schematics, documents, generation and monthly-report are always `pending`.
   - `simulationCount` is capped at 1 (PD:1005).
   - "blocked" tabs are still clickable.

---

## 1. Project-detail shell (`src/pages/ProjectDetail.tsx`)

### 1.1 Purpose
The shell is the single workspace page for one solar project. It loads the project and its supporting data, shows a breadcrumb and header, and presents 14 tabs that walk the user through the pipeline: tenants, load profile, tariff, costs, simulation, PV layout and proposals. Each tab carries a coloured dot with a tooltip saying what is complete or missing. The shell also holds cross-tab state (system costs, blended-rate preference, live PV/battery capacity) so the Costs, Tariff and Simulation tabs share one model.

### 1.2 Routing, URL params, global state, keyboard
- **Route:** `/projects/:id` → `ProjectDetail` (`src/App.tsx:83`), inside `ProtectedRoute`. That wrapper only checks for a signed-in user (`App.tsx:46-62`). There is **no role check** anywhere in the shell. `useUserRole` exists in `src/hooks` but PD does not use it.
- **URL params:** only `:id` (PD:709). **The active tab is not in the URL.** It lives in `useState("overview")` (PD:712). A refresh, a shared link or the back button always lands on Overview. There are no deep links to a tab or a tenant.
- **Global state:** no zustand store is used. `useProjectStore` (`src/hooks/useProjectStore.ts`) is dead. All state is React Query plus local `useState` in PD.
- **Keyboard shortcuts:** none in the shell. Radix Tabs gives arrow-key navigation between tab triggers natively. The only shortcuts in this scope are in the schematic editor (§4.4: Esc, Delete/Backspace).
- **Unsaved-changes guard:** none. There is no `beforeunload` and no router blocker. Overview edits are saved only on blur, on the Save button, or on **tab change** (PD:722-738). Leaving via the breadcrumb or the back arrow skips `saveIfNeeded`.

### 1.3 Data loaded by the shell (React Query)

| Query key | Source | Columns | Used for | File:line |
|---|---|---|---|---|
| `["project", id]` | `projects` + embed `tariff_plans(*, municipality_id, municipalities(name, province_id, provinces(name)))` | `*` | Everything; `.single()` | PD:856-871 |
| `["project-tenants", id]` | `project_tenants` + embed `shop_types(*)` + `scada_imports(shop_name, area_sqm, load_profile_weekday, load_profile_weekend, date_range_start, date_range_end, detected_interval_minutes)`, ordered by `name`; then `project_tenant_meters` (+ `scada_imports` embed) `IN (tenantIds)`, merged in as `tenant_meters[]` | see left | Tenants, Load Profile, Simulation, header counts, statuses | PD:917-959 |
| `["shop-types"]` | `shop_types` all rows, ordered by name | `*` | Tenants / Load Profile / Simulation fallback intensity | PD:961-968 |
| `["latest-proposal-branding", id]` | `proposals.branding`, latest `version` | `branding` | **Never read. Dead query.** | PD:971-985 |
| `["project-latest-simulation", id]` | `project_simulations`, latest `created_at`, `.maybeSingle()` | id, name, solar_capacity_kwp, battery_capacity_kwh, battery_power_kw, annual_solar_savings, roi_percentage, results_json | Overview KPIs, statuses, Load Profile, Costs, PV Layout | PD:988-1002 |
| `["last-saved-simulation-costs", id]` | `project_simulations.results_json`, latest | `results_json` | Seeds `systemCosts`, `blendedRateType`, `useHourlyTouRates` **once per project** | PD:781-795, 798-849 |
| `["project-pv-layout", id]` | `pv_layouts` `.maybeSingle()` by project | id, pv_arrays | PV Layout status | PD:1008-1020 |
| `["project-proposals-count", id]` | `proposals` count (head) | — | Proposals status | PD:1023-1034 |
| `["project-gantt-tasks-count", id]` | `gantt_tasks` count (head) | — | Schedule status | PD:1037-1048 |

Notes:
- The two `project_simulations` queries fetch the same row twice (PD:781 and PD:988), and both download `results_json`, which can be large.
- `pv_layouts … .maybeSingle()` **throws** if a project has more than one layout row. The status query then errors and `pvLayout` is undefined, so the tab reads "pending".
- **Loading gate:** the page shows a skeleton until `project`, `tenants` and `simulation` have all loaded (PD:1069-1078). **Error handling:** if the project query errors (RLS, network, bad id), `isLoading` becomes false and `project` is undefined. The page then shows "Project not found" with a "Back to Projects" link (PD:1080-1089). No real error is ever shown.

### 1.4 Header and breadcrumb

| Control | Type | What it is for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| "Dashboard" breadcrumb (Home icon) | button | Go home | `navigate("/dashboard")` PD:1200 | — | — | **Broken: no `/dashboard` route exists.** The home route is `/` (`App.tsx:79`), so this lands on the NotFound page. |
| "Projects" breadcrumb | button | Back to the project list | `navigate("/projects")` PD:1205 | — | — | Skips the Overview save. |
| Project name crumb | text | Context | — | `project.name` | Truncated at 200px | — |
| Active-tab crumb | text | Context | `activeTab.replace(/-/g,' ')`, capitalised, hidden on Overview PD:1210-1215 | — | — | — |
| ← (ArrowLeft) | icon button | Back | `navigate("/projects")` PD:1219 | — | — | Skips the Overview save. |
| Project logo | img | Branding | `src = logo_url?t=${Date.now()}` PD:1227 | `projects.logo_url` | Shown only if set | `onError` hides the parent container. **The cache-buster changes on every render, so the logo is re-downloaded on every re-render.** No control on this page sets the logo. |
| Title + subtitle | text | Summary | `"{location or 'No location set'} • {n} tenants ({assigned} with profiles) • {Σarea} m² • {kVA} kVA connection"` PD:1237-1243 | projects.location, connection_size_kva; tenants | — | `assigned` counts only `scada_import_id`. Tenants with only multi-meter assignments count as "without profile". |

There are no other header buttons or menus: no export, no duplicate, no delete, no settings.

### 1.5 Tab bar, `TabWithStatus` and status rules

`TabWithStatus` (PD:90-120) wraps a Radix `TabsTrigger`. It adds a Tooltip (bottom side, 300 ms delay from the `TooltipProvider` at PD:1249) whose content has a status icon and a sentence, plus `TabStatusBadge` (PD:74-88): a 2×2 px dot top-right with these colours: `complete` green-500, `partial` amber-500, `pending` muted/40, `blocked` destructive/60.

Inputs used by the rules (PD:1091-1103):
- `tenantCount = tenants.length`
- `assignedCount = tenants.filter(t => t.scada_import_id).length`. This **ignores `tenant_meters`** and ignores whether the assigned meter actually has a profile.
- `hasTariff = !!project.tariff_id`
- `hasSimulations = simulationCount > 0`, where `simulationCount = latestSimulation ? 1 : 0` (PD:1005). It is capped at 1.
- `hasPVLayout = pv_arrays is a non-empty array`
- `hasProposals = proposalCount > 0`
- `hasLocation = !!project.location`. This is the **text** field, not lat/lng.

| # | Tab value | Label / icon | Status rule (exact) | Tooltip text (exact) | Content |
|---|---|---|---|---|---|
| 1 | `overview` | Overview / LayoutDashboard | always `complete` | "Project summary dashboard" | `DashboardTabContent` |
| 2 | `tenants` | Tenants / Users | `tenantCount==0` → pending; `assigned==tenantCount` → complete; else partial | 0 tenants: "Add tenants to get started"; assigned < count: "`{a}/{n}` tenants have load profiles"; else "`{n}` tenants configured" | `TenantManager` |
| 3 | `schematics` | Schematics / Cpu | always `pending` (constant) | "Upload electrical distribution schematics" | `SchematicsTab` |
| 4 | `load-profile` | Load Profile / BarChart3 | `assigned==0` → blocked; `assigned==tenantCount` → complete; else partial | assigned 0: "Assign load profiles to tenants first"; else "Showing data from `{a}` tenant profiles" | `LoadProfileChart` |
| 5 | `costs` | Costs / Wallet | always `complete` | "System costs configured" | `SystemCostsManager` |
| 6 | `tariff` | Tariff / DollarSign | `hasTariff` → complete; else pending | "Tariff selected" / "Select a tariff for simulation" | `TariffSelector` |
| 7 | `simulation` | Simulation / Zap | `!hasTariff \|\| assigned==0` → blocked; `hasSimulations` → complete; else pending | "Needs: Select a tariff first" / "Needs: Assign tenant load profiles" / "`{n}` simulation(s) saved" (always "1 simulation saved") / "Ready to run simulations" | `SimulationModes` |
| 8 | `pv-layout` | PV Layout / Sun | `hasPVLayout` → complete; else pending | "PV layout configured" / "Design your PV array layout" | `FloorPlanMarkup` |
| 9 | `solar-forecast` | Solar Forecast / CloudSun | `hasLocation` (text) → complete; else pending | "Location set for forecasting" / "Set project location for forecasts" | `ProjectLocationMap` + `SolarForecastCard` |
| 10 | `proposals` | Proposals / ScrollText | `!hasSimulations` → blocked; `hasProposals` → complete; else pending | "Needs: Run a simulation first" / "`{n}` proposal(s) created" / "Ready to create proposals" | `ProposalManager` |
| 11 | `schedule` | Schedule / CalendarDays | `ganttTaskCount>0` → complete; else pending | "`{n}` task(s) scheduled" / "Create project schedule" | `ProjectGantt` |
| 12 | `documents` | Documents / FolderOpen | always `pending` | "Manage project documents" | `ProjectDocuments` |
| 13 | `generation` | Generation / TrendingUp | always `pending` | "Track plant generation performance" | `GenerationTab` |
| 14 | `monthly-report` | Monthly Report / FileText | always `pending` | "Manage monthly reports" | `MonthlyReportManager` |

(Rules at PD:1105-1194; triggers at PD:1250-1306; contents at PD:1310-1447.)

Rule defects:
- "blocked" does not block anything. Every trigger stays clickable.
- The Solar Forecast status uses the location **text**. A project with coordinates but no text is "pending"; a project with text that failed to geocode is "complete".
- The Tenants and Load Profile statuses ignore multi-meter assignments (`project_tenant_meters`) and virtual tenants. A virtual tenant created from the schematic (§4.5) always has a `scada_import_id`, but its meter has **no profile**, yet it counts as "assigned".

### 1.6 Tab change and save orchestration (`handleTabChange`, PD:722-738)
1. When leaving `overview`, it awaits `dashboardRef.current.saveIfNeeded()`.
2. When leaving `simulation` or `costs`, or when **entering** `pv-layout`, it awaits `simulationRef.current.saveIfNeeded()`.
3. Then `setActiveTab(newTab)`. Save failures are toasted inside the children, and the tab **still switches**.
4. The Simulation tab is **force-mounted while on Costs** (hidden with CSS) so its ref survives for auto-save (PD:1382-1386).
5. `onNavigateToTenant` from the Load Profile tab sets `highlightTenantId`, switches to `tenants`, and clears the highlight after 3000 ms (PD:1349-1354).

### 1.7 Cross-tab state held by the shell
- `systemCosts` (PD:741-775) is seeded from `DEFAULT_SYSTEM_COSTS` (`simulation/FinancialAnalysis`) with inline fallbacks: solarMaint 3.5%, batteryMaint 1.5%, insuranceRate 1.0%, replacementYear 10, equipmentCost 45%, moduleShare 70%, inverterShare 30%, moduleReplacement 10%, inverterReplacement 50%, batteryReplacement 30%, costOfCapital 9.0, cpi 6.0, electricityInflation 10.0, projectDuration 20, lcoeDiscount 9.0, mirrFinance 9.0, mirrReinvestment 10.0. It is then overwritten **once** from `results_json.systemCosts` of the latest simulation (PD:798-849), guarded by `costsInitializedRef` and reset when `id` changes (PD:852-854).
- `blendedRateType` defaults to `'solarHours'`. `useHourlyTouRates` defaults to `true`. Both are loaded from `results_json` (PD:840-846).
- `liveSolarCapacity` and `liveBatteryCapacity` are pushed up from Simulation. When nothing is set, Costs falls back to `latestSimulation` values or the hard-coded **100 kWp / 50 kWh** (PD:1363-1364).
- The system config is parsed from `projects.system_type` (PD:874-882):
  - `solarPV` = the list includes "solar pv", **or** the value equals 'Solar' / 'Solar + Battery' / 'Hybrid', **or** it is empty.
  - `battery` = includes "battery", or equals 'Solar + Battery' / 'Hybrid'.
  - `generator` = includes "generator".
  - The DB default is `'Solar'` (migration `ADD COLUMN IF NOT EXISTS system_type text DEFAULT 'Solar'`).
- `handleRequestEnableFeature` (PD:893-915), called from the Simulation carousel, rewrites `system_type` as a CSV of 'Solar PV', 'Battery' and 'Generator', then toasts.
- `updateProject` mutation (PD:1050-1060) is used only by Tariff `onSelect` (PD:1375). It toasts "Project updated".
- The Load Profile tab's default coordinates are **Cape Town** (-33.9249, 18.4241, PD:1341-1342). The Solar Forecast tab's defaults are **Johannesburg** (-26.2044, 28.0456, PD:1423-1424). These are inconsistent hard-coded fallbacks.
- Dead: `connectionSizeInput` (PD:1062), `maxSolarKva = kVA × 0.75` (PD:1066, never read), `latestProposal` (PD:971).

---

## 2. Tab "overview"

### 2.0 Which component actually renders
`TabsContent value="overview"` renders **`DashboardTabContent`** (PD:1310-1319). `ProjectOverview` (PO) is imported at PD:25 and **never rendered**. §2.1 to §2.8 document what users actually see. §2.9 summarises PO for completeness, because it contains a financial model that someone may assume is live.

### 2.1 Purpose
This is the project's "cover sheet". The user edits the core project facts: name, location, area, connection size, which technologies are in scope, client, the meter-file prefix used to pull meters from the library, budget and target date. The user also sees a 9-step workflow checklist and six headline KPIs taken from the most recent saved simulation. A map dialog pins the exact site coordinates used for irradiance data.

### 2.2 Layout (in order)
- **Left column (w-80), card "Project Parameters"** (PD:352-580): Project Name, Location (with a coordinates badge and a map-pin button that opens a dialog), Total Area (m²) and Capacity (kVA) side by side, System Configuration toggles (Solar PV / Battery / Generator), Client Name, Meter File Prefix, Budget (R), Target Date, and the Save button with a saved tick.
- **Right column:**
  - Card "Workflow Progress" (PD:585-621), showing a `n/9 Steps` badge and a 3×3 grid of steps.
  - Card "Key Performance Indicators" (PD:624-700), with a `From: {simulation name}` badge and six tiles, or an empty state.
- **Dialog "Project Location"** (PD:382-409): `max-w-4xl h-[80vh]`, embedding `ProjectLocationMap` (§2.6).

### 2.3 Control inventory

| Control | Type | What it is for | Handler → effect | Data read / written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Project Name | text input | Rename the project | `handleParamChange('name')` PD:366; blur → `handleFieldBlur` → `saveParams` PD:334-338, 223-261 | W `projects.name` | None. **An empty string can be saved** (the column is NOT NULL, and "" passes). | Toast "Failed to save changes"; the console holds the detail. |
| Coordinates badge | badge | Shows lat/lng to 4 dp | — | R `projects.latitude/longitude` | Shown only when both are truthy (0 is treated as missing) | — |
| Map pin button | icon button (DialogTrigger) | Pin the exact site | Opens the dialog, `mapDialogOpen` PD:382-392 | — | — | — |
| Location | text input | Human-readable site location | as for Name; W `projects.location` | Placeholder = `"{province}, {municipality}"` from the tariff's municipality when available, else "Enter location" PD:416-420 | — | Saving a pin in the map dialog **overwrites this text** with the reverse-geocoded "municipality, province, South Africa" (PLM:118-140). |
| Total Area (m²) | number input | Gross area for the project | `Number(value)` PD:432 | W `projects.total_area_sqm` (`|| null`) | None; negatives allowed | **The initial value falls back to Σ tenant `area_sqm`** when the DB is null (PD:191). The first save of *any* field then persists that sum. This is a silent write. |
| Capacity (kVA) | number input | Grid connection size | PD:444 | W `projects.connection_size_kva` | None | 0 is stored as NULL. |
| Solar PV / Battery / Generator | Toggle ×3 | Which technologies the project includes; gates the Simulation, Costs and Load Profile features | `handleParamChange('systemConfig', …)` then `setTimeout(() => saveParams(), 0)` PD:459-462, 472-475, 485-488 | W `projects.system_type` as a CSV, e.g. `"Solar PV,Battery"`. An empty config serialises to `'Solar PV'` (PD:185). | Turning everything off is impossible in effect: it saves as 'Solar PV'. | **The "immediate save" is a no-op.** `saveParams` is the closure from the render *before* the state update, so `JSON.stringify(params) === lastSavedParams` and it returns early (PD:225-228). The change is persisted only by blur on another field, by Save, or by changing tab. |
| Client Name | text input | Client for proposals | PD:502 | W `projects.client_name` (`|| null`) | — | — |
| Meter File Prefix | text input | Prefix (e.g. "PDB") used by "Import from Library" to find this site's meters in the global library | PD:513 | W `projects.meter_data_prefix` (`|| null`) | — | Not in the sync-effect dependency list (PD:214), so an external change does not refresh it. |
| Budget (R) | number input | Budget | PD:527 | W `projects.budget` | — | Not used by any calculation in this scope. |
| Target Date | Popover + Calendar | Target completion date | `onSelect` → `handleParamChange('targetDate')` + `setTimeout(saveParams)` PD:553-557 | W `projects.target_date` as `toISOString().split('T')[0]` | — | Same stale-closure no-op as the toggles. **UTC slicing can shift the date by a day** for users east of UTC who pick at local midnight (the Calendar returns local midnight, and toISOString converts to UTC, so SAST midnight becomes the previous day 22:00). |
| Save / Saved | button | Manual save | `handleSave` → `saveParams` PD:329-331, 566-573 | as above | Disabled when `isSaving` or when there are no unsaved changes | Spinner, then "Saving…"; a green tick when clean. Toast "Changes saved" (1.5 s). |
| Workflow step tiles ×9 | display | Progress checklist | none (not clickable) | — | — | Steps 5–9 are always pending (PD:293-297). |
| KPI tiles ×6 | display | Headline results | — | R latest `project_simulations` | — | Empty state: "No simulation saved yet / Run a simulation in the Simulation tab to see KPIs here" (PD:636-641). |

**Save mechanics** (PD:216-282): `lastSavedParams` is a JSON snapshot. `hasUnsavedChanges` is recomputed on every params change, and skipped on the first mount. After a successful save the code sets the snapshot, invalidates `["project", id]`, calls `onProjectUpdate` (which invalidates the same key again), and toasts.

**Sync effect** (PD:201-214): when `project.*` changes, each param becomes `project.x || prev.x`. **A field cleared elsewhere (DB null) keeps the stale local value.** Also, because the effect runs on every project refetch, a user who is mid-edit can have a field overwritten by the refetched DB value whenever that value is truthy.

### 2.4 Calculations and business rules

Workflow steps (PD:288-298):

| Step | Complete when |
|---|---|
| 1 Resource Analysis | `tenants.length > 0` |
| 2 System Design | `latestSimulation.solar_capacity_kwp` is truthy |
| 3 Energy Configuration | `results_json.totalDailyLoad` is truthy |
| 4 Financial Analysis | `latestSimulation.annual_solar_savings` is truthy |
| 5 Proposal Draft … 9 Portal Setup | never (constant) |

KPIs (PD:300-321), from the latest `project_simulations` row:
- **Annual Yield (MWh)** = `results_json.totalDailySolar × 365 / 1000`. This assumes `totalDailySolar` is kWh/day.
- **Savings (/year)** = `annual_solar_savings`, formatted `Intl` en-ZA ZAR with 0 dp.
- **ROI (%)** = `roi_percentage || results_json.roi || 0`.
- **Self-Coverage (%)** = `totalSolarUsed / totalDailyLoad × 100`.
- **CO₂ Avoided (t/yr)** = `AnnualYield(MWh) × 0.9`. The constant is "~0.9 kg CO₂/kWh SA grid" (PD:309-310).
- **Grid Impact (%)** = `−((1 − totalGridImport/totalDailyLoad) × 100)`. **Sign defect:** it renders as a negative number labelled "reduction", e.g. "-45.0% reduction".
- There is no reference period. "Annual" is daily × 365 of whatever day type `results_json` represents.

### 2.5 Data model touched
`projects`: `name TEXT NOT NULL`, `location TEXT`, `total_area_sqm NUMERIC`, `connection_size_kva NUMERIC`, `system_type TEXT DEFAULT 'Solar'`, `client_name TEXT`, `meter_data_prefix TEXT`, `budget NUMERIC`, `target_date DATE`, `latitude/longitude NUMERIC`, `logo_url`, `tariff_id → tariff_plans(id) ON DELETE SET NULL` (migration `20260218102530`), and `org_id → organizations` (`20260318090000`).

⚠ `org_id` is **missing from `src/integrations/supabase/types.ts`**. The generated types are stale.

Also read: `project_simulations` (results_json, solar_capacity_kwp, annual_solar_savings, roi_percentage) and `tariff_plans → municipalities → provinces` (names only).

### 2.6 `ProjectLocationMap` (the map dialog on Overview; also the top of the Solar Forecast tab)

**Purpose:** pin the exact site on a satellite map and preview the solar resource at that point: PVGIS 19-year monthly average, PVGIS TMY, or a Solcast 7-day forecast.

**Layout:**
- Left card, lg:2 columns wide, "Site Location": a search box, a location badge, a Lat/Long row, and a 400px Mapbox map with overlays.
- Right card "Solar Data": a refresh button, a data-source toggle, and a summary panel.

| Control | Type | What it is for | Handler → effect | Data / services | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Map (click) | Mapbox GL, `satellite-streets-v12` | Drop a pending pin | `map.on('click')` → `setPendingCoords`, fills the lat/lng inputs, amber marker PLM:281-289 | — | Always active (no edit mode), so an accidental click creates a pending pin | — |
| Nav and scale controls | Mapbox controls | Zoom/rotate, scale bar | PLM:274-275 | — | — | — |
| Search location… | text input with debounced dropdown | Find a place by name | `handleSearchChange` (≥3 chars, 300 ms debounce) → `functions.invoke('google-places-search', {query})` PLM:372-409 | Edge fn `google-places-search` (JWT-verified by default; not listed in config.toml) → Google Places Autocomplete | Fewer than 3 chars clears the results | Errors are swallowed (console only). No keyboard navigation of the suggestions. |
| Suggestion row | button | Pick a place | `handleSelectSearchResult` → invoke `google-places-search` with `{place_id}` → pending coords, flyTo zoom 14 PLM:411-442 | Google Place Details | — | Toast "Could not get coordinates…" / "Failed to get location details" |
| Lat / Long inputs | text | Type exact coordinates | `handleCoordinateChange` sets `isEditingCoords` PLM:342-346 | — | Applied on ✓ only; Enter does nothing | — |
| ✓ (apply) | icon button | Apply the typed coordinates | `handleApplyManualCoords`: range check lat ∈[-90,90], lng ∈[-180,180] → pending pin + flyTo zoom 12 PLM:348-361 | — | Only visible while editing | Toast "Invalid coordinates…" |
| ✗ (cancel edit) | icon button | Revert the inputs | `handleCancelCoordEdit` PLM:363-369 | — | — | — |
| "Try Geocode Again" | button (overlay) | Retry auto-geocoding of the location text | `handleManualGeocode` → resets the flag → `geocodeLocation` PLM:250-253 | see auto-geocode below | Shown when there is location text but no coordinates | — |
| Pending bar: Cancel | button | Discard the pending pin | `handleCancelPending` PLM:506-514 | — | — | — |
| Pending bar: Save Location | button | Persist the pin | `saveLocation.mutate` PLM:116-164: (1) invoke `geocode-location {latitude, longitude, reverse:true}` → "municipality, province, South Africa"; (2) `projects.update({latitude, longitude, updated_at, location?})`; (3) on success, refetch solar data for the selected source | W `projects.latitude/longitude/location/updated_at`; edge fn `geocode-location` (Mapbox reverse, `country=ZA`, types region/place/locality) | Disabled while pending | Toast "Failed to save location: …". **It silently replaces the user's location text** whenever reverse geocoding succeeds. |
| Refresh (↻) | icon button | Re-pull solar data | `handleRefreshForecast` PLM:516-526: Solcast → `fetchForecast({hours:168})`; PVGIS → `fetchBothDatasets({…, forceRefresh:true})` | edge fns `solcast-forecast`, `pvgis-tmy`, `pvgis-monthly`; W `project_solar_data` | Disabled while loading; hidden without coordinates | — |
| Monthly Avg / TMY / Solcast | ToggleGroup | Choose the dataset | `handleDataSourceChange` PLM:484-498 fetches only if not already loaded | — | — | Error panel with "Try Again" (PLM:766-773) |

**Auto-geocode** (PLM:167-248) runs once the map has loaded, when there is location text and no coordinates:
1. It invokes `geocode-location {project_id, location, save_to_project:true}`. The edge function forward-geocodes via Mapbox (`country=ZA`, `proximity=25,-29`, `fuzzyMatch`, and `&` / "and" stripped: GEO:170-189) and **writes the coordinates to the project using the service role** (GEO:288-301).
2. On failure it falls back to the hard-coded `SA_CITY_FALLBACKS` table (23 cities, PLM:39-63). It matches the whole string, then any substring, and **saves those coordinates directly** (PLM:174-182). A location such as "Shop 5, George Street, Pretoria" will match **"george"** or "pretoria", whichever comes first in object order.
3. Toasts: "Location found: …" / "Could not find coordinates…" / "Failed to geocode location".
4. The auto-geocode is attempted once per mount (`geocodeAttempted`).

**Data panels:**
- **PVGIS** (PLM:791-852): Peak Sun Hours; kWh/m²/day; kWh/m²/year; 12 monthly averages; average temperature. The badge reads "19-Yr Avg" (2005-2023) or "TMY".
- **Solcast** (PLM:855-925): average PSH; kWh/m²/day; a 7-day list where a day counts as cloudy if cloud opacity > 50; today's minimum and maximum temperature.

**Caching (PVGIS hook):**
- `project_solar_data` is keyed by `(project_id, data_type ∈ {'tmy','monthly_radiation'})`, with a UNIQUE constraint. It is reused when the cached coordinates are within 0.001° (~111 m) (PVGIS:127-143).
- The write is select-then-update/insert rather than an upsert (PVGIS:160-198).
- Both PVGIS calls always request `startyear 2005, endyear 2023` (PVGIS:231-236, 286+).
- Every successful fetch toasts ("PVGIS TMY data loaded", "PVGIS Monthly data loaded"), so opening the map fires 2 toasts.
- Solcast results are **not cached** (a call per view).
- The Mapbox token is fetched from edge fn `get-mapbox-token` (`verify_jwt=false`), which returns env `MAPBOX_ACCESS_TOKEN`. If that fails, the map is a skeleton **forever**, with no error state (PLM:633-634).

**External services:** Mapbox GL JS (client), Mapbox Geocoding (server), Google Places Autocomplete + Details (server), PVGIS (via edge), Solcast (via edge).

**Defects:**
- The service-role write in `geocode-location` with `verify_jwt=false` (see §0).
- The overwrite of the location text.
- The fallback substring match.
- The refresh fetches data for **unsaved pending** coordinates and caches them against the project (PLM:517-524 with `projectId`).
- No error state for a failed token.
- In the Overview dialog, `location={params.location}` means **unsaved typed text** drives auto-geocoding (PD:402).

### 2.7 External services (Overview tab overall)
Supabase REST (`projects`, `project_simulations`, `tariff_plans…`), plus everything in §2.6.

### 2.8 Defects, gaps and dependencies (Overview)
- Defects already listed: the stale-closure "immediate save", the grid-impact sign, `total_area_sqm` silently seeded from tenants, the target-date UTC shift, empty name allowed, no dirty guard when navigating away, the sync effect clobbering in-progress edits, and steps 5–9 dead.
- **Depends on:** Tenants (step 1, area fallback) and Simulation (all KPIs, steps 2–4).
- **Feeds:**
  - `meter_data_prefix` → Tenants "Import from Library".
  - `system_type` → Simulation, Costs and Load Profile feature gating.
  - `connection_size_kva` → Load Profile.
  - lat/lng → Load Profile, Solar Forecast, PVGIS cache.
  - `location` → Solar Forecast status.
  - `client_name` → proposals.

### 2.9 `ProjectOverview.tsx` (dead, not rendered): summary for completeness
Props: `{project, tenants, onNavigateTab}` (PO:30-36). If revived, it would show:
- Setup progress over 4 steps: add tenants; assign profiles; set connection size (whose `tab` is `"tenants"`, which is wrong); select tariff (PO:217-226).
- A clickable workflow diagram.
- Metric cards.
- Mini charts for load and PV.
- Energy-ratio pies.
- A financial summary.
- A 15-year savings chart.
- Quick actions.

It is built on **hard-coded constants that contradict the real engine**:
- consumption fallback 50 kWh/m²/month (PO:46)
- SCADA scale assumes a 100 m² profile area (PO:64)
- PV peak = 0.75 × kVA × 0.85 (PO:43, 96)
- tariff R2.50/kWh (PO:109)
- yield 1700 kWh/kWp/yr (PO:117)
- self-consumption 70% (PO:119, 144)
- system cost R12,000/kWp (PO:124)
- escalation 8% (PO:175)
- 20-year straight amortisation (PO:184)

Its "Run Full Simulation" button has **no onClick** (PO:916-918). It should be deleted rather than ported. The canonical overview is `DashboardTabContent`.

---

## 3. Tab "tenants" (`TenantManager` and children)

### 3.1 Purpose
This tab builds the site's **load model**: the list of tenants (shops) with shop number, name, area and breaker rating. Each tenant gets a measured consumption profile, meaning a 24-hour weekday/weekend kW shape imported from meter CSVs. A tenant can instead take a shop-type intensity estimate or a manual monthly kWh override. Profiles are scaled by area (tenant m² ÷ meter m²), and each tenant can be included in or excluded from the site load profile. The tab also bulk-imports meter CSVs (creating meters and tenants), imports tenants from a CSV schedule, and creates tenants from a global meter library filtered by the project's meter-file prefix.

### 3.2 Layout (in order)
1. Hidden `<input type=file accept=".csv">` for the tenant-schedule CSV (TM:984-990).
2. Header "Tenant Schedule / Import or add tenants to build the load model", with buttons: **Add Tenant** (dialog), **Import Data** (the SCADA wizard), **Import from Library** (TM:991-1164).
3. Three stat cards: Total Tenants; Total Area (m²); Est. Monthly Consumption (kWh) (TM:1166-1185).
4. `AccuracySummary` bar: actual / estimated / missing counts and percentages (TM:1188-1194).
5. Tenant table card, with a bulk-action bar when rows are selected (TM:1196-1649). When there are no tenants, a dashed empty card instead: "No tenants yet. Import a CSV or add tenants manually." (TM:1650-1658).
6. `TenantProfileMatcher`: an "Analyze Tenant Load Profiles" button that expands into an analysis card (TM:1660-1662). Shown only when there are tenants.
7. Mounted dialogs: `ScadaImportWizard`, `MeterLibraryImportDialog`, `TenantColumnMapper`, `MultiMeterSelector`, `ScaledMeterPreview`, and the Edit Tenant dialog (TM:1664-1794).

### 3.3 Data read by `TenantManager` (in addition to the shell's `tenants` prop)

| Query key | Source | Notes | File:line |
|---|---|---|---|
| `["tenant-meter-counts", projectId]` | `project_tenant_meters.tenant_id IN (tenantIds)` | Counts per tenant | TM:312-333 |
| `["scada-imports-for-assignment", scope, projectId]` | `scada_imports` (15 columns, **including both 24-value profile arrays**), paginated 1000 rows at a time until exhausted, ordered by shop_name. `scope==='local'` adds `project_id = projectId`. **`'global'` (the default!) has no filter, so it returns every meter of every project plus the library.** | The payload grows with the whole database | TM:336-365 |
| `["assigned-scada-display", ids]` | `scada_imports IN (assigned ids)` | Display names when the assigned meter is outside the current scope | TM:372-384 |

### 3.4 Control inventory: page header and Add Tenant dialog

| Control | Type | What it is for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Add Tenant | button → Dialog | Add one tenant manually | opens dialog, `dialogOpen` TM:999-1005 | — | — | — |
| (dialog) Import CSV | button | Import a tenant schedule from CSV | `csvInputRef.click()` → `handleCsvFileSelected` TM:245-272: reads the text and auto-detects the delimiter from the header line (`;` if it beats `,` and tab; tab if it beats `,`; else `,`). **Naive `split`, so quoted fields containing delimiters break columns.** Blank rows are dropped. The Add dialog closes and `TenantColumnMapper` opens. | — | `.csv` only (no xlsx, although the wizard supports xlsx) | Toast "CSV file must have a header row and at least one data row" |
| Shop Number | input | Unit reference | `newTenant.shop_number` | → `project_tenants.shop_number` | Optional | — |
| Shop Name | input | Tenant name | `newTenant.shop_name` | → `shop_name` **and `name`** (kept for backwards compatibility) | Required (button disabled) | — |
| Area (m²) | number input | Tenant GLA | `newTenant.area_sqm` | → `area_sqm` (`parseFloat`) | Required as a non-empty string. Negative and 0 accepted. | — |
| Load Profile (optional) | combobox Popover + Command | Pre-assign a meter profile | select → `newTenant.scada_import_id` TM:1049-1136 | R current scope's `scada_imports` | Search is a case-insensitive substring over "shop_name site_name area" | "No profile found." Badges: **Suggested** (exact name match), **Similar** (contains). |
| (profile popover) Sort by Name / Area | two small buttons | Order the candidates | `addDialogSortByArea` TM:1070-1088 | — | — | — |
| Add Tenant (submit) | button | Create the tenant | `addTenant.mutate` TM:386-405 → `project_tenants.insert({project_id, name, shop_number, shop_name, area_sqm, scada_import_id})` | W `project_tenants` | Disabled without name or area | Toast `error.message`. **Pre-assigning a profile does not un-assign it from other tenants**, unlike the inline dropdown (TM:436-443), so one meter can end up on two tenants. |
| Import Data | button | Bulk-upload meter CSV/XLSX files, creating meters (and tenants) | `setWizardOpen(true)` → `ScadaImportWizard` (§3.8) | — | — | — |
| Import from Library | button | Create tenants from library meters matching the project prefix | `setMeterLibraryImportOpen(true)` → `MeterLibraryImportDialog` (§3.9) | — | — | — |

### 3.5 Control inventory: tenant table

Columns in order: [select] · Shop # · Shop Name · Area (m²) · Rating · Load Profile (with a scope switch, auto-match and clear-all in the header) · Scale · Est. kWh/month · Include · Source · Type · [⋮].

| Control | Type | What it is for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Header checkbox | checkbox | Select all | sets all ids TM:1219-1228 | — | Checked only when every row is selected | — |
| Row checkbox | checkbox | Select a row | toggles the id in the Set TM:1400-1410 | — | — | — |
| "Delete N" (bulk bar) | destructive button | Delete the selected tenants | `bulkDeleteTenants.mutate(ids)` → `project_tenants.delete().in('id', ids)` TM:419-431 | W `project_tenants` (cascades to `project_tenant_meters`) | Disabled while pending | **No confirmation.** Toast "Deleted N tenants". |
| "Clear" (bulk bar) | ghost button | Clear the selection | TM:1210 | — | — | — |
| Sort headers: Shop #, Shop Name, Area, Est. kWh/month | header buttons | Sort | `handleSort` cycles asc → desc → off TM:518-531. Shop #: numeric before non-numeric, then alphabetical (TM:693-714). kWh uses `calculateTenantKwh`. | — | — | — |
| Scope switch (in Load Profile header) | Switch + tooltip | Choose the candidate meter list: "Global data set" or "Local data set" | `setProfileScope` TM:1277-1285 | Changes the `scada_imports` query | — | **"Global" is not the library.** It is the unfiltered table: all projects plus the library. |
| ↻ Auto-match | icon button | Assign best-guess meters to unassigned tenants | `autoMatchProfiles` TM:534-638 (algorithm in §3.10) | W `project_tenants.scada_import_id`, one sequential UPDATE per match | Disabled while running | Toasts: "No profiles available to match", "All tenants already have profiles assigned", "Auto-matched X of Y unassigned tenants". **Uses the current scope, so by default it can link tenants to other projects' meters.** |
| ✗ Clear all profile assignments | icon button | Unlink every tenant's meter | `clearAllProfileAssignments` TM:641-663 → `project_tenants.update({scada_import_id:null}).eq('project_id')` | W | Disabled while running | **No confirmation.** It does **not** clear multi-meter (`project_tenant_meters`) assignments. Toast "Cleared profile assignments from N tenants". |
| Load Profile combobox (per row) | Popover + Command | Assign or replace the tenant's meter | select → `updateTenantProfile.mutate` TM:433-454: (1) clears that meter from any other tenant in the project, **error ignored**; (2) sets `scada_import_id` | W `project_tenants` | The list hides meters already assigned to other tenants (TM:1480-1481). Label: "N meters (averaged)" if multi-meter, else "Name (area m²)", else "Unassigned". | Toast `error.message`. Suggestions are computed with `tenant.name`, while auto-match uses `shop_name`, so they can disagree. |
| (combobox) ✗ unassign | icon button | Remove the assigned meter | `updateTenantProfile({scadaImportId:null})` TM:1438-1450 | W | Visible only when assigned | — |
| (combobox) Sort by Name / Area | buttons | Order the candidates | `sortByAreaMap[tenant.id]` TM:1453-1470 | — | — | — |
| Meter-count badge | badge | Number of multi-meters | — | `tenantMeterCounts` | Shown if > 0 | — |
| 👁 Preview | icon button + tooltip "Preview scaled load profile" | Inspect the meter's real data, scaled to this tenant | `setPreviewContext` → `ScaledMeterPreview` (§3.12) TM:1525-1543 | — | Shown only when the assigned meter has `data_points > 0` | — |
| Scale | display | Area scale factor | `×{tenantArea/meterArea}` to 2 dp. **Amber when > 1.5 or < 0.5.** Tooltip "Tenant: X m² / Profile: Y m²". "avg" when multi-meter. "—" otherwise. TM:1546-1563 | — | — | Meter area null or 0 means no scale. |
| Est. kWh/month cell | button → Popover (`KwhOverrideCell`) | Show and override monthly kWh | TM:86-153. Shows `override ?? calculated`, highlighted when overridden. Popover: NumericInput (min 0), "Calculated: X kWh", **Save** (saves only if value > 0, otherwise just closes), **↺ reset** (sets null, shown when overridden). → `updateTenantKwhOverride` TM:456-469. | W `project_tenants.monthly_kwh_override` | The value is initialised once at mount and not refreshed | Toast "kWh override updated". **Typing 0 cannot clear an override; use ↺.** |
| Include | checkbox | Include the tenant in the site load profile | `updateTenantIncludeInProfile` with optimistic cache update and rollback TM:492-515 | W `project_tenants.include_in_load_profile` | — | Toast `error.message`. Also toggled from the schematic cards (§4.4). |
| Source | `AccuracyBadge` | Data quality | `meterCount>1 ? 'actual' : getAccuracyLevel(!!scada_imports.load_profile_weekday, !!shop_type_id)` TM:1582-1590. AB:111-115: actual, then estimated, then missing. | — | — | **A tenant with exactly one multi-meter (and no single profile) shows "missing".** |
| Type | badge | Virtual or Actual | `is_virtual` TM:1592-1596 | R | Read-only | — |
| ⋮ → Edit Tenant | menu item | Edit number, name or area | `setEditTenant` → Edit dialog (TM:1743-1794) → `updateTenant` TM:471-490 (writes `name` too) | W | Save disabled without name or area | Toast "Tenant updated" or the error. **`cb_rating` cannot be edited anywhere. The only source is the CSV import.** |
| ⋮ → Manage Assigned Meters | menu item | Multi-meter assignment | `setMultiMeterTenant` → `MultiMeterSelector` (§3.11) | — | — | — |
| ⋮ → Delete Tenant | destructive menu item | Delete | `deleteTenant.mutate` TM:407-417 | W `project_tenants` | — | **No confirmation.** |
| Row highlight | behaviour | Arriving from Load Profile | Row gets `bg-primary/10 animate-pulse` and `scrollIntoView` inside the ref callback. It re-scrolls on every re-render during the 3 s window. TM:1387-1397 | — | — | — |

**Missing controls a rebuild must decide on:**
- There is no way to set a tenant's **shop type** (`shop_type_id`) anywhere in the UI. `ShopTypesManager` is unreferenced. As a result the "estimated" accuracy tier and the `shop_types.kwh_per_sqm_month` fallback are unreachable except through legacy data.
- There is no weight editing for multi-meters.
- There is no confirmation on any destructive action.
- There is no duplicate detection on import.

### 3.6 Calculations (Tenants tab)
- `calculateDailyKwh(profile) = Σ profile[0..23]`, i.e. Σ of hourly kW, which equals kWh/day (TM:156-159).
- **Per-row calculated kWh/month** (TM:1364-1372, and `calculateTenantKwh` TM:671-685 for sorting):
  - Override, if truthy (**0 is ignored**).
  - Else, with an assigned profile: `Σweekday × (scale ?? 1) × 30`, where `scale = tenantArea / meterArea` when meterArea > 0.
  - Else `(shop_types.kwh_per_sqm_month || 50) × area`. **50 kWh/m²/month is hard-coded.**
  - Uses the weekday profile only (weekends ignored); 30-day month.
- **Header "Est. Monthly Consumption"** (TM:968-978) uses **a different formula**: no area scaling (`Σweekday × 30`). It ignores `include_in_load_profile` and ignores multi-meters. **The header total does not equal the sum of the row values.**
- **AccuracySummary** (TM:1189-1193):
  - actual = has `scada_import_id` AND a weekday profile
  - estimated = no scada and has shop_type
  - missing = no scada and no shop_type
  - Tenants with a `scada_import_id` whose meter has no profile (e.g. virtual meters) are **counted in no bucket**. Percentages are rounded independently (AB:79-84).
- Name suggestion scores (TM:184-211):
  - exact (shop_name or meter_label equals the tenant name, lowercase trimmed) = 100
  - contains in either direction = `60 + (shorter/longer) × 30`. `matchedLen` uses shopName.length even when the label was the one that matched.
  - else 0

### 3.7 `TenantColumnMapper` (the CSV tenant schedule)
**Purpose:** map spreadsheet columns to Shop Number, Shop Name, Area and Rating, then bulk-create tenants.

| Control | Type | Handler | Notes |
|---|---|---|---|
| Column header ▾ | DropdownMenu per column | `assignRole(i, role)`: a role is unique, so assigning it removes it from any other column (TCM:97-107). The menu offers Shop Number, Shop Name, Area (m²), Rating (CB) and **Clear** (`clearRole`). | Auto-detection at open (TCM:52-79): headers containing shop_number / "shop number" / "shop nr" / **"unit"** / "number" (not "phone") / exactly nr, no, "no." → shop_number; shop_name / "shop name" / tenant / **name / shop** → shop_name; area / sqm / size / m2 / m² → area; rating / breaker / cb / amps → rating. Priority is name, then area, then number, then rating. A header like "Shop Number" contains "shop", so it can be claimed as **shop_name** first. |
| Preview table | display | First 50 rows, cells tinted by role | — |
| Footer text | display | "{rows} total rows · {valid} valid tenants", or "Assign Shop Name to continue" | valid = rows with a non-empty name cell |
| Cancel | button | `onClose` | — |
| Import N Tenants | button | `handleImport` (TCM:138-166): area is parsed by stripping non `[\d.]` (so "1,234.5" becomes 1234.5, but **"1 234,5" becomes 12345**); ≤ 0 or NaN becomes 0; number and rating are trimmed or null → `onImport` → TM `handleMappedImport` (TM:939-964): a single `project_tenants.insert([...])` with name, shop_number, shop_name, area_sqm, cb_rating | Disabled without a Shop Name mapping, while importing, or with 0 valid rows. **No de-duplication against existing tenants; re-importing doubles the list.** Area 0 is accepted. |

### 3.8 `ScadaImportWizard` ("Import Data") and `handleWizardComplete`
**Purpose:** a four-step bulk uploader for meter CSV/XLSX exports. Each file becomes a meter profile. Each file can be linked to an existing tenant, or it auto-creates a tenant.

Steps are a Tabs component inside the dialog "Bulk Upload" (SIW:709-738): **1. Select Files → 2. Parse & Ingest → 3. Preview → 4. Upload.**

| Control | Step | Handler → effect | Data / validation / errors |
|---|---|---|---|
| "Previously Imported Files" table | 1 | Lists `scada_imports` WHERE project_id (SIW:322-334, 753-835) | "Loading…" / "No files have been imported yet." |
| Delete all imports | 1 | `window.confirm` → `deleteAllImportsMutation` (SIW:383-423). Per import: unlink tenants (`project_tenants.scada_import_id=null`); list `scada-csvs/{projectId}/` and remove files ending in `_${file_name}`; delete the `scada_imports` row. | **Only removes the project-scoped row.** The global library copy and the `meters/{id}/…` storage copies (see below) are orphaned. The file match uses the raw `file_name`, but upload paths use a sanitised name, so files with spaces or special characters are **never deleted**. |
| Delete (per import) | 1 | Same, for one import (SIW:336-381) | Same defects. |
| Choose Files | 1 | Hidden input `accept=".csv,.xlsx,.xls" multiple` → `handleFilesSelected` appends (SIW:427-440, 844-859) | Pending count badge "N new". |
| Tenant picker per file | 1 | Combobox of project tenants not already chosen for another file; "No tenant" clears (SIW:924-970) | R `project_tenants(id,name,shop_name,shop_number)`. |
| ✗ remove file | 1 | `removeFile` | — |
| Continue | 1 | `handleReadAll` (SIW:452-491): reads each file locally (XLSX → first sheet converted to CSV via SheetJS, `cellDates:true`); auto-detects the separator from the first 5 lines of the first file; builds the preview; validates that headers match across files; goes to step 2 | Disabled while reading or when all files are ready. Toasts "No files selected" / "Files loaded successfully" / "Failed to read files". |
| Header-mismatch alert | 2 | "Column headers do not match across all files…" with a Missing/Extra list per file (SIW:1014-1030) | **Blocks steps 3 and 4.** |
| Column Separator | 2 | Select Tab / Comma / Semicolon / Space → reparse and revalidate | Comma parsing honours quotes. Other separators use a naive split. |
| Header Row Number | 2 | Input → reparse and revalidate | `parseInt || 1` |
| Column Interpretation: show all / per-column visible checkbox | 2 | Toggles column inclusion | Hidden columns are dropped from the rows sent to import. |
| Column Name | 2 | Rename (displayName) | Renamed headers **are** what auto-detection sees later, so renaming a column to "kWh" or "date" can steer detection. This is the only interpretation setting that has any effect. |
| Data Type (DateTime/Float/Int/String/Boolean) | 2 | `updateColumnDataType` | Guessed from 20 samples (SIW:175-199). **Ignored by profile processing** (see below). |
| DateTime Format (preset list or Custom) | 2 | `updateColumnDateFormat` | **Ignored by processing.** |
| Split Column By | 2 | `updateColumnSplit` | **Ignored everywhere. Pure UI.** |
| Preview Data | 2 | Go to step 3 | Disabled with no visible columns or with a mismatch. |
| File selector buttons | 3 | `setPreviewFileIdx` | First 50 rows, visible columns only. |
| Cancel / Continue to Upload | 3 | `handleDialogClose` / `handleGoToImport` | — |
| Complete Import | 4 | `handleStartImport` (SIW:636-682), sequentially per file: (a) upload the **original file** to `scada-csvs/{projectId}/{Date.now()}_{safeName}` (upsert); (b) re-parse with the separator and header row, keeping visible columns; (c) **call `onComplete([result])` without awaiting it**; (d) mark "done" | Status per file: Pending / Uploading / Parsing / Done / Failed. **"Done" is set before any DB work has happened.** DB errors in `handleWizardComplete` never reach the wizard (console only). The storage path written here is **never recorded** in the DB. |
| Close / Cancel | 4 | `handleDialogClose` resets all state | — |

**`handleWizardComplete`** (TM:729-937) runs once per file (not awaited, so files can interleave):
1. `processCSVToLoadProfile(headers, rows, defaultConfig)`. `defaultConfig.columns = []`, so **all wizard column typing is discarded**. Detection runs purely on header names (CSV2LP:371-382): date ∈ rdate/date/datetime/timestamp; time ∈ rtime/time; value ∈ kwh+/kwh-/kwh/energy/consumption/reading/value/amount/usage, else `findValueColumn`. It then auto-detects the unit from the header (CSV2LP:385-408): MWh, MW, kVAh, kVA, kWh, kW, Wh, W, A (A converted at **400 V, PF 0.9**, CSV2LP:332-333). If date or value is not found → an empty profile → skipped with a console warning.
2. Profile maths (CSV2LP:472-560):
   - Rows are bucketed by hour of day and by weekday/weekend (by the row date).
   - **Energy units:** `hourValue = Σ energy in that hour / number of distinct days of that type`, i.e. average kWh per hour, numerically kW.
   - **Power units:** `hourValue = mean of the readings`.
   - Rounded to 2 dp.
   - `totalKwh` = Σ energy, or Σ power × interval hours.
   - `peakKw` and `avgKw` are over non-zero profile values.
   - Date range comes from the unique ISO dates.
   - ⚠ Dates are bucketed with `toISOString()`, i.e. **UTC**. Timestamps parsed as local SAST can shift across midnight, and with them the weekday/weekend split, depending on the parser (not verified).
3. `raw_data` is built with a **separate, different heuristic** over the wizard's guessed types (TM:760-783): date column = the first DateTime-typed column or a name containing date/from/time; value = the first Float/Int column or a name containing kwh/kw. **So `raw_data` can hold a different column from the one the profile was computed from.** If either is missing it falls back to `[{csvContent: raw}]`. `raw_data` feeds `ScaledMeterPreview`'s monthly and daily views.
4. It upserts a **project-scoped** `scada_imports` row matched on `(project_id, file_name)` (TM:810-843). **A different file with the same name overwrites the previous meter.** `area_sqm` = the assigned tenant's area, else null.
5. It upserts a **global library** row (`project_id=null`, `meter_label=fileName`) matched on **`file_name` alone** (TM:853-879). This is the cross-project collision, and it pushes client data into a shared library.
6. `uploadCsvToStorage` (CSVS:7-33) uploads the CSV text **again** to `scada-csvs/meters/{meterId}/{ts}_{name}` for **both** rows, then sets `csv_file_path`. With the wizard's own upload, that makes **three copies** per file.
7. If no tenant was chosen, it inserts a new `project_tenants` row (name = file name without extension, `area_sqm = 0`, `include_in_load_profile = true`). Otherwise it links the chosen tenant. A new tenant with area 0 and a meter area of null gives no scale.
8. It invalidates 7 query keys, toasts "Successfully imported X, updated Y, created Z tenants, added W to meter library", and **switches the scope to "local"**.

### 3.9 `MeterLibraryImportDialog` ("Import from Library")
**Purpose:** create tenants in one step from global library meters whose label, shop name or file name starts with the project's Meter File Prefix. Name, number and area are parsed from labels such as `PDB_36506603_HomeEssentials_3365m2`.

- **Query** (MLID:55-72): `scada_imports` WHERE `project_id IS NULL AND data_points > 0 AND (shop_name ILIKE '{prefix}_%' OR meter_label ILIKE … OR file_name ILIKE …)`, limit 5000. It is enabled only when the dialog is open and a prefix exists.
  - ⚠ In ILIKE, `_` is a **single-character wildcard**, so "PDB_%" also matches "PDBX…", "PDB1…" and so on.
  - The `.or()` string interpolates the raw prefix unescaped, so a comma or parenthesis in the prefix breaks the filter.
- **Parsing** (MLP:25-69):
  - It recognises only the literal prefix **"PDB"**: `PDB_<digits>_<Name parts>_<n>m2`. Name parts are CamelCase-expanded ("HomeEssentials" becomes "Home Essentials"). `shopNumber` is set to the **digits segment, which is a meter serial, not a shop number**.
  - Any other prefix goes down the generic branch, which keeps the prefix and the serial inside the name.
  - Falls back to "Unknown".

| Control | Handler | Notes |
|---|---|---|
| Header select-all checkbox | `toggleAll` | — |
| Row checkbox | `toggleRow` | — |
| Prefix badge / Meter Label | display | — |
| Tenant Name input | `updateField('shopName')` | **Empty is allowed.** An empty name inserts a tenant with `name=""`. |
| Area (m²) input | `updateField('areaSqm')` (`parseFloat \|\| 0`) | — |
| Data Points badge | display | — |
| Cancel | `handleClose` resets | — |
| Create N Tenants | `createTenants.mutate` (MLID:121-194), sequentially per selected row: (1) fetch the full `raw_data` and profiles; (2) insert a **project-local copy** of the meter (all fields, with raw_data duplicated); (3) insert `project_tenants` (`include_in_load_profile=true`, `is_virtual=false`, linked). The first error throws, and **earlier rows stay created** because nothing is transactional. | Disabled with 0 selected or while pending. **Re-importing the same meters creates duplicate meters and tenants** because nothing excludes already-imported library meters, despite the copy saying "unassigned". |

Empty states: "No meter file prefix configured. Set the Meter File Prefix in Project Parameters first (e.g. "PDB")." / spinner / "No unassigned meters matching prefix … found in the library."

### 3.10 Auto-match algorithm (TM:534-638), which a rebuild must reproduce or replace
For each unassigned tenant × each candidate meter that no tenant in the project has used:
- **95** if the shop numbers are equal numerically (`parseFloat`) or case-insensitively as strings.
- Else **93** if the meter's `shop_name || site_name` ends in `[\s_-](\d+[A-Za-z]?)$` and that token equals the tenant's shop number (as a string or numerically).
- Else the name score from §3.6 (exact 100, contains 60–90).
- Candidates are kept at a score of 60 or more.

Then:
- The candidates are sorted by score descending and assigned **greedily one-to-one** (each tenant once, each meter once).
- Each match is written with its own UPDATE; failures are silently not counted.

Quirks:
- An exact-name 100 outranks a shop-number 95.
- "Shop 1" vs "Shop 10" is safe under the trailing regex.
- A numeric compare via `parseFloat("12A") = 12` makes "12A" equal to "12".

### 3.11 `MultiMeterSelector` ("Manage Assigned Meters")
**Purpose:** attach several meters to one tenant, e.g. a large store with several supplies. The meters' area-scaled profiles are **averaged**.

- **Reads:**
  - `project_tenant_meters` for the tenant, with the meter embedded (MMS:125-136).
  - **All** `project_tenant_meters` across the database, with tenant names, to warn about duplicates (MMS:139-149). This is not scoped to the project, so a meter used on another project's tenant is reported as "Already assigned to: X".
- **Controls:**
  - Remove all (`removeAllMeters`: delete WHERE tenant_id).
  - Per-meter remove (`removeMeter`).
  - The single-profile row's remove → `onClearSingleProfile`, which TM wires to `updateTenantProfile(null)`.
  - Search box.
  - Available-meter list grouped by shop name, sorted by area similarity; select → `addMeter` inserts `{tenant_id, scada_import_id, weight: 1.0}`. It is refused with a toast if another tenant holds the meter.
  - Close.
- **Summary stats** (MMS:301-335):
  - The averaged profile is `Σ(profile × tenantArea/meterArea) / count`, **including the single profile**. When a meter has no area the scale is **1**.
  - Totals: data points, area, meters with data; displayed daily kWh and ×30 monthly.
- **Dead code:**
  - `updateWeight` (MMS:224) has no UI.
  - The exported `calculateAveragedProfiles` (MMS:749-775, which is **weight**-based and **unscaled**) and `useAveragedProfile` are **used nowhere**.
  - As a result the load model's handling of `tenant_meters` lives entirely in the Load Profile tab's hooks, outside this review's scope. It must be checked against this averaging rule, because averaging several **sub-meters of one tenant** under-counts load: sub-meters should be summed.
- **Invalidation:** after changes it invalidates `["tenant-meters", tenantId]` and `["tenant-meter-counts"]`, but **not `["project-tenants", id]`**. The shell's merged `tenant_meters` (used by Load Profile and Simulation) stays stale until something else refetches it.

### 3.12 `ScaledMeterPreview` (the 👁 dialog)
**Purpose:** view a meter's real recorded data, month by month and day by day, optionally scaled to the tenant's area, with TOU shading.

- **Data:** `useMonthlyConsumption(meterId)` and `useDailyConsumption(meterId)` both read `scada_imports.raw_data`, which can be a `{timestamp,value}` array or embedded `csvContent`. This is the raw_data built by the heuristic in §3.8, which may not be the right column.
- **Scaling** (SMP:84-110):
  - `areaScale = tenantArea/meterArea`, or **1** when the meter has no area.
  - `meterDaily = Σweekday profile`; `meterMonthly = ×30`; `intensity = monthly/meterArea`.
  - Tenant values are the meter values × scale.
  - Colouring is amber outside 0.5–1.5.
- **Controls:**
  - "Show Scaled" switch.
  - Month select (monthly kWh and peak).
  - Day prev/next buttons and a day slider.
  - Daily chart (hourly kW bars with TOU background).
- **TOU:** `getTOUPeriod(hour, isWeekend)` from `load-profile/types`, with settings from `readStoredTOUSettings()`, i.e. **browser localStorage**. **No month is passed, so the low-season map is always used**, and the shading can differ between users and browsers.
- `shopTypeIntensity` defaults to 50.

### 3.13 `TenantProfileMatcher` ("Analyze Tenant Load Profiles")
**Purpose (intended):** suggest a meter for every tenant by name, and let the user assign one where there is no match.

- **Button** "Analyze Tenant Load Profiles" → `showMatcher = true`. This fetches **all** `scada_imports` with `data_points > 0` (all projects, **no pagination**, so it silently caps at 1000 rows) (TPM:43-55).
- **Matching:** exact on shop_name or meter_label, then contains in either direction. It **ignores the tenant's existing assignment** and does not use shop numbers.
- **Cards:**
  - "With Profiles X / N". This counts *name matches*, not assignments, so it is misleading.
  - "Average Confidence": High if > 70% matched **and** > 50% of matches are exact; Medium if > 40%; else Low. Its colour classes are built dynamically (`text-green-` + `500`), which Tailwind's JIT will **not** generate, so the colours render unstyled.
- **Row list:** tenant → matched meter with an Exact/Similar badge and "`{site} • {weekday_days}d history`", or "No profile matched" with an **"Assign…" combobox whose onSelect is a `TODO` that only calls `console.log`** (TPM:237-240).
- **Close** button.

This whole component is a non-functional analysis stub.

### 3.14 Data model (Tenants)

| Table | Columns used (type) | Constraints / RLS |
|---|---|---|
| `project_tenants` | id uuid, project_id uuid NOT NULL → projects ON DELETE CASCADE, name text NOT NULL, shop_number text, shop_name text, area_sqm numeric NOT NULL, cb_rating text, shop_type_id uuid → shop_types, scada_import_id uuid → scada_imports ON DELETE SET NULL, monthly_kwh_override numeric, include_in_load_profile bool NOT NULL default true, is_virtual bool NOT NULL default false, created_at, updated_at | **RLS: "Anyone can …" SELECT/INSERT/UPDATE/DELETE USING (true), including anon.** No uniqueness on (project_id, shop_number). No DB rule for one meter per tenant. |
| `project_tenant_meters` | id, tenant_id → project_tenants ON DELETE CASCADE, scada_import_id → scada_imports ON DELETE CASCADE, weight numeric(5,2) default 1.0, created_at; UNIQUE(tenant_id, scada_import_id) | **RLS USING (true), including anon.** |
| `scada_imports` | id, site_name text NOT NULL, shop_number, shop_name, file_name, meter_label, meter_color, project_id uuid NULL (NULL = global library), site_id, category_id, area_sqm, data_points, load_profile_weekday numeric[24], load_profile_weekend numeric[24], raw_data jsonb, date_range_start/end, weekday_days, weekend_days, detected_interval_minutes, value_unit, csv_file_path, processed_at | RLS: any **authenticated** user has full CRUD over all rows. No uniqueness on (project_id, file_name). |
| `shop_types` | id, name, kwh_per_sqm_month, load_profile_weekday/weekend, description, category_id | **RLS USING (true), including anon.** Global, not per-org. |
| Storage `scada-csvs` (private) | paths `{projectId}/{ts}_{name}` (wizard) and `meters/{meterId}/{ts}_{name}` (csvStorage) | INSERT / SELECT / DELETE for any authenticated user. **No UPDATE policy**, although `uploadCsvToStorage` passes `upsert:true`. Paths are unique per timestamp, so this normally inserts, but an upsert on an existing path would fail (not verified). |

### 3.15 External services (Tenants)
Supabase REST and Storage only. SheetJS runs client-side for xlsx. No edge functions.

### 3.16 Defects, gaps and security (Tenants): consolidated
1. The anon-writable `project_tenants`, `project_tenant_meters` and `shop_types` (§0.2).
2. The "global" scope exposes every project's meters. Library writes collide on `file_name` across projects (§0.4).
3. No confirmation on delete, bulk delete, or clear-all.
4. The wizard reports "Done" before DB processing; DB errors are invisible; `onComplete` is not awaited, so files can interleave.
5. Wizard column typing, date format and split settings are ignored. Profile columns and `raw_data` columns are chosen by two different heuristics.
6. Three storage copies per file, and the delete paths leave orphans (wrong filename match, `meters/` copies, the global row).
7. Re-import duplicates in the tenant CSV and the library import. Same-file-name overwrite in the wizard.
8. Header kWh total ≠ Σ row values (no scaling, no include filter, no multi-meter).
9. Hard-coded 50 kWh/m²/month; 30-day month; weekday-only monthly estimate; A → kW at 400 V / PF 0.9.
10. No UI to set a shop type or edit `cb_rating`. `ShopTypesManager` is dead. The "estimated" tier is effectively unreachable.
11. `TenantProfileMatcher` "Assign" is a stub; its counts are misleading; it is unpaginated; the confidence colours break.
12. `MultiMeterSelector` has no weight UI; averages rather than sums; checks duplicates across projects; does not invalidate `project-tenants`.
13. `MeterLibraryImportDialog`: the ILIKE `_` wildcard bug; PDB-only parsing; a serial number used as the shop number; empty names allowed; non-transactional.
14. `updateTenantProfile`'s "clear from other tenant" error is swallowed. Add Tenant pre-assignment bypasses the one-to-one rule.
15. The tenant CSV parser does not handle quoted delimiters.
16. Performance: the default "global" scope downloads every meter's 48-value profile arrays from the whole database, paginated, on every tab visit.

### 3.17 Dependencies (Tenants)
- **Needs first:** a project. For "Import from Library", `projects.meter_data_prefix` must be set on Overview and matching global library rows must exist (created by other projects' wizard imports or by the global Load Profiles page).
- **Feeds:**
  - Overview (step 1, area fallback).
  - The shell statuses (Tenants, Load Profile, Simulation).
  - Load Profile (the tenants with profiles, include flags, overrides, `tenant_meters`).
  - Simulation.
  - Schematics (the meters and the `include_in_load_profile` toggle are shared).
  - The Load Profile tab navigates back here through `highlightTenantId`.

---

## 4. Tab "schematics" (`SchematicsTab` + `SchematicEditor`)

### 4.1 Purpose
The user uploads the site's electrical distribution single-line diagrams (PDF, PNG, JPG or SVG), or starts a blank canvas. On top of a diagram the user places **meter cards** representing the project's SCADA meters, and draws **connection lines** between meters to record the upstream → downstream hierarchy. Each card also carries a toggle for whether that meter's tenant is included in the load profile. The diagram can be exported as SVG.

### 4.2 Layout
- **List mode:** header "Schematics / Electrical distribution diagrams for this site", with "Delete N Selected" (only when rows are selected) and "Upload Schematic" (dialog). Then one of: a loading card; the empty card "No schematics yet / Upload your first electrical distribution diagram" with an Upload button; or the card "Site Schematics" ("N schematic(s) uploaded") with a table (ST:465-672).
- **Editor mode** (when a schematic is opened; ST:441-463): ← back, the name and description, then `SchematicEditor`: a toolbar and a canvas whose height is width × 900/1400.

### 4.3 Control inventory: list and dialogs

| Control | Type | What it is for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Upload Schematic | button → Dialog | Add a diagram or blank canvas | ST:479-546 | — | — | — |
| Schematic Name | input (required) | Name | Auto-filled from the file name unless typed manually (ST:100-103, 129-132) | → `project_schematics.name` | HTML `required` | — |
| Description | textarea | Notes | — | → `description` | — | — |
| Total Pages | number input (min 1) | Declared page count | — | → `total_pages` | `parseInt || 1` | **Informational only.** Only page 1 of a PDF is ever converted or shown. `page_number` is never set, so the list shows "1 of N". |
| File drop zone / picker | Label + hidden file input, drag & drop | Choose the file | `handleFileChange` / `handleDrop` ST:87-134 | — | MIME ∈ {pdf, png, jpeg, svg+xml}; ≤ 52,428,800 bytes (50 MB), matching the bucket limit | Toasts "Invalid file type…" / "File size must be less than 50MB" |
| Submit: "Upload Schematic", or "Clean Schematic" when no file | submit button | Create the record | `handleSubmit` ST:136-234: **with a file** → upload to `project-schematics/{projectId}/{ts}-{originalName}` (name not sanitised) → insert the row (`uploaded_by = auth user`) → if PDF, convert page 1 client-side with pdf.js at scale 2 (`lib/pdfConversion`) → upload `…_converted.png` → set `converted_image_path`. **Without a file** → insert a row with `file_path = null` (a blank canvas; NOT NULL was dropped in migration `20260220093418`). | W storage `project-schematics`; W `project_schematics` | Disabled while loading | Toasts: success, "Converting PDF…", "PDF conversion failed, but file is uploaded", or the error. **A failed conversion leaves the status "⏳ Converting…" forever**, and the editor then tries to load the raw PDF URL as an image, which fails silently and leaves the canvas unready. |
| Header checkbox / row checkbox | checkbox | Selection | ST:241-253 | — | — | — |
| Delete N Selected | button | Bulk delete | `handleBulkDelete` ST:255-300: `window.confirm`; per row: delete positions → remove the file and converted image from storage → delete the row | W | Disabled while deleting | Success/failure counts. Lines cascade through the FK. **`project_meter_connections` are project-level and not removed.** |
| Type column | icon | PenTool (canvas) / 📄 / 🖼️ | `getFileTypeIcon` (`types/schematic.ts:63-67`) | — | — | — |
| Pages column | display | "Single" or "`{page_number} of {total_pages}`" | — | — | — | — |
| Uploaded column | display | `created_at` in the locale date | — | — | — | — |
| Status column | badge | Canvas / "✓ Converted" / "⏳ Converting…" / — | ST:629-642 | — | — | See above. |
| 👁 View | icon button | Open the editor | `openSchematicEditor` ST:424-438: `getPublicUrl` of the converted PNG (for a PDF) or of the file | R storage via a **public URL** | — | — |
| ⤒ Replace | icon button | Swap the drawing and keep the meters | opens the Replace dialog ST:329-333 | — | — | — |
| 🗑 Delete | icon button | Delete one | AlertDialog "Delete Schematic?" → `handleDeleteConfirm` ST:302-327 (same sequence as bulk) | W | Disabled while deleting | Toasts |
| Replace dialog: drop zone and "Replace Image" | file input and button | Upload the new drawing | `handleReplaceConfirm` ST:357-422: upload the new file → **delete the old files first** → update `file_path`, `file_type`, `converted_image_path = null`, `updated_at` → convert if PDF | W | Disabled without a file | **Not atomic:** if the DB update fails after the old files are deleted, the record points at deleted objects. The warning text says positions are "percentages relative to the image". **In fact they are relative to the canvas** (§4.4), so a replacement with a different aspect ratio misaligns the cards. |

The list uses **realtime**: a Postgres-changes subscription on `project_schematics` filtered by project, with the fixed channel name `'project-schematics-changes'` (ST:45-67), plus manual refetches.

### 4.4 Control inventory: `SchematicEditor` (Fabric.js v6)

Data loaded on mount and on refresh (SE:224-274):
- `scada_imports` WHERE project_id, all columns, **including raw_data**, which is heavy.
- `project_schematic_meter_positions` WHERE schematic_id.
- `project_meter_connections` WHERE project_id. Fetched **but never rendered or used**.
- `project_schematic_lines` WHERE schematic_id AND line_type = 'connection'.
- `project_tenants` (id, scada_import_id, include_in_load_profile) with a meter, giving a map of meter → tenant.
- There is no error handling on any of these reads.

**Canvas and interaction model:**
- The canvas is created once, with a background of #f8f9fa and no group selection.
- The background image is added through `FabricImage.fromURL(publicUrl, crossOrigin anonymous)`, scaled by `min(cw/w, ch/h)` and placed at 0,0.
- Cards and lines are positioned in **% of the canvas width/height**. That is not relative to the image, which is letter-boxed.
- A resize observer keeps width = container and height = width × 900/1400, and rescales the background.

| Control / gesture | Type | What it is for | Handler → effect | Data | Conditions | Errors |
|---|---|---|---|---|---|---|
| Edit / Editing | toggle button | Enter edit mode | `setIsEditMode` SE:1101-1111. Leaving edit mode resets the tool to select. **It does not save.** | — | — | — |
| Select | tool button (edit mode) | Move or resize cards | `activeTool='select'` | — | — | — |
| Place Meter | tool button | Click the canvas to place a meter | the mouse:down in meter mode records the % position → opens `QuickMeterDialog` SE:348-357 | — | Edit mode | — |
| Connect | tool button | Draw a connection | SE:360-474. Four blue **snap points** (top/right/bottom/left) are added around each card **when the tool is selected** (SE:894-925). They are stale if a card is moved after that. The first click must hit a snap point (within 15 px); intermediate clicks add amber waypoints (**Shift** snaps to the nearest meter axis within 80 px, with blue dashed guides); clicking a *different* meter's snap point finishes the line. A dashed grey preview follows the mouse. | On finish: insert `project_meter_connections {parent, child, project_id}` if it is not already present, and **insert one `project_schematic_lines` row per segment** (% coordinates, color #000, width 2, `metadata {parent_meter_id, child_meter_id, node_index}`) | Edit mode | Toast "Connection started…", "Click on a meter snap point to start a connection", "Connection saved", "Failed to save connection". **Drawing the same pair again inserts a duplicate set of lines** (only the connection row is de-duplicated). |
| Esc | key | Cancel the connection in progress | SE:935-950 | — | Connect tool | Toast "Connection cancelled" |
| Manage | button | List, add or delete connections in a form | opens `MeterConnectionsManager` (§4.6) | — | Edit mode | — |
| Delete (toolbar), or the Delete/Backspace key | button / key | Remove the selected meter card | `handleDeleteSelectedMeter` SE:953-991 → delete the `project_schematic_meter_positions` row | W | Edit mode and select tool; ignored while focus is in an input | "Select a meter card to delete" / success / failure (refetches). **The meter's lines and connections are left orphaned** and keep rendering. |
| Save | button | Persist card positions | `handleSave` SE:1014-1044: updates x/y % for every card and refetches positions; **exits edit mode** | W `project_schematic_meter_positions.x_position/y_position` | Disabled while saving | "Schematic saved" / "Failed to save schematic". **It saves positions only.** |
| Drag a card | Fabric object drag | Reposition | `object:modified` **auto-saves** the card's x/y % immediately (SE:602-622). **Shift while dragging** snaps to other cards' axes, with guides (SE:565-598). | W | Edit mode | Toast "Position saved" / "Failed to save position" on **every** drag. |
| Resize a card (corner handles) | Fabric controls | Enlarge or shrink a card | Fabric scales it; rotation is locked and the rotate handle hidden | **Not persisted:** `scale_x` and `scale_y` are read (SE:708-709) but never written | Edit mode | Lost on reload. |
| Drag a connection waypoint | Fabric object drag | Re-route a line | `object:moving` updates the adjoining segments (SE:546-563) | **Not persisted.** Lost on reload. | Middle nodes only | — |
| Include indicator on a card (green ✓ / grey circle) | Fabric circle, clickable | Include or exclude that meter's tenant in the load profile | mouse:down handler SE:785-827: optimistic toggle → `project_tenants.update({include_in_load_profile})` → invalidates `["project-tenants", id]` | W `project_tenants.include_in_load_profile` | Works in **any** mode. Shown for every card. | Rollback plus toast on error. **A meter with no linked tenant shows a green ✓ but clicking does nothing.** In Place-Meter mode a click on the indicator also opens the place dialog. |
| Mouse wheel | gesture | Zoom about the cursor (×0.95 / ×1.05; clamped 0.3–10) | SE:321-336 | — | — | — |
| Ctrl/Cmd + wheel | gesture | **Vertical pan** (unconventional; usually zoom) | — | — | — | — |
| Shift + wheel | gesture | Horizontal pan | — | — | — | — |
| Middle-mouse drag | gesture | Pan | window listeners SE:307-318, 478-484 | — | — | — |
| Zoom + / Zoom − / % badge / Reset (Maximize) | buttons | ×1.2 / ×0.8, clamped; reset zoom and viewport | SE:994-1012 | — | — | Zoom buttons zoom about the origin, not the centre. |
| Meters / Lines / Background | visibility toggles | Show or hide layers | SE:1154-1165 | — | — | — |
| Export SVG | button | Download the diagram | `handleExportSVG` SE:1053-1095: temporarily resets the viewport, `canvas.toSVG`, downloads `schematic-{id}.svg` | — | — | Toast. The background is embedded by URL (a public bucket), so the SVG shows it only while the URL stays valid. |

**Meter card content** (SE:692-698, 104-155): a 600×210 canvas rendered to an image and scaled to 200×140. Its rows are METER (`meter_label || site_name || id`), SHOP, NO, FILE, and COLOUR, which prints `meter_color` as **hex text**, not as a swatch. The border-colour parameter is ignored (the border is always black). Values are truncated with "…".

### 4.5 `QuickMeterDialog` (the Place Meter dialog)
Title: "Place Meter at (x%, y%)". It lists project meters (`scada_imports` WHERE project_id), filtered by search over site_name, shop_name, meter_label and shop_number.

| Control | Handler | Data | Notes |
|---|---|---|---|
| Search | filter | — | Autofocus |
| Meter button | `handleSelectMeter` QMD:62-103: if this schematic already has a position for this meter, **move it**; else insert a position (label = meter_label ‖ shop_name ‖ site_name) | W `project_schematic_meter_positions` | `.single()` errors when there is no row and the error is ignored (safe, but noisy). Empty text: "No meters available. Import SCADA data first." |
| Create Virtual Meter (collapsible): Meter Label *, Shop Name, Shop Number, "Create and Place" | `handleCreateVirtualMeter` QMD:105-162: (1) insert `scada_imports {site_name=meter_label=label, project_id, shop_name, shop_number}` with **no profile**; (2) insert `project_tenants {name, shop_name, shop_number, area_sqm:0, scada_import_id, is_virtual:true}`; (3) insert the position | W three tables | Label required. **Not transactional: a failure at step 2 or 3 leaves orphans.** The virtual tenant counts as "assigned" in the shell statuses (§1.5), with area 0 and no data. |

### 4.6 `MeterConnectionsManager` (the Manage dialog)
- **Purpose:** maintain the parent → child meter hierarchy without drawing it.
- **Controls:**
  - Parent (Upstream) select and Child (Downstream) select, both over project meters.
  - "Add Connection": refuses self-links ("A meter cannot connect to itself") and exact duplicates, then inserts `project_meter_connections`. It **creates no drawn line**.
  - The existing connection list, each with 🗑, which deletes the matching `project_schematic_lines` **for this schematic only** (fetch all, filter by metadata, then delete one by one), then deletes the connection. **Lines for the same pair on other schematics are orphaned.**
  - Close.
- **Validation gaps:** no cycle detection (A→B and B→A are both allowed); no rule that a child has only one parent; and the error on delete is ignored (toast "Connection deleted" regardless).
- **Consumption:** grep shows that `project_meter_connections` is read **only** by SE and MCM. **Nothing in the load model uses the hierarchy**, whether to avoid double-counting a parent meter and its sub-meters, to build a site total, or to feed the simulation. It is documentation only.

### 4.7 `SchematicViewer` page (dead)
`src/pages/SchematicViewer.tsx` reads `useParams()` `{id, projectId}`, loads `project_schematics` with `projects(name)`, resolves the public URL, and renders `SchematicEditor` full-page. **There is no route for it in `src/App.tsx`**, so it is unreachable. It is the WM-tariffs original that `SchematicsTab` now inlines.

### 4.8 Calculations and business rules (Schematics)
- Coordinates: `pct = pointer / canvasSize × 100` on write; `px = pct/100 × canvasSize` on read, for positions and lines alike (SE:350-354, 430-439, 606-610, 687-690, 853-857).
- Snap: 15 px to a snap point; 80 px axis snap. `snapToAngle` (45°) is defined at SE:63-70 but **never used**.
- Meter-card base size: 200×140 px.
- There are no electrical calculations: no load roll-up, no diversity, no cable data. `ExtractedMeterData` and `EditableMeterFields` in `types/schematic.ts:35-61` (rating, cable_specification, ct_type, serial…) are **unused** remnants of an extraction feature that does not exist here.

### 4.9 Data model (Schematics)

| Table | Columns | RLS |
|---|---|---|
| `project_schematics` | id, project_id → projects ON DELETE CASCADE, name NOT NULL, description, file_path (nullable since `20260220093418`), file_type (nullable), page_number int default 1, total_pages int default 1, converted_image_path, uploaded_by uuid (no FK), created_at, updated_at | Any authenticated user, full CRUD, all projects. Realtime enabled. |
| `project_schematic_meter_positions` | id, schematic_id → project_schematics ON DELETE CASCADE, **meter_id TEXT (no FK to scada_imports)**, x_position, y_position numeric (%), label, scale_x, scale_y numeric default 1.0, timestamps | Any authenticated user. Deleting a meter leaves dangling positions, which render with the raw id. |
| `project_schematic_lines` | id, schematic_id → CASCADE, from_x/from_y/to_x/to_y numeric (%), line_type default 'connection', color, stroke_width, metadata jsonb, created_at | Any authenticated user. |
| `project_meter_connections` | id, **parent_meter_id TEXT, child_meter_id TEXT (no FKs)**, project_id → CASCADE, created_at | Any authenticated user. No unique constraint on (parent, child). |
| Storage `project-schematics` | **public bucket**, 50 MB limit; paths `{projectId}/{ts}-{name}` and `…_converted.png` | SELECT: **anyone** ("Anyone can view project schematics"); INSERT/UPDATE/DELETE: any authenticated user. |

### 4.10 External services (Schematics)
Supabase REST, Storage and Realtime. pdf.js runs client-side (`lib/pdfConversion`). Fabric.js is used on the client. There are no edge functions.

### 4.11 Defects, gaps and security (Schematics)
1. **Client electrical drawings sit in a public bucket.** Anyone with the URL can read them, and the URL pattern contains `projectId/timestamp-filename`.
2. RLS is open to any authenticated user of any org.
3. The tab status is always "pending", even when schematics exist.
4. Only positions persist. Card resize (`scale_x/y`) and waypoint moves are lost.
5. Deleting a card orphans its lines and connections. The IDs in positions and connections are text with no FKs.
6. Duplicate line sets on a redraw. Connection deletion leaves lines on other schematics.
7. The hierarchy (`project_meter_connections`) is unused by any calculation.
8. PDF: page 1 only; `total_pages` is cosmetic; a failed conversion is stuck at "Converting…"; the upload file name is not sanitised.
9. Replace is not atomic, and the aspect-ratio warning is inaccurate (positions are relative to the canvas, not the image).
10. `meterConnections` is fetched but unused; `snapToAngle` is unused; `SchematicViewer` and `MeterFormFields` are dead; the `ExtractedMeterData` types are unused.
11. The include ✓ on a card for a meter without a tenant is misleading. The indicator is active in every mode and collides with Place-Meter clicks.
12. The editor loads `scada_imports.*` including `raw_data` for every project meter. That is heavy.
13. Stale snap points after cards move. Ctrl+wheel pans instead of zooming.
14. The realtime channel name is not project-unique.
15. Virtual-meter creation is not transactional and inflates the shell's "assigned" count.

### 4.12 Dependencies (Schematics)
- **Needs first:** project meters in `scada_imports` WHERE project_id. They come from Tenants → Import Data or Import from Library, or are created as virtual meters here. Tenants must be linked to meters for the include toggles to work.
- **Feeds:** `project_tenants.include_in_load_profile`, which Load Profile and Simulation consume. It creates virtual meters and tenants, which the Tenants tab shows as "Virtual". Nothing else consumes the hierarchy or the drawings.

---

## 5. Cross-cutting notes for the E-Site rebuild
- **Authorisation must be designed from scratch.** None of these tables has project- or org-scoped RLS that actually holds (§0.2). E-Site's RESTRICTIVE-policy and `user_has_project_access` model should gate every one of them. `shop_types` and the "global meter library" need an explicit ownership decision: per org, or platform-curated.
- **Remove the service-role geocode write** (or require a JWT plus a project-access check), and make the schematic bucket private with signed URLs.
- **Make tab state a URL segment** (`/projects/[id]/solar/[tab]`) so tabs can be deep-linked, and add a dirty-state guard.
- **Replace every "Anyone/true" status rule with real data**: schematics count, documents count, and so on. Decide whether "blocked" should actually block.
- **Pick one kWh estimate formula** and use it for both the row values and the totals: the scaling rule, weekday/weekend weighting, days per month, and the treatment of multi-meters (sum or average).
- **Collapse the three CSV ingestion paths** (tenant-schedule CSV, SCADA wizard, library import) into one server-side importer. It should be idempotent by content hash, confirm before it writes, honour the column mapping the user chose, store one file copy, and produce `raw_data` from the same column as the profile.
- **Do not port the dead code:** `ProjectOverview`, `ShopTypesManager` (unless shop types become a feature), `TenantProfileMatcher` (or finish its Assign), `SchematicViewer`, `MeterFormFields`, `useProjectStore`, `calculateAveragedProfiles`, `snapToAngle`, and the `ExtractedMeterData` types.
