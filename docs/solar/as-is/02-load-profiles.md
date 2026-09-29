# 02 — Load Profiles (WM Solar → E-Site "Solar" add-on)

**Source:** read-only export of `WattMatt/greencalc-sa` `origin/main` (no `.git` in the export, so commit hashes are not available; the "Fix kWh-to-kW conversion for sub-hourly CSV load profiles" change is described by what the code does now).
**Scope:** the project **Load Profile** tab, the project **Tenants** tab and the meter components that feed it, the global **Load Profiles** page (`/load-profiles`), and the import, parsing and normalisation pipeline (client utilities and edge functions).
**Method:** every claim cites `file:line` relative to the repository root. Parts A to D were produced by four parallel read-throughs of disjoint file sets. Section 0 (this section) holds the cross-cutting findings, which were checked by hand.

---

## 0. Cross-cutting summary: what a rebuild must get right

### 0.1 Where load data enters and where it goes

```
          ┌────────────────────── GLOBAL /load-profiles page (Part C) ───────────────────────┐
 CSV/XLSX │ CsvImportWizard · BulkCsvDropzone · OneClickBatchProcessor · ScadaImport ·        │
 GSheets  │ SheetImport · GoogleSheetsImport · ExcelAuditReimport · MeterReimportDialog       │
 AI       │   → client parse (utils/sharedParsingUtils, csvToLoadProfile)  or edge fns        │
          │     (process-scada-profile, ai-import-loadprofiles, ai-import-sheet,              │
          │      import-google-sheet, normalise-raw-data)          (Part D)                   │
          └───────────────► public.scada_imports  (a "meter": raw_data jsonb + 24-value        │
                            load_profile_weekday / load_profile_weekend + totals, per site)  ─┘
                                        │
       Project Tenants tab (Part B) ────┤ tenant.scada_import_id / multi-meter selection /
       (TenantManager, ScadaImportWizard, MeterLibraryImportDialog, MultiMeterSelector,
        ScaledMeterPreview, ProjectMeterStacking)   + shop_types fallback (kWh/m²)
                                        │
       Project Load Profile tab (Part A) ── useLoadProfileData(tenants, shopTypes, …)
                                        │      → chartData[24] { hour, total, per-tenant…, pvGeneration, battery… }
                                        ▼
       Simulation (useSimulationEngine.ts:162-210) calls the SAME hook with ALL_DAYS/ALL_MONTHS,
       powerFactor 0.9, and passes loadProfile = chartData.map(d => d.total)  → number[24]
                                        ▼
       runAnnualEnergySimulation(loadProfile[24], solar[24], …, solar8760?)  (EnergySimulationEngine.ts:749)
```

### 0.2 The downstream shape (the most consequential fact in this review)

- The simulation consumes a **single 24-value array** (average kW per hour, which equals kWh per hour), built by `useLoadProfileData` with **every weekday and every month selected** (`src/components/projects/simulation/useSimulationEngine.ts:162-181`, `:210`).
- `runAnnualEnergySimulation` builds 8,760 hours but reads `const load = loadProfile[h] || 0` (`src/components/projects/simulation/EnergySimulationEngine.ts:818`). **The same 24-hour load shape repeats on every day of the year.** Weekday and weekend differences, monthly or seasonal load variation, and public holidays are all averaged away before the annual simulation. Only the solar side can be truly 8760 (`solarProfile8760` from TMY). The engine's own comment calls the input "24-hour representative load profile (kWh)" (`EnergySimulationEngine.ts:750`).
- The second call (`useSimulationEngine.ts:184-202`) produces a per-day profile for the day-view chart (a selected day-of-week and month), not for annual energy.
- `powerFactor: 0.9` is hard-coded at both call sites (`useSimulationEngine.ts:170`, `:195`). It only matters when `displayUnit` is kVA.
- **Rebuild implication:** E-Site should store readings as a real interval time series and derive an 8760 (or 17,520 half-hour) load series for simulation. Keep the 24-value weekday/weekend arrays only as a preview or fallback, or the rebuild inherits this loss of accuracy. Tariff (TOU) costing inherits the same flattening: every weekday and weekend in the simulation has an identical load, so weekend off-peak benefit is misstated whenever the real load differs by day type.

### 0.3 kWh→kW conversion (the recent fix): what the code does now

`src/components/loadprofiles/utils/csvToLoadProfile.ts:515-590`:
- **Power input (kW):** each hour bucket takes the arithmetic **mean of all readings in that clock hour across all days** (`:524-529`). Total energy = Σ(value × detectedInterval/60) (`:564-569`).
- **Energy input (kWh per interval):** each hour bucket = **Σ(all readings in that hour across all days) ÷ number of distinct weekday (or weekend) dates** (`:530-542`). With 30-minute kWh data, two readings per hour are summed, giving kWh per hour, which equals average kW. This is the fix: before it, sub-hourly kWh was presumably averaged, which halved (30-minute) or quartered (15-minute) the result.
- `peakKw` = max of the **averaged profile** (`:579`), **not** the true peak interval demand. It understates the maximum-demand figures that tariffs bill on.
- **Edge case (not handled):** the divisor is the count of distinct dates on which *any* reading exists (`weekdayDates.size`). If a day has missing intervals, its missing hours count as zero energy, so the average is biased low. The power path averages only the readings that exist, so it is not biased the same way. The two input types therefore handle gaps differently.
- Also: `|| 1` guards (`:521`, `:545`) mean a file with no weekend dates yields a weekend profile of all zeros, not "no data".

- **Also (Part A):** the simulation's call to `useLoadProfileData` passes **no `validatedSiteData` and no `diversityFactor`** (`useSimulationEngine.ts:163-207`). So the simulation drops raw SCADA interval data, applies diversity 1.0 while the tab defaults to 0.80, and uses PF 0.9 while the tab uses 0.95. **The load the simulation runs on is not the load the Load Profile tab shows.**

### 0.5 Headline defects (details and citations in Parts A–D)

1. **`scada_imports.raw_data` has several incompatible shapes** (Part C §C.16, Part D data model). Each screen understands a different subset, so meters silently show zero or disappear. `load_profile_weekday` is in kW from `processCSVToLoadProfile` but is **percent-summing-to-100** after the SitesTab "Reprocess" button runs. A rebuild must define ONE canonical reading schema and a unit on every derived array.
2. **Multi-meter tenants are summed, not weight-averaged** (Part A). "Monthly kWh" has five inconsistent computations across the Tenants tab (Part B). Scaling is a plain area ratio. The shop-type fallback is a hard-coded 50 kWh/m²/month, and a meter with no area is treated as 1 m².
3. **Diversity is a flat multiplier on every hour** (it cuts energy, not only coincident peak) and is stored in localStorage per browser, not per project (Part A). TOU periods come from a hard-coded default table or browser localStorage, not from the project's tariff.
4. **Import integrity** (Parts B, D):
   - The SCADA wizard reports "Done" before the database write finishes.
   - Several wizard options are never read.
   - A file whose date column is not recognised by name imports nothing, silently.
   - Ambiguous dates default to Y/M/D.
   - The global library meter is upserted by bare file name, so files overwrite each other across projects.
   - The same file lands in storage three times.
   - Deletes leave orphans behind.
5. **Destructive global maintenance buttons** (Part C): "Excel Audit Reimport" replaces `raw_data` with a stub and copies weekday data over weekend. "Clear Processed" and "Fix 30-min Averaging" rewrite every meter in the database; Fix 30-min asks for no confirmation.
6. **Security:**
   - `project_tenants`, `project_tenant_meters` and `stacked_profiles` RLS admit anon read, write and delete.
   - `scada_imports` and the `scada-csvs` bucket admit any authenticated user, with no org or tenant scoping.
   - A stored XSS path exists: site names are placed into map-marker `innerHTML`.
   - Edge-function auth and CORS posture is covered in Part D.
7. **Dead or stub UI:**
   - The battery chart and its CSV columns are always zero.
   - Annotations are never drawn on a chart or saved.
   - The outlier count is always 0.
   - SVG export downloads an icon instead of the chart.
   - The profile matcher's "Assign…" button only logs to the console.
   - Site Detail's "Process All" and "Configure" do nothing.
   - Map-click pin placement never fires.
   - Seven components on the global page, plus `ProjectMeterLibrary` and `ProjectMeterStacking`, are unreachable.
8. **Parsing correctness** (Part D):
   - Six different CSV parsers disagree on delimiter, header row, date order and units.
   - All live imports run in the browser. The documented server-side path for 10k+ rows exists only in the unmounted `ScadaImport.tsx`.
   - A decimal comma produces a value 10× too large.
   - MM/DD dates are silently misread.
   - A time of "24:00" aborts the whole import.
   - The browser's time zone shifts dates by one day.
   - The `load_profile_*` column default is 4.17 in every hour; placeholder meters therefore become a flat 4.17 kW load.
   - `correctProfileForInterval` divides already-correct profiles by 2 or 4 a second time.
   - kW data labelled kWh is summed, inflating the load 2–4×.
   - Edge functions `ai-import-loadprofiles`, `ai-import-sheet`, `import-google-sheet` and `process-scada-profile` run with `verify_jwt=false` and have no auth check in code, so unauthenticated callers can spend Anthropic credits and write through the service role.
   - SheetImport "Full Sync" can delete every meter in the system.
   - `xlsx@0.18.5` has known CVEs.
   - The `simulation/` scripts contain no assertions.
9. **Performance:** full `raw_data` jsonb blobs are fetched for every meter (unbounded), with N+1 per-meter fetches. `.limit(5000)` is silently capped at 1000 rows by PostgREST. CSVs are parsed in the browser.

### 0.6 Rebuild recommendations (E-Site)

- **Storage:** keep the raw file in storage once. Put readings in a narrow table or a compressed columnar blob per meter (`meter_id, ts timestamptz, value, unit, interval_min`), not an unbounded jsonb array. Derive profiles server-side into typed columns with explicit units (`kw_avg_by_hour_weekday[24]`, etc.) plus an 8760 or 17,520 series.
- **Parsing:** run it server-side with explicit, user-confirmed choices for the date order, the unit (kW, kWh, kVA, kVAh, Wh or MWh) and the interval length. Report gaps, duplicates and DST instead of silently zero-filling them. Store the true maximum interval demand separately from the averaged profile.
- **Composition:** one tenant→meter weighting model (a weighted average of kW/m² × tenant area). Apply diversity only to coincident peak or to an explicitly chosen scope, stored per project. Take TOU from the project's tariff.
- **Access:** gate everything on E-Site project membership through RLS, following the `user_has_project_access` pattern. Add no anon policies.

### 0.7 Contents

- Part A — Project Load Profile tab (`src/components/projects/load-profile/**`)
- Part B — Tenants tab, project meter library, multi-meter selection, stacking, SCADA import wizard
- Part C — Global Load Profiles page (screens)
- Part D — File formats, parsing, normalisation, data model, downstream shape

### 0.4 Load Profile tab readiness status (ProjectDetail)

`src/pages/ProjectDetail.tsx:1124-1131`: `blocked` if no tenant has an assigned profile; `complete` if all tenants have one; otherwise `partial`. The tooltip reads "Showing data from N tenant profiles". The tab renders `LoadProfileChart` (`ProjectDetail.tsx:1335-1350`), a re-export of `src/components/projects/load-profile/index.tsx` (`LoadProfileChart.tsx:1-3`). Props: `tenants`, `shopTypes`, `projectId`, `connectionSizeKva`, `latitude`/`longitude` (**defaulting to Cape Town −33.9249, 18.4241** when the project has no coordinates, `ProjectDetail.tsx:1341-1342`), the latest simulation's solar kWp, battery kWh/kW and DC:AC ratio (`results_json.pvConfig.dcAcRatio` via an `any` cast), system-includes flags, and `onNavigateToTenant`.

---


---

## Part A — Project Load Profile tab

**Scope.** The "Load Profile" tab on the project detail page (`/projects/:id`, tab value `load-profile`). All paths are relative to `src/`. Abbreviations used below:

- `PD` = `pages/ProjectDetail.tsx`
- `LP/` = `components/projects/load-profile/`
- `LPD` = `LP/hooks/useLoadProfileData.ts`
- `VSD` = `LP/hooks/useValidatedSiteData.ts`
- `ENV` = `LP/hooks/useEnvelopeData.ts`
- `STK` = `LP/hooks/useStackedMeterData.ts`
- `SOL` = `LP/hooks/useSolcastPVProfile.ts`
- `EXP` = `LP/hooks/useExportHandlers.ts`
- `IDX` = `LP/index.tsx`

`components/projects/LoadProfileChart.tsx` is only a 3-line re-export shim (`export { LoadProfileChart } from "./load-profile"`, lines 1-3).

---

### A.0 Where the tab gets its data (ProjectDetail)

| Input | Source | Cite |
|---|---|---|
| `tenants` | `project_tenants` `select('*, shop_types(*), scada_imports(shop_name, area_sqm, load_profile_weekday, load_profile_weekend, date_range_start, date_range_end, detected_interval_minutes)')`, filtered by `project_id` and ordered by `name`. **`raw_data` is not selected here.** | PD:917-927 |
| `tenant.tenant_meters[]` | second query: `project_tenant_meters` `select(id, tenant_id, scada_import_id, weight, scada_imports:scada_import_id(id, shop_name, site_name, area_sqm, load_profile_weekday, load_profile_weekend, detected_interval_minutes))` `.in('tenant_id', tenantIds)`, grouped by tenant and merged onto each tenant | PD:929-956 |
| `shopTypes` | `shop_types select('*') order('name')` (a global table, not project-scoped) | PD:961-968 |
| `connectionSizeKva` | `project.connection_size_kva` | PD:1340 |
| `latitude/longitude` | `project.latitude ?? -33.9249`, `project.longitude ?? 18.4241`. This is a **hard-coded Cape Town fallback**. The Solar Forecast tab uses Johannesburg (-26.2044, 28.0456) instead. | PD:1341-1342 vs PD:1423-1424 |
| `simulatedSolarCapacityKwp` / `BatteryCapacityKwh` / `BatteryPowerKw` | latest `project_simulations` row (`order created_at desc limit 1`): `solar_capacity_kwp`, `battery_capacity_kwh`, `battery_power_kw` | PD:988-1002, 1343-1345 |
| `simulatedDcAcRatio` | `latestSimulation.results_json.pvConfig.dcAcRatio` (untyped `as any`) | PD:1346 |
| `systemIncludesSolar/Battery` | parsed from `project.system_type`, a comma string. Solar is **true when `system_type` is empty**. | PD:874-886, 1347-1348 |
| `onNavigateToTenant` | sets `highlightTenantId`, switches to the `tenants` tab, and clears the highlight after 3000 ms | PD:1349-1354 |

The page renders a skeleton until the project, tenants and latest-simulation queries have loaded (PD:1069-1078).

**How `tabStatuses["load-profile"]` is computed (PD:1094-1096, 1124-1131)**

- `assignedCount = tenants.filter(t => t.scada_import_id).length`
- `assignedCount === 0` gives `blocked`, with the tooltip "Assign load profiles to tenants first".
- `assignedCount === tenantCount` gives `complete`.
- Otherwise the status is `partial`, with the tooltip "Showing data from N tenant profiles".
- ⚠ Only the single-meter link `scada_import_id` is counted. Tenants linked **only** through `project_tenant_meters` (multi-meter) count as unassigned. A project with only multi-meter assignments therefore shows **blocked** even though the tab renders real data.
- The status ignores whether any `raw_data` exists, and it ignores `include_in_load_profile`.
- The Simulation tab's `blocked` rule uses the same `assignedCount` (PD:1143).

---

### A.1 The site load-profile algorithm

#### A.1.1 Pipeline overview

```
PD tenants ──► useRawScadaData (fetch raw_data,value_unit)  [IDX:61]
            └► useValidatedSiteData (per-tenant per-date hourly kW; site sum; outage filter) [IDX:64]
                 ├► useLoadProfileData  → chartData (24 rows), stats, PV, grid, over-paneling [IDX:159-191]
                 ├► useEnvelopeData     → envelope min/avg/max (24 rows) [IDX:194-201]
                 └► useStackedMeterData → per-tenant stacked areas (24 rows) [IDX:203-214]
useSolcastPVProfile → normalised 24-h PV shape + temps [IDX:147-157]
global settings (localStorage): derating (PF, DC/AC, losses), diversity factor [IDX:68-69]
```

#### A.1.2 Raw data fetch — `useRawScadaData` (`LP/hooks/useRawScadaData.ts`)

- It collects scada IDs from `tenant.scada_import_id` **and** from every `tenant_meters[].scada_import_id`, across **all** tenants, including tenants excluded from the load profile (lines 23-34).
- One query: `scada_imports select('id, raw_data, value_unit') .in('id', ids) .not('raw_data','is',null)` (lines 41-45). It is keyed `["tenant-raw-data", scadaIds]`, with `staleTime` 5 min (lines 37, 62).
- The result is `RawDataMap = { [scadaImportId]: { raw_data, value_unit } }` (lines 6-11, 50-58).
- **The error is thrown but never surfaced.** `index.tsx` reads only `rawDataMap` and `isLoadingRawData` (line 65). On failure the map is `{}` and every tenant silently falls back to estimates.

#### A.1.3 Per-tenant, per-date hourly kW — `useValidatedSiteData`

**1. Included tenants.** Tenants with `include_in_load_profile !== false` (VSD:47).

**2. Display key.** Tenant name truncated to 15 chars + "…" (VSD:93). ⚠ Two tenants whose names share the first 15 characters collide on the same key in `useLoadProfileData`'s per-key sums and in `TopContributors`.

**3. Source resolution, in priority order (`getRawEntries`, VSD:50-84):**

- (1) The direct link `scada_import_id` present in `rawDataMap`. `areaScale = tenant.area_sqm / scada_imports.area_sqm` when both are > 0, otherwise 1 (VSD:55-61).
- (2) Inline `tenant.scada_imports.raw_data` with `value_unit: null` (VSD:63-69). **This path is dead from this tab**, because PD never selects `raw_data`.
- (3) Multi-meter. Every `tenant_meters[]` whose raw data is loaded contributes an entry with `areaScale = tenantArea / meterArea` (VSD:71-82). ⚠ **`weight` is ignored, and the meters are summed, each one scaled to the full tenant area** (VSD:120, 134). A tenant with N reference meters is overcounted about N×. The estimate path (A.1.5) instead takes a **weighted average** of kW/m² across meters. The two paths disagree.
- ⚠ Priority (1) short-circuits (3). If a tenant has both a direct link and multi-meters, the multi-meters are ignored.

**4. Point parsing (VSD:103-111).**

- If `raw_data[0]` has `date` and `time`, the array is used as-is.
- Otherwise it goes through `normaliseRawData` (`components/loadprofiles/utils/normaliseRawData.ts:26-191`). That function handles:
  - Format 1/2: `{date,time,value}`
  - Format 3: `{timestamp,value}`, with timestamps as ISO, `YYYY/MM/DD`, SA `DD/MM/YYYY`, `DD Mon YYYY HH:MM`, or date-only
  - Format 4: `{csvContent}`, with header sniffing over the first 10 lines and value column matched on `kwh|value|active|p1`, else column 2
  - Format 5: summary objects, which return `[]`

**5. Hour bucketing (VSD:115-136).**

- `hour = parseInt(time.split(':')[0])`, and points with hours outside 0-23 are dropped (so `24:00` readings are lost).
- `kwValue = value × areaScale`.
- Points accumulate into `dateHourMap[date][hour] = {sum, count}` **across all of the tenant's meters**.
- The line `hourEntry.sum += useSum ? kwValue : kwValue` (VSD:134) is a no-op ternary.

**6. Interval → hourly collapse (VSD:139-154).**

- `useSum = isEnergyUnit(firstEntry.value_unit)` (VSD:143). Only the tenant's **first** meter's unit is used.
- `isEnergyUnit`: `null`/empty counts as energy, and so do `kwh | wh | mwh | kvah` (VSD:7-12).
- **Energy units:** hourly value = sum of all sub-hourly readings in that hour. Summing kWh over an hour gives kWh-in-hour, which is numerically average kW. This is correct for kWh.
- ⚠ `wh` and `mwh` are **not rescaled** (no ÷1000 or ×1000), so Wh data plots 1000× too high.
- ⚠ `kvah` is treated as kW with no power factor applied.
- **Power units** (anything else, e.g. `kw`): hourly value = `sum / count`. For a multi-meter tenant with power units this **averages across meters instead of summing them**.
- Timestamp convention: a period-ending timestamp (`01:00` for 00:00-01:00) is bucketed into the next hour. No convention handling exists.

**7. Tenant counts (VSD:162-181).**

- `scadaCount` = tenants with raw data, plus non-raw tenants that have a 24/48/96-length `load_profile_weekday` (single or multi-meter).
- `estimatedCount` = the rest.

**8. Site dates (VSD:187-196).** The **union** of all dates across all raw-data tenants. The comment calls these "validated dates", but no overlap is required.

**9. Site sum and outage filter (VSD:199-216).**

- Per date, sum the hourly kW over the tenants that **have** that date. Tenants missing the date contribute 0, so dates at the edges of meter coverage understate the site.
- Drop the date if `Σ24h < SITE_OUTAGE_THRESHOLD_KW = 75` (VSD:15). That is a fixed 75 kWh/day, regardless of site size.

**10. Returned values (VSD:220-231).**

- `validatedDateCount = allValidatedDates.length`. This is the count **before** the outage filter, so it does not equal `siteDataByDate.size`.
- `outlierCount` is **always 0** (declared at VSD:162 and never incremented). The "N outlier days excluded" badge (`LP/charts/LoadEnvelopeChart.tsx:128-132`) and the "outliers removed" badge (`LP/components/DataInspector.tsx:192`) are dead UI.
- `availableYears` are collected from **all** points, including dates later dropped (VSD:122-123, 218).

#### A.1.4 Composite 24-hour profile — `useLoadProfileData` (LPD)

Inputs from IDX:173-191. Defaults: `systemLosses = 0.14`, `diversityFactor = 1.0` (LPD:124-125).

**1. Date selection (LPD:178-195).**

- Keep `siteDataByDate` keys whose month is in `selectedMonths` (0-indexed) and whose JS `getDay()` (0 = Sun) is in `selectedDays`.
- ⚠ **No year filter here.** The year-range selects only affect the envelope and stacked charts. The stats, CSV/PDF export and PV/grid charts use all years.

**2. Raw-data tenants (LPD:262-276).**

- For each raw tenant and hour: `avg = Σ tenantHourly[h] over validatedDates / validatedDates.length`.
- Dates on which the tenant has no data count as 0 in the numerator but are still in the denominator. This understates tenants with partial coverage.
- ⚠ If month or day filters leave **zero** dates, raw tenants contribute **nothing**. They are not re-routed to the fallback path, so the chart silently shows only the estimated tenants.

**3. Non-raw tenants: fallback `getFallbackHourlyKw` (LPD:198-244).**

`avgDayMultiplier` is the mean of `DAY_MULTIPLIERS` over the selected days (LPD:201-204). The multiplier values are hard-coded at `LP/types.ts:74-82`:

| Day | Multiplier |
|---|---|
| Mon | 0.92 |
| Tue | 0.96 |
| Wed | 1.00 |
| Thu | 1.04 |
| Fri | 1.08 |
| Sat | 1.05 |
| Sun | 0.88 |

⚠ With the day preset **None** selected, `daysArray = []`. Then `avgDayMultiplier = 0/0 = NaN` and every fallback value becomes NaN. Also `[].every(...)` is `true`, so `isWeekend` becomes true.

The fallback tries these sources in order:

- **Priority 2, multi-meter averaged profile** (area > 0).
  - `getAveragedProfileKw(tenant_meters, weekday|weekend)` (LPD:56-82) keeps meters whose profile length is 24/48/96 **and** whose `area_sqm` > 0.
  - Each meter's profile is interval-corrected, then accumulated as `Σ (profile[h] / meterArea) × weight/Σweight`. The weight defaults to 1.
  - Result: `tenantArea × kWperm²[h] × avgDayMultiplier`.
  - If all selected days are weekend and there is no weekend profile, it falls back to the weekday profile (LPD:207-216).
- **Priority 3, single SCADA pre-computed profile.**
  - Uses `scada_imports.load_profile_weekday`, or `load_profile_weekend` when all selected days are weekend (falling back to weekday).
  - `correctProfileForInterval` is applied, then `× tenantArea / scadaArea` (scadaArea defaults to tenantArea) `× avgDayMultiplier`.
  - With no tenant area, the result is simply `× avgDayMultiplier` (LPD:219-232).
  - ⚠ Day multipliers are applied **on top of** a profile that is already weekday- or weekend-specific. This double-counts the day effect.
- **Priority 4, shop-type estimate** (area > 0 only; area ≤ 0 returns null, so the tenant is dropped silently) (LPD:235-243).
  - `monthlyKwh = tenant.monthly_kwh_override || (shopType.kwh_per_sqm_month || 50) × area`. The default of **50 kWh/m²/month is hard-coded**.
  - `dailyKwh = monthlyKwh / 30`.
  - The profile is `shopType.load_profile_weekday` (or weekend), and must be exactly length 24. Otherwise `DEFAULT_PROFILE_PERCENT = Array(24).fill(4.17)` is used (`LP/types.ts:84`); 4.17 × 24 = 100.08%.
  - Hour value = `dailyKwh × p/100 × avgDayMultiplier`, so shop-type profile values are **percent of daily energy per hour**.
  - ⚠ The month filter is ignored and there is no seasonality.
  - ⚠ `monthly_kwh_override` is *not* scaled by area. It is a whole-tenant figure, which is correct but undocumented.

**4. `correctProfileForInterval` (LPD:19-53).** It is duplicated with drift in ENV:24-39 and STK:40-55. The arbitrary-length branch exists only in LPD.

- Length 48: average adjacent pairs.
- Length 96: average groups of 4.
- Length 24 with `detected_interval_minutes` 30: divide by 2. With 15: divide by 4. Otherwise unchanged.
- Other lengths (LPD only): bucket-average.
- ⚠ The 48/96 branches assume kW samples (averaged), while the 24 + 30-min branch divides by 2, which assumes something else. The meaning of the stored `load_profile_*` arrays is not established by this code; it is defined by the import slice.

**5. Row shape (LPD:257-285).** `{hour: "HH:00", total, [tenantKey]: kW}`. The fallback key uses the same 15-char truncation (LPD:252).

**6. Diversity and unit conversion (LPD:372-383).**

- **Every** key, including `total`, is multiplied by `diversityFactor`.
- For kVA display, each value is then divided by `powerFactor`.
- Diversity is a flat scalar on the whole site: every hour, raw and estimated tenants alike. It is **not** a coincidence model.

**7. Weekday/weekend daily kWh (LPD:288-361).** These feed ChartStats' "Monthly" figure.

- Raw data: mean site daily total across validated weekdays and weekends. Month-filtered, not day-filtered.
- Fallback tenants:
  - Multi-meter: `Σ kW/m² × area`.
  - Single SCADA: `Σ profile × area/scadaArea`.
  - Shop type: `dailyKwh` for weekdays and `dailyKwh × 0.85` for weekends. The 0.85 is a hard-coded weekend factor.
- ⚠ **Diversity is NOT applied** to these figures, while `totalDaily` is diversified.
- ⚠ Day multipliers are not applied here either, so this path is inconsistent with the chart.

**8. Stats (LPD:434-437).**

- `totalDaily = Σ total` (kWh/day, but labelled with `unit`).
- `peakHour = argmax total`.
- `avgHourly = totalDaily / 24`.
- `loadFactor = avg/peak × 100`.
- The header peak comes from the **envelope's `max`** series when the envelope exists (IDX:254-256), not from `chartData`. So the header peak and the CSV/PDF peak differ.

**9. Memo instability (performance).** `daysArray` is a fresh `Array.from` on every render (LPD:133) and sits in the `useMemo` deps (LPD:369). The whole composite is therefore recomputed on every render.

#### A.1.5 Envelope — `useEnvelopeData` (ENV)

**1. Year range.** `yearFrom/yearTo` are local state. The defaults are the first and last `availableYears`, or 2020/2030 when no years exist (ENV:75-79). The range is not persisted.

**2. Fallback total.** `fallbackHourlyTotal` repeats LPD's fallback chain for `nonScadaTenants` (ENV:84-143), with drift:

- Its `getAveragedProfileKw` does **not** require meter area > 0, and uses `area || 1`. A meter with no area therefore yields kW/m² = kW, which is then multiplied by the tenant area (ENV:41-62).
- LPD excludes such meters.

**3. Filtering and averaging.**

- Dates are filtered by year range, month set and weekday set (ENV:150-162).
- Each day's composite is `(siteHourly[h] + fallback[h]) × diversity` (ENV:176).
- `avg[h] = mean` across the filtered days (ENV:200).

**4. Min/max** are **whole days**, not per-hour extremes.

- Days are sorted by daily total. The "min" day is at index `floor(n × 0.01)` and the "max" day at `floor(n × 0.99)`.
- These are the 1st and 99th percentiles, even though the comment says 5th/95th (ENV:186-191).
- The band plots those two days' hourly curves (ENV:196-199).
- The comment "Clamp max/min so they never cross the average line" is **not implemented**; the curves can cross avg.

**5. kVA display.** Multiply by `1/powerFactor` (ENV:166).

**6. Empty cases.** No raw data, or no dates after filtering, returns `[]`, and the envelope chart renders **nothing, with no message** (`LoadEnvelopeChart.tsx:70`). Estimate-only projects therefore have **no main load chart at all**: the envelope is the only load chart on this tab.

#### A.1.6 Stacked meter chart — `useStackedMeterData` (STK)

**1. Early exits.** No raw-data tenants, or no dates after filtering by year/month/day, gives `{data:[], tenantKeys:[]}` (STK:91-114). This yields a blank area with no message.

**2. Fallback.** The same drifted fallback chain as the envelope (STK:117-172). It is aggregated into a single `"__estimated__"` series labelled "Estimated", coloured `#94a3b8` (STK:12, 236-243).

**3. Modes.**

- `avg`: per tenant, `Σ hourly × diversity × unitMult / filteredDateKeys.length` (STK:177-191). The denominator is the site date count, not the tenant's own date count.
- `max`/`min`: pick **one date** at the 99th or 1st percentile of site daily total (including fallback), then show every tenant's values on that date (STK:193-223).

**4. Colours.** A 20-colour palette, cycled (STK:5-10).

#### A.1.7 Specific-date mode, monthly data, `parseRawData`: DEAD CODE

- `LP/hooks/useSpecificDateData.ts`, `LP/hooks/useMonthlyData.ts` and `LP/utils/parseRawData.ts` have **no importers anywhere in `src/`**. They were verified by grep.
- The tab has **no specific-date or single-month mode**. Only the day and month multi-selects plus the year range exist.
- For the record, these hooks disagree with the live path:
  - They read `tenant.scada_imports.raw_data`, which is never selected (useSpecificDateData:39, 84).
  - They **average** sub-hourly readings (sum/count), treating values as kW (useSpecificDateData:136-138; useMonthlyData:170-171). The live path sums them as kWh.
  - `useMonthlyData.peakKw = value × 2` hard-codes 30-minute kWh (useMonthlyData:103).
  - `useSpecificDateData` uses `toISOString()` (a UTC date shift) for date matching (line 68).
- `LP/charts/LoadChart.tsx` and `LP/charts/BuildingProfileChart.tsx` live in this folder but are only rendered by `components/projects/simulation/SimulationChartTabs.tsx`, not on this tab.

#### A.1.8 PV overlay (LPD:136-145, 385-403; SOL)

**PV shape**

- **Static:** hard-coded `[0,0,0,0,0,.02,.08,.2,.38,.58,.78,.92,1.0,.98,.9,.75,.55,.32,.12,.02,0,0,0,0]`. It is duplicated at LPD:140 and SOL:42-44.
- The static profile claims `dailyGhiKwh = peakSunHours = 5.5` (SOL:171-172), but the array sums to 6.5. The "Static Profile (5.5 PSH)" badge (`ChartSettings.tsx:278`) is only a label; the 5.5 is never used in the calculation.

**Solcast**

- Calls `supabase.functions.invoke('solcast-forecast', {latitude, longitude, hours: 24, period: 'PT60M'})` (SOL:66-73).
- Expected response: `{success, error?, hourly: [{period_end, ghi, dni, dhi, air_temp, cloud_opacity}]}`.
- Values are grouped by browser-local `new Date(period_end).getHours()` and averaged (SOL:84-118). Because this uses the **period-end hour**, each hour's energy is labelled one hour late.
- `normalizedProfile = ghi / max(ghi)`, so only the **shape** is used; forecast magnitude and cloudiness are discarded. `hourlyTemp = air_temp` (defaults to 25 when missing) (SOL:139-163).
- It is a next-24-h **forecast**, not a typical or TMY day, so a cloudy forecast day and a clear day produce the same peak of 1.0.

**Solcast state**

- `useSolcast` starts false and is not persisted.
- `toggleSolcast(true)` fetches only when there is no cached data (SOL:181-190).
- `refetch` clears and re-fetches (SOL:193-196).
- Success and failure both raise toasts (SOL:125, 131).
- `hasLocation = !!(lat && lng)` (SOL:205). This is always true on this tab because of PD's Cape Town fallback, so Solcast is always enabled, even for unlocated projects.

**Capacity**

- `maxPvAcKva = simulatedSolarCapacityKwp ?? connectionSizeKva × 0.75` (IDX:115-116). The **75% of connection size is hard-coded**, and PD:1066 has the same rule.
- ⚠ The simulation's `solar_capacity_kwp` (named kWp, i.e. DC) is used as the **AC** limit and then multiplied by DC/AC again. That double-applies oversizing if the column really holds DC.
- `effectiveDcAcRatio = simulatedDcAcRatio ?? dcAcRatio`. The local default comes from global derating (`hooks/useDeratingSettings.ts:30`, 1.2) (IDX:96, 117).
- `dcCapacityKwp = maxPvAcKva × effectiveDcAcRatio` (IDX:118).

**Per hour (LPD:387-403)**

- `tempDerating = temp > 25 ? 1 − 0.004 × (temp − 25) : 1`, with `TEMP_COEFFICIENT` = 0.004 hard-coded at LPD:84. This uses **ambient air temperature, not cell temperature**. With the static profile the temperature is fixed at 25, so there is never derating.
- `effectiveEfficiency = (1 − systemLosses) × tempDerating`. Losses default to the global 0.14.
- `pvDcOutput = shape[h] × dcCapacityKwp × effectiveEfficiency`
- `pvGeneration = min(pvDcOutput, maxPvAcKva)` (AC, clipped)
- `pvClipping = max(0, pvDcOutput − maxPvAcKva)`
- `pv1to1Baseline = shape[h] × maxPvAcKva × effectiveEfficiency` (unclipped by construction)
- `temperature = temp`
- Losses are applied **before** clipping, so the inverter-efficiency portion of "system losses" is applied on the DC side.
- There is no irradiance-to-kWp scaling: `shape = 1.0` means the full nameplate DC. The daily yield is therefore `Σshape × kWp × η`, about 6.5 × η kWh/kWp for the static profile.

**Grid (LPD:406-409)**

- Computed always: `netLoad = total − pvValue`, `gridImport = max(netLoad, 0)`, `gridExport = max(−netLoad, 0)`.
- ⚠ **Unit mixing:** in kVA mode, `total` is kVA (÷PF) while `pvValue` stays in kW (never ÷PF), so net and grid values are wrong in kVA mode.

**PV stats (LPD:440-451)**

- `totalGeneration = Σ pvGeneration`
- `selfConsumption = gen − Σ gridExport`
- `selfConsumptionRate = self / gen`
- `solarCoverage = self / totalDaily`

#### A.1.9 Over-paneling analysis (LPD:454-492; `LP/components/OverPanelingAnalysis.tsx`)

- Shown only when PV is on, `maxPvAcKva` is set, and `effectiveDcAcRatio > 1` (IDX:362-364).
- `additionalKwh = Σ pvGeneration − Σ pv1to1Baseline`, and `percentGain = additionalKwh / Σ baseline`.
- `clippingPercent = Σ clipping / Σ DC`.
- Monthly figures are ×**30** and annual figures ×**365** of a single representative day (LPD:466-473), with no seasonal variation.
- The panel always prefixes "+" to "Daily Additional", even when the value is negative (OverPanelingAnalysis.tsx:30), and to the monthly/annual additional values (lines 53, 57).

#### A.1.10 Battery chart: STUB

- `useLoadProfileData` accepts `showBattery`, `batteryCapacity`, `batteryPower` and `batteryDischargePower`, and lists them in the `chartData` memo deps (LPD:423-426).
- It **never computes `batteryCharge`, `batteryDischarge`, `batterySoC` or `gridImportWithBattery`**. grep finds no assignment.
- As a result, `BatteryChart` (IDX:366-368) renders empty bars and an SoC of 0%.
- The capacity/power sliders and presets have no effect on any number.
- The CSV "Battery Charge / Discharge / SoC" columns are always `0.00` (EXP:57-63).
- `BatteryChart` also labels its tooltip in "kW" regardless of unit (`LP/charts/BatteryChart.tsx:85-86`).
- The chart only renders when PV is also on (IDX:366).
- Initial values come from the simulation, else 500 kWh / 250 kW (IDX:94-95).

#### A.1.11 Grid flow chart (`LP/charts/GridFlowChart.tsx`)

- Renders when PV is on and `maxPvAcKva` is set (IDX:351-360).
- Import (red) and export (green) are **stacked positive** bars. Export is not drawn below zero, even though there is a `ReferenceLine y={0}` (lines 50, 87-88).
- The header totals `Σ` hourly kW (kWh/day), but they are labelled with `unit`, i.e. kW or kVA (lines 18-19, 36, 40).
- The tooltip says "Self-sufficient" when both values are 0 (line 79-81).

#### A.1.12 Solar chart (`LP/charts/SolarChart.tsx`)

- `pvGeneration` is drawn as bars. When DC/AC > 1, it adds `pvDcOutput` (blue line), a dashed `pv1to1Baseline` (if the toggle is on), and an "Inverter AC Limit" reference line at `maxPvAcKva` (lines 152-172, 214-220).
- The y-axis max is `max(peakDc × 1.1, AC × 1.3)` (line 38).
- Badges show "gained vs 1:1", "clipped (x%)" and "Net: … oversizing beneficial / not beneficial".
- `netBenefit = energyGained − totalClipping` (line 37). ⚠ This double-counts: `energyGained` is already net of clipping, since AC is clipped.
- The "To Load / To Battery / Exported / Curtailed" badges (lines 88-108) depend on `solarUsed`, which this tab never sets, so they are **dead here**.
- All totals are Σ kW labelled as `unit`.

#### A.1.13 TOU reference areas

**Period resolution.** `getTOUPeriod(hour, isWeekend, touSettings?, month?, dayOfWeek?)` (`LP/types.ts:193-217`).

- Settings come from `localStorage["tou-settings"]` via `readStoredTOUSettings` (types.ts:185-191). That value is written by `hooks/useTOUSettings.ts` (STORAGE_KEY line 4). Otherwise `DEFAULT_TOU_SETTINGS` applies.
- The settings are **not** taken from the project's selected tariff. They are a single browser-global table.
- Season is high when `month ∈ highSeasonMonths`. When `month` is undefined the **low season** is used.
- Weekend with `dayOfWeek === 0` uses the Sunday map. Otherwise the Saturday map is used.

**Hard-coded defaults** (`DEFAULT_TOU_SETTINGS`, types.ts:143-174). Hours not listed are off-peak.

| Season | Day | Peak | Standard |
|---|---|---|---|
| High (months 5,6,7 = Jun-Aug) | Weekday | 06-09, 17-19 | 09-12, 14-17, 19-22 (12-14 off-peak) |
| High | Saturday | — | 07-12 |
| High | Sunday | — | — |
| Low (other months) | Weekday | 07-10, 18-20 | 06-07, 10-18, 20-22 |
| Low | Saturday | — | 07-12, 18-20 |
| Low | Sunday | — | — |

**How the charts use it**

- The charts are given `month = first element of selectedMonthsFilter` and `dayOfWeek = first element of selectedDays` (IDX:126-134). This is Set **insertion order**, not the smallest value. With multi-season selections only one season's bands are drawn, so "All months" normally shows **low season**, since January (0) is first.
- Rendering is done by `TOUBarsLayer`, a 5 px coloured strip under the plot for each hour, 0.55 opacity (`LP/utils/touReferenceAreas.tsx:30-68`), plus `TOUXAxisTick` label offsets (lines 8-22).
- Bar width is the x-axis `bandSize`. On point-scale axes (the area and line envelope chart) this may be 0 or undefined, so the strip can be invisible. This is a rendering risk and has not been verified in a browser.
- Colours: peak `hsl(0 72% 51%)`, standard `hsl(38 92% 50%)`, off-peak `hsl(160 84% 39%)` (types.ts:219-223).
- `TOULegend` is static (`LP/components/TOULegend.tsx`).

**Inconsistencies**

- CSV and PDF exports call `getTOUPeriod(i, isWeekend)` **without month or day** (EXP:64, 88), so they always use low season and, for weekends, the Saturday map. They can disagree with the on-screen bands.
- The Methodology "TOU Periods" text (`components/simulation/MethodologySection.tsx:98-121`) states weekday peak 07-10 and 18-20, and "Weekends: All day" off-peak. That contradicts the high-season defaults and Saturday standard hours.
- `getTOUPeriod` re-reads and `JSON.parse`s localStorage on **every call**: once per hour, per chart, per render and per tooltip move.

#### A.1.14 Annotations (`LP/components/AnnotationsPanel.tsx`)

- They are stored in the local `useState<Annotation[]>` in IDX:107 as `{id: Date.now(), hour, text, color: 'hsl(var(--primary))'}` (lines 18-27).
- **Not persisted anywhere, and not drawn on any chart.** `annotations` is never passed to a chart component.
- They are lost when the tab unmounts, because Radix `TabsContent` unmounts inactive tabs.
- `annotations.sort(...)` mutates state in place (line 101-102).

#### A.1.15 Presets (`LP/components/SavePresetDialog.tsx`, `LP/components/ChartSettings.tsx:83-118`, `hooks/useSimulationPresets.ts`)

**Storage and load**

- Presets are stored in Supabase table **`simulation_presets`** (`user_id, name, description, config jsonb, is_default`). They are **per user, not per project**, and are shared with other screens that use `useSimulationPresets`.
- The list query is `.eq('user_id', user.id)` ordered by `created_at desc` (useSimulationPresets.ts:41-60). Insertion is at lines 62-95.

**Saved config shape** (ChartSettings.tsx:104-118)

```json
{ "dcAcRatio": 1.2, "batteryCapacity": 500, "batteryPower": 250, "systemLosses": 0.14,
  "powerFactor": 0.95, "showPVProfile": true, "showBattery": false, "show1to1Comparison": true,
  "useSolcast": false, "diversity": { "diversityFactor": 0.8, "buildingType": null } }
```

- `buildingType` is always null (line 116).

**Apply** (ChartSettings.tsx:85-102)

- Each defined field is set.
- `dcAcRatio` is **overridden by `simulatedDcAcRatio`** whenever a saved simulation has one (IDX:117), so it becomes a no-op.
- `useSolcast: true` triggers a fetch.

**Gaps**

- `is_default` is displayed as a badge only; it is **never auto-applied**.
- There is no edit or delete in this tab.
- The Select is uncontrolled, so it keeps showing the last applied preset name after the user changes settings.
- The Select is hidden entirely when the user has no presets (line 132).

#### A.1.16 Diversity factor (global) — `hooks/useDiversitySettings.ts`, `components/settings/DiversitySettingsCard.tsx`

- Stored in `localStorage["diversity-settings"]` as `{diversityFactor, buildingType, customProfiles[]}`. The defaults are **0.80 / "Shopping Centre"** (useDiversitySettings.ts:3-15, 18-32).
- It is per browser, not per user or project.
- The tab seeds `diversityFactor` from the global value once at mount (IDX:109). Changes made in the tab are session-only and are **not written back**.
- **Out of the box every tenant sum is multiplied by 0.80.** Because diversity is applied uniformly to every hour, it also reduces **energy** (kWh/day) by 20%, not just the peak. This is a modelling error: a diversity factor should reduce coincident peak, not consumption.
- The settings card copy says the settings are "applied as defaults for all new projects" (DiversitySettingsCard.tsx:233). In reality they apply to every project viewed in that browser.

**Settings card presets** (DiversitySettingsCard.tsx:12-20)

| Preset | Factor |
|---|---|
| Shopping Centre | 0.80 |
| Office Park | 0.85 |
| Industrial | 0.90 |
| Mixed Use | 0.75 |
| Hotel/Hospitality | 0.70 |
| Educational | 0.65 |
| Healthcare | 0.88 |

- The tab's quick presets (ChartSettings.tsx:163-169) are a subset (Shopping Centre 0.80, Office Park 0.85, Industrial 0.90, Mixed Use 0.75) plus **None 1.0**. Hotel, Educational and Healthcare are missing from the tab.
- The settings slider is 50-100 in steps of 1 (lines 94-101); the tab slider is 50-100 in steps of 5 (ChartSettings.tsx:182-188).
- The tab highlights a preset button with float equality `diversityFactor === preset.value` (line 172). The settings page uses a tolerance of `< 0.01`.

#### A.1.17 Exports (EXP)

All exports are built from `chartData` produced by LPD: no year filter, diversified, and in the current unit.

- **CSV** (EXP:37-77). File name `load-profile-<firstSelectedDay>.csv`.
  - Columns: `Hour, Load (<kW|kVA>)`, then `PV Generation, Grid Import, Grid Export, Net Load` when PV is on, then `Battery Charge, Battery Discharge, Battery SoC` when the battery is on (always 0), then `TOU Period`.
  - Values use 2 decimal places, with 24 rows labelled `HH:00`.
  - Per-tenant columns are **not** exported.
  - There is no CSV escaping, though no free text is involved.
- **PDF** (EXP:79-163). This is **not a real PDF**.
  - It calls `window.open` with a `document.write` HTML page and then `print()`.
  - Content: title with day name and weekday/weekend, three stats (Daily, Peak, Load Factor), and a table of Hour / Load / (PV Gen, Grid Import) / TOU.
  - A footer shows "N tenants • X SCADA meters, Y estimated".
  - If popups are blocked, a toast is shown.
  - The day name is `selectedDay`, the **first** selected day, even when all days are selected.
- **PNG** (EXP:165-190). `html2canvas(chartRef, {scale: 2, background #fff})`.
  - `chartRef` is the whole `CardContent` (IDX:280): the settings bar, every chart, TOU legend, notes and Data Inspector.
- **SVG** (EXP:192-229). `chartRef.current.querySelector('svg')` returns the **first** `<svg>` in that container.
  - That element is the lucide `Settings2` **icon** in the Settings button (ChartSettings.tsx:125), not the chart.
  - **The SVG export downloads a 12 px gear icon.**
- **Data Inspector CSVs** (`DataInspector.tsx:150-170`):
  - `site-load-data.csv` has `Date, H00..H23` from `siteDataByDate`: post-outage filter, undiversified kW, rounded by `formatKw` to 2, 1 or 0 decimal places depending on magnitude.
  - `<tenant name>-load-data.csv` has the same shape per tenant. The raw tenant name goes into the file name unsanitised.

#### A.1.18 Data Inspector (`LP/components/DataInspector.tsx`)

It is collapsible and closed by default.

**Summary badges:**

- `validatedDateCount` (the pre-outage union count)
- `scadaCount`
- `estimatedCount`
- outliers (always hidden)
- the year span

**Tabs:**

- **Site Data:** a heatmap of the date × 24 h table, coloured relative to the site peak.
- **Per-Tenant:** a select over tenants with raw data, the same heatmap, and an eye button per row that opens a dialog with raw readings for that date.
  - The dialog shows **unscaled** raw values, while the table is area-scaled.
  - For multi-meter tenants it concatenates all meters' points with no meter column.
  - Matching is by `p.date === date`, so legacy-format raw data (`timestamp`) shows 0 readings.
- **Format Check:** per scada id, the record count and "Normalised / Legacy" (lines 111-120).

The row limit select offers 25 / 50 / 100 / All (line 21).

---

### A.2 Units

| Quantity | Unit | Array shape | Cite |
|---|---|---|---|
| `raw_data` points | `value` per interval. Assumed **kWh per interval** unless `value_unit` is non-energy. | `[{date:'YYYY-MM-DD', time:'HH:MM[:SS]', value}]`, any interval | VSD:7-12, 103-111 |
| Hourly bucket, energy units | Σ interval kWh = kWh in hour ≡ average kW | 24 per date | VSD:145-154 |
| Hourly bucket, power units | mean of readings (kW) | 24 per date | VSD:150 |
| `load_profile_weekday/weekend` | 24 / 48 / 96 values. 48 and 96 are averaged to hourly; 24 values at 30- or 15-min intervals are divided by 2 or 4. Semantics are ambiguous. | 24/48/96 | LPD:19-53 |
| `shop_types.load_profile_*` | % of daily kWh per hour | exactly 24, else flat 4.17% | LPD:239-243 |
| `shop_types.kwh_per_sqm_month`, `monthly_kwh_override` | kWh/m²/month; kWh/month (whole tenant) | scalar | LPD:237 |
| `chartData[h].total` and tenant keys | average kW (or kVA = kW/PF) in hour h, **after diversity** | 24 rows | LPD:372-383 |
| `totalDaily`, chart header totals, SolarChart and GridFlow totals | Σ of 24 hourly kW = **kWh/day**, but labelled "kW"/"kVA" | scalar | LPD:434; ChartStats.tsx:46-47 |
| PV fields | kW AC/DC. **Never converted to kVA.** | 24 rows | LPD:387-403 |
| Envelope min/avg/max | kW or kVA per hour, diversified | 24 rows (+ a "24:00" duplicate row added for drawing) | ENV:196-208; LoadEnvelopeChart.tsx:81-85 |
| Monthly (ChartStats) | `weekdayKwh × 22 + weekendKwh × 8` (**undiversified**). Fallback: `totalDaily × 30`. | scalar | ChartStats.tsx:28-41 |

**How 30-minute data becomes hourly**

- **Raw data:** both half-hour points whose `time` starts with the same `HH` are summed (kWh) or averaged (kW) into hour `HH` (VSD:117, 150).
- **Pre-computed 48-slot profiles:** adjacent pairs are averaged (LPD:23-29).

Every output on this tab is **24 hourly values**. Nothing is kept at 30-minute resolution.

---

### A.3 Control inventory

"IDX" state lives in `LP/index.tsx`. No control on this tab writes project data. The only DB write is the preset insert; everything else is React state or localStorage.

#### A.3.1 Header (`LP/components/ChartHeader.tsx`)

| Control | Type | What it's for (user terms) | Handler → effect (file:line) | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Month toggles J…D | multi ToggleGroup (12) | Include or exclude calendar months from the averaged profile | `MonthSelector.tsx:10-13` → `setSelectedMonthsFilter` (IDX:110-112, 275-276) → LPD, ENV and STK filters | React state (not persisted) | Can deselect every month | 0 months: raw tenants vanish from stats and export (LPD:262); envelope and stacked go blank with no message |
| Season preset None / Summer / Winter / All | single ToggleGroup | Quickly pick Eskom seasons | `SeasonPresets.tsx:31-48`. Summer = Sep-May `{0-4, 8-11}`, Winter = Jun-Aug `{5,6,7}` (lines 9-11) | state | Deselect ignored (line 32). Shows no active item for custom sets. | "None" leads to the same zero-data behaviour |
| Weekday toggles S M T W T F S | multi ToggleGroup (0 = Sun) | Pick the days of the week to average | `WeekdaySelector.tsx:10-12` → `setSelectedDays` (IDX:73, 273-274) | state | Can select none | 0 days: fallback profiles become NaN (LPD:201-204) and `isWeekend` becomes true |
| Day preset None / Wkday / Wkend / All | single ToggleGroup | Quick day sets | `DayPresets.tsx:30-47` | state | Deselect ignored | "None" leads to NaN as above |
| kW / kVA | two buttons | Show real or apparent power | `ChartHeader.tsx:83-88` → `setDisplayUnit` (IDX:71) | state | — | kVA mode: PV and grid mix units (LPD:380 vs 393) |
| Peak readout | display | Site peak demand and hour | IDX:254-256, taken from the envelope `max` series; falls back to `chartData` | — | — | Shows "0 kW at 00:00" when there is no data |
| TOU switch | Switch | Show TOU colour strips and legend | `ChartHeader.tsx:107` → `setShowTOU` + `localStorage['loadProfile_showTOU']` (IDX:77-80, 90) | localStorage (browser-global, **not per project**) | — | — |
| PV switch | Switch | Overlay solar, grid flow and over-paneling | `ChartHeader.tsx:111` → `setShowPVProfile` + `localStorage['loadProfile_showPV']` (IDX:81-84, 91) | localStorage | — | If there is no simulation **and** no connection size, `maxPvAcKva` is null: the toggle is on but **nothing renders, with no explanation** (IDX:337-368) |
| Battery switch | Switch | Show battery chart and sliders | `ChartHeader.tsx:116` → `localStorage['loadProfile_showBattery']` (IDX:85-88, 92) | localStorage | — | **Stub**: the chart is always empty (A.1.10) and needs PV on as well |
| Notes switch | Switch | Show the chart-notes panel | `ChartHeader.tsx:121` → `setShowAnnotations` (IDX:106) | state | — | — |
| "N SCADA" / "N Est." badges | display | Data-quality indicator | `ChartHeader.tsx:129-134` | VSD counts | Hidden when 0 | — |
| Export ▸ CSV | menu item | Download the hourly table | EXP:37-77 | `chartData` | — | Toast on success; no failure path |
| Export ▸ PDF | menu item | Printable report | EXP:79-163 | `chartData` + stats | — | Popup blocked gives a toast error |
| Export ▸ PNG | menu item | Image of the tab | EXP:165-190 (html2canvas) | DOM | — | Loading/success/error toasts |
| Export ▸ SVG | menu item | Vector chart | EXP:192-229 | DOM | — | **Defect: exports the gear icon** (A.1.17) |
| (Prev/next day navigation) | — | — | `navigateDay` (IDX:139-145) is passed as a prop but **never rendered** by ChartHeader. `selectedDay`, `isWeekend` and `maxPvAcKva` props are unused there. | — | — | **Dead** |

#### A.3.2 Settings bar and panel (`LP/components/ChartSettings.tsx`)

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| "Settings ▾" | Collapsible trigger | Show advanced settings | line 121-129 → `setShowAdvancedSettings` (IDX:105) | state | — | — |
| "Load preset…" | Select | Apply a saved preset | lines 133-146 → `handleApplyPreset` (85-102) | reads `simulation_presets` | Hidden if the user has no presets. Spinner while loading (148). | dcAcRatio is ignored when a simulation exists. `is_default` is not auto-applied. |
| "Save as Preset" | Dialog trigger | Save the current settings | `SavePresetDialog.tsx:82-87` | — | — | — |
| Preset Name | Input | Name the preset | `SavePresetDialog.tsx:99-104` | — | Required (trimmed) | — |
| Description | Textarea | Optional note | lines 109-115 | — | — | — |
| "Set as default preset" | Switch | Mark as default | line 119 | `is_default` | — | Has no behavioural effect anywhere in this tab. Multiple defaults are allowed. |
| Config preview | display | Show what will be saved | lines 124-158 | — | — | — |
| Cancel / Save Preset | buttons | Close / insert | `handleSave` lines 61-78 → `createPreset.mutateAsync` (`useSimulationPresets.ts:62-95`) | **INSERT `simulation_presets`** (user_id, name, description, config, is_default) | Disabled when the name is blank or the save is pending (167) | Error toast from the hook. The dialog stays open on error; `mutateAsync` rejects, which gives an unhandled promise. |
| Diversity presets (Shopping Centre 80%, Office Park 85%, Industrial 90%, Mixed Use 75%, None 100%) | buttons | Apply a building-type diversity | lines 163-180 → `setDiversityFactor` | state (not persisted) | — | Also reduces energy, not just peak |
| Diversity slider | Slider 50-100, step 5 | Fine-tune diversity | lines 182-188 | state | min 0.5 | — |
| Power Factor | Slider 0.70-1.00, step 0.01 | kW→kVA conversion | lines 194-202 → `setPowerFactor` (IDX:72, seeded from global derating 0.95) | state | Only visible in kVA mode | — |
| DC/AC Ratio | Slider 1.0-1.5, step 0.05 | PV oversizing | lines 205-214 → `setDcAcRatio` | state | Visible when PV is on and there is an AC limit | **No effect when the latest simulation has `pvConfig.dcAcRatio`** (IDX:117). The slider moves but nothing changes. |
| DC→AC caption | display | Shows kWp → kVA | line 211-213 | — | — | — |
| "Show 1:1 Baseline" | Switch | Show the non-oversized comparison | lines 215-220 → `setShow1to1Comparison` (IDX:104) | state | Visible only when DC/AC > 1 | — |
| Battery Capacity | Slider 100-2000 kWh, step 50 | Battery size | lines 225-231 | state | Visible when the battery is on | **Stub: no effect on any number** |
| Battery Power | Slider 50-1000 kW, step 25 | Battery power | lines 232-238 | state | same | **Stub** |
| Solcast Irradiance | Switch | Use a live forecast shape instead of the static curve | lines 249-257 → `toggleSolcast` (SOL:181-190) → `supabase.functions.invoke('solcast-forecast')` | edge function (Solcast API quota) | Disabled when there is no location or while loading. Location is always present because of PD's fallback. | Toast on error. The forecast is today's, not a typical day. |
| Refresh (↻) | icon button | Re-fetch Solcast | lines 259-263 → `refetch` (SOL:193-196) | edge function | Disabled while loading | Toast |
| Solcast badge | display | PSH/avg temp, or "Static Profile (5.5 PSH)" | lines 267-281 | — | — | The static PSH label (5.5) does not match the curve (Σ 6.5) |
| "Set project location…" hint | text | — | line 283-285 | — | **Unreachable**, because `hasLocation` is always true | — |
| System Losses | Slider 5-25%, step 1 | PV derate | lines 288-301 → `setSystemLosses` (IDX:108, seeded 0.14) | state | — | — |

#### A.3.3 Charts

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Envelope / By Meter | single ToggleGroup | Switch between the band view and the per-tenant stack | `LoadEnvelopeChart.tsx:91-107` → `setChartViewMode` (IDX:102) | state | Deselect ignored | — |
| Avg / Max / Min | single ToggleGroup | Choose which day the stacked chart shows | lines 108-127 → `setStackedMode` (IDX:103) → STK | state | Stacked view only | — |
| Year from / to | 2 Selects | Limit the envelope and stacked charts to years | lines 134-158 → `setYearFrom/To` (ENV:75-76) | state | Options outside the range are disabled | **Does not affect stats, exports or PV/grid** (LPD has no year filter). Selects are empty when there are no years. |
| Envelope chart hover | Recharts Tooltip | Max/Avg/Min at the hour plus the TOU badge | lines 199-233 | — | — | Loading spinner (59-68). **No data: renders null with no message** (line 70). |
| Envelope `syncId="loadProfileSync"` | chart sync | Links the hover to the stacked chart | line 176; `StackedMeterChart.tsx:40` | — | — | The PV, grid and battery charts are **not** synced |
| Stacked chart hover | Tooltip | Total plus per-tenant sorted values | `StackedMeterChart.tsx:65-105` | — | — | Returns null when there is no data |
| Stacked legend item click | button | Hide or show a tenant series | lines 133-144 → `toggleKey` (24-30) | local state | — | The tooltip total only sums visible series |
| Legend tooltip "View in Tenants" | button | Jump to that tenant on the Tenants tab | lines 148-156 → `onNavigateToTenant` → PD:1349-1354 | — | — | Also shown for the synthetic "Estimated" series, which navigates with `__estimated__` (a no-op highlight) |
| Solar chart hover | Tooltip | DC, AC, clipping, 1:1 baseline and gain per hour | `SolarChart.tsx:174-212` | — | Needs PV on and an AC limit | — |
| Grid flow hover | Tooltip | Import/export at the hour | `GridFlowChart.tsx:51-85` | — | same | — |
| Battery hover | Tooltip | Charge, discharge and SoC | `BatteryChart.tsx:76-93` | — | Needs battery and PV | Always 0 (stub) |
| Brush / zoom / click-to-annotate | — | — | **None exist** on any chart | — | — | — |

#### A.3.4 Notes, Data Inspector and footer

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Add Note | Popover with a 24-hour grid | Attach a note to an hour | `AnnotationsPanel.tsx:60-89` → `addAnnotation` (18-27) | state only | Hours that already have a note are no-ops (78) | Empty text: "Click 'Add Note'…" (129). **Notes are not drawn on the charts and not saved.** |
| Note text | Input | Edit the note | line 108-115 → `updateAnnotation` | state | — | — |
| × | icon button | Delete the note | lines 116-123 | state | — | — |
| Clear All | button | Delete all notes | lines 90-94 | state | Visible when there are notes | Toast |
| Data Inspector | Collapsible | View underlying data | `DataInspector.tsx:177-184` | VSD, rawDataMap | — | — |
| Rows | Select 25/50/100/All | Limit table rows | lines 203-214 | — | — | "All" renders every date |
| Site Data / Per-Tenant / Format Check | Tabs | — | lines 217-222 | — | — | — |
| Site CSV | button | Download the site date×hour table | lines 230-232 → `handleExportSite` (150-157) | `siteDataByDate` | — | — |
| Tenant select | Select | Choose a tenant with raw data | lines 274-285 | `tenantsWithRawData` | — | "Select a tenant above…" / "No validated data for this tenant." (346-350) |
| Tenant CSV | button | Download that tenant's table | lines 287-289 → `handleExportTenant` (159-170) | `tenantDateMaps` | Tenant only | — |
| Eye (raw) | icon button → Dialog | See the raw readings for a date | lines 330-337 → `openRawDialog` (122-148) | rawDataMap | — | "No raw data found…" (416-422). Values are unscaled. |
| Stats cards | display | Daily, Avg Hourly, Load Factor, Monthly (calc), Validated Days, PV Generated, Solar Coverage | `ChartStats.tsx:44-97` | LPD | PV cards only when PV is on | "Validated Days … full-coverage dates" is **mislabelled**: it is a union of filtered dates |
| Top Contributors | display | Top 8 tenants by daily energy | `TopContributors.tsx:10-37` | `chartData` keys | — | Excluded tenants appear with 0. Name collisions. |
| Methodology accordions | Collapsible list | Explain the solar, battery, TOU and financial methods | IDX:394-401 | static text | Battery item only when the battery is on | The TOU text contradicts the defaults (A.1.13) |
| Empty tab | Card | "Add tenants to see the combined load profile" | IDX:232-240 | — | Only when `tenants.length === 0` | All tenants excluded shows zeros with no message |

---

### A.4 Defects, gaps, hard-coded constants, performance, UX, security

#### A.4.1 Correctness defects (ranked)

1. **The simulation does not use the load profile this tab shows.**
   - `useSimulationEngine` calls `useLoadProfileData` **without `validatedSiteData`** (`components/projects/simulation/useSimulationEngine.ts:163-180`, `184-207`).
   - So `emptyDefault` applies (LPD:148-169): `nonScadaTenants = all tenants`, and **raw SCADA interval data is ignored**. The engine uses only pre-computed `load_profile_*` or shop-type estimates.
   - It also omits `diversityFactor`, so the simulation uses 1.0 while the tab defaults to 0.80.
   - It uses `powerFactor: 0.9` where the tab uses 0.95.
   - The Load Profile tab and the Simulation tab therefore show **different site loads** for the same project.
2. **Multi-meter raw path overcounts:** meters are summed, each scaled to the full tenant area, and `weight` is ignored (VSD:71-82, 120-135). This contradicts the weighted-average estimate path (LPD:56-82).
3. **Diversity reduces energy, not just peak.** A flat ×0.80 applies to every hour, both in the charts (LPD:379) and in the envelope average (ENV:176). Daily and monthly kWh are then understated by 20% by default, and `weekday/weekendDailyKwh` are **not** diversified, so the "Monthly" card disagrees with "Daily".
4. **Wh/MWh are not rescaled; kVAh is treated as kW** (VSD:7-12, 150).
5. **Union of dates with zeros:** partial-coverage dates understate the site total (VSD:201-209), and per-tenant averages divide by dates the tenant has no data for (LPD:268-272; STK:190).
6. **Zero dates after filtering removes raw tenants entirely.** No fallback applies (LPD:262).
7. **`selectedDays = ∅` gives NaN** (LPD:201-204; ENV:87-90; STK:117-120).
8. **Day multipliers are double-applied** to weekday- or weekend-specific SCADA profiles (LPD:229), and not applied to raw data or to the daily kWh stats. That is inconsistent.
9. **The kVA mode mixes units** in net load and grid flow (LPD:380 vs 393-409).
10. **`solar_capacity_kwp` is used as the AC limit, then multiplied by DC/AC** (IDX:116-118).
11. **The battery chart and battery CSV columns are stubs** that are always zero (A.1.10).
12. **SVG export exports an icon** (EXP:198; ChartSettings.tsx:125).
13. **Tab status ignores multi-meter tenants** (PD:1095, 1124-1131).
14. **The year filter only affects the envelope and stacked charts.** The stats, header peak source and exports are inconsistent with each other (IDX:254-256; LPD:178-195).
15. **Solcast is period-end hour-shifted** and normalised to its own peak, and it is a next-24-h forecast, not a typical day (SOL:85-86, 146).
16. **The envelope uses 1st/99th-percentile days** where the comment says 5th/95th, and there is no clamp (ENV:186-199).
17. **`outlierCount` is always 0**, so two badges are dead (VSD:162).
18. **`validatedDateCount` differs between the Data Inspector** (pre-outage union, VSD:226) **and ChartStats** (post-outage, filtered, LPD:195), and "full-coverage" is a false label.
19. **`netBenefit` double-counts clipping** (SolarChart.tsx:37). Over-paneling prints "+" on negative values.
20. **Exports' TOU column ignores season and day** (EXP:64, 88).
21. **Tenant key collisions** from 15-char truncation (VSD:93; LPD:252; TopContributors.tsx:13).
22. **24:00 readings are dropped, and period-ending timestamps shift by one hour** (VSD:117-118).
23. **The drifted duplicates of `correctProfileForInterval` and `getAveragedProfileKw`** (LPD vs ENV vs STK) produce different fallback numbers for the same tenant, because of the meter-area filter.

#### A.4.2 Hard-coded constants

| Constant | Value | Where |
|---|---|---|
| Site outage threshold | 75 (Σ hourly kW per day, i.e. kWh/day) | VSD:15 |
| Energy-unit set | kwh, wh, mwh, kvah; null counts as energy | VSD:7-12 |
| Default shop intensity | 50 kWh/m²/month | LPD:237; ENV:129; STK:159 |
| Days per month (shop type) | 30 | LPD:238, 358 |
| Weekend factor (shop type, daily stats) | 0.85 | LPD:360 |
| Flat profile | 4.17% × 24 | types.ts:84 |
| Day multipliers | Mon .92, Tue .96, Wed 1.00, Thu 1.04, Fri 1.08, Sat 1.05, Sun .88 | types.ts:74-82 |
| Static PV shape | 24 values, peak 1.0 at 12:00, Σ 6.5 | LPD:140; SOL:42-44 |
| Static PSH label | 5.5 | SOL:171-172 |
| Temp coefficient / reference | 0.004 /°C above 25 °C (ambient) | LPD:84, 389 |
| Default hourly temp | 25 °C | LPD:144; SOL:97, 116, 173 |
| PV AC limit fallback | 0.75 × connection kVA | IDX:115; PD:1066 |
| Default battery | 500 kWh / 250 kW | IDX:94-95 |
| Global derating defaults | losses 0.14, PF 0.95, DC/AC 1.2 (temp 0.05, soiling 0.02, cable 0.02, degradation 0.005 unused here) | useDeratingSettings.ts:27-35 |
| Diversity default | 0.80 "Shopping Centre" | useDiversitySettings.ts:11-15 |
| Diversity presets (tab) | 0.80 / 0.85 / 0.90 / 0.75 / 1.0 | ChartSettings.tsx:163-169 |
| Slider ranges | Diversity 50-100/5; PF .7-1/.01; DC/AC 1-1.5/.05; Battery 100-2000/50 kWh, 50-1000/25 kW; Losses 5-25/1 % | ChartSettings.tsx |
| Envelope percentiles | 0.01 / 0.99 | ENV:188-189; STK:208-209 |
| Default years | 2020 / 2030 | ENV:78-79 |
| Monthly split | 22 weekdays + 8 weekend days | ChartStats.tsx:28-29 |
| Over-paneling extrapolation | ×30 monthly, ×365 annual | LPD:466-473 |
| TOU defaults | table in A.1.13; high season Jun-Aug | types.ts:143-174 |
| Season presets | Summer {0-4, 8-11}, Winter {5,6,7} | SeasonPresets.tsx:9-11 |
| Default location | Cape Town -33.9249, 18.4241 | PD:1341-1342 |
| Tenant key length | 15 chars | VSD:93 et al. |
| Raw-data cache | staleTime 5 min | useRawScadaData.ts:62 |
| Stacked palette | 20 hex colours; Estimated `#94a3b8` | STK:5-12 |

#### A.4.3 Performance

- **The raw-data payload is unbounded.** One query pulls `raw_data` JSON for every linked meter, excluded tenants included (useRawScadaData.ts:23-45). A 30-min meter holds about 17.5k points per year, so large centres transfer tens of MB on every tab visit after 5 minutes. There is no server-side aggregation.
- VSD walks every point on every change of `tenants` or `rawDataMap` (VSD:115-136).
- `getTOUPeriod` does a localStorage read plus `JSON.parse` per call, invoked hundreds of times per render and on every tooltip move (types.ts:185-200).
- `useLoadProfileData`'s memo is defeated by the unmemoised `daysArray` (LPD:133, 369).
- The fallback chain is computed three times (LPD, ENV, STK) with duplicated code.
- Data Inspector "All" renders every date × 24 cells without virtualisation.

#### A.4.4 UX dead ends and gaps

- **No load chart for estimate-only projects.** The envelope is the only load chart and it returns null without raw data, with no message (LoadEnvelopeChart.tsx:70).
- **PV toggle on but no AC limit** (no simulation and no connection size): nothing renders, with no hint (IDX:337).
- **Battery UI** is fully interactive but does nothing.
- **DC/AC slider** is inert when a simulation exists.
- **Annotations** are never shown on the charts and never saved.
- **Tab state is not persisted per project.** TOU/PV/Battery toggles are browser-global; diversity, PF, losses, filters and years reset on remount.
- **No specific-date or single-month view**, although dead hooks exist for it.
- **No brush or zoom** on any chart.
- **The raw-data query error is swallowed**, and the user just sees estimates.
- **The export file name uses only the first selected day.** "PDF" is actually a print dialog.
- **Methodology text contradicts the TOU defaults.** Its solar formula ("kWp × PSH × efficiency") is not the hourly model actually used.

#### A.4.5 Security and data-governance notes

- All reads run through the client Supabase session and RLS, which is not visible from this code.
- The raw-data query selects by an ID list derived from already-fetched tenants.
- Presets are filtered client-side by `user_id` on read. Insert sets `user_id` client-side, so the RLS on `simulation_presets` must enforce `user_id = auth.uid()`; that was not verified here.
- Every Solcast toggle or refresh spends third-party API quota via `solcast-forecast`. There is no caching or throttling in the client, and any user who can view a project can trigger it.
- The PDF export uses `document.write` with only numeric data and a day name, so there is no injection surface from tenant names.
- The Data Inspector CSV file name embeds the raw tenant name unsanitised (cosmetic).

---

### A.5 What this tab outputs for downstream consumers

**Persisted outputs:** none except `simulation_presets` rows (A.1.15). The tab writes nothing to projects, tenants or simulations. Its toggles are written to browser localStorage (`loadProfile_showTOU`, `loadProfile_showPV`, `loadProfile_showBattery`). It reads, but does not write, `diversity-settings`, `derating-settings` and `tou-settings`.

**Shared computation.** The real contract is the hook `useLoadProfileData` (LPD), which the Simulation engine calls directly. Its return shape is:

```ts
{
  chartData: Array<{
    hour: "00:00".."23:00",
    total: number,                 // avg kW (or kVA) in hour, × diversityFactor
    [tenantKey: string]: number,   // per-tenant (15-char key), same units
    pvGeneration?, pvDcOutput?, pvClipping?, pv1to1Baseline?, temperature?,   // kW, only if PV on
    netLoad: number, gridImport: number, gridExport: number                   // always present
    // batteryCharge/Discharge/SoC/solarUsed/gridImportWithBattery: declared in ChartDataPoint (types.ts:237-254) but never set
  }>,                              // length 24
  totalDaily: number,  // Σ total (kWh/day)
  peakHour: { val: number, hour: number },
  avgHourly: number, loadFactor: number,              // %
  pvStats: { totalGeneration, selfConsumption, selfConsumptionRate, solarCoverage } | null,
  overPanelingStats: OverPanelingStats | null,        // types.ts:256-272
  tenantsWithScada: number, tenantsEstimated: number, isWeekend: boolean,
  weekdayDailyKwh: number, weekendDailyKwh: number,   // undiversified
  validatedDateCount: number
}
```

**How the Simulation engine consumes it** (`useSimulationEngine.ts:161-210`)

- `loadProfile = stableChartData.map(d => d.total)`, a **24-element average-day kW array** over all days and months.
- That array feeds `runAnnualEnergySimulation(loadProfile, solarProfile, energyConfig, touSettingsData, tmy8760?)` (lines 255-266).
- A second call (per-day, lines 183-207) feeds the day-view charts.
- As noted in A.4.1 #1, these calls pass **no `validatedSiteData` and no `diversityFactor`**, so they produce a different profile from what this tab displays.
- **There is no 8760 or 17520 load series anywhere in this slice.** Seasonality in the annual simulation cannot come from the load profile, which is one averaged day.

**TOU contract for the tariff side.** `getTOUPeriod` and `DEFAULT_TOU_SETTINGS` (types.ts:120-217) plus `localStorage['tou-settings']` are shared with `lib/tariffCalculations.ts` and `hooks/useTOUSettings.ts`. The shape is:

```
TOUSettings = { highSeasonMonths: number[], highSeason, lowSeason }
each season  = { weekday, saturday, sunday: Record<0..23, "peak"|"standard"|"off-peak"> }
```

**User-facing exports** (A.1.17):

- 24-row CSV: Hour, Load, optional PV/grid, optional zero battery columns, TOU label.
- Print-HTML "PDF".
- PNG of the whole tab.
- SVG (broken).
- Data Inspector date×24 CSVs: undiversified kW per site or per tenant.

**Out-of-scope helper.** `utils/meterLabelParser.ts` is **not used by this tab**. It is imported only by `components/projects/MeterLibraryImportDialog.tsx`.

- It parses `PDB_<shopNumber>_<CamelName>_<area>m2` into `{shopName, shopNumber, areaSqm, prefix:'PDB'}` (lines 41-65).
- Other `_…_<n>m2` labels give `{shopName, areaSqm, shopNumber: null}` (67-83).
- Plain strings are camel-case expanded with area 0 (85-86).
- A missing label gives "Unknown" (35-37).
- This is where `scada_imports.area_sqm` typically originates, and it is the denominator of every `areaScale` above.


---

## Part B — Tenants, project meter library, multi-meter, stacking, SCADA wizard

Source root `R = wmsolar-main/`. All paths below are relative to `R/src/`. File abbreviations used in citations:

| Abbrev | File |
|---|---|
| TM | `components/projects/TenantManager.tsx` (1797 lines) |
| MMS | `components/projects/MultiMeterSelector.tsx` (780) |
| PML | `components/projects/ProjectMeterLibrary.tsx` (380) |
| PMS | `components/projects/ProjectMeterStacking.tsx` (1086) |
| SMP | `components/projects/ScaledMeterPreview.tsx` (565) |
| SIW | `components/projects/ScadaImportWizard.tsx` (1438) |
| MLID | `components/projects/MeterLibraryImportDialog.tsx` (311) |
| TPM | `components/projects/TenantProfileMatcher.tsx` (268) — rendered inside TM |
| TCM | `components/projects/TenantColumnMapper.tsx` (263) — rendered inside TM |
| AB | `components/simulation/AccuracyBadge.tsx` (115) |
| C2LP | `components/loadprofiles/utils/csvToLoadProfile.ts` (670) |
| CS | `components/loadprofiles/utils/csvStorage.ts` (77) |
| MLP | `utils/meterLabelParser.ts` (87) |
| UMC / UDC | `components/loadprofiles/hooks/useMonthlyConsumption.ts` / `useDailyConsumption.ts` |
| PD | `pages/ProjectDetail.tsx` |

### B.0 What is live and what is orphaned

* **Live (reachable from the UI):** only `TenantManager` is mounted, in the **Tenants** tab of the project page (PD:1321-1328). Everything else in this slice is reached *through* it: `ScadaImportWizard` (TM:1664), `MeterLibraryImportDialog` (TM:1671), `TenantColumnMapper` (TM:1680), `MultiMeterSelector` (TM:1694), `ScaledMeterPreview` (TM:1717), `TenantProfileMatcher` (TM:1661).
* **Orphaned (dead code — not imported anywhere in `src/`):** `ProjectMeterLibrary` and `ProjectMeterStacking`. A repo-wide grep for either symbol finds only their own declarations. Their empty-state copy still refers to a "Meter Library tab" (PMS:521) that does not exist on the project page. MMS's exported `useAveragedProfile` (MMS:733) and `calculateAveragedProfiles` (MMS:749) are also unused. **A rebuild should treat these as design references, not as shipped features.**
* **No edge function is used anywhere in this slice.** All parsing is client-side (FileReader + `xlsx` + C2LP) and every write is a direct supabase-js call from the browser.

### B.1 Data model touched

| Table / bucket | Columns this slice reads or writes | Defined in |
|---|---|---|
| `public.project_tenants` | `id, project_id, name, shop_number, shop_name, area_sqm, cb_rating, shop_type_id, scada_import_id, monthly_kwh_override, include_in_load_profile, is_virtual, created_at, updated_at` | `supabase/migrations/20251205041711…sql:28` (base); `scada_import_id` FK → `scada_imports(id) ON DELETE SET NULL` (`20251213043700…:3`); `include_in_load_profile bool NOT NULL DEFAULT true`, `is_virtual bool NOT NULL DEFAULT false` (`20260220130602…:2-3`); `cb_rating text` (`20260223081352…`); `shop_number/shop_name` (`20260130084023…`) |
| `public.project_tenant_meters` | `id, tenant_id (FK project_tenants ON DELETE CASCADE), scada_import_id (FK scada_imports ON DELETE CASCADE), weight, UNIQUE(tenant_id, scada_import_id)` | `20260113064133…:2-8` |
| `public.scada_imports` ("meters") | `id, project_id (NULL = global library; FK projects ON DELETE SET NULL), site_name, shop_name, shop_number, meter_label, meter_color, area_sqm, data_points, load_profile_weekday[], load_profile_weekend[], date_range_start, date_range_end, weekday_days, weekend_days, detected_interval_minutes, processed_at, file_name, raw_data (jsonb), value_unit, csv_file_path, category_id, created_at` | `20251208061157…:2`; `project_id` `20251209051034…:3`; `csv_file_path` `20260305094301…` |
| `public.shop_types` | `id, name, kwh_per_sqm_month (default 50), load_profile_weekday/weekend (24 × % of daily, default 4.17 each)` — **read only** here | `20251205041711…:14` |
| `public.stacked_profiles` | `id, project_id, name, description, meter_ids uuid[], created_at` (orphaned PMS only) | `20251209051034…:11` |
| `public.projects.meter_data_prefix` | read via PD, passed to MLID as `meterDataPrefix` (PD:1327); edited in PD's parameters panel "Meter File Prefix" (PD:510-518) | `20260309123326…` |
| Storage bucket `scada-csvs` (private) | objects `"{projectId}/{Date.now()}_{safeName}"` (SIW:650) and `"meters/{meterId}/{Date.now()}_{safeName}"` (CS:18) | `20260220064250…:3` |

**RLS reality (security-relevant):** `project_tenants` has `Anyone can view/insert/update/delete … USING (true)` (`20251205041711…:81-84`) and is never tightened in any later migration; `project_tenant_meters` likewise `USING (true)` / `WITH CHECK (true)` (`20260113064133…:15-33`, comment says "allow all operations for now"); `stacked_profiles` `Anyone…` (`20251209051034…:25-28`); `scada_imports` "Authenticated users can …" (`20251215032623…:35-50`). The bucket allows any authenticated user to upload/read/delete any object (`20260220064250…:7-19`). **Every client-side delete in this slice is therefore unguarded by ownership** — any signed-in user (and for `project_tenants` / `project_tenant_meters`, the anon key) can read or delete any project's tenants and meter links.

### B.2 How the Tenants tab is fed and how its status is computed (ProjectDetail)

* Tenants query `["project-tenants", id]` (PD:917-959):
  1. `supabase.from("project_tenants").select("*, shop_types(*), scada_imports(shop_name, area_sqm, load_profile_weekday, load_profile_weekend, date_range_start, date_range_end, detected_interval_minutes)").eq("project_id", id).order("name")` (PD:921-925).
  2. `supabase.from("project_tenant_meters").select("id, tenant_id, scada_import_id, weight, scada_imports:scada_import_id(id, shop_name, site_name, area_sqm, load_profile_weekday, load_profile_weekend, detected_interval_minutes)").in("tenant_id", tenantIds)` (PD:931-940), grouped client-side into `tenant.tenant_meters` (PD:944-956).
* Shop types `["shop-types"]`: `from("shop_types").select("*").order("name")` (PD:961-967).
* Tab status (PD:1094-1119): `assignedCount = tenants.filter(t => t.scada_import_id).length`; status `pending` if 0 tenants, `complete` if every tenant has a `scada_import_id`, else `partial`; tooltip "`{assigned}/{count} tenants have load profiles`". The Load Profile tab is `blocked` when `assignedCount === 0` (PD:1124-1131).
  * ⚠ Status counts only the single-profile link. A tenant served purely by multi-meter assignments (`project_tenant_meters`) counts as **unassigned**, as does a tenant deliberately excluded (`include_in_load_profile = false`) or one using a shop-type estimate. A project fully modelled through multi-meter shows "partial", and if no tenant has a single link the Load Profile tab shows **blocked** even though downstream code would use the multi-meter data.
* Header line: "`{n} tenants ({assigned} with profiles) • {area} m²`" (PD:1240).
* Deep-link: the Load Profile chart's `onNavigateToTenant` sets `highlightTenantId`, switches to the Tenants tab and clears the highlight after 3 s (PD:1349-1354); TM scrolls the row into view and pulses it (TM:1389-1396).

### B.3 TenantManager — the Tenants tab

**Purpose.** A tenant schedule (shop number, name, area, CB rating) where each tenant is linked to a metered load profile (a `scada_imports` row) or falls back to a kWh/m² estimate, and flagged in or out of the site load profile.

**Layout (top → bottom).**
1. Header "Tenant Schedule / Import or add tenants to build the load model" with buttons **Add Tenant**, **Import Data**, **Import from Library** (TM:991-1164).
2. Three KPI cards: Total Tenants, Total Area (m²), Est. Monthly Consumption (kWh) (TM:1166-1185).
3. `AccuracySummary` data-quality strip (TM:1188-1194).
4. Bulk-action bar (only when rows are selected) (TM:1198-1214).
5. Tenant table (TM:1215-1648), or an empty-state card "No tenants yet. Import a CSV or add tenants manually." (TM:1651-1657).
6. `TenantProfileMatcher` button / panel (TM:1660-1662).
7. Dialogs: SIW, MLID, TCM, MMS, SMP, Edit Tenant.

**Queries owned by TM.**
* `["tenant-meter-counts", projectId]`: `from("project_tenant_meters").select("tenant_id").in("tenant_id", tenantIds)` → count per tenant (TM:312-333).
* `["scada-imports-for-assignment", profileScope, projectId]`: paginated in 1000-row pages until a short page, `from("scada_imports").select("id, shop_name, site_name, area_sqm, data_points, load_profile_weekday, load_profile_weekend, meter_label, meter_color, date_range_start, date_range_end, weekday_days, weekend_days, processed_at, shop_number").order("shop_name").range(from, from+999)`, plus `.eq("project_id", projectId)` only when scope is `local` (TM:336-365). In **global** scope this loads **every meter in the database, across all projects and the global library**, including two 24-element arrays each.
* `["assigned-scada-display", assignedScadaIds]`: same select `.in("id", assignedScadaIds)` so an assigned meter still shows when it is outside the current scope (TM:372-384).

#### B.3.1 Algorithms

**Per-tenant monthly kWh shown in the table (TM:1354-1372, duplicated in `calculateTenantKwh` TM:671-685 for sorting):**
```
tenantArea = Number(area_sqm) || 0
scadaArea  = tenant.scada_imports.area_sqm
scale      = (scada_import_id && scadaArea > 0) ? tenantArea / scadaArea : null
if scada_imports.load_profile_weekday:
    daily   = Σ load_profile_weekday[h]            (calculateDailyKwh, TM:156-159)
    monthly = (scale ? daily × scale : daily) × 30
else:
    monthly = (shop_types.kwh_per_sqm_month || 50) × tenantArea
display   = monthly_kwh_override ?? monthly     (KwhOverrideCell, TM:100)
```
* Scaling is a pure **area ratio** (tenant m² ÷ meter m²). There is no kWh/m² intensity normalisation, no diversity factor, no weekend weighting (weekday profile × 30 days), and no interval correction: a 48- or 96-point profile is summed as if hourly, over-stating by 2× or 4× (downstream load-profile code does call `correctProfileForInterval`; TM does not).
* When the meter has no area, scale is `null` and the **unscaled** meter kWh is used.
* When there is no profile the fallback is `kwh_per_sqm_month` of the tenant's shop type, else a hard-coded **50 kWh/m²/month** (TM:684, TM:1371, TM:976). The shop type's own hourly shape is not used here (it is used downstream).
* **Multi-meter assignments are ignored** by the kWh estimate — a tenant with only `project_tenant_meters` falls to the shop-type/50 fallback while the Profile cell reads "N meters (averaged)".
* Rounding: `Math.round` for display (TM:120, TM:1182); scale shown `toFixed(2)` (TM:1556).
* Scale colouring: amber when `scale > 1.5 || scale < 0.5` (TM:1550).

**KPI "Est. Monthly Consumption" (TM:968-978)** uses a *different* formula from the rows: it **does not apply the area scale** (`dailyKwh × 30` unscaled, TM:971-974), includes tenants whose Include box is off, and treats an override of `0` as unset (truthiness). The card total therefore does not equal the sum of the row values.

**Profile suggestions for the picker (TM:184-235).**
* Name match (`getProfileSuggestions`): exact match of lower-cased tenant name to `shop_name` or `meter_label` → score 100, badge "Suggested"; substring either direction → `60 + (shorter/longer) × 30`, badge "Similar"; else 0.
* Sort: by score desc then |meterArea − tenantArea| asc; or, with "Area" chosen, purely by area difference (meters without area sort last).
* ⚠ In the row picker the name used is `tenant.name` (TM:1380), not `shop_name`; in the add dialog it is `shop_name`.

**Auto-match (RefreshCw icon, `autoMatchProfiles` TM:534-638).** Greedy one-to-one assignment for tenants with no `scada_import_id`:
1. Candidate pool = currently loaded `scadaImports` (i.e. the *current scope* — global scope can match meters belonging to other projects), minus meters already linked to any tenant in this project.
2. Score each (tenant, meter): numeric equality of `shop_number` (parseFloat) or case-insensitive string equality → 95; else a trailing `[\s_-](\d+[A-Za-z]?)$` token of the meter's `shop_name||site_name` equal to the tenant's shop number → 93; else the name score above. Keep candidates ≥ 60.
3. Sort desc and assign greedily, each tenant and each meter at most once.
4. One `update({scada_import_id}).eq("id", tenantId)` per match (TM:623-629) — N sequential round-trips, failures silently counted as unmatched.
5. Toast "Auto-matched X of Y unassigned tenants".
* Note `parseFloat("12A") === 12`, so shop "12" and "12A" score 95 against each other.

**One-to-one enforcement on manual pick (`updateTenantProfile` TM:433-454).** Before setting a tenant's profile it clears that profile from any other tenant in the project (`update({scada_import_id:null}).eq("project_id").eq("scada_import_id").neq("id")`, TM:437-442); the error from that first call is **not checked**. The row picker also hides meters already linked to another tenant (TM:1481). One-to-one is only enforced within the single-link column: the same meter can still sit in another tenant's multi-meter list.

**Accuracy classification (TM:1582-1590, AB:111-115).** Badge = `actual` if `meterCount > 1`, else `actual` if the joined profile has a weekday array, `estimated` if `shop_type_id` is set, else `missing`. ⚠ A tenant with exactly **one** multi-meter entry and no single link shows **Missing**. The summary strip (TM:1189-1193) uses different predicates, so a tenant with a `scada_import_id` whose meter has no weekday profile is counted in **none** of the three buckets, and multi-meter-only tenants are counted as estimated/missing.

**Shop types.** `shopTypes` is passed in (TM:80, TM:241) but **never used**: TM has no control to set `shop_type_id`. It is read-only from this tab, so the "Estimated" level is unreachable from this UI.

#### B.3.2 Control inventory — header, KPIs, dialogs

| Control | Type | What it's for (user terms) | Handler → effect (file:line) | Data read/written | Validation / disabled | Error & empty states |
|---|---|---|---|---|---|---|
| **Add Tenant** | Button → Dialog | Add one shop manually | `DialogTrigger` opens (TM:999-1005) | — | — | — |
| Add dialog › **Import CSV** | Button → hidden file input (`accept=".csv"`) | Bulk-create tenants from a schedule CSV | `csvInputRef.click()` (TM:1013) → `handleCsvFileSelected` (TM:245-272): reads text, auto-detects `;` / tab / `,` from the header line, naive `split` (no quote handling), drops blank rows, closes Add dialog, opens TCM | none until TCM import | none | toast "CSV file must have a header row and at least one data row" (TM:253) |
| Add dialog › Shop Number | Text input | Shop/unit ref | sets `newTenant.shop_number` (TM:1024-1028) | → `project_tenants.shop_number` | optional | — |
| Add dialog › Shop Name | Text input | Tenant name | sets `shop_name` (TM:1031-1036) | → `name` **and** `shop_name` | required (button disabled) | — |
| Add dialog › Area (m²) | Number input | Lettable area | sets `area_sqm` (TM:1041-1046) | → `area_sqm` (parseFloat) | required; negatives and 0 accepted | — |
| Add dialog › Load Profile (optional) | Combobox (Popover + Command) | Link a meter at creation | select sets `newTenant.scada_import_id` (TM:1107-1110) | reads `scadaImports` | Search is a case-sensitive-order substring of "`shop_name site_name area`" (TM:1090-1093); does **not** hide meters already linked to other tenants | "No profile found." |
| Add dialog › Sort by **Name / Area** | Two toggle buttons | Order the picker by name match or closest area | `setAddDialogSortByArea` (TM:1072-1087) | — | — | — |
| Add dialog › **Add Tenant** | Button | Save | `addTenant.mutate` (TM:1138-1151) → `from("project_tenants").insert({project_id, name: shop_name, shop_number, shop_name, area_sqm, scada_import_id})` (TM:386-405) | writes `project_tenants` | disabled when name or area empty (TM:1148) | toast `error.message`; success toast "Tenant added", resets the form |
| **Import Data** | Button | Bulk-upload meter CSV/XLSX files | `setWizardOpen(true)` (TM:1155) → SIW (§B.7) | — | — | — |
| **Import from Library** | Button | Create tenants from the global meter library using the project's file prefix | `setMeterLibraryImportOpen(true)` (TM:1159) → MLID (§B.8) | — | — | — |
| KPI: Total Tenants / Total Area / Est. Monthly | Read-only cards | Headline figures | TM:1166-1185; formulas §B.3.1 | derived | — | area shows `0 m²` when empty |
| AccuracySummary strip | Read-only | Data-quality split | AB:78-109 | derived | hidden when there are no tenants or total = 0 | — |
| **Edit Tenant** dialog › Shop Number / Shop Name / Area | Inputs | Correct a tenant | TM:1743-1775 | — | name and area required | — |
| Edit dialog › **Save Changes** | Button | Persist edits | `updateTenant.mutate` (TM:1776-1791) → `update({name, shop_number, shop_name, area_sqm}).eq("id")` (TM:471-490) | writes `project_tenants` | disabled if name/area empty or pending | toast error; "Tenant updated". ⚠ `cb_rating` is **not editable** anywhere after import; there is no way to set `is_virtual` or `shop_type_id` either |

#### B.3.3 Control inventory — tenant table

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Header checkbox | Checkbox | Select/deselect all rows | TM:1219-1228 | client state | checked only when all selected | — |
| Row checkbox | Checkbox | Select a row for bulk actions | TM:1400-1410 | client | — | — |
| Bulk bar › **Delete N** | Destructive button | Delete the selected tenants | `bulkDeleteTenants.mutate(ids)` → `from("project_tenants").delete().in("id", ids)` (TM:419-431) | deletes `project_tenants` (cascades `project_tenant_meters`) | disabled while pending; **no confirmation** | toast error; "Deleted N tenants" |
| Bulk bar › **Clear** | Button | Clear selection | TM:1210 | — | — | — |
| Column headers **Shop # / Shop Name / Area / Est. kWh/month** | Sort buttons | Sort the table | `handleSort` cycles asc → desc → unsorted (TM:518-531); Shop # sorts numeric-before-alpha (TM:693-714) | client | — | — |
| **Load Profile scope** switch (header) | Switch + tooltip | Choose whether the picker lists **all** meters (global) or only this project's (local) | `setProfileScope` (TM:1277-1280) re-keys the scada query | reads `scada_imports` | — | tooltip "Local data set" / "Global data set". Default **global** (TM:280); auto-flips to local after a wizard import (TM:933) |
| **Auto-match** (RefreshCw icon) | Icon button | Link unassigned tenants to meters automatically | `autoMatchProfiles` (TM:534-638) | writes `project_tenants.scada_import_id` | disabled while running; spins | toast "No profiles available to match", "All tenants already have profiles assigned", error text; result count |
| **Clear all assignments** (X icon) | Icon button | Unlink every tenant from its meter | `clearAllProfileAssignments` → `update({scada_import_id:null}).eq("project_id", projectId)` (TM:641-663) | writes `project_tenants` | disabled while running; **no confirmation**; does **not** touch `project_tenant_meters` | toast "No profile assignments to clear" / error / "Cleared … from N tenants" |
| Row **Load Profile** combobox | Popover + Command | Pick the meter that represents this tenant | select → `updateTenantProfile.mutate({tenantId, scadaImportId})` (TM:1486-1492) | writes `project_tenants.scada_import_id` (clears the same id on other tenants first) | meters linked to other tenants hidden (TM:1481) | label "Unassigned", "`{n} meters (averaged)`" when multi-meter count > 0, or "`Name (NNN m²)`"; "No profile found." |
| Combobox › **X** (unassign) | Icon button | Remove this tenant's single link | `updateTenantProfile.mutate({scadaImportId:null})` (TM:1438-1450) | writes | shown only when assigned | — |
| Combobox › Sort **Name / Area** | Toggle buttons | Per-row picker order | `setSortByAreaMap` (TM:1454-1469) | client | — | — |
| Meter-count badge | Badge | Shows number of multi-meter entries | TM:1519-1523 | `tenant-meter-counts` | only when > 0 | — |
| **Preview** (Eye) | Icon button + tooltip | See the tenant's scaled profile | `setPreviewContext({meter, tenant})` (TM:1533) → SMP (§B.6) | — | shown only when an assigned meter has `data_points > 0` (TM:1525); **not shown for multi-meter-only tenants** | — |
| **Scale** cell | Read-only | Shows ×(tenant area ÷ meter area) | TM:1546-1563 | derived | amber outside 0.5–1.5; "avg" for multi-meter; "—" otherwise | tooltip `Tenant: Xm² / Profile: Ym²` |
| **Est. kWh/month** cell (`KwhOverrideCell`) | Popover editor | Override the tenant's monthly kWh | Save → `onUpdate(value)` only if `value > 0` (TM:103-108); reset button → `onUpdate(null)` (TM:110-113) → `update({monthly_kwh_override}).eq("id")` (TM:456-469) | writes `project_tenants.monthly_kwh_override` | `min=0`; 0 or negative silently ignored and the popover closes; the input's initial value is captured once at mount (TM:96-98) so it goes stale after area/profile changes | toast error / "kWh override updated"; overridden values show in primary colour |
| **Include** checkbox | Checkbox | Include/exclude this tenant from the site load profile | `updateTenantIncludeInProfile` with optimistic cache update and rollback (TM:492-515) | writes `project_tenants.include_in_load_profile` | — | rollback + toast on error. Downstream honoured by `useValidatedSiteData.ts:47` and `useLoadProfileData.ts:129`; **ignored** by TM's own KPI total |
| **Source** badge | AccuracyBadge | Actual / Estimated / Missing | TM:1582-1590 | derived | see §B.3.1 caveats | tooltip descriptions AB:22-39 |
| **Type** badge | Badge | Virtual vs actual tenant | TM:1593-1595 | reads `is_virtual` | **no control sets it** (only MLID writes `false`) | — |
| Row ⋮ › **Edit Tenant** | Menu item | Open Edit dialog | TM:1606-1616 | — | — | — |
| Row ⋮ › **Manage Assigned Meters** | Menu item (+count badge) | Open MMS for this tenant | `setMultiMeterTenant({id, name, area})` (TM:1617-1631) | — | — | — |
| Row ⋮ › **Delete Tenant** | Destructive menu item | Delete one tenant | `deleteTenant.mutate(id)` → `delete().eq("id", id)` (TM:407-417, 1633-1639) | deletes `project_tenants` | **no confirmation** | toast error / "Tenant removed"; does not invalidate `tenant-meter-counts` |
| Row highlight | Behaviour | Arrive from the load-profile chart | ref callback `scrollIntoView` + pulse (TM:1389-1396) | — | re-fires on every render while highlighted | — |

#### B.3.4 TenantColumnMapper (TCM) — tenant-schedule CSV import

Purpose: map the columns of a tenant schedule to Shop Number / Shop Name / Area / Rating, then bulk-insert tenants.

* Auto-detect (TCM:52-79) by header substring: name ← `shop_name|shop name|tenant|name|shop`; area ← `area|sqm|size|m2|m²`; number ← `shop_number|shop number|shop nr|unit|number (not phone)|nr|no|no.`; rating ← `rating|breaker|cb|amps`. Name is assigned first, then area, number and rating, skipping used columns. (A header "Shop No" matches the *name* rule first because it contains "shop".)
* Import (TCM:138-166): per row: name trimmed (rows without a name skipped); area = digits and dot only, parsed, else **0**; number/rating trimmed or null. → TM `handleMappedImport` (TM:939-964): **one** `insert([...])` of `{project_id, name, shop_number, shop_name, area_sqm, cb_rating}`. No duplicate check against existing tenants (re-import doubles the schedule); no link to meters.

| Control | Type | Purpose | Handler | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Column header dropdown › Shop Number / Shop Name / Area (m²) / Rating (CB) | Dropdown menu per column | Assign a role (one column per role) | `assignRole` (TCM:97-107, 204-215) | client | — | — |
| Column header dropdown › **Clear** | Menu item | Remove a role | `clearRole` (TCM:109-115, 216-220) | client | only when the column has a role | — |
| Preview grid | Table (first 50 rows) | Check the mapping | TCM:228-236 | — | — | — |
| **Cancel** | Button | Close | `onClose` (TCM:255) | — | — | — |
| **Import N Tenants** | Button | Insert | `handleImport` (TCM:256) → TM:939 | inserts `project_tenants` | disabled until Shop Name mapped and ≥1 valid row | "Assign Shop Name to continue"; TM toast error / "Imported N tenants" |

#### B.3.5 TenantProfileMatcher (TPM) — "Analyze Tenant Load Profiles"

Purpose: a read-only name-matching report. Fetch `from("scada_imports").select("id, site_name, shop_name, shop_number, meter_label, category_id, weekday_days, weekend_days").gt("data_points", 0)` — **all projects plus the global library, unpaginated (PostgREST's 1000-row cap applies)** (TPM:43-55). Each tenant gets the first meter whose `shop_name`/`meter_label` equals its name (Exact), else the first substring match (Similar) (TPM:58-91). Confidence High when > 70 % matched and > 50 % of those exact, Medium when > 40 %, else Low (TPM:141-144).

| Control | Type | Purpose | Handler | Data | Notes |
|---|---|---|---|---|---|
| **Analyze Tenant Load Profiles** | Button | Open the report | `setShowMatcher(true)` (TPM:95) | read `scada_imports` | shown only when tenants exist |
| **Close** | Button | Hide | TPM:115 | — | — |
| **Assign…** combobox per unmatched tenant | Popover + Command | Supposedly assign a meter | **STUB — `// TODO: Implement assignment logic` → `console.log` only (TPM:237-240)** | none | **Dead control.** Also, "With Profiles N/M" counts name matches, not actual assignments, so it can contradict the table. Confidence colours are built as dynamic Tailwind class fragments (`${textClass}500`, TPM:148-161) and are purged at build, so they render uncoloured. `projectId` prop unused |

### B.4 MultiMeterSelector (MMS) — "Manage Assigned Meters"

**Purpose.** Attach several meters to one tenant so that its profile is an average of similar shops. Dialog "Multi-Meter Profile for {tenant}" (MMS:337-348) with an **Assigned Meters** table and summary on top, an **Available Meters** searchable grouped list below, and a Close footer.

**Queries.**
* `["tenant-meters", tenantId]`: `from("project_tenant_meters").select("id, scada_import_id, weight, scada_imports:scada_import_id(id, shop_name, site_name, area_sqm, data_points, load_profile_weekday, load_profile_weekend)").eq("tenant_id", tenantId)` (MMS:125-136).
* `["all-meter-assignments"]`: `from("project_tenant_meters").select("scada_import_id, tenant_id, project_tenants:tenant_id(name)")` — **no project filter; every assignment in the database** (MMS:139-149). Used to mark meters "In use".
* Available list = TM's `scadaImports` in the current scope (TM:1705).

**Algorithm shown in the dialog (`calculateAveragedProfile`, MMS:76-109).**
```
autoScale(meterArea, tenantArea) = (meterArea>0 && tenantArea>0) ? tenantArea/meterArea : 1
profiles = [primary single-link meter if its weekday array has 24 values]
         + [each junction meter whose weekday array has 24 values]
avg[h]   = Σ (profile[h] × autoScale) / count          (simple mean, WEEKDAY only)
Daily kWh = Σ avg[h];  Est. Monthly = round(Daily × 30)
```
* The `weight` column is always inserted as 1.0 (MMS:180); `updateWeight` (MMS:224-236) has **no UI** — dead. The dialog ignores weights.
* Meters whose weekday array is not exactly 24 values (30/15-min profiles) are silently dropped from the average.
* "Total Data" / "with data" sums `data_points`; a `totalArea` is computed but not shown (MMS:316-331).

**⚠ The dialog's maths disagrees with what the load profile actually uses.** Downstream `getAveragedProfileKw` (`load-profile/hooks/useStackedMeterData.ts:57-75`, duplicated in `useLoadProfileData.ts:56`) computes a **weighted** mean of **kW per m²** (`corrected[h] / (area || 1)`), interval-corrected, over 24/48/96-point profiles, and the caller multiplies by tenant area (`useLoadProfileData.ts:205-215`). A meter with **no area** divides by **1 m²**, so its kW is multiplied by the full tenant area (e.g. 500×) — whereas the dialog assumes scale 1. The single-link primary meter is **included** in the dialog average but **not** in `getAveragedProfileKw`; and the raw-data path `useValidatedSiteData.ts:52-84` uses the single link *instead of* the multi-meter list (`else if`), while the estimate path `useLoadProfileData.ts:205-230` prefers multi-meter *over* the single link. The user sees one number here and gets another in the chart.

**Grouping of available meters (MMS:248-299):** exclude meters already assigned to this tenant (single or multi); filter by `(shop_name||site_name)` containing the search (the list's own filter); sort by |meterArea − tenantArea| (a missing area counts as 0); group by case-insensitive `shop_name` (groups with more meters first, then alphabetical; members sorted by `site_name`); meters without `shop_name` go under "Other Meters".

| Control | Type | Purpose | Handler → effect | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Summary line "N data points · x/y with data" | Read-only | Data coverage | MMS:358-368 | derived | shown when > 0 assigned | — |
| **Remove All** | Destructive ghost button | Detach all multi-meters | `removeAllMeters` → `from("project_tenant_meters").delete().eq("tenant_id", tenantId)` (MMS:208-222, 370-379) | deletes junction rows | shown only when junction rows exist; disabled while pending; **no confirmation**; does not clear the primary link; does not invalidate `all-meter-assignments` | toast error / "All meters removed" |
| Primary row **X** | Icon button | Remove the single (primary) link | `onClearSingleProfile` → TM `updateTenantProfile(null)` (MMS:447-457, TM:1707-1712) | writes `project_tenants.scada_import_id` | — | — |
| Junction row **X** | Icon button | Remove one meter | `removeMeter` → `delete().eq("id", id)` (MMS:192-206, 495-503) | deletes junction row | disabled while any removal is pending | toast; does not invalidate `all-meter-assignments`, so the meter can still show "In use" until refetch |
| Assigned table (Meter / Data Points / Daily kWh / Auto Scale) | Read-only table | Inspect each meter | MMS:394-510 | derived | — | "Loading assigned meters...", "No meters assigned. Select meters below to build an averaged profile." |
| Profile Summary card | Read-only | Averaged daily/monthly kWh scaled to the tenant | MMS:514-540 | derived | — | — |
| Search box | CommandInput | Filter available meters | `setSearchQuery` (MMS:552-556) | client | — | "No meters found." |
| Available meter item | CommandItem | Add the meter to this tenant | `addMeter` → client-side check against `meterToOtherTenants`, then `insert({tenant_id, scada_import_id, weight: 1.0})` (MMS:170-190, 584-590) | inserts junction row | "In use" meters are dimmed with a tooltip and blocked (toast "Already assigned to: …"). Uniqueness is client-side only; the check spans **all projects**, so a global-library meter used by a tenant in another project cannot be reused here. It does **not** check single links held by other tenants | toast error / "Meter added"; the DB `UNIQUE(tenant_id, scada_import_id)` gives a raw error on a double click |
| **Close** | Button | Close; TM refreshes counts | MMS:723-725, TM:1699-1704 | — | — | — |

### B.5 How the tenants feed the site profile (for context; implemented in Part A's hooks)

Order of precedence for a tenant's hourly kW in the estimate path (`load-profile/hooks/useLoadProfileData.ts:198-244`): (1) raw SCADA via `useValidatedSiteData` (single link first, else the multi-meter list, each area-scaled `tenantArea/meterArea`); (2) multi-meter weighted kW/m² × tenant area; (3) the single link's 24/48/96 profile, interval-corrected, × `tenantArea / (meterArea || tenantArea)`; (4) `monthly_kwh_override || (shopType.kwh_per_sqm_month || 50) × area`, ÷ 30, spread by the shop type's % shape (or a default shape), × a day-of-week multiplier. Only tenants with `include_in_load_profile !== false` participate. There is **no diversity factor** anywhere in this slice: the site profile is a straight sum of the tenants.

### B.6 ScaledMeterPreview (SMP) — "Scaled Load Profile for {tenant}"

**Purpose.** Inspect the tenant's linked meter, raw vs scaled to the tenant's area, by month and by individual day with TOU shading. Opened from the Eye button (TM:1717-1740).

**Data.** Props carry the meter's precomputed arrays and metadata. `useMonthlyConsumption(meterId)` and `useDailyConsumption(meterId)` each run `from("scada_imports").select("raw_data").eq("id", meterId)` (UMC:149-150, UDC:59-60) — **the full raw interval dataset, fetched twice per open**.

**Algorithm (SMP:84-109).** `areaScaleFactor = meterArea > 0 ? tenantArea / meterArea : 1`; `meterDaily = Σ weekday profile`; `meterMonthly = meterDaily × 30`; `tenantMonthly = meterDaily × scale × 30`. Month and day totals and peaks are multiplied by the scale when "Show Scaled" is on (SMP:130-144).
* Monthly (UMC:205-250): `totalKwh = Σ raw values` (assumes the values are kWh), `peakKw = max raw value` (for 30-min kWh data this is kWh per half-hour, i.e. half the kW); months with fewer than 5 days are dropped.
* Daily (UDC:95-157): `totalKwh = Σ values × (1 / readings-per-hour)` (assumes kW); `hourlyProfile[h]` = mean of that hour's readings; peak = the highest hourly mean. **The monthly and daily cards therefore apply opposite unit assumptions to the same data**, so a month's kWh ≠ Σ of its days' kWh for kWh-interval data.
* TOU shading uses `getTOUPeriod(hour, isWeekend)` from `load-profile/types.ts:193-217`, reading `localStorage["tou-settings"]` (or defaults); the month is never passed, so it is **always low season**, and Sunday uses the Saturday map.
* **Dead inputs:** the `shopTypeIntensity` prop (default 50, SMP:61) and the computed `meterIntensity` (SMP:90) are never displayed; `renderChart`'s `peakHour` argument is unused.

| Control | Type | Purpose | Handler | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| **Show Scaled** | Switch | Toggle raw vs area-scaled values | `setShowScaled` (SMP:268-272) | client | default on | — |
| Scaling card (Meter Area, Tenant Area, Scale Factor, Est. Monthly) | Read-only | Explain the scaling | SMP:259-306 | props | scale amber outside 0.5–1.5 | meter area "—" |
| Month selector | Select | Choose a month for Monthly Consumption and Peak Demand | `setSelectedMonth` (SMP:319-331) | raw_data via UMC | only when months exist | "Loading monthly data...", "No monthly data available", Peak "Select a month" |
| Day **‹ / ›** | Buttons | Step through days | `navigateDay('prev'/'next')` (SMP:416-444) | raw_data via UDC | disabled at the ends | "Loading daily data...", "No daily data available. Raw data may not be stored." |
| Day slider | Slider | Jump to a day | `setSelectedDate(days[i].date)` (SMP:448-459) | — | — | — |
| Daily bar chart | Recharts ComposedChart | Hourly kW for the day with TOU background and tooltip (scaled and raw) | SMP:146-232 | — | — | — |
| Dialog close | onOpenChange | Close | `onClose` (SMP:235) | — | — | Whole body "No data available / This meter needs to be processed first" when `data_points` is 0 (SMP:250-255) |

### B.7 ScadaImportWizard (SIW) — "Import Data" / "Bulk Upload"

**Purpose.** Upload many meter files at once, optionally tie each file to an existing tenant, configure how they are parsed, preview, then import. Four tabs (SIW:720-740). **File types accepted:** `.csv, .xlsx, .xls` (SIW:849). XLSX/XLS are converted to CSV client-side with SheetJS, using the **first sheet only** (`XLSX.read(…, {cellDates:true})` → `sheet_to_csv`, SIW:201-221). **No edge function is called.**

**Step 1 — Select Files (tab "upload").**
* "Previously Imported Files" card: `from("scada_imports").select("id, file_name, site_name, shop_name, data_points, date_range_start, date_range_end, created_at").eq("project_id", projectId).order("created_at", desc)` (SIW:322-334).
* Tenant list for per-file assignment: `from("project_tenants").select("id, name, shop_name, shop_number").eq("project_id", projectId).order("shop_number")` (SIW:296-308). A tenant can be tied to at most one file in the batch (SIW:311-319, 954-959).
* **Continue** (`handleReadAll`, SIW:452-491) reads every pending file into memory (no network), auto-detects the separator from the first file's first 5 lines (tab if tabs > commas and semicolons; semicolon if semicolons > commas; else comma — SIW:119-128), builds the preview and column interpretation from the first file, validates headers across files, then moves to step 2.

**Step 2 — Parse & Ingest (tab "parse").**
* Separator (Tab/Comma/Semicolon/Space) and **Header Row Number** re-parse the first file and re-validate (SIW:526-545). Parsing: drop empty lines; header = line `headerRow-1`; data = all following lines; comma-split honours double quotes (without escaped-quote handling); other separators use a plain `split` (SIW:130-173). "Space" splits on every single space.
* Header validation (SIW:226-256): every file's header set (case/space-insensitive) must equal the first file's; mismatches list Missing/Extra and **block** steps 3/4.
* Column Interpretation (SIW:1095-1237): per column Visible, Column Name (rename), Data Type (DateTime/Float/Int/String/Boolean, guessed from 20 non-empty samples: `^\d{4}[-/]\d{2}[-/]\d{2}` → DateTime; numeric → Float/Int; ≤2 distinct of true/false/0/1/yes/no → Boolean — SIW:175-199), DateTime Format (11 presets or custom), Split Column By.
  * ⚠ **DateTime Format and Split Column By are never consumed** — dead controls. Data Type is used only by TM's `raw_data` column heuristic (TM:760-776), not by the profile computation.
  * The DD/MM vs MM/DD choice in particular has no effect: C2LP receives `columns: []`, so `getDateFormat` returns `"YMD"` (C2LP:309-312) and ambiguous `a/b/c` dates are read as year/month/day unless the first part is > 31 (then day-first is assumed; MM/DD/YYYY cannot be selected) (C2LP:205-231).

**Step 3 — Preview (tab "preview").** Per-file toggle buttons when more than one file; shows the first 50 data rows of the chosen file restricted to visible columns (SIW:606-619, 1256-1328). **Continue to Upload** initialises every file's status to pending (SIW:623-632).

**Step 4 — Upload (tab "import").** **Complete Import** (`handleStartImport`, SIW:636-682), sequentially per file:
1. Upload the **original file** to `scada-csvs` at `{projectId}/{Date.now()}_{name with [^a-zA-Z0-9._-] → _}` with `upsert:true` (SIW:648-654).
2. Re-parse and build `ParsedFileResult {fileName, tenantId, headers: renamed visible names, rows: visible cells only, columns: visible interpretations, rawContent: full text}` (SIW:657-666).
3. Call `onComplete([result])` **without awaiting it** (the prop is typed `void`, SIW:76/669-671) and immediately mark the file **Done**.
* ⚠ "Done / Imported successfully" therefore only means *uploaded to storage*. The real import (TM `handleWizardComplete`) runs asynchronously and concurrently for all files; its failures ("No data points…", insert errors) appear only as console logs plus one toast **per file** (TM:919-936), after the wizard has already said "N of N files imported successfully".

**What `handleWizardComplete` saves (TM:729-937), per file:**
1. `processCSVToLoadProfile(result.headers, result.rows, defaultConfig)` with `defaultConfig = {fileType:"delimited", startRow:1, comma delimiter, columns: [], valueUnit:"auto"}` (TM:733-749). Because `columns` is empty, C2LP auto-detects **by the (possibly renamed) header text** (C2LP:367-382): date ← first header containing `rdate|date|datetime|timestamp`; time ← `rtime|time`; value ← `kwh+|kwh-|kwh|energy|consumption|reading|value|amount|usage`, else `findValueColumn` (C2LP:279-305). **A file whose timestamp column is called anything else (e.g. "From", "Period", "Interval Start") yields 0 rows and is skipped** — even though TM's own `raw_data` heuristic accepts "from" (TM:763). Hiding or renaming the date column in step 2 breaks the import silently.
   * Unit auto-detect from the value header (C2LP:385-408): MWh/MW/kVAh/kVA/kWh/kW/Wh/W/A, default **kWh**. A (amps) → kW via `√3 × 400 V × I × 0.9 / 1000` (C2LP:34-45; hard-coded 400 V and PF 0.9).
   * Profile (C2LP:496-560): rows are bucketed weekday/weekend by `Date.getDay()` in local time, by hour of the timestamp. Power units: hourly value = mean of the readings in that hour. Energy units: hourly value = Σ readings in that hour ÷ number of distinct weekdays (or weekend days) → average kWh per hour = kW. Rounded to 2 dp. The detected interval = the mode of consecutive deltas snapped to {1,5,10,15,30,60,120,180,240} min, default 60 (C2LP:66-133).
2. Build `raw_data` = `[{timestamp: "date time", value: parseFloat(cell stripped of non-numerics)}]` for **every row**, choosing columns by `dataType`/name heuristics (TM:760-783), *unconverted* (no unit conversion). If no date/value column is found it stores `[{csvContent: <entire file>}]`.
3. Project meter: look up `scada_imports` where `project_id = projectId AND file_name = fileName` (`maybeSingle`); update if found, else insert `{site_name: shopName, shop_name: shopName, load_profile_weekday, load_profile_weekend, data_points, date_range_start, date_range_end, weekday_days, weekend_days, detected_interval_minutes, processed_at, file_name, raw_data, area_sqm: assignedTenant.area_sqm ?? null, project_id}` (TM:790-843). `shopName` = the file name without `.csv/.xls/.xlsx`.
4. **Global library copy:** look up `scada_imports` where `project_id IS NULL AND file_name = fileName`; update it or insert the same payload with `project_id: null, meter_label: shopName` (TM:845-879). ⚠ The global key is the **bare file name across the whole system** — importing `Meter1.csv` in project B **overwrites** the global library meter created by project A (profile, raw data, area). `maybeSingle` errors are ignored; if two globals share a name, the lookup errors and a third is inserted.
5. Storage: `uploadCsvToStorage(rawContent, id, fileName)` for **both** rows → `scada-csvs/meters/{meterId}/{Date.now()}_{safeName}` and `update({csv_file_path})` (CS:9-39, TM:882-890). Together with step 4.1 each file is stored **three times** in the bucket, and `raw_data` holds the whole series **twice** in the database.
6. Tenant link: if the file had no tenant, **create a tenant** `{project_id, name: shopName, shop_name: shopName, area_sqm: 0, scada_import_id, include_in_load_profile: true}` (TM:893-905) — area 0, so it contributes nothing on the fallback path and cannot be scaled. If the file had a tenant, `update({scada_import_id}).eq("id", tenantId)` (TM:906-911) without clearing the meter from other tenants (bypassing the one-to-one rule). Because the new meter's `area_sqm` is copied from the tenant, the scale factor for that link is always ×1.00.
7. Invalidate many query keys and flip the Tenants scope to **local** (TM:919-933).

**Deleting previous imports.**
* Row trash (`deleteImportMutation`, SIW:336-381): read `file_name`; `update project_tenants set scada_import_id = null where scada_import_id = id` (redundant with the FK's `ON DELETE SET NULL`); list `scada-csvs/{projectId}` and remove objects whose name ends with `_{file_name}`; delete the `scada_imports` row (the junction rows cascade). ⚠ The match uses the **unsanitised** file name, so any file with a space or other special character never matches its sanitised object name and is **orphaned**; the `meters/{id}/…` copies and the global-library row are never removed. `storage.list` returns only 100 objects by default, so on larger projects matches are missed. The tenants created by the import are left behind with no profile.
* Header trash (`deleteAllImportsMutation`, SIW:383-423): the same per import in a sequential loop, **listing the bucket once per import** (N+1); it stops at the first DB error, leaving a partial delete.

| Step / control | Type | Purpose | Handler → effect | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Tab **1. Select Files** | Tab | Pick files | SIW:721 | — | always enabled | — |
| Tab **2. Parse & Ingest** | Tab | Configure parsing | SIW:722-727 | — | disabled while every file is pending | — |
| Tab **3. Preview** | Tab | Preview parsed rows | SIW:728-733 | — | disabled with no columns or with header mismatches | — |
| Tab **4. Upload** | Tab | Run the import | SIW:734-739 | — | disabled until "Continue to Upload" sets statuses | — |
| Previously Imported Files › trash-all (header) | Icon button + `confirm()` | Delete every import of this project | SIW:781-795 → SIW:383-423 | deletes `scada_imports`, storage objects; clears tenant links | disabled while any delete is pending | toast "Failed to delete all: …" / "All N imports deleted"; "No files have been imported yet."; "Loading…" |
| Previously Imported Files › row trash | Icon button + `confirm()` | Delete one import | SIW:820-832 → SIW:336-381 | as above | disabled while pending | toast |
| **Choose Files** | Button → hidden multi-file input | Add files to the batch | `handleFilesSelected` appends as pending (SIW:427-440, 846-860) | client | accepts `.csv,.xlsx,.xls`; no size limit; the same file can be added twice | "No file chosen" / "N file(s) selected" |
| Per-file **tenant** combobox | Popover + Command | Tie this file to an existing tenant | `assignTenant` (SIW:442-446, 919-982) | reads `project_tenants` | a tenant already used in the batch is hidden | "No tenant found."; "No tenant" option |
| Per-file trash | Icon button | Remove a file from the batch | `removeFile` (SIW:448-450, 984-991) | client | — | — |
| **Continue** | Button | Read files and go to step 2 | `handleReadAll` (SIW:882-890) | client | disabled while reading or when all files are ready | toast "No files selected", "Failed to read files", "Files loaded successfully" |
| Header-mismatch banner | Alert card | Explain why the batch cannot continue | SIW:1007-1040 | — | — | lists Missing / Extra per file |
| Parsing Configuration (collapsible) › **Column Separator** | Select | Delimiter | `handleSeparatorChange` (SIW:1063-1076) | client | — | — |
| Parsing Configuration › **Header Row Number** | Number input | Which line holds headers | `handleHeaderRowChange` (SIW:1080-1086) | client | `parseInt || 1` | — |
| Column Interpretation (collapsible) › select-all checkbox | Checkbox | Show/hide all columns | `toggleAllColumns` (SIW:1114-1118) | client | — | — |
| Column card › visible checkbox | Checkbox | Include this column | `toggleColumnVisibility` (SIW:1129-1132) | client | at least one must be visible to preview | hiding the date or value column makes the import yield nothing, silently |
| Column card › **Column Name** | Input | Rename | `updateColumnName` (SIW:1136-1142) | client | — | renaming changes auto-detection |
| Column card › **Data Type** | Select | Declare type | `updateColumnDataType` (SIW:1146-1165) | client | — | used only by TM's raw_data heuristic |
| Column card › **DateTime Format** (+ custom input) | Select + input | Declare the date pattern | `updateColumnDateFormat` (SIW:1168-1201) | client | — | **DEAD — never read** |
| Column card › **Split Column By** | Select | Split a combined column | `updateColumnSplit` (SIW:1207-1229) | client | — | **DEAD — never read** |
| **Preview Data** | Button | Go to step 3 | SIW:1241-1251 | — | disabled with no columns, none visible, or mismatches | — |
| Preview › file buttons | Toggle buttons | Choose which file to preview | `setPreviewFileIdx` (SIW:1268-1281) | client | only when >1 file | "N readings • file" |
| Preview › **Cancel** | Button | Abort and reset the wizard | `handleDialogClose` (SIW:1320, 687-701) | — | — | — |
| Preview › **Continue to Upload** | Button | Go to step 4 | `handleGoToImport` (SIW:1323-1326) | — | — | — |
| Upload › **Complete Import** | Button | Run the import | `handleStartImport` (SIW:1418-1430) | storage + everything in "What handleWizardComplete saves" | disabled while importing; hidden once complete; cannot be retried for failed files without starting over | per-file status Pending / Uploading / Parsing / Done / Failed (+ error text); "N failed" badge. Statuses reflect storage upload only |
| Upload › **Cancel / Close** | Button | Close and reset | `handleDialogClose` (SIW:1414-1416) | — | during an import, closing does not stop the loop | — |

### B.8 MeterLibraryImportDialog (MLID) — "Import from Library"

**Purpose.** Create tenants in bulk from global-library meters whose names start with the project's **Meter File Prefix** (e.g. `PDB`), with the name, shop number and area parsed from the meter label.

**Query** `["global-meters-for-import", prefix]` (MLID:55-72): `from("scada_imports").select("id, site_name, shop_name, shop_number, meter_label, meter_color, data_points, area_sqm, date_range_start, date_range_end, file_name, value_unit, detected_interval_minutes, weekday_days, weekend_days, csv_file_path").is("project_id", null).gt("data_points", 0).or("shop_name.ilike.{P}_%,meter_label.ilike.{P}_%,file_name.ilike.{P}_%").order("site_name").limit(5000)`. The prefix is interpolated unescaped into the PostgREST `or()` string (a comma or parenthesis in the prefix breaks or alters the filter; `_` in `ilike` is itself a single-character wildcard).

**Label parsing (MLP:37-87).** `PDB_<digits>_<Name…>_<n>m2` → shopNumber = digits, area = n, name = the remaining segments with camelCase expanded ("HomeEssentials" → "Home Essentials"), prefix "PDB". ⚠ The literal `"PDB"` is **hard-coded** (MLP:50), so any other configured prefix (e.g. `ABC_123_Name_50m2`) falls into the generic branch: no shop number, the prefix and number stay in the name, and the Prefix column is blank. Otherwise any `_…m2` segment anywhere gives the area; a plain string is used as the name with camelCase expanded. Row defaults: `shopNumber = parsed || meter.shop_number`, `areaSqm = parsed || meter.area_sqm || 0` (MLID:75-92).

**Create (MLID:121-194), sequentially per selected row:**
1. `select("raw_data, load_profile_weekday, load_profile_weekend").eq("id", m.id).single()` — full raw data pulled into the browser (N+1).
2. Insert a **project-local copy** of the meter (all metadata, the edited `shop_name`, `area_sqm`, both profiles, the full `raw_data`, and the **same** `csv_file_path` as the global row — two rows now reference one storage object).
3. Insert `project_tenants {project_id, name, shop_name, shop_number, area_sqm, scada_import_id: copy.id, include_in_load_profile: true, is_virtual: false}`.
* Not transactional: the first error throws and aborts the rest, leaving earlier rows committed and possibly an orphan meter copy without a tenant. The global meter is **not** marked as used, so re-opening the dialog lists the same meters again and a second run duplicates the tenants and the copies. There is no check against existing tenants with the same shop number. Area 0 is accepted.

| Control | Type | Purpose | Handler | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Select-all checkbox | Checkbox | Select every listed meter | `toggleAll` (MLID:228-232) | client | — | — |
| Row checkbox | Checkbox | Select a meter | `toggleRow` (MLID:245-248) | client | — | — |
| Prefix badge / Meter Label / Data Points | Read-only | Identify the source meter | MLID:250-280 | — | — | — |
| **Tenant Name** | Inline input | Edit the parsed name | `updateField(idx,"shopName")` (MLID:261-265) | client → `shop_name`, `name` | none (blank allowed) | — |
| **Area (m²)** | Inline number input | Edit the parsed area | `updateField(idx,"areaSqm")` (MLID:268-274) | client → `area_sqm` on tenant and copy | `min=0`; unparsable → 0 | — |
| **Cancel** / dialog close | Button | Close and reset | `handleClose` (MLID:95-99, 292-294) | — | — | — |
| **Create N Tenants** | Button | Run the import | `createTenants.mutate()` (MLID:295-303) | reads `scada_imports.raw_data`; inserts `scada_imports`, `project_tenants` | disabled with nothing selected or while pending | toast error / "Created N tenant(s) with meter assignments". Empty states: "No meter file prefix configured. Set the Meter File Prefix in Project Parameters first", a spinner, "No unassigned meters matching prefix "X" found in the library." |

### B.9 ProjectMeterLibrary (PML) — ORPHANED

**Intended purpose.** Manage which meters "belong" to the project, their chart label and colour.

**Queries.** Project meters: `from("scada_imports").select("id, site_name, shop_number, shop_name, meter_label, meter_color, project_id, date_range_start, date_range_end, data_points, created_at").eq("project_id", projectId).order("created_at", desc)` (PML:47-58). Unassigned: the same with `.is("project_id", null)` (PML:61-72), unpaginated.

⚠ **Semantics.** "Add" **moves** a global-library meter into the project (`update({project_id})`, PML:95-110), removing it from the library for every other project; "Unlink" sets `project_id = null` (PML:112-127), **publishing** a project's meter into the global library. This contradicts SIW/MLID, which *copy* meters. Display name precedence: `meter_label` › "`shop_name - site_name`" › "`shop_number - site_name`" › `site_name` (PML:149-154).

| Control | Type | Purpose | Handler | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| **Add Meter** → dialog "Add Meters to Project" | Button + Dialog | Pick library meters | PML:180-228 | — | — | "No unassigned meters available / Import SCADA data in the Load Profiles section" |
| Dialog row **Add** | Button | Assign (move) a meter | `assignMeter.mutate(id)` (PML:216-222) | `scada_imports.project_id` | none; the dialog stays open | toast |
| Row **Edit** | Icon button | Open Edit dialog | `openEditDialog` (PML:282-289) | — | — | — |
| Row **Unlink** | Icon button | Remove from the project (into the global library) | `unassignMeter` (PML:290-297) | `project_id = null` | **no confirmation** | toast |
| Row **Delete** | Icon button + `confirm("Delete this meter permanently?")` | Hard-delete a meter | `deleteMeter` → `delete().eq("id")` (PML:129-140, 298-309) | deletes `scada_imports` (tenant links set null; junction rows cascade); storage objects are **not** removed | confirm only | toast |
| Edit › **Custom Label** | Input | Chart label | PML:335-339 | `meter_label` (blank → null) | — | — |
| Edit › **Chart Color** | 10 swatch buttons | Chart colour | PML:347-358; palette PML:29-32 | `meter_color` | — | — |
| Edit › **Save Changes** | Button | Persist | `updateMeter` (PML:74-93, 361-374) | writes | — | toast |
| Table | Read-only | Colour, label, date range, data points | PML:239-315 | — | — | "Loading meters…", "No meters assigned to this project" |

### B.10 ProjectMeterStacking (PMS) — ORPHANED

**Intended purpose.** Stack selected project meters' **raw interval data** into a combined 24-hour or time-series profile, save named selections, export CSV.

**Queries.** `from("scada_imports").select("id, site_name, shop_number, shop_name, meter_label, meter_color, date_range_start, date_range_end, data_points, raw_data").eq("project_id", projectId).order("created_at", desc)` (PMS:87-101) — **every meter's entire raw series in one response**. Saved configs: `from("stacked_profiles").select("*").eq("project_id").order("created_at", desc)` (PMS:104-115); insert `{name, description, project_id, meter_ids}` (PMS:117-135); delete `.eq("id")` (PMS:137-147).

**Algorithms.**
* The value per point is `point.values[k]`, where k is the first key containing "P1" or "kWh", else the first key (PMS:311-313, 406-408). ⚠ SIW writes `raw_data` as `{timestamp, value}` (no `values` map) and MLID copies whatever the global row has, so for wizard-imported meters `Object.keys(undefined)` throws inside `try` and **every point is skipped**; the meters still pass the "with data" filter (PMS:149-151) and stack as flat zeros.
* 24-hour view (PMS:373-445): for each meter and hour, collect the values within [dateFrom, dateTo 23:59:59.999] and the day filter; **Sum** = Σ of all readings for that hour across **all days** (a period total, not a daily profile); **Average** = mean. Total per hour = Σ over meters. Values rounded to 2 dp. Time-of-day from `new Date(timestamp).getHours()` in the browser's local time zone.
* Time series (PMS:275-370): the window is day/week(Mon-start)/month/custom around `currentDate` (**defaults to today**, so it is usually empty); buckets "HH:mm" (day), "EEE HH:00" (week), "MMM d" (month). ⚠ Custom `end = dateTo` is midnight at the start of that day, so the last selected day is excluded (PMS:224-225), unlike the 24-hour view. The month view is not sorted (`return 0`, PMS:366), so it relies on insertion order.
* Summary (PMS:450-465): "Daily Total" = Σ of the bucket totals, labelled "kWh" even when the data are kW and the period spans many days; peak/min buckets.
* No diversity, no area scaling, no tenant awareness.

| Control | Type | Purpose | Handler | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| **Load** → dialog | Button + Dialog | Load a saved meter selection | `handleLoadConfig` (PMS:184-197, 560-615) | `stacked_profiles` | ids no longer present are dropped | toast "Loaded X of Y meters (some no longer exist)"; "No saved configurations for this project" |
| Load dialog › trash | Icon button + `confirm()` | Delete a saved config | PMS:598-609 | deletes `stacked_profiles` | — | toast |
| **Save** → dialog (Name, Description, **Save Configuration**) | Button + Dialog | Save the selection | `handleSaveConfig` (PMS:199-213, 618-657) | inserts `stacked_profiles` | Save disabled with nothing selected; name required | toasts |
| **Select All / Deselect All** | Button | Toggle every meter | `handleSelectAll` (PMS:176-182, 666-668) | client | — | — |
| Meter checkboxes (with colour dot) | Checkbox grid | Choose meters | `handleMeterToggle` (PMS:164-174, 671-693) | client | only meters with raw_data | "No meters assigned to this project"; "No meter data available" |
| **24-Hour Profile / Time Series** | Toggle buttons | View mode | `setViewMode` (PMS:702-719) | client | — | — |
| From / To date (24-h) | Calendar popovers | Filter dates | PMS:727-779 | client | — | "All dates" |
| Day Type | Select (All / Weekdays / Weekends) | Day filter | PMS:781-793, 895-907 | client | — | — |
| Aggregation | Select (Sum / Average) | Combine readings | PMS:795-806, 909-920 | client | — | — |
| Period (time series) | Select (Day / Week / Month / Custom) | Window size | PMS:812-825 | client | — | — |
| ‹ / › and "Previous/Next {period}" | Buttons (twice: filter bar and chart card) | Move the window | `handlePrevPeriod` / `handleNextPeriod` (PMS:229-255, 828-840, 945-963) | client | hidden in Custom | — |
| Custom From / To | Calendar popovers | Custom window | PMS:843-893 | client | — | "Select custom range" |
| **Generate Stack (N)** | Button | Compute and show the chart | `handleGenerateStack` (PMS:467-474, 927-930) | client | disabled with none selected | toast; ⚠ an empty result shows **nothing at all** (no empty state, PMS:942) |
| **Export CSV** | Button | Download the chart data | `handleExportCSV` (PMS:476-502, 931-936) | client Blob | shown only with data | names are not quoted, so a comma in a meter label corrupts the CSV |
| Chart | Recharts Area (stacked) / Line (+dashed Total) | Visualise | PMS:1015-1078 | — | — | — |

### B.11 Defects, gaps, hard-coded values, security, performance

**Correctness / data integrity**
1. **Wizard reports success before importing** (SIW:669-673): `onComplete` is fire-and-forget; statuses mean "uploaded to storage", and real failures surface later as separate toasts. The rebuild should await the import and show per-file outcomes (rows parsed, date range, unit, tenant created or linked).
2. **Wizard parsing settings are mostly ignored**: DateTime Format and Split By are dead; Data Type does not reach C2LP; C2LP is called with `columns: []` and a hard-coded comma config, so only header-name auto-detection applies. A date header not containing "date/timestamp/rdate" (e.g. "From") imports nothing (TM:733-753; C2LP:367-382).
3. **Ambiguous dates default to Y/M/D**; the user's DD/MM choice is discarded (C2LP:205-231, 309-312).
4. **Global-library collisions by bare file name** (TM:853-879): any project's import overwrites another project's library meter of the same file name.
5. **Triple storage and double raw_data** per wizard file (SIW:650, TM:882-890, TM:803/848); a MLID import adds a third DB copy. Deletes do not clean `meters/{id}/…` objects, the global row, or the auto-created tenants; the storage-name match uses the unsanitised name (SIW:357, 398).
6. **`raw_data` shape drift**: SIW writes `{timestamp, value}` or `{csvContent}`; PMS reads `{timestamp, values:{}}`; UMC/UDC normalise several legacy shapes. One canonical interval format (with its unit) is needed.
7. **Inconsistent kWh maths**: the TM row (area-scaled, weekday × 30, no interval correction), the TM KPI (unscaled, includes excluded tenants), MMS (simple mean of area-scaled 24-point weekday profiles, weights ignored, primary included), downstream `getAveragedProfileKw` (weighted kW/m², area-less meter = 1 m², primary excluded), and SMP monthly (Σ raw, kWh) vs daily (Σ × interval, kW). Five different answers for "this tenant's monthly kWh".
8. **Accuracy labels**: a single multi-meter entry shows "Missing" (TM:1583); the summary strip drops some tenants; the tab status ignores multi-meter tenants (PD:1095, 1110-1131).
9. **Tenant area 0** for wizard-created tenants (TM:901) and on unparsable TCM areas (TCM:150-155): such tenants silently drop out of the fallback estimate.
10. **Scale ×1.00 by construction** when the wizard assigns a file to a tenant (the meter's area is copied from the tenant, TM:804).
11. **One-to-one rule is partial**: enforced for single links by the picker and `updateTenantProfile`, bypassed by the wizard link path (TM:908-911), and independent of multi-meter lists; the MMS "In use" check is client-side and cross-project.
12. **Auto-match** matches "12" and "12A" (parseFloat), may pull meters from other projects in global scope, and runs N sequential updates without reporting errors.
13. `KwhOverrideCell` cannot set 0, and its initial value goes stale (TM:96-108); totals treat 0 as unset.
14. The TCM header detection prefers "name/shop" for a "Shop No" column; the CSV reader ignores quoting (TM:262-264).
15. `ScaledMeterPreview` TOU shading is always low season, with Sunday = Saturday (SMP:45-47 → `load-profile/types.ts:193-217`).
16. The PMS custom range excludes its last day (PMS:224-225); the month view is unsorted.

**Stubs / dead controls**
* TPM **Assign…** is a TODO `console.log` (TPM:237-240).
* SIW **DateTime Format**, **Split Column By** (never read).
* MMS `updateWeight` mutation has no UI (MMS:224-236); `weight` is always 1.
* SMP `shopTypeIntensity` / `meterIntensity` unused (SMP:61, 90).
* TM `shopTypes` prop unused; there is no way to set `shop_type_id`, `is_virtual` or `cb_rating` (after import) from this tab.
* PML and PMS entirely unmounted; MMS `useAveragedProfile` / `calculateAveragedProfiles` unused.

**Hard-coded values**
50 kWh/m²/month fallback (TM:684, 976, 1371; SMP:61); ×30 days per month (TM:682, 973, 1369; MMS:531; SMP:91/97); scale warning band 0.5–1.5 (TM:1550; SMP:288); suggestion scores 100 / 60 + 30·ratio / 95 / 93 and a threshold of 60 (TM:196-205, 572-603); page size 1000 (TM:339); MLID limit 5000 (MLID:67); `"PDB"` prefix (MLP:50); 400 V / PF 0.9 amp conversion (C2LP:32-45); 10-colour palette (PML:29-32; PMS:55-58); default separator comma, header row 1 (SIW:275-276); 11 date presets (SIW:105-117); months with ≥5 days only (UMC:241).

**Security**
* Open RLS on `project_tenants`, `project_tenant_meters`, `stacked_profiles` (anon role) and authenticated-only (not project-scoped) on `scada_imports` and the `scada-csvs` bucket (§B.1). Every delete in this slice — tenant, bulk tenant, clear-all, remove meters, delete import(s), delete meter, delete config — is a client-side statement with no server-side ownership check; most have **no confirmation** (TM:1205, 1314, 1635; MMS:374).
* Global-scope listing (TM:336-365) and TPM's query expose meter names/areas from every client project to any user.
* PML's Unlink publishes a project's meter to the global library.
* Unescaped prefix in MLID's `.or()` filter (MLID:65).

**Performance**
* TM global scope pages through **every** `scada_imports` row with both 24-value arrays on each Tenants-tab load (TM:336-365).
* For **each table row, on every render**, TM recomputes and sorts suggestions over all meters (TM:1379-1384) — O(tenants × meters × log meters) even with every popover closed.
* Auto-match is O(unassigned × meters) scoring plus N sequential updates (TM:559-629).
* The wizard processes files concurrently and holds all file contents plus fully built `raw_data` arrays in memory; each file writes its raw series twice.
* MLID fetches `raw_data` per meter sequentially and re-inserts it (N+1, very large payloads).
* SMP fetches the same `raw_data` twice per open (UMC + UDC).
* PMS loads every meter's `raw_data` in one query.
* MMS loads **all** junction rows system-wide on open (MMS:139-149).
* Delete-all lists the bucket once per import (SIW:394-396).

**UX dead ends**
* Wizard "Done" can hide a failed import; there is no retry for failed files (Complete Import disappears).
* Tenants created by the wizard are named after the file and have area 0, with no prompt to fix them.
* MLID lists already-imported meters again; nothing prevents duplicates.
* The Tenants tab can say "partial" and the Load Profile tab "blocked" for a fully multi-meter-modelled project.
* The Preview (Eye) is unavailable for multi-meter tenants.
* The TPM report can claim "With Profiles 20/20" while the table shows unassigned tenants, and its Assign does nothing.


---

## Part C — Global Load Profiles page (screens)

Source root: `wmsolar-main/`. All paths below are relative to `src/components/loadprofiles/` unless they start with `src/`. Line numbers are `file:line`. The parsers and import wizards (`CsvImportWizard`, `CsvParseDialog`, `ColumnSelectionDialog`, `BulkCsvDropzone`, `OneClickBatchProcessor`, `ScadaImport`, `SheetImport`, `GoogleSheetsImport`, `utils/*`) are documented in another part. This part only records where they are launched from and with which props.

---

### C.0 Route, reachability and data model in one view

**Route.** `src/App.tsx:81` mounts `/load-profiles` → `src/pages/LoadProfiles.tsx`. The route sits inside `<ProtectedRoute>` (`src/App.tsx:72-76`), so a signed-in session is required. Nothing on the page checks roles, and no query filters by user or organisation.

**Which components can a user actually reach from this page?**

| Component | Reachable from `/load-profiles`? | How |
|---|---|---|
| `LoadProfilesDashboard` | Yes | Tab "Dashboard" |
| `SitesTab` | Yes | Tab "Sites" |
| `SiteLocationMap` | Yes | Sites → Add/Edit Site dialog |
| `SitesMapView` | Yes | Sites → Map toggle |
| `SiteMeterOverview` | Yes | Sites → open a site → "Overview" |
| `MeterAnalysis` | Yes | Sites → site → "Analysis" |
| `ProfileStacking` | Yes | Sites → site → "Stacking" |
| `MeterComparison` | Yes | Sites → site → "Comparison" |
| `MeterReimportDialog` | Yes | Sites → site → Meters table → Upload icon (listed-only rows) |
| `MeterLibrary` | Yes | Tab "Meter Library" |
| `MeterProfilePreview` (+ `useDailyConsumption`, `useMonthlyConsumption`) | Yes | Meter Library → eye icon |
| `CrossSiteComparison` (+ `useCrossSiteComparison`) | Yes | Tab "Cross-Site Comparison" |
| `ExcelAuditReimport` | Yes | Tab "Excel Audit Reimport" |
| `ScadaImportsList` | **No, orphaned.** No file imports it. | — |
| `LoadProfileEditor` | **No.** Its only importer is the orphaned `ScadaImportsList` (`ScadaImportsList.tsx:15`). | — |
| `PivotTable` | **No, orphaned.** No file imports it. | — |
| `SiteManager` | **No, orphaned.** No file imports it. | — |
| `CategoryMapper`, `ProfilePreviewCard` | **No.** Their only importer is `loadprofiles/GoogleSheetsImport.tsx:14-15`, which is itself orphaned. `src/pages/TariffManagement.tsx:8` imports a *different* `src/components/tariffs/GoogleSheetsImport`. | — |
| `MeterAnalysisChart` | **No.** Its only importer is `loadprofiles/ScadaImport.tsx`, which nothing imports. `MultiMeterSelector.tsx:25` declares a local *interface* named `ScadaImport`; that is not an import. | — |

**Tables, buckets and edge functions touched by these screens**

- `public.scada_imports`: one row per meter; the central table. Columns used: `id, site_name, site_id, shop_number, shop_name, area_sqm, meter_label, meter_color, file_name, data_points, date_range_start, date_range_end, created_at, updated_at, load_profile_weekday (numeric[24]), load_profile_weekend (numeric[24]), weekday_days, weekend_days, processed_at, category_id, raw_data (jsonb), detected_interval_minutes, value_unit, csv_file_path`.
  - `site_id` is declared `REFERENCES sites(id) ON DELETE SET NULL`.
  - `category_id` is declared `REFERENCES shop_type_categories(id) ON DELETE SET NULL`.
  - Both are in `supabase/migrations`.
- `public.sites`: `id, name, site_type, location, latitude, longitude, total_area_sqm, description, created_at, updated_at`.
- `public.stacked_profiles`: `id, project_id, name, description, meter_ids uuid[], created_at`.
- `public.projects`: read only, `id, name`.
- `public.shop_type_categories`: read only, `id, name`.
- Storage bucket `scada-csvs` (private). Objects are written at `meters/{meterId}/{Date.now()}_{safeName}` by `utils/csvStorage.ts:17`, and the path is saved in `scada_imports.csv_file_path`.
- Edge functions:
  - `get-mapbox-token`: `SiteLocationMap.tsx:60`, `SitesMapView.tsx:75`.
  - `google-places-search`: `SiteLocationMap.tsx:163,187`, `SitesMapView.tsx:264,290`.

**RLS as found in migrations**

- `scada_imports` has "Authenticated users can select/insert/update/delete" with `USING (true)` (`20260108035004_*.sql`).
- `sites`, `stacked_profiles` and `shop_type_categories` have "Anyone can view/insert/update/delete" with `USING (true)` / `WITH CHECK (true)`, and no later migration drops them.
- The `scada-csvs` bucket has authenticated INSERT/SELECT/DELETE policies, but no UPDATE policy (`20260220064250_*.sql`).

Consequence: there is **no tenant or user isolation**. Every signed-in user sees and can delete every site and meter. Deletes are issued straight from the browser.

**The `raw_data` jsonb has at least six shapes in the wild.** The screens disagree about which shapes they understand, and that is the root cause of most defects in this part.

| Shape | Written by | Understood by |
|---|---|---|
| **A.** `[{ csvContent: "<whole csv>", processingConfig?, totalKwh?... }]` (legacy) | older imports | `SitesTab` reprocess/wizard, `MeterLibrary` wizard/reprocess, `MeterAnalysis`, `useMonthlyConsumption`, `useDailyConsumption` (via `normaliseRawData`) |
| **B.** `[{ date:"YYYY-MM-DD", time:"HH:MM:SS", value }]` (canonical "normalised") | wizard saves (`SitesTab.tsx:1128`, `MeterLibrary.tsx:980`), `MeterReimportDialog.tsx:82`, `normaliseRawData` | `useDailyConsumption`, `useMonthlyConsumption`, `useCrossSiteComparison` |
| **C.** `[{ timestamp:"ISO", values:{ "P1 (kWh)":n, ... } }]` (multi-quantity SCADA) | old `ScadaImport` path | `MeterAnalysis`, `MeterComparison`, `ProfileStacking`, `PivotTable`, `ScadaImportsList` |
| **D.** `[{ timestamp, value }]` (wizard shape before normalising) | legacy | `useMonthlyConsumption`, `normaliseRawData` |
| **E.** `[]` (emptied) | `MeterLibrary.reprocessMeters` (`MeterLibrary.tsx:500,520`); that code is unreachable | nothing |
| **F.** `[{ source:"excel-audit-reimport", fileName, columnHeader, totalKwh, peakKw, dataPoints, importedAt }]` (metadata only, no intervals) | `ExcelAuditReimport.tsx:514-522` | nothing. Every consumer shows "no data" or zeros. |

**`load_profile_weekday/weekend` also means different things depending on who wrote it.** See C.16.

---

### C.1 Page shell: `src/pages/LoadProfiles.tsx`

**Purpose.** A global (not project-scoped) workspace for managing sites and the reference meter library that project load profiles are built from.

**Layout.**
- Heading "Load Profiles" with the subtitle "Manage sites and meter data for energy analysis" (`:16-21`).
- A shadcn `Tabs` controlled by `activeTab` (`:12,23`). The default is `"dashboard"`.
- The tab is not synced to the URL. It resets on reload and cannot be deep-linked.

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error & empty |
|---|---|---|---|---|---|---|
| Dashboard | TabsTrigger `value="dashboard"` | Summary stats | `setActiveTab` (`:23-28`) | — | — | — |
| Sites | TabsTrigger `sites` | Manage sites and meters | `:29-32` → `<SitesTab/>` (`:54-56`) | — | — | — |
| Meter Library | TabsTrigger `meter-library` | All meters globally | `:33-36` → `<MeterLibrary/>` with **no `siteId`** (`:58-60`) | — | — | — |
| Cross-Site Comparison | TabsTrigger | Compare meters across sites | `:37-40` → `<CrossSiteComparison/>` | — | — | — |
| Excel Audit Reimport | TabsTrigger | Bulk-overwrite profiles from an audit workbook | `:41-44` → `<ExcelAuditReimport onImportComplete={() => setActiveTab("meter-library")}/>` (`:66-70`) | — | — | — |

Props passed down:
- `LoadProfilesDashboard` receives `onNavigateToSites` and `onNavigateToMeters`, which only switch tabs (`:48-51`).
- `ExcelAuditReimport` receives no `projectId` or `siteId`, so it works on all meters.

---

### C.2 `LoadProfilesDashboard.tsx` (245 lines)

**Purpose.** Four KPI cards plus "Recent Imports" and "Quick Actions".

**Queries**
- `["load-profiles-stats"]` (`:13-67`) runs in parallel:
  - `sites.select("id, name, total_area_sqm")`
  - `scada_imports.select("id, site_id, data_points, date_range_start, date_range_end, processed_at, load_profile_weekday")`
  - Neither has pagination or a limit, so PostgREST's default 1000-row cap applies. Above 1000 meters the counts are silently wrong. Contrast `SitesTab`, which paginates (`SitesTab.tsx:106-126`).
  - It also pulls the 24-element `load_profile_weekday` array for every meter just to test it for non-zero values.
- `["recent-meters"]` (`:69-80`): `scada_imports.select("id, site_name, shop_name, meter_label, created_at, data_points").order(created_at desc).limit(5)`.

**Derived stats** (`:21-65`)
- `metersWithData` means `data_points > 0` OR `load_profile_weekday` has any value > 0 (`:27-35`).
  - This is **inconsistent** with `SitesTab`, which counts only `data_points > 0` (`SitesTab.tsx:141`). A "listed only" meter carrying a placeholder profile is counted "with data" on the dashboard and "listed only" on the Sites card.
- `metersListedOnly` is total minus with-data.
- `totalDataPoints` is Σ `data_points`.
- `dateRange` is the minimum start and maximum end over meters that have both dates (`:41-53`).
- Coverage days is `ceil((max-min)/86400000)`, shown at `:162`.
- `totalArea` is Σ `sites.total_area_sqm` (`:63`). The active Add/Edit Site dialog cannot set `total_area_sqm`; see C.3.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| "Total Sites" card | Clickable Card | Jump to Sites | `onClick={onNavigateToSites}` (`:86-89`) | stats.siteCount, totalArea | — | Shows 0. The m² line is hidden when area is 0 (`:96-100`). |
| "Total Meters" card | Clickable Card | Jump to Meter Library | `onNavigateToMeters` (`:104-107`) | meterCount, metersWithData, metersListedOnly | — | 0 |
| "Data Points" card | Static card | Total readings | none | totalDataPoints, formatted as K/M (`:134-140`) | — | 0 |
| "Date Coverage" card | Static card | Earliest to latest date | none | dateRange, `en-ZA` month/yy (`:156-163`) | — | "-" when no dates (`:166`) |
| Recent Imports list | List | Last 5 meters created | none (rows not clickable) | recentMeters | — | "No meters imported yet" (`:180-183`) |
| "Create a Site" tile | Clickable div | Go to Sites | `onNavigateToSites` (`:212-225`) | — | — | Only switches tab; does **not** open the Add Site dialog. |
| "Browse Meter Library" tile | Clickable div | Go to Meter Library | `onNavigateToMeters` (`:226-239`) | — | — | — |

**Gaps**
- Neither query has error handling; failures render as zeros.
- The clickable cards and tiles are `div`s, not buttons, so they are not keyboard-accessible.

---

### C.3 `SitesTab.tsx` (1903 lines)

This component renders **two mutually exclusive screens**.
- If `selectedSite` is set, it early-returns the **Site Detail** screen (`:1260-1611`).
- Otherwise it renders the **Sites List** screen (`:1631-1902`).

Hidden defect: the `CsvImportWizard` and the "Configuring Meters" queue toast are rendered **only in the Sites List branch** (`:1877-1900`). The buttons that open the wizard live only in the Site Detail branch. See D-1.

#### C.3.1 Queries and mutations

| Name | Query | Notes |
|---|---|---|
| `["sites-with-stats"]` (`:97-164`) | `sites.select("*").order("name")`; then `scada_imports.select("id",{count:"exact",head:true})`; then a loop over `.select("site_id, data_points").range(p*1000,(p+1)*1000-1)` | Correctly pages past the 1000-row cap. The page fetches run sequentially and their errors are ignored (`:118-125`). Per-site stats are `total` and `withData = data_points>0`, plus `meters_listed_only`. `staleTime: 0`. |
| `["site-meters", siteId]` (`:167-180`) | `scada_imports.select("id, site_name, shop_name, file_name, data_points, date_range_start, date_range_end, created_at, load_profile_weekday, load_profile_weekend, detected_interval_minutes").eq("site_id", id).order(created_at desc)` | No limit, so capped at 1000 meters per site. |
| `saveSite` (`:182-214`) | edit: `sites.update({name, site_type, location, latitude, longitude}).eq("id")`; create: `sites.insert(...).select().single()` | Invalidates `sites-with-stats` and `load-profiles-stats`. |
| `deleteSite` (`:216-228`) | `sites.delete().eq("id")` | The FK sets meters' `site_id` to NULL. Meters are *not* deleted. |
| `deleteMeter` (`:230-241`) | `scada_imports.delete().eq("id")` | Does not delete the `scada-csvs` object, which is orphaned. |
| `bulkDeleteMeters` (`:243-256`) | `scada_imports.delete().in("id", ids)` | Same orphaning. A very large `in()` can exceed URL length. |
| `deleteDuplicateMeters` (`:260-317`) | client-side grouping, then `scada_imports.delete().in("id", idsToDelete)` | See algorithm below. Invalidates `["sites"]`, not `["sites-with-stats"]` (`:308`), so the list-card counts go stale. |
| `handleReprocessMeter` (`:348-409`) | `scada_imports.select("raw_data").eq(id).single()`, falling back to `downloadCsvFromStorage(id)` | Loads the whole `raw_data` just to find `csvContent`. |
| `handleColumnSelected` (`:415-447`) | First `update({processed_at:null, load_profile_weekday:null, load_profile_weekend:null, weekday_days:null, weekend_days:null})`, then `processWithColumn` | The clearing update's error is not checked. If `processWithColumn` then fails, the meter is left with **no profile**. |
| `processWithColumn` (`:537-687`) | `select("raw_data")`, then `update({load_profile_weekday, load_profile_weekend, date_range_start, date_range_end, weekday_days, weekend_days, data_points, processed_at, detected_interval_minutes, value_unit})` | Writes **percentage-normalised** profiles. See C.16 and D-3. |
| `loadMeterForWizard` (`:997-1070`) | `select("id, raw_data, shop_name, site_name")`, then `downloadCsvFromStorage` (priority 1), then legacy `csvContent` (priority 2) | Fetches the full `raw_data` even when the storage copy is used. |
| `handleWizardProcess` (`:1094-1162`) | `update({raw_data: normaliseRawData(intervalData), data_points, load_profile_weekday, load_profile_weekend, weekday_days, weekend_days, date_range_start, date_range_end, processed_at})`, then fire-and-forget `uploadCsvToStorage` | Does **not** call `validateLoadProfile` (MeterLibrary does). Does not write `detected_interval_minutes` or `value_unit`. |
| `handleMapLocationSet` (`:1614-1629`) | `sites.update({latitude, longitude}).eq("id")` | Called from `SitesMapView`. |

#### C.3.2 Sites List screen (`:1631-1902`)

**Layout.** A header row with a list/map toggle, "Import Sheet" and "Add Site". Below it, either a responsive card grid (`md:2`, `lg:3` columns) or `SitesMapView`.

| Control | Type | Purpose | Handler → effect | Data | Validation/disabled | Error & empty |
|---|---|---|---|---|---|---|
| List / Map toggle | ToggleGroup single (`:1643-1650`) | Switch view | `setViewMode` (ignores deselect) | — | — | Not persisted |
| Import Sheet | Button (`:1651-1654`) | Create sites and meter placeholders from Excel | Opens a Dialog (`:1733-1754`) that hosts `<SheetImport onImportComplete={() => {close; invalidate ["sites"], ["load-profiles-stats"]}}/>` | See other part | — | Invalidates `["sites"]`, but the list uses `["sites-with-stats"]`. New sites appear only because `staleTime:0` refetches on remount or focus. |
| Add Site | DialogTrigger Button (`:1662-1667`) | Create a site | Opens the dialog. `onOpenChange(false)` runs `resetForm` (`:1655-1660`). | — | — | — |
| Site Name * | Input (`:1677-1683`) | Name | `setFormData` | → `sites.name` | Submit disabled when empty (`:1722`). No trim and no uniqueness check. | — |
| Location Text | Input (`:1685-1691`) | Free-text location | `setFormData` | → `sites.location` | — | — |
| Site Type | Input (`:1693-1699`) | Free-text type ("Shopping Centre"…) | `setFormData` | → `sites.site_type` | Free text, no list | — |
| Map Location | `SiteLocationMap` editable, compact (`:1710-1717`) | Pick lat/lng by clicking or searching | `onLocationChange(lat,lng)` → `setFormData({...formData, lat, lng})` | → `sites.latitude/longitude` | — | Stale-closure bug D-8 |
| Coordinates badge | Badge (`:1704-1708`) | Shows picked coordinates | — | — | Hidden when lat or lng is 0 (truthiness check) | — |
| Create / Update Site | Button (`:1719-1725`) | Save | `handleSubmit` → `saveSite.mutate` (`:1244-1252`) | `sites` insert/update | disabled `!name \|\| isPending` | Error message shown as a toast |
| (missing) Total area | — | — | **There is no `total_area_sqm` field.** Area can only come from `SheetImport` (`SheetImport.tsx:611`) or the orphaned `SiteManager`. | | | |
| (missing) Description | — | — | The `sites.description` column exists but no active UI edits it. | | | |
| Site card | Clickable Card (`:1783-1787`) | Open Site Detail | `setSelectedSite(site)` | — | — | — |
| Edit (pencil) | Icon button (`:1795-1802`) | Edit site | `openEditDialog` (`:1231-1242`) calls `stopPropagation` and pre-fills the form | — | — | — |
| Delete (trash) | Icon button (`:1803-1815`) | Delete site | `confirm('Delete "<name>"? Meters will be unassigned.')` → `deleteSite.mutate` | `sites.delete` | Uses the native `confirm` | Error toast |
| Card body | Display | With Data / Listed Only counts, coordinates or location text or "No location set", m² | — | `meters_with_data`, `meters_listed_only`, lat/lng, `total_area_sqm` | — | — |
| Empty state CTA | Button (`:1767-1770`) | "Create Your First Site" | `setSiteDialogOpen(true)` | — | — | Shown when no sites exist (`:1759-1772`) |
| Loading | Text (`:1757-1758`) | — | — | — | — | "Loading sites..." |
| Map view | `SitesMapView` (`:1774-1779`) | See C.5 | props `sites`, `onSiteSelect=setSelectedSite`, `onLocationSet=handleMapLocationSet`, `selectedSiteId` | — | — | `onCreateSiteAtLocation` is not passed |

There is no search, sort, filter or pagination on the site grid.

#### C.3.3 Site Detail screen (`:1260-1611`)

**Header**
- A back arrow (`:1272`) runs `setSelectedSite(null); setSiteDetailTab("meters")`.
- The title shows `site.name` and "location • type".
- An "Upload Meters" button (`:1285-1288`) opens the upload dialog.

**Sub-tabs** (`:1292-1314`): Meters (default), Overview, Analysis, Stacking, Comparison. Each maps to a component with `siteId={selectedSite.id}`:
- `SiteMeterOverview` (`:1536-1539`) also receives `siteName`.
- `MeterAnalysis` (`:1544`).
- `ProfileStacking` (`:1549`).
- `MeterComparison` (`:1554`).

**Meters sub-tab**

The header counts come from `:1261-1265`:
- `processedCount` uses `isProcessed`: `data_points>0` AND any non-zero value in either profile (`:971-984`).
- `unprocessedCount` counts meters with data that are not processed.
- `listedOnlyCount` counts meters with `data_points` of 0 or null.

| Control | Type | Purpose | Handler → effect | Data | Validation/disabled | Error & empty |
|---|---|---|---|---|---|---|
| Delete Duplicates | Button (`:1337-1349`) | Remove duplicate meters in this site | `deleteDuplicateMeters` (`:260-317`) | `scada_imports.delete().in(...)` | disabled while running or when there are no meters | "No duplicate meters found" info. `confirm` shows the count only, not which meters. Failure gives the generic toast "Failed to delete duplicates". |
| Delete Selected (N) | Destructive button (`:1350-1360`), shown only when selection > 0 | Bulk delete | `handleBulkDelete` (`:340-345`) → `confirm` → `bulkDeleteMeters` | delete | disabled while pending | toast |
| Process All (N) | Button (`:1361-1375`), shown when unprocessedCount > 0 | Configure columns for every unprocessed meter with data | `handleProcessAllWithWizard` (`:1199-1217`) → `startWizardProcessing(ids)` | Loads the first meter's CSV | disabled while the queue is non-empty | **Effectively dead in this screen (D-1).** The wizard mounts only in the list branch. The button sets the queue and spinner, then nothing visible happens until the user presses Back. |
| Select-all checkbox | Checkbox (`:1396-1399`) | Toggle all | `toggleAllMeters` (`:331-338`) | — | — | — |
| Row checkbox | Checkbox (`:1418-1421`) | Toggle one | `toggleMeterSelection` (`:319-329`) | — | — | — |
| Status badge | Display (`:1429-1442`) | Processed (green) / Pending / Listed Only (amber) | — | derived | — | — |
| Interval badge | Display (`:1444-1453`) | e.g. "30-min" | — | `detected_interval_minutes` | — | "-" |
| Data Points, Date Range | Display (`:1454-1464`) | — | — | `data_points`, `date_range_*` via `toLocaleDateString` (`:1254-1257`) | — | "-" |
| Configure columns (gear) | Icon button (`:1470-1482`), for rows with `data_points>0` | Open `CsvImportWizard` for this meter | `handleConfigureSingleMeter` (`:1220-1224`) → `loadMeterForWizard` | `select raw_data`, storage download | disabled while the id is in the queue | **Dead in this screen (D-1).** |
| Reprocess (refresh) | Icon button (`:1484-1498`), only when processed | Pick a value column and unit, then recompute | `handleReprocessMeter` (`:348-409`) opens `ColumnSelectionDialog`; confirm → `handleColumnSelected` (`:415-447`) → `processWithColumn` | See C.3.1 | disabled while reprocessing | Toasts: "No raw data stored…", "No CSV content stored… Please re-upload". The profile ends up normalised to %, not kW (D-3). |
| Upload CSV (upload icon) | Icon button (`:1502-1509`), only for listed-only rows | Attach data to a placeholder meter | `setReimportMeter(meter)` → `MeterReimportDialog` (`:1588-1595`) | See C.10 | — | — |
| Delete row (trash) | Icon button (`:1511-1521`) | Delete one meter | `confirm("Delete this meter?")` → `deleteMeter` | delete | — | toast |
| Empty-state Upload | Button (`:1386-1389`) | — | `setUploadDialogOpen(true)` | — | — | "No meters uploaded yet" |

**Dialogs launched from Site Detail**
- **Upload dialog** (`:1559-1585`) contains `<BulkCsvDropzone siteId={selectedSite.id} onComplete={...}/>`. `onComplete` closes the dialog and invalidates `site-meters`, `sites`, `sites-with-stats`, `meter-library` and `load-profiles-stats`.
- **`MeterReimportDialog`** (`:1588-1595`) receives `isOpen`, `onClose`, `meterId`, `meterName = shop_name||site_name`, `originalFileName = file_name` and `siteId`.
- **`ColumnSelectionDialog`** (`:1598-1608`) receives `isOpen`, `onClose`, `onConfirm=handleColumnSelected`, `csvContent`, `meterName` and `isProcessing`. The `initialColumn`, `initialUnit` and `initialVoltageV` props exist but are **not passed**, so a reprocess never pre-fills the previous choice.

#### C.3.4 Wizard queue algorithm (shared pattern with MeterLibrary)

1. `startWizardProcessing(ids)` (`:987-994`) resets `wizardCompletedMeters`, sets `processingQueue` and calls `loadMeterForWizard(ids[0])`.
2. `loadMeterForWizard` looks for CSV text in the storage bucket first, then in legacy `raw_data[0].csvContent`, a string item, or a `{csvContent}` object (`:1017-1052`).
   - If none is found it sets `wizardError` and removes the id from the queue (`:1055-1065`).
   - `CsvImportWizard` then shows `errorMessage`.
3. `onProcess(config, parsedData)` → `handleWizardProcess`:
   - `processCSVToLoadProfile(headers, rows, config)`.
   - Rejects the result if `dataPoints===0 || totalKwh===0`.
   - Rebuilds interval data as `{timestamp: "<dateCell> <timeCell>", value: parseFloat(stripNonNumeric(cell))}` and normalises it.
   - The stored `raw_data` values are the **raw cell numbers, not unit-converted**. A W or MW or A column is stored unconverted while the profile is converted.
   - Updates the row and uploads the CSV.
4. `moveToNextMeterInQueue` (`:1165-1195`) appends to the completed list, filters `processingQueue` from the **closure value**, then loads the next meter or finishes with "All meters processed!".
   - The closure is stale when `loadMeterForWizard` fails straight after `startWizardProcessing` in the same tick. The queue is still `[]` in that closure, so it declares success immediately.
   - `wizardCompletedMeters` is collected here but **never rendered** in SitesTab.
5. Closing the wizard (`handleWizardClose`, `:1073-1091`) skips the current meter and advances to the next one. There is no "cancel all" in SitesTab. MeterLibrary's error path does clear the queue.

#### C.3.5 Duplicate-detection algorithm (`:260-317`)

- Key = `(shop_name || site_name).toLowerCase().replace(/[^a-z0-9]/g,'')`.
- Groups with more than one meter are sorted by `data_points` descending, then `created_at` descending. The first is kept and the rest are deleted.
- Risk: distinct meters with the same shop name are treated as duplicates. Examples are two DBs for "Woolworths", or a meter with no shop name that falls back to the *site* name, which is identical for every meter in the site.
- On a site where several meters lack `shop_name`, **all but one are deleted**. There is only a count confirmation.

#### C.3.6 Dead code inside SitesTab

- `parseCsvContent` (`:690-814`) is never called.
- `processMeter` (`:966-969`) is never called.
- `wizardCompletedMeters` is set but never displayed.

---

### C.4 `SiteLocationMap.tsx` (313 lines)

**Purpose.** A small Mapbox satellite map with an optional place search. It is used only in the Add/Edit Site dialog, with `editable` and `compact` set.

**Behaviour**
- Fetches the token with `supabase.functions.invoke("get-mapbox-token")`, cached for 1 h (`:57-65`).
- The map uses style `satellite-streets-v12`. The default centre is `SA_CENTER=[24,-29]` at zoom 5, or the site coordinates at zoom 12 (`:77-89`).
- Navigation controls are hidden in compact mode (`:91-93`).
- Height is `h-32` compact or `h-48` otherwise (`:236`).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Search location | Input (`:245-252`), editable only | Find a place | `handleSearchChange` (`:147-182`): 300 ms debounce, minimum 3 chars → `google-places-search {query}` → `suggestions[]` | Edge function | < 3 chars clears the list | Errors are only logged; results are empty |
| Suggestion item | Button (`:262-271`) | Pick a place | `handleSelectSearchResult` (`:184-213`) → `google-places-search {place_id}` → if `success && latitude && longitude`, set pending coords, marker and flyTo zoom 14, then `onLocationChange` | Edge function | — | Toasts "Could not get coordinates…" / "Failed to get location details" |
| Map click | Mapbox click (`:99-106`), editable only | Drop a pin | `setPendingCoords` + `updateMarker` + `onLocationChange` | — | — | **Stale closure (D-8).** The handler is bound once when the token arrives, so it calls the `onLocationChange` from that render. |
| Click outside | document mousedown (`:216-225`) | Close suggestions | — | — | — | — |
| Overlays | Display (`:283-309`) | Spinner until the token loads; "Click map or search" / "No location set"; coordinates badge | — | — | `hasCoordinates` uses truthiness, so 0 counts as unset | — |

**Gaps**
- There is no way to *clear* a location.
- The marker is not draggable.
- The map is not re-centred when the dialog switches from one site to another, because `map.current` persists. In practice the dialog unmounts its content on close.

---

### C.5 `SitesMapView.tsx` (490 lines)

**Purpose.** A full map (600 px) of all sites, with a workflow to place pins for sites that have no coordinates.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Site marker | Custom DOM marker (`:207-229`) | Open site | Click → `onSiteSelect(site)` → SitesTab shows Site Detail | — | — | The marker label is injected with **`innerHTML` including the raw `site.name`** (`:163-187`). This is a stored XSS vector (D-15). The click handler captures the `site` object once, so it goes stale after edits. |
| Nav control | Mapbox NavigationControl (`:118`) | Zoom and compass | — | — | — | — |
| "Sites missing location" panel | Card list (`:389-413`) | List sites without lat/lng | Item button → `startPlacingPin(site)` (`:349-354`) | — | Hidden during placement | Hidden when every site has a location |
| Pin-placement search | Input (`:433-441`) | Search a place for the chosen site | `handleSearchChange` (`:248-283`), same as C.4 | `google-places-search` | min 3 chars | Logged only |
| Suggestion | Button (`:451-461`) | Choose a place | `handleSelectSearchResult` (`:285-325`) → temporary amber marker + flyTo | edge fn | — | toasts |
| Map click during placement | Mapbox click (`:125-140`) | Drop a pin | Intended to set `pendingLocation` and a temporary marker | — | — | **Does not work (D-9).** The handler is registered once, reading `isPlacingPin` and `siteWithoutLocation` from the initial render (false/null), so a click never places a pin. Only search works, although the placeholder says "Search location or click on map…". |
| Cancel (X) | Button (`:424-426`) | Abort placement | `cancelPlacement` (`:357-366`) | — | — | — |
| Confirm Location | Button (`:472-474`) | Save the pin | `confirmPlacement` (`:369-374`) → `onLocationSet(siteId, lat, lng)` → SitesTab `sites.update({latitude, longitude})` | `sites` | Shown only when `pendingLocation` is set | toast in SitesTab |
| "x / y sites mapped" badge | Display (`:482-487`) | Coverage | — | — | — | Red when any site is missing |

**Performance / UX**
- `sitesWithLocation` is recomputed every render and is a dependency of the marker effect (`:195-245`).
- That effect calls `fitBounds` or `flyTo` on **every re-render**, which yanks the viewport while the user pans.
- `onCreateSiteAtLocation` is declared but never used.

---

### C.6 `SiteMeterOverview.tsx` (427 lines)

**Purpose.** A site-level aggregate: KPI cards, a 24 h stacked area chart of weekday and weekend, and the top 5 consumers.

**Query** `["site-meters-overview", siteId]` (`:47-62`):
- `scada_imports.select("id, site_name, shop_name, shop_number, meter_label, meter_color, data_points, date_range_start, date_range_end, load_profile_weekday, load_profile_weekend, raw_data").eq("site_id").order(created_at desc)`.
- It **downloads the full `raw_data` for every meter in the site but never uses it** (D-20).

**Algorithm**
- **Aggregated profile** (`:73-107`):
  - For each hour h, sum the `load_profile_weekday[h]` of every meter whose array has exactly 24 values. Do the same for weekend.
  - `total = (weekdaySum+weekendSum)/2`, which is displayed nowhere except the CSV.
  - The profiles are summed as-is. Summing kW-profile meters with %-profile meters (C.16) produces nonsense.
- **Summary** (`:110-141`):
  - `totalDailyKwh = Σ_h weekday[h]`. This treats hourly kW as kWh per hour.
  - `monthlyKwh = totalDailyKwh × 30`, ignoring weekends.
  - `peakKw = max_h weekday[h]` and `peakHour = argmax`, weekday only.
- **Top consumers** (`:144-162`): `dailyKwh = Σ weekday profile`, sorted descending, top 5. Colour is `meter_color` or a palette colour by index.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| KPI cards ×4 | Display (`:214-268`) | Total meters / daily kWh plus ~monthly / peak kW at hh:00 / meters with raw data | — | — | — | — |
| Export CSV | Button (`:284-287`) | Download the site profile | `handleExportCSV` (`:164-184`). Columns: `Hour, Weekday (kWh), Weekend (kWh), Average (kWh)`. Filename `<site>-site-profile-<yyyy-MM-dd>.csv`. | client | — | "No data to export" toast |
| Area chart | Recharts AreaChart (`:292-341`) | Weekday and weekend areas | Tooltip only | — | — | "No processed profiles available yet" (`:343-347`) |
| Top Consumers | List with bars (`:353-424`) | Ranking | Eye button calls `onMeterPreview(id)` (`:397-406`) | — | **Never rendered.** SitesTab does not pass `onMeterPreview`. | Hidden when empty |

**Gaps**
- Weekday and weekend areas use different `stackId`s, so they overlay rather than stack. The label "Aggregated hourly consumption" is accurate.
- Units are labelled kWh when the values are kW (or %).
- The `isWeekend` and `format` imports are partly unused.

---

### C.7 `MeterAnalysis.tsx` (827 lines)

**Purpose.** A single-meter time-series explorer. Choose a meter and a date/time window, load the data, pick quantities (columns), aggregate and plot.

**Query** `["scada-imports-raw", siteId]` (`:221-241`):
- `scada_imports.select("id, site_name, site_id, shop_number, shop_name, date_range_start, date_range_end, data_points, raw_data").order(created_at desc)`, with `.eq("site_id")` when `siteId` is set.
- It downloads **`raw_data` for every meter in the site at once**, then **parses every embedded CSV on the client** (`extractDataPoints`, `:146-176`) before the user has picked a meter. On large sites this means tens of MB of jsonb and a frozen tab (D-19).
- It is capped at 1000 rows.

**Parsing** (`:55-143`, `:146-176`)
- **Shape A:** `parseCsvToDataPoints`:
  - Strips `\r` and `sep=`.
  - Treats the first line as the header and splits on **commas only**.
  - The date column is found by an exact match on `date|timestamp|datetime|time`, else column 0.
  - Every other column is a value column.
  - Dates are parsed with the regex `DD/MM/YYYY HH:mm(:ss)` as **local time**, else `new Date(str)`, then converted with `.toISOString()`.
  - The result is sorted by time.
- **Shape C:** passed through when the first element has `timestamp` and `values`.
- **Shape B `{date,time,value}` (what every current wizard writes) is not recognised.** It returns `null`, so the meter is **filtered out of the selector** (`:475`). Every meter processed through the current wizard, and every re-imported meter, is invisible in Analysis (D-4). If a site has only such meters, the whole tab shows "No meter data available".

**Aggregation** (`:271-378`)
- Filter by `dateFrom+timeFrom` and `dateTo+timeTo`. Time is `HH:mm` local and the end time gets `:59.999`.
- `raw` returns one point per reading.
- `hourly` keys by `format(date,"MMM d HH:00")`.
- **`daily` keys by `format(date,"d")`, the day-of-month only.** 5 Jan and 5 Feb fall in the same bucket (D-5).
- The operation is sum, average, max or min over the group. An empty group gives 0.
- Numeric keys sort numerically; otherwise `localeCompare`. For "hourly", keys like "Jan 10 00:00" sort alphabetically, so **Apr sorts before Jan**.

| Control | Type | Purpose | Handler → effect | Data | Validation/disabled | Error & empty |
|---|---|---|---|---|---|---|
| Select Meter | Select (`:532-543`) | Choose a meter | `handleMeterChange` (`:381-393`): resets quantities, graph and load state; defaults dates to the meter's `date_range_*` | — | Lists only meters with a parsable `raw_data` | — |
| Date & Time From | Popover + Calendar + time Input (`:548-586`) | Window start | `setDateFrom` / `setTimeFrom` | — | — | — |
| Date & Time To | Same (`:591-629`) | Window end | `setDateTo` / `setTimeTo` | — | No check that from ≤ to | Empty chart |
| Load Data | Button (`:635-641`) | "Load" the data | `handleLoadData` (`:409-419`): sets `dataLoaded` and auto-selects all quantities | none. The data is already in memory, so the button only reveals controls. | disabled without meter or dates | toast "Please select meter and date range" |
| Download CSV | Button (`:642-649`) | Export the current chart data | `handleDownloadCSV` (`:445-466`). Header `Timestamp,<quantities>`; rows use `label`. Filename `meter-data-<site_name>.csv`. | client | disabled when not loaded or empty | toast |
| Quantity checkboxes | Checkbox list (`:659-673`) | Choose series | `handleQuantityToggle` (`:396-406`) | — | — | Section hidden when no quantities |
| Graph | Button (`:675-681`) | Draw the chart | `handleGraph` (`:422-428`) → `showGraph=true` | — | toast when nothing is selected | — |
| Y-Axis Min / Max | Text Inputs (`:688-703`) | Fix the axis domain | `yAxisDomain` memo (`:469-473`) | — | Non-numeric input means "auto" | — |
| Operation | Select (`:712-722`) sum/average/max/min, default average | Aggregate function | state | — | — | — |
| Period | Select (`:726-735`) raw/hourly/daily, default daily | Bucket | state | — | — | — |
| Apply Manipulation | Button (`:738-743`) | Re-plot | `handleApplyManipulation` (`:431-442`). Only sets `showGraph` and shows a toast; the memo already reacts to changes. | — | toast when not loaded | — |
| Line chart | Recharts (`:749-797`) | Plot | Hover tooltip. Colours come from `QUANTITY_COLORS` by name, else a fallback palette (`:181-197`). | — | — | "No data available for the selected time range…" (`:800-804`) plus guidance placeholders (`:806-822`) |

**Other issues**
- The subtitle says "using kVA data", which is misleading.
- The empty state says to use the "New SCADA Import" tab, which does not exist (D-24).
- Raw mode with a year of 30-min data draws about 17,520 points with no down-sampling.

---

### C.8 `ProfileStacking.tsx` (801 lines)

**Purpose.** Select several meters in a site and draw a stacked 24 h area chart. Selections can be saved and loaded as named `stacked_profiles`, optionally tagged to a project.

**Queries**
- `["scada-imports-stacking", siteId]` (`:85-104`): `scada_imports.select("id, site_name, shop_number, shop_name, meter_label, meter_color, date_range_start, date_range_end, data_points, raw_data")`, filtered by site. This is **full `raw_data` for every meter**.
- `["projects-list"]` (`:106-116`): `projects.select("id, name").order(name)`. All projects, no scoping.
- `["stacked-profiles", selectedProjectId]` (`:118-135`): `stacked_profiles.select("*").order(created_at desc)`, with `.eq("project_id")` unless `__all__` or empty.
- `saveConfig` (`:137-155`): `stacked_profiles.insert({name, description, project_id, meter_ids})`.
- `deleteConfig` (`:157-167`): `stacked_profiles.delete().eq("id")`.

**Algorithm** (`:238-315`)
- Only shape C is handled. `new Date(point.timestamp)` gives local time; `isWeekend` is local.
- The primary value is the first key containing "P1" or "kWh", else the first key.
- Readings are bucketed by `getHours()`.
- **Sum** mode adds *every reading across every day* in that hour. The result is total energy over the whole period for that hour, **not a daily profile**, yet the UI labels it "Daily Total" (`:692-694`) (D-6).
- **Average** mode gives the mean reading.
- `total` per hour is the sum across meters.
- Summary: `dailyTotal = Σ_h total`, plus peak and minimum hour (`:318-333`).
- `metersWithData` (`:202-204`) filters on `raw_data` being non-empty. Shape B meters *do* pass that filter, but then every `point.values` is undefined, so `Object.keys` throws inside `try` and the error is swallowed. Those meters contribute **silent zeros** (D-4).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Project filter | Select (`:414-424`) `__all__` or a project | Filter saved configs | `setSelectedProjectId` | reads `stacked_profiles` | — | — |
| Load | Dialog (`:427-482`) | Open a saved config | Row click → `handleLoadConfig` (`:169-183`): keeps only ids still present in `metersWithData` | — | — | "No saved configurations…"; toast "Loaded x of y meters" |
| Delete config (trash) | Icon in Load dialog (`:465-476`) | Remove a config | `confirm` → `deleteConfig` | `stacked_profiles.delete` | — | toast |
| Save | Dialog (`:485-539`) | Save the current selection | — | — | Trigger disabled with no selection | — |
| Configuration Name * / Description | Inputs (`:500-515`) | Metadata | state | → insert | Name is required (`:186-189`, `:533`) | toast |
| Assign to Project | Select (`:517-528`) `__none__` or a project | Tag a project | **Shares `selectedProjectId` state with the header filter.** Changing it in Save also changes the Load filter. | — | — | — |
| Save Configuration | Button (`:533-536`) | Persist | `handleSaveConfig` (`:185-200`) | insert | — | toast |
| Select All / Deselect All | Button (`:548-550`) | Toggle all meters | `handleSelectAll` (`:229-235`) | — | — | — |
| Meter tile | Clickable div + Checkbox (`:553-572`) | Toggle a meter | `handleMeterToggle` | — | — | Clicking the checkbox also bubbles to the div and double-toggles (D-26) |
| Date From / Date To | Popover calendars (`:578-632`) | Window | state | — | — | "All dates" |
| Day Type | Select (`:636-645`) | all / weekday / weekend | state | — | — | — |
| Aggregation | Select (`:650-658`) | Sum ("Total kWh") / Average ("Mean kWh") | state | — | — | — |
| Generate Stacked Profile | Button (`:664-667`) | Draw | `handleGenerateStack` (`:335-342`) | — | disabled with no selection | — |
| Export CSV | Button (`:668-673`) | Download | `handleExportCSV` (`:344-370`). Columns: `Hour, <meter names…>, Total`. Filename `stacked-profile-<date>.csv`. | client | shown only after generation | toast |
| Stacked area chart | Recharts (`:730-795`) | Visualise | Custom tooltip and legend | — | — | — |

Empty state: "Import SCADA data first…" (`:382-394`).

---

### C.9 `MeterComparison.tsx` (405 lines)

**Purpose.** Compare the average hourly profiles of two meters in the site.

**Query** `["scada-imports-comparison", siteId]` (`:49-70`): `scada_imports.select("id, site_name, shop_number, shop_name, meter_label, meter_color, raw_data")`, filtered by site and then client-side to non-empty `raw_data`. **Full `raw_data` for every meter again.**

**Algorithm** (`:83-136`)
- Only shape C is handled, with the same primary-key selection as C.8.
- Hourly mean per meter, filtered by day type.
- Per hour: `diff = a-b` and `percentDiff = b≠0 ? (a-b)/b×100 : 0`.
- Summary (`:139-157`):
  - `totalA/B = Σ_h hourly means`. This is labelled "kWh", but it is only a daily kWh when values are hourly-kW.
  - `diffPercent = (A-B)/B×100` has **no divide-by-zero guard**, so it shows NaN or Infinity (D-27).
  - `avgHourlyDiff` is computed but not shown.
  - Peak hours come from `reduce`.
- Shape A and shape B meters appear in the selector but produce all zeros (D-4).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Meter A / Meter B | Selects (`:228-256`) | Choose two meters | state | — | The option already picked on the other side is disabled | — |
| Day Type | Select (`:260-269`) | Filter | state | — | — | — |
| Compare Meters | Button (`:274-277`) | Run | `handleCompare` (`:159-169`) | — | disabled until both are chosen; toast if they are the same | — |
| Export CSV | Button (`:278-283`) | Download | `handleExportCSV` (`:171-186`). Columns: `Hour, A, B, Difference (kWh), Difference (%)`. Meter names are not CSV-escaped, so a comma in a name breaks columns (D-28). | client | — | — |
| Stat cards ×4 | Display (`:291-334`) | Totals, difference %, peak hours | — | — | — | — |
| Line chart | Recharts (`:347-397`) | Hourly A vs B | Tooltip shows the difference | — | — | Empty state "Import SCADA data first…" (`:198-210`) |

`showComparison` is not reset when the meters change, so the chart updates live after the first Compare. That is harmless.

---

### C.10 `MeterReimportDialog.tsx` (226 lines)

**Purpose.** Upload a fresh CSV for one meter, typically a listed-only placeholder. The user configures it in `CsvImportWizard`, and the meter's data and profile are replaced.

Props: `isOpen, onClose, meterId, meterName, originalFileName, siteId` (`:20-27`). `siteId` is unused, as is `isSaving`.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Amber info banner | Display (`:161-173`) | Explains the re-import | — | — | — | Copy always says "The original import detected wrong columns", even for never-imported placeholders |
| Original file line | Display (`:175-179`) | — | — | `file_name` | — | Hidden when null |
| Upload zone | Click-to-browse div + hidden `<input accept=".csv">` (`:183-207`) | Pick a CSV | `handleFileUpload` (`:47-63`): FileReader `readAsText`, count lines, then open the wizard | — | `.csv` only, no size limit, no drag-and-drop despite the dashed zone | — |
| `CsvImportWizard` | Child (`:213-223`) | Column and unit configuration | Props `isOpen=dialogOpen`, `onClose` (clears content), `csvContent`, `fileName`, `onProcess=handleWizardProcess`, `isProcessing` | — | — | — |
| (on process) | — | Save | `handleWizardProcess` (`:65-137`): `processCSVToLoadProfile`; rebuild `raw_data` from the wizard indices; `normaliseRawData`; warn if all values are zero; then `scada_imports.update({raw_data, data_points, date_range_start, date_range_end, weekday_days, weekend_days, load_profile_weekday, load_profile_weekend, file_name}).eq(id)` | `scada_imports` | **No `validateLoadProfile`**. Zero-value data is saved anyway, with a warning toast. | On error, toast plus reopen the wizard |

**Omissions compared with the other save paths**
- It does **not** set `processed_at`. The meter stays "Not processed" in MeterLibrary, so Quick Process and Manual Config offer it again.
- It does **not** upload the CSV to `scada-csvs`, so later "Configure" has no source and shows the error (D-10).
- It does not set `detected_interval_minutes` or `value_unit`.
- It invalidates `["site-meters"]`, `["meter-library"]` and `["scada-imports"]`, but not `["sites-with-stats"]`, so the site card keeps saying "Listed Only".
- The `timeIdx >= 0` check at `:83` treats `undefined` as falsy, which is handled correctly, but a date-time combined column plus a separate time index could double up.

---

### C.11 `MeterLibrary.tsx` (1932 lines), the most important screen

**Purpose.** The global reference catalogue of every meter (`scada_imports`). Users can search, filter, sort, bulk-import, bulk-process (auto or with the wizard), fix legacy averaging, edit metadata, preview profiles and delete. The card subtitle reads "Global reference meters - used to build project load profiles" (`:1320-1322`). The page mounts it with no `siteId` (`LoadProfiles.tsx:59`).

**Layout, top to bottom**
1. A collapsible "Bulk CSV Import" card (`:1277-1310`).
2. The main card, with a filter/action toolbar (`:1328-1486`), the inline `OneClickBatchProcessor` (`:1489-1502`), a progress panel (`:1505-1528`), the completed list (`:1531-1553`), and the table (`:1572-1777`).
3. Edit dialog (`:1784-1895`).
4. `MeterProfilePreview` (`:1898-1902`).
5. `CsvImportWizard` (`:1905-1914`).
6. A floating queue indicator (`:1917-1929`).

#### C.11.1 Queries and mutations

| Name | Query | Notes |
|---|---|---|
| `["sites-for-filter"]` (`:155-165`) | `sites.select("id, name").order(name asc)` | — |
| `["meter-library", siteId]` (`:167-186`) | `scada_imports.select("id, site_name, site_id, shop_number, shop_name, area_sqm, meter_label, meter_color, date_range_start, date_range_end, data_points, created_at, load_profile_weekday, load_profile_weekend, weekday_days, weekend_days, processed_at, category_id, file_name").order(created_at desc).limit(5000)` | Excludes `raw_data` on purpose (`:170`). **`.limit(5000)` does not beat the server's `max-rows` (1000 by default on Supabase)**, so above 1000 meters the library silently truncates to the newest 1000, while "Showing X of Y" reports only the fetched count (D-12). There is no server-side filtering or paging. |
| `updateMeter` (`:187-211`) | `scada_imports.update({meter_label, meter_color, shop_number, shop_name, area_sqm, site_name}).eq(id)` | `category_id` and `site_id` are not editable, so a meter cannot be reassigned to a site from here. |
| `deleteMeter` (`:213-225`) | `.delete().eq(id)` | The storage object is orphaned. |
| `bulkDeleteMeters` (`:227-241`) | `.delete().in("id", ids)` | Same. |
| `reprocessMeters` (`:244-594`) | Batches of 20: `select("id, raw_data, shop_name, site_name")` then `update({raw_data: [] ...})` | **Dead code, never invoked** (D-2). It is dangerous because it **wipes `raw_data` to `[]`** (`:499-500,520`). |
| `forceRecalculate30MinMeters` (`:597-790`) | `select("id, shop_name, site_name, detected_interval_minutes, raw_data").eq("detected_interval_minutes",30).not("raw_data","is",null)`, filtered client-side to legacy `csvContent`, then per meter `update({load_profile_weekday, load_profile_weekend, data_points, date_range_start, date_range_end, weekday_days, weekend_days, processed_at})` | **Global** across all sites, ignoring filters. It pulls the full `raw_data` of every 30-min meter in one request, which risks a timeout. It forces `valueUnit:"kW"`, which is **wrong for meters whose CSV is kWh per interval**: their profile becomes the average kWh per interval (half the kW). Only shape A meters are touched. There is no validation. |
| `startWizardProcessing` (`:819-844`) | When not forced: `select("id").in("id", ids).is("processed_at", null)` | Large `in()` lists risk hitting URL limits. |
| `loadMeterForWizard` (`:847-912`) | `select("id, raw_data, shop_name, site_name")`, then `downloadCsvFromStorage`, then legacy `csvContent` | Reads `raw_data[0].processingConfig` into `previousConfig`. **No current writer stores `processingConfig`**: `handleWizardProcess` builds it (`:962-967`) and then discards it (`:980`). The "reconfigure with previous settings" feature is inert (D-13). |
| `handleWizardProcess` (`:938-1022`) | `update({raw_data: normalised, data_points, load_profile_weekday, load_profile_weekend, weekday_days, weekend_days, date_range_start, date_range_end, processed_at})`, then fire-and-forget `uploadCsvToStorage` | Runs `validateLoadProfile` (`:983-988`): all-zero, all-identical, peak > 100000. Does not store `detected_interval_minutes` or `value_unit`. |
| `handleClearProcessed` (`:1056-1076`) | `scada_imports.update({processed_at:null}).not("processed_at","is",null)` | **Clears every processed meter in the database**, regardless of search, site filter or `siteId` prop. The confirmation count is only the loaded rows (D-11). |

#### C.11.2 Toolbar and table controls

| Control | Type | Purpose | Handler → effect | Data | Validation/disabled | Error & empty |
|---|---|---|---|---|---|---|
| Bulk CSV Import header | Collapsible trigger (`:1277-1292`) | Show the dropzone | `setShowBulkImport` | — | — | — |
| `BulkCsvDropzone` | Lazy child (`:1298-1306`) | Create new meters from CSVs, optionally without a site | Props `siteId={siteId \|\| null}` (always null from this page) and `onComplete` (invalidate `meter-library`, collapse) | See the parser part | — | Suspense spinner. Does not invalidate `sites-with-stats` or `load-profiles-stats`. |
| Search | Input (`:1331-1336`) | Free-text filter | `setSearchQuery`. Filter memo at `:1211-1255` matches `site_name`, the resolved `sites.name`, `shop_name`, `shop_number` and `meter_label`, case-insensitive substring. | client | — | "No meters match your filters" plus a Clear link (`:1561-1566`) |
| Site filter | Select (`:1339-1349`) | Limit to one site | `setSiteFilter`. Matches on `site_id`. Options are only sites that have meters (`:1204-1208`). | client | — | — |
| (missing) | — | There is **no filter for unassigned meters** (`site_id` null), for category, or for processed status. | | | | |
| Sort | Select (`:1351-1366`) | Newest/Oldest, Name A-Z/Z-A, Largest/Smallest area, Most/Least data | `setSortBy`. The comparator is at `:1233-1254`, and name uses `getMeterDisplayName` (`:1120-1125`). | client | — | — |
| Clear | Ghost button (`:1368-1373`) | Reset search and site filter | `clearFilters` (`:1259-1262`) | — | shown when a filter is active | — |
| Quick Process {n} (selection) | Button (`:1377-1389`), shown when selection > 0 | Auto-detect columns and process the selected meters | Sets `oneClickMeterIds` and shows `OneClickBatchProcessor` | See the parser part | disabled while the wizard queue is active | — |
| Manual Config (selection) | Button (`:1390-1402`) | Step through the wizard per selected meter | `handleReprocessSelected` (`:792-799`) → `startWizardProcessing(ids)` (non-forced, so only unprocessed meters) | — | disabled while the queue is active | toast "All selected meters already processed. Click the Settings icon…" |
| Delete {n} | Destructive button (`:1403-1411`) | Bulk delete | `handleBulkDelete` (`:1102-1107`) → `confirm` → mutation | delete | disabled while pending | toast |
| Quick Process (N) | Button (`:1416-1433`), shown when some filtered meters are unprocessed with data | Auto-process every unprocessed meter in view | Sets the ids and shows the processor | — | disabled while the queue is active | — |
| Manual Config... | Button (`:1436-1454`) | Wizard over unprocessed meters in view | `handleReprocessAll` (`:801-815`) | — | same | toasts |
| Fix 30-min Averaging | Amber button (`:1457-1472`), always shown when meters exist | One-off legacy repair | `forceRecalculate30MinMeters.mutate()` | See C.11.1 | disabled while pending or while the queue is active | toasts. **No confirmation** before a global rewrite of profiles (D-14). |
| Clear Processed (N) | Ghost button (`:1475-1485`) | Reset processed flags | `handleClearProcessed` | Global update | `confirm` | toast |
| `OneClickBatchProcessor` | Inline child (`:1489-1502`) | Auto-process | Props `meterIds`, `onComplete` (hide, invalidate `meter-library`), `onCancel` | — | Hides the other action buttons while visible | — |
| Progress panel | Display (`:1505-1528`) | Batch progress | Driven by `reprocessProgress` | — | — | Only `forceRecalculate30MinMeters` sets it (the dead `reprocessMeters` would too) |
| Completed list | Display plus dismiss X (`:1531-1553`) | Success/skip/fail per meter | `setCompletedMeters([])` | — | X hidden during progress | — |
| Select-all | Checkbox (`:1576-1579`) | Selects all **filtered** meters | `toggleSelectAll` (`:1084-1090`) | — | — | Selection is not cleared when filters change, so hidden meters can remain selected and get deleted (D-29) |
| Row checkbox | Checkbox (`:1596-1599`) | — | `toggleSelect` | — | — | — |
| Status icon | Display with title tooltip (`:1602-1608`) | Processed timestamp | — | `processed_at` | — | — |
| Colour dot | Display (`:1611-1614`) | `meter_color` | — | — | — | — |
| Meter / Label | Display (`:1617-1632`) | Display name, secondary shop name, file name | — | — | — | — |
| Total kWh | Display plus tooltip (`:1635-1683`) | Recorded consumption | `(Σ weekday profile × weekday_days) + (Σ weekend profile × weekend_days)`, shown as "K" when ≥ 1000 | — | "-" when there is no data or profile | Treats `Σ profile` as kWh/day. That holds for kW-hourly profiles but is **~100 × days for %-profiles** written by SitesTab reprocess (D-3). |
| Area (m²) | Display (`:1686-1690`) | — | — | `area_sqm` | — | "-" |
| Days (WD/WE) | Display (`:1693-1699`) | — | — | `weekday_days/weekend_days` | — | "-" |
| Peak kW | Display (`:1702-1716`) | "Peak" | `max(load_profile_weekday)`. This is the **weekday average-hour maximum, not a true peak demand**, and it ignores the weekend. | — | "-" | — |
| Data Points | Badge (`:1719-1721`) | — | — | `data_points` | — | — |
| Configure (gear) | Icon button with tooltip (`:1728-1740`) | Wizard for this meter (forced, so processed meters can be reconfigured) | `handleConfigureSingleMeter` (`:1079-1082`) | See C.11.1 | disabled while in the queue | Wizard error view when no CSV is found |
| Preview (eye) | Icon button (`:1745-1753`) | Open `MeterProfilePreview` | `setPreviewMeter(meter)` | — | disabled when `!load_profile_weekday` | — |
| Edit (pencil) | Icon button (`:1754-1760`) | Edit metadata | `openEditDialog` (`:1109-1118`) | — | — | — |
| Delete (trash) | Icon button (`:1761-1771`) | Delete | `confirm` → `deleteMeter` | delete | — | toast |
| Empty library | Display (`:1555-1560`) | — | — | — | — | "No meters imported yet / Use the 'New SCADA Import' tab…", which refers to a non-existent tab (D-24) |
| Loading | Display (`:1264-1272`) | — | — | — | — | "Loading meter library..." |

There is no pagination. All rows render at once, and with 1000+ rows × 10 columns and a Tooltip per row, rendering is slow.

#### C.11.3 Edit Meter dialog (`:1784-1895`)

| Field | Column | Validation |
|---|---|---|
| Site Name (Input `:1798-1802`) | `site_name` (free text, not linked to `sites`) | Required, trimmed (`:1877,1889`) |
| Shop Number (`:1811-1815`) | `shop_number` | — |
| Shop Name (`:1822-1826`) | `shop_name` | — |
| Area (m²) number (`:1835-1840`) | `area_sqm` via `parseFloat` | No check for negative or NaN. `parseFloat("abc")` gives NaN, which is sent to the database. |
| Custom Label (`:1848-1852`) | `meter_label` (empty becomes null) | — |
| Chart Color swatches ×10 (`:1860-1871`) | `meter_color` | The swatches are `<button>` elements with no `type` or aria-label, and there is no custom colour. |
| Save Changes (`:1874-1892`) | `updateMeter.mutate` | disabled when the site name is blank |

**Not editable anywhere:**
- `site_id` (assign a meter to a site). This is only possible at import time or through `SheetImport`.
- `category_id` (shop type).
- Weekday/weekend profile arrays (the `LoadProfileEditor` is unreachable).
- `value_unit` and `detected_interval_minutes`.

#### C.11.4 Monthly estimate helper (dead)

`getMonthlyKwhEstimate` (`:1130-1192`) is never called. It is documented here because it encodes business constants:
- **Profile method:** `Σ weekday × 22 + Σ weekend × 8`. With no weekend profile, weekend = weekday × 0.7.
- **Area method:**
  - Constants: `vaPerSqm=65`, `operatingHours=12`, `daysPerMonth=30`, `diversityFactor=0.65`, `powerFactor=0.92`, `loadFactor=0.55`.
  - `dailyKwh = (65×area/1000) × 12 × 0.55 × 0.65 × 0.92`, and `monthly = daily × 30`.
  - The comment wrongly says "48 half-hourly values"; the arrays hold 24.

---

### C.12 `MeterProfilePreview.tsx` (523 lines) with `hooks/useDailyConsumption.ts` and `hooks/useMonthlyConsumption.ts`

**Purpose.** A modal (`max-w-4xl`) opened from Meter Library. It shows monthly consumption and peak for a chosen month, the data-point count, a day-by-day actual 24 h profile with prev/next and a slider, or a fallback average weekday/weekend profile. Bars are coloured by TOU period.

**Data**
- Both hooks run `supabase.from("scada_imports").select("raw_data").eq("id", meterId).single()`.
  - Monthly: `useMonthlyConsumption.ts:148-152`.
  - Daily: `useDailyConsumption.ts:58-62`.
  - That is **two identical full `raw_data` downloads per open** (D-19), fired only while `isOpen`.
- TOU colours come from `getTOUPeriod(hour, isWeekend)` in `src/components/projects/load-profile/types.ts:193`. It reads **TOU settings from browser localStorage** (`readStoredTOUSettings`), so colours differ per browser. The month is not passed, so it always uses the low season.

**Daily algorithm** (`useDailyConsumption.ts:80-163`)
- Normalises through `castRawData`. Shape B is passed through; other shapes go through `normaliseRawData`.
- Groups by the `date` string. The hour is `parseInt(time)`.
- `hourlyProfile[h]` is the **mean of readings in hour h**.
- Peak is the running maximum of the hourly mean, and `peakHour` is its hour (`:124-128`).
- `totalKwh = Σ values × intervalHours`, where `intervalHours = 1/(readings/24)` when readings per hour > 1, else 1 (`:144-147`). This **assumes values are kW**. For kWh-per-interval data it under-counts by 2× (30 min) or 4× (15 min). Missing intervals also skew the inferred interval.
- The day of week comes from a local-time `Date(y,m-1,d)`, so the weekend flag is correct in any timezone.
- The initial selection is the last day (`:165-169`).
- **Selection is not reset when `meterId` changes.** The component stays mounted, so opening a second meter keeps the previous `selectedDate`. If that date is absent, `selectedDayData` is null, the Day stats and chart are not shown, and the header reads "Day 0 of N" (D-16).

**Monthly algorithm** (`useMonthlyConsumption.ts:208-254`)
- Handles:
  - Shape A: embedded CSV. Comma-split only; the date column is found by name and the value column by `kwh|p14|value|active`, else column 1.
  - Shape B.
  - Shape D: `{timestamp,...}`.
- `parseDateTime` (`:37-97`) tries ISO, then "DD Mon YYYY HH:mm", then `DD/MM/YYYY`.
  - For shape B it builds `"YYYY-MM-DD HH:MM:SS"` and calls `new Date(str)`. Chrome accepts that as local time; **Safari returns Invalid Date**.
  - The fallback regex expects `D/M/YYYY`, so in Safari shape B gives **no monthly data at all** (D-17).
- `totalKwh = Σ raw values` with no interval scaling, which **assumes kWh per interval**. `peakKw = max raw value`.
  - This is the **opposite assumption to the daily hook**. For kW data the monthly total is inflated 2× (30 min) or 4× (15 min), and peak is correct.
  - For kWh data the total is correct, but the "peak kW" is kWh-per-interval (half of kW for 30 min).
  - **Monthly and daily figures in the same modal are therefore mutually inconsistent for every meter** (D-18).
- Only months with at least 5 distinct days are listed.
- Auto-selection picks the latest month with at least 20 days, else the latest month. The same not-reset-on-meter-change bug applies.

**kWh/m² intensity** (`MeterProfilePreview.tsx:513-517`) is `selectedMonthData.totalKwh / area_sqm`, labelled "kWh/m²/mo". It inherits the monthly unit error above. It uses the calendar-month total even when the month is partial: a 5-day month is shown as the monthly intensity.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Month select | Select (`:205-218`) | Choose a month | `setSelectedMonth` | monthly hook | Hidden when no months | "Loading monthly data..." / "No monthly data available" |
| Monthly Consumption card | Display (`:198-245`) | kWh (K format), "Actual consumption for <month> (n days)" | — | — | — | — |
| Peak Demand card | Display (`:247-267`) | Maximum raw reading in the month | — | — | — | "Select a month" |
| Data Points card | Display (`:269-280`) | — | — | `data_points` | — | — |
| Prev / Next day | Buttons (`:382-410`) | Step days | `navigateDay('prev'\|'next')` | daily hook | disabled at the ends | — |
| Day slider | Slider (`:414-425`) | Jump to a day | `setSelectedDate(days[i].date)` | — | — | — |
| Day stats | Display (`:435-464`) | Total kWh, peak kW, peak hour | — | — | — | — |
| Daily bar chart | Recharts ComposedChart with a TOU `ReferenceArea` per hour (`:91-170`, `:467-490`) | Actual profile | Tooltip shows kW and TOU period | — | — | — |
| Weekday / Weekend toggle | ToggleGroup (`:309-317`), only in fallback mode | Choose the summary profile | `setProfileType` | `load_profile_*` | Shown when a weekend profile has 24 values | — |
| Fallback summary | Display (`:290-371`) | Used when `raw_data` yields no days but a 24-value weekday profile exists | — | — | — | "No daily data available. Raw data may not be stored." (`:372-375`). This is what shape F (Excel audit) and shape E meters show. |
| No-data view | Display (`:188-193`) | When `data_points` is 0 or null | — | — | — | "This meter needs to be processed first" |

Other issues:
- `hasData` gates on `data_points`, so a meter with a profile but `data_points=0` cannot be previewed even though the eye button is enabled.
- The `renderChart` parameter `peakHour` is unused.

---

### C.13 `CrossSiteComparison.tsx` (651 lines) with `hooks/useCrossSiteComparison.ts` (441 lines)

**Purpose.** Pick up to **6** meters (`MAX_METERS`, `:54`) from any site and overlay their profiles. The aggregation can be a daily hourly profile, a weekly day-of-week pattern or monthly totals. An optional baseline meter drives a "% vs Baseline" view, and a statistics table is shown.

**Queries** (hook)
- `["meters-metadata"]` (`:73-113`):
  - `scada_imports.select("id, shop_name, shop_number, site_id, site_name, category_id, area_sqm, date_range_start, date_range_end, detected_interval_minutes").order(site_name)`. **No pagination, so the 1000-row cap applies** (D-12).
  - Then `sites.select("id, name")` and `shop_type_categories.select("id, name")` to resolve names. Those queries' errors are ignored.
- `["meters-raw-data", selectedMeterIds]` (`:116-153`):
  - `scada_imports.select(<same> + raw_data).in("id", ids)`, plus `sites` again.
  - This is refetched on every change to the selection array, because the key contains the array. Adding a 6th meter re-downloads all 6 `raw_data` blobs.

**Algorithm** (`:156-401`)
- **Parsing**
  - Shape A (`csvContent`) meters are **skipped** ("skip for now", `:173-176`). Their `processedMeters` entry is never set, so they chart as 0.
  - Other arrays are cast as `{date,time,timestamp,value}`.
  - Shape C (`{timestamp, values}`) has no `.value`, which gives NaN or undefined sums.
  - In effect only **shape B** works.
- **Date filter** (`:182-189`)
  - `new Date(point.date)` for `"YYYY-MM-DD"` is **UTC midnight**, compared against a local-midnight `dateFrom`/`dateTo`.
  - East of UTC (SAST +2) the From boundary works. The To date *includes* the selected day only because UTC midnight is before local 00:00.
  - Behaviour shifts with the browser's timezone.
- **Day-type filter** uses `getDay()` on that UTC-midnight date in local time. That is correct for UTC+, but it **shifts the weekday by one for users west of UTC** (D-21).
- **daily**
  - Per hour, the mean of readings for each meter.
  - Stats: `sum` = Σ of the 24 means, `peak` = maximum mean.
  - The y-axis is labelled "Average kW". That is only true if values are kW; kWh-per-interval data shows kWh/interval.
- **weekly**
  - Per meter: daily sum of raw values (no interval scaling), then the mean of daily sums per weekday (Mon=0…Sun=6).
  - Labelled "Daily kWh", which is **wrong for kW data** (2× or 4×).
- **monthly**
  - Σ raw values per `YYYY-MM`.
  - The month key uses a UTC-midnight date read with local getters. That is fine for UTC+ but can shift month-end days for UTC−.
  - Months where a meter has no data give 0, which drags down its stats.
- **Group average** (`:339-340`) is the mean of each meter's `sum`. `vsGroupAvg = (sum − groupAvg)/groupAvg × 100`.
- **Baseline**: `vsBaseline = (sum − baselineSum)/baselineSum × 100`. The per-bucket % chart is `(v − b)/b × 100`, or 0 when b ≤ 0.
- **`totalKwh` = `sum`**. Its meaning changes with the aggregation: the Σ of 24 hourly means (≈ daily kWh for kW data), the Σ of 7 weekday means (≈ a week), or Σ months (the whole period).
- **`energyIntensity` = `sum / area_sqm`**, labelled "kWh/m²". Its meaning likewise changes with the aggregation (D-22).
- **Colours**: 6 HSL colours by index in the selection (`:55-62`, `:425-428`).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Export CSV | Button (`:178-186`) | Download the chart data | `handleExportCSV` (`:128-148`). Header `Period, "<shop> (<site>)"…`, values to 2 dp. Filename `cross-site-comparison-<agg>-<date>.csv`. Absolute values only, even in % view. Names are not CSV-escaped. | client | disabled with no data | — |
| Category filter | Select (`:196-208`) | Narrow the meter picker | `setCategoryFilter` | client; categories come from meters' `category_id` | — | — |
| Site filter | Select (`:214-226`) | Narrow the picker | `setSiteFilter` | client | — | — |
| Start Date / End Date | Popover calendars (`:231-263`) | Date window | `setDateFrom` / `setDateTo` | client filter | No from ≤ to check | — |
| Clear dates | Ghost button (`:264-275`) | — | reset both | — | — | — |
| Add Meter | Popover list (`:288-344`) | Pick a meter | `handleAddMeter` (`:102-107`) | — | disabled at 6. The list is all filtered meters with **no search box**, which is unusable with hundreds of meters (D-23). | "No meters available" |
| Selected meter chip | Clickable Badge (`:357-393`) | Toggle baseline | `handleSetBaseline` (`:118-126`) | — | Target icon plus ring on the baseline | "Select meters to start comparing" |
| Remove chip (X) | Button (`:382-392`) | Remove a meter | `handleRemoveMeter` (`:109-116`), which clears the baseline if it was the baseline | — | — | — |
| Aggregation | Button group (`:407-416`) | daily / weekly / monthly | `setAggregation` | — | — | — |
| Day Type | Button group (`:423-432`) | all / weekday / weekend | `setDayTypeFilter` | — | — | — |
| View Absolute / % vs Baseline | Button group (`:437-457`), only with a baseline | Toggle chart mode | `setShowPercentageView` | — | — | — |
| Line chart | Recharts (`:486-554`) | Overlay | The baseline is dashed and thicker. The y-axis label comes from `getYAxisLabel` (`:150-164`). A second `CartesianGrid horizontalPoints={[0]}` meant as a zero line does not do that (`:505-511`). | — | — | Spinner while loading; "No data available for the selected meters and filters" |
| Summary Statistics table | Table (`:561-648`) | Avg, Peak, Total kWh, vs Group Avg, vs Baseline, kWh/m² | — | — | kWh/m² column only when some meter has area | — |

The metadata list includes meters with no data at all (listed-only). Selecting one produces a flat zero line with no warning.

---

### C.14 `ExcelAuditReimport.tsx` (840 lines)

**Purpose.** Import a **metering-audit Excel workbook in "pivot" form** and overwrite (or create) meters' weekday/weekend profiles in bulk. In that form, rows are time slots (`00:00`, `00:30`…) and columns are meters.

**Queries / writes**
- `["all-meters-for-matching"]` (`:186-196`): `scada_imports.select("id, shop_name, meter_label, site_name, data_points, date_range_start, date_range_end").order(shop_name)`. **Capped at 1000 rows**, so meters beyond that can never be matched (D-12).
- Update path (`:526-537`): `scada_imports.update({raw_data: [metadata], data_points, load_profile_weekday, load_profile_weekend, weekday_days: 1, weekend_days: 0, updated_at}).eq("id", matchedMeterId)`.
- Insert path (`:547-559`): `scada_imports.insert({site_name: header, shop_name: header, file_name, raw_data: [metadata], data_points, load_profile_weekday, load_profile_weekend, weekday_days: 1, weekend_days: 0})`. There is **no `site_id`**, so the meter is unassigned and `site_name` is the column header.
- Writes run one at a time in a loop. Per-row failures are counted as "skipped" and only logged.
- After saving it invalidates `scada-imports`, `scada-imports-raw`, `meter-library`, `all-meters-for-matching` and `project-tenants`, then calls `onImportComplete` (switch to the Meter Library tab).
- The props `projectId` and `siteId` are declared and unused.

**File format and parse** (`handleFileUpload`, `:210-454`)
1. Accepts `.xlsx`, `.xls` or `.xlsm` (`:626`), with **no size limit**.
2. Reads with SheetJS `XLSX.read(buf, {type:"array", cellDates:true})`, **first sheet only** (`:222-226`). Converts with `sheet_to_json({header:1, raw:false, dateNF:"yyyy-mm-dd"})`, so every cell becomes a *display string*.
3. **Header detection** scans the first 10 rows (`:244-262`):
   - If `row[0]` matches `^\d{1,2}:\d{2}$`, the header row is `i-1`. If `i` is 0, the header row is 0, the time row itself, which consumes the first data row and names meters with numbers.
   - Otherwise, if `row[0]` contains "time" or equals "period", that row is the header.
   - Otherwise the header defaults to row 0.
   - Excel times formatted `h:mm:ss` or `hh:mm AM/PM` fail the regex.
4. Data rows are the rows after the header with more than one cell and a truthy first cell.
5. **Meter columns** are every column ≥ 1 with a non-empty header that is not a date header (contains "date" or looks like `YYYY-MM-DD`) and has a numeric value in its first 10 data rows (`:275-302`). Totals or "Grand Total" columns are **not excluded** and become meters (D-25).
6. **Interval**: 30 min if there are at least 40 unique time labels, else 60 (`:306-315`).
7. **Per column** (`:341-383`):
   - For each row with a valid time slot: `value = parseFloat(cell stripped of non-numeric)`.
   - Pushed into `weekdayHours[hour]` only. There is no date dimension, so every row counts as a weekday.
   - `totalKwh += value × interval/60`, which **assumes the cells are kW**.
   - `peakKw = max(value)`, `dataPoints++`.
   - `weekdayProfile[h] = mean of values in hour h`.
   - `weekendProfile[h]` is a **copy of the weekday value** (`:378-382`).
8. **Matching** (`findBestMatch`, `:67-117`). This is greedy, in column order, and each existing meter can be used once.
   - Normalise: lowercase, `_-.` → space, collapse spaces, **strip trailing digits** (`:57-64`). "Shop 12" and "Shop 13" normalise to the same "shop".
   - For each meter, compare against `shop_name`, `meter_label` and `site_name`:
     - Exact match scores 100 and returns immediately.
     - Containment in either direction scores `min/max length × 80`.
     - Word overlap (words longer than 2 chars) scores `common/max(words) × 60`.
   - The match is accepted if the score is at least 40.
   - Matching on **`site_name`** means a column named after the mall matches an arbitrary meter in it.
9. **Duplicates** (`detectDuplicates`, `:120-150`): column j is a duplicate of i when all 24 weekday values are within 0.01. All-zero columns are duplicates of each other.
   - Duplicate columns are **flagged after they have already consumed a matched meter id** (`usedIds.add` at `:387-389` runs before detection). The meter they consumed is then excluded from every manual dropdown.
10. **Auto-select** non-duplicate columns that have a match (`:429-435`). Unmatched columns default to "Create New Meter" but are not selected.

**What it overwrites.** For every matched meter:
- **`raw_data` is replaced by a metadata-only stub (shape F)**. All interval history is destroyed.
- `data_points` becomes the number of time slots (e.g. 48).
- Both profiles become the audit's typical day, with weekend identical to weekday.
- `weekday_days=1` and `weekend_days=0`.
- It does **not** touch `date_range_*`, so the old dates remain and misrepresent the new data. It does not touch `processed_at` or `detected_interval_minutes`.

Afterwards:
- Meter Library "Total kWh" shows one weekday's worth.
- Preview falls back to the summary profile.
- Analysis, Comparison, Stacking and Cross-Site show no data for the meter.
- The CSV in `scada-csvs` still exists, so "Configure" can rebuild the meter from the old CSV and silently undo the audit.

There is no undo, no backup of the previous values and no preview of what will change (D-7).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error & empty |
|---|---|---|---|---|---|---|
| Upload zone | Big outline button + hidden input (`:624-667`) | Choose a workbook | `fileInputRef.click` → `handleFileUpload` | client parse | disabled while parsing | toasts "Excel file appears to be empty…", "Failed to parse Excel file" |
| Clear file (X) | Nested Button inside the upload button (`:646-658`) | Reset | clears state with `stopPropagation` | — | — | A **button nested inside a button** is invalid HTML |
| Parse stats | Alert (`:671-685`) | Counts | — | — | — | `dateRange` is always "N/A" and never shown |
| Duplicate warning | Destructive Alert (`:688-697`) | — | — | — | — | — |
| Select-all | Checkbox (`:704-707`) | Toggle non-duplicate columns | `toggleSelectAll` (`:481-491`) | — | The `checked` expression uses **indices of the filtered array** (`:705`), so the displayed state is wrong whenever a duplicate precedes other columns (D-30) | — |
| Selection summary | Text (`:708-710`) | "n selected (m to update, k new)" | — | — | — | — |
| Save Selected | Button (`:712-728`) | Write to the database | `handleSave` (`:493-604`) | See above | disabled while saving or with nothing selected. **No confirmation** before overwriting. | Toast success lists updated/created/skipped. Per-row errors are not shown. |
| Progress bar | Progress (`:731-733`) | Save progress | — | — | — | — |
| Row checkbox | Checkbox (`:754-758`) | Include a column | `toggleSelect` | — | disabled for duplicates | — |
| Match To Meter | Select (`:783-810`) | Choose the target meter or "Create New Meter" | `updateColumnMatch` (`:456-467`) | — | Options exclude meters used by other columns. There is no search, which with hundreds of meters means a very long list. | Duplicates show "Skipped (Duplicate)" |
| Status badge | Display (`:814-828`) | Exact / Manual / Fuzzy (confidence %), New, or Duplicate | — | — | — | — |

---

### C.15 Orphaned components (unreachable from any route; document so they are not rebuilt by accident)

#### `ScadaImportsList.tsx` (503 lines)

A table of all imports that the rebuild does **not** need; `MeterLibrary` supersedes it.
- **Query** `["scada-imports", siteId]` (`:95-111`): `scada_imports.select("*, shop_type_categories(name)")`. That is **`select *`, including `raw_data` for every meter**, embedding the category name.
- **Controls**
  - Expand row (chevron, `:254-260`) shows mini TOU-coloured bar charts of both profiles, labelled kWh, with a tooltip per hour.
  - Eye (`:315-322`) opens a dialog with date/readings/day counts and a read-only `LoadProfileEditor`.
  - Trash (`:323-334`) runs `confirm` → `scada_imports.delete().eq(id)`.
  - "Recalculate All to kWh" (`:219-233`) runs `forceRecalculateAllProfiles` (`:117-150`). For every import with `raw_data` it recomputes profiles as the mean value per **UTC** hour (`getUTCHours`/`getUTCDay`, `:41-42`, which is 2 h off for SAST). Each reading uses the **first positive value** in `values` (a zero reading becomes the next column's value). Only shape C is valid; other shapes write zeros.
- The fragment `<>` in `.map` has no key (`:252`), which triggers React warnings.

#### `LoadProfileEditor.tsx` (391 lines)

An interactive 24-bar percentage editor with presets.
- **Props**: `weekdayProfile`, `weekendProfile`, `onWeekdayChange`, `onWeekendChange`, `readOnly` (`:9-15`).
- **Arrays**: two `number[24]` arrays in **percent of daily energy**, intended to sum to 100.
- **Presets** (`PROFILE_PRESETS`, `:20-80`): flat, restaurant, retail, office, supermarket, gym, cafe, cinema, hotel, warehouse. Raw weights are normalised to 100 by `normalizeToPercent` (`:83-87`). An all-zero profile falls back to flat 100/24.
- **Controls**
  - Preset Select (`:134-146`) → both profiles.
  - Reset (`:147-150`) → flat for the active tab.
  - "Copy to Weekend/Weekday" (`:151-153`).
  - Weekday/Weekend tabs (`:159-178`).
  - Drag canvas (`InteractiveChart`, `:195-391`): mouse down/move/up on window plus touch.
  - Footer: "Total: n%" and "Peak Hour" (`:180-183`).
- **Validation: none.**
  - A drag sets `profile[i] = y%` (0–100, one decimal) on a **display-normalised copy** (`:166,174`) and emits it un-normalised. On the next render the chart re-normalises, so the bar the user just dragged visibly jumps.
  - The total is shown but never enforced.
  - Hit-testing uses the container rect while bars sit in an inset area (`left-7 right-1 top-2 bottom-6`, `:355`), so the selected hour and value are offset from the pointer.
  - Touch handlers ignore `readOnly` (`:271-304`).
  - TOU colours are **hard-coded** (`:306-317`: peak 7-10 & 18-20, standard 6-7/10-18/20-22), unlike the configurable `getTOUPeriod` used elsewhere.
  - `maxValue` is unused (`:200`).

#### `PivotTable.tsx` (370 lines)

An hour × meter table of mean readings.
- **Query**: `scada_imports.select("id, site_name, shop_number, shop_name, meter_label, meter_color, raw_data")` for **all meters globally, with `raw_data`** (`:39-54`).
- The algorithm is the same as C.8 average mode (shape C only).
- It adds column totals (the Σ of 24 hourly means, labelled kWh) and a grand total.
- **Controls**: meter chips, Select All, Day Type, Generate, Export CSV (with a TOTAL row).
- `handleExportExcel` (`:192-196`) is a stub. It just exports CSV and shows the toast "Open the CSV in Excel", and it is not wired to any button.

#### `SiteManager.tsx` (319 lines)

An older site list and selector with an "All Sites" row.
- **Query** `["sites"]`: `sites.select("*")` plus `scada_imports.select("site_id")` with **no paging**, so counts are wrong above 1000 meters.
- **Form** fields: name, location, **total_area_sqm**, **description**. This is the only UI that ever wrote those two fields. `saveSite` inserts or updates and selects the new site.
- Delete uses `confirm`.
- Invalidating `["sites"]` elsewhere is a leftover from this component.

#### `CategoryMapper.tsx` (182 lines) and `ProfilePreviewCard.tsx` (271 lines)

Presentational helpers for the orphaned `loadprofiles/GoogleSheetsImport`. That component reads `shop_type_categories` (`GoogleSheetsImport.tsx:233`) and inserts into `shop_types` (`:253`).
- **CategoryMapper**
  - Lists the extraction categories with counts and a "new" flag.
  - Bulk remap From → To (`handleBulkRemap`, `:62-68`).
  - "Add New Category" input with Enter/Add (`:55-60`); duplicates are rejected against existing and new names.
  - Reference badges.
  - Purely callback-driven, with no database access.
- **ProfilePreviewCard**
  - Select checkbox.
  - Inline edit of the name (`:60-65`, non-empty).
  - Inline edit of `kwh_per_sqm_month` (`:67-73`, must be > 0).
  - Confidence badge (default 70; green ≥ 80, amber ≥ 60, red otherwise).
  - Warnings tooltip, mini weekday bars (values shown as %), expandable weekday/weekend bars, trading hours and source tab.
  - The `availableCategories` prop is unused. The category cannot be changed on the card.
- These are the only place in this slice where **shop-type profiles** (`kwh_per_sqm_month` + 24 h % arrays) appear. The live shop-type management is `src/components/projects/ShopTypesManager.tsx` (outside this slice).

#### `MeterAnalysisChart.tsx` (89 lines)

A Recharts `ComposedChart` bar of `amount` per `period`. It is only used by the orphaned `ScadaImport.tsx`.
- The props `meterNumber` and `isKvaMetric` are unused.
- `meterReading` is declared and configured, but no `<Line>` is rendered even though `Line` is imported (`:5`). That is a stub.

---

### C.16 Algorithms and semantics, consolidated

#### C.16.1 What `load_profile_weekday/weekend` means depends on the writer

| Writer | Values | Units | Sum over 24 h |
|---|---|---|---|
| `processCSVToLoadProfile` (`utils/csvToLoadProfile.ts:505-560`), used by both wizards, re-import, OneClick and Fix-30-min | Per hour: **power units** → mean of all readings in that hour across days; **energy units** → Σ readings in that hour ÷ number of days | kW (the average demand in that hour) | ≈ kWh/day |
| `SitesTab.processWithColumn` (`SitesTab.tsx:601-655`), via the Reprocess button | Mean per hour, then **normalised so the 24 values sum to 100** and rounded to 2 dp | **percent of daily energy** | 100 |
| `ExcelAuditReimport` (`:365-383`) | Mean of the audit cells per hour; weekend = weekday | kW if the audit is in kW | ≈ kWh/day |
| `ScadaImportsList.forceRecalculateAllProfiles` (orphan, `:35-64`) | Mean per UTC hour of the first positive value | whatever the SCADA column was | — |
| `LoadProfileEditor` (orphan) | User-drawn | percent | 100 (not enforced) |
| Listed-only placeholders (`SheetImport`, other part) | "May contain estimated profiles" (`SitesTab.tsx:129`) | unknown | — |

**Every consumer assumes kW-per-hour.** The kWh/day totals in Meter Library, SiteMeterOverview daily kWh and top consumers, MeterProfilePreview fallback, and TOU charts all make that assumption. A meter that has been "Reprocessed" from SitesTab therefore shows about 100 kWh/day and a "Peak kW" of a few units, whatever its real size (D-3).

#### C.16.2 Typical weekday/weekend 24 h profile

- The canonical path is `processCSVToLoadProfile`.
- Weekend is Saturday + Sunday via `isWeekend(row.date)`.
- The day key is `row.date.toISOString().split('T')[0]` (`csvToLoadProfile.ts:484`). That is the **UTC date of a local timestamp**, so in SAST a reading at 00:00–01:59 local is counted against the *previous* date for the day tallies (see the parser part).
- There are **no public holidays**; holidays count as weekdays.
- There is no seasonal split.
- **Monthly** views are computed only on the fly from `raw_data` (C.12, C.13) and never stored.

#### C.16.3 Peak detection

There is no true maximum-demand calculation anywhere in this slice. The variants are:

| Where | "Peak" is |
|---|---|
| Meter Library column | `max(load_profile_weekday)`: the highest *average* weekday hour (`MeterLibrary.tsx:1708`) |
| SiteMeterOverview | argmax of the summed weekday profile (`:121-127`) |
| Daily preview | maximum hourly *mean* in that day (`useDailyConsumption.ts:124-128`) |
| Monthly preview | maximum single raw reading in the month (`useMonthlyConsumption.ts:226`) |
| Excel audit | maximum cell (`:360`) |
| Stacking / Comparison / Cross-site | maximum of the aggregated bucket |

#### C.16.4 kWh/m²

- `MeterProfilePreview.tsx:513-517`: monthly total ÷ `area_sqm`.
- `useCrossSiteComparison.ts:367`: aggregation-dependent `sum` ÷ `area_sqm`.
- The dead `getMonthlyKwhEstimate` has an area-based VA/m² method (C.11.4).
- Shop-type `kwh_per_sqm_month` appears only in the orphaned Google-Sheets cards.

#### C.16.5 Interval detection

`SitesTab.detectDataIntervalLocal` (`:477-534`):
- Samples the first 200 points.
- Takes positive diffs of 240 minutes or less.
- Rounds each to the nearest of {1, 5, 10, 15, 30, 60, 120, 180, 240}.
- Takes the mode, defaulting to 60.

This is duplicated from `utils` (the parser part).

#### C.16.6 Unit conversion

`SitesTab.tsx:450-474`:
- W ÷ 1000, MW × 1000, kVA × PF.
- A → `√3·V·I·PF/1000` (defaults V = 400, PF = 0.9).
- Wh ÷ 1000, MWh × 1000, kVAh × PF.

#### C.16.7 Timezone

Everything uses the browser's local time. There is no explicit site timezone.
- `new Date("YYYY-MM-DD")` is UTC and is mixed with local getters (C.13).
- `ScadaImportsList` uses UTC getters.
- SA data only behaves correctly on SAST machines.

---

### C.17 Supabase access catalogue (this slice)

| Table / resource | Op | Where | Filter / shape |
|---|---|---|---|
| `sites` | select `id, name, total_area_sqm` | Dashboard `:17` | none |
| `sites` | select `*` order name | SitesTab `:100-103`, SiteManager `:43-46` | — |
| `sites` | select `id, name` | MeterLibrary `:158-161`; useCrossSite `:95-97,141-143` | — |
| `sites` | insert / update / delete | SitesTab `:191-218`, `:1616-1619`; SiteManager `:76-105` | `eq id` |
| `scada_imports` | select counts (`head:true`, exact) + paged `range` | SitesTab `:108-126` | — |
| `scada_imports` | select metadata (no `raw_data`) | Dashboard `:18,73-76`; SitesTab `:171-175`; MeterLibrary `:172-180` (limit 5000); useCrossSite `:76-90`; Excel `:189-192` | `site_id` eq where applicable |
| `scada_imports` | select **with `raw_data`**, many rows | SiteMeterOverview `:50-54`; MeterAnalysis `:224-231`; ProfileStacking `:88-95`; MeterComparison `:52-59`; useCrossSite `:121-136` (≤ 6 ids); MeterLibrary Fix-30-min `:602-606`; PivotTable/ScadaImportsList (orphans) | by site / all |
| `scada_imports` | select `raw_data` single | SitesTab `:353-357,550-554,1000-1004`; MeterLibrary `:849-853`; useDaily `:58-62`; useMonthly `:148-152` | `eq id` |
| `scada_imports` | select `id` where `processed_at is null` `in(ids)` | MeterLibrary `:826-830` (+ dead `:259-277`) | — |
| `scada_imports` | update profile fields | SitesTab `:421-430,661-675,1131-1144`; MeterLibrary `:741-753,991-1004`; Reimport `:97-110`; Excel `:526-537` | `eq id` |
| `scada_imports` | update metadata | MeterLibrary `:189-199` | `eq id` |
| `scada_imports` | **global** update `processed_at=null` | MeterLibrary `:1064-1067` | `not processed_at is null` |
| `scada_imports` | insert | Excel `:547-559` | — |
| `scada_imports` | delete | SitesTab `:232,245,304`; MeterLibrary `:215,229`; ScadaImportsList `:154` | `eq` / `in` |
| `scada_imports` | update `csv_file_path` | `utils/csvStorage.ts:31-34` (called from the wizard saves) | — |
| `stacked_profiles` | select / insert / delete | ProfileStacking `:121-160` | `eq project_id` |
| `projects` | select `id, name` | ProfileStacking `:109-112` | — |
| `shop_type_categories` | select `id, name` | useCrossSite `:100-102`; ScadaImportsList embed `:100` | — |
| Storage `scada-csvs` | upload (`upsert:true`) / download | `utils/csvStorage.ts:21-23,62-64` via SitesTab/MeterLibrary | path `meters/{id}/{ts}_{name}` |
| Edge fn `get-mapbox-token` | invoke | SiteLocationMap `:60`, SitesMapView `:75` | — |
| Edge fn `google-places-search` | invoke `{query}` / `{place_id}` | SiteLocationMap `:163,187`, SitesMapView `:264,290` | — |

None of these queries uses an RPC or server-side aggregation. All aggregation happens in the browser.

---

### C.18 Defects, gaps and risks (numbered for cross-reference)

#### Broken functionality

- **D-1: Site Detail "Process All" and per-row "Configure" do nothing visible.**
  - `CsvImportWizard` is rendered only in the Sites List branch (`SitesTab.tsx:1877-1885`), while the buttons live in the early-returned detail branch (`:1260-1611`).
  - The queue state is set and the spinner shows. The wizard appears only if the user goes Back to the list.
- **D-2: Dead but dangerous batch reprocessor.** `MeterLibrary.reprocessMeters` (`:244-594`) is never called and would wipe `raw_data` to `[]`. Delete it rather than rebuild it.
- **D-3: Profile-unit corruption from SitesTab "Reprocess".**
  - `processWithColumn` stores profiles normalised to 100 % (`SitesTab.tsx:646-655`).
  - Every other writer and every consumer uses kW. Totals, peaks, stacking and project profiles built from such meters are wrong.
  - The same flow first nulls the profile (`:421-430`) without checking the error. A failure part-way leaves the meter with no profile.
- **D-4: Four screens ignore the canonical `raw_data` shape.**
  - Shape B `{date,time,value}` is what every current save writes. It is not understood by MeterAnalysis (meters are hidden), MeterComparison and ProfileStacking (silent zeros), or the orphaned PivotTable.
  - Cross-Site ignores shape A. Nothing understands shape F.
  - A rebuild must define **one** interval-data store and one reader.
- **D-5: MeterAnalysis "Daily" aggregation merges days across months** (key `format(date,"d")`, `:319`). The "Hourly" labels sort alphabetically across months.
- **D-6: ProfileStacking "Sum" is not a daily profile.** It sums every day's readings per hour, yet is labelled "Daily Total … kWh".
- **D-7: Excel Audit Reimport is destructive.**
  - It replaces `raw_data` with metadata (interval history lost).
  - It sets `weekday_days=1, weekend_days=0` and copies weekday to weekend.
  - It leaves stale `date_range_*`.
  - It matches on `site_name` and strips trailing digits (so "Shop 12" and "Shop 13" collide).
  - It turns total columns into meters and creates meters with no `site_id`.
  - It gives no confirmation, diff or undo.
  - A later "Configure" from the retained CSV silently reverses the audit.
- **D-8: Stale closure in the Add/Edit Site map.**
  - The map click calls the `onLocationChange` captured when the Mapbox token loaded (`SiteLocationMap.tsx:99-106`).
  - SitesTab's handler spreads the `formData` from that render (`SitesTab.tsx:1715`).
  - Clicking the map after typing a name can revert the name, location and type to their earlier values.
- **D-9: Map-click pin placement never works in `SitesMapView`.** The click handler reads the initial `isPlacingPin`/`siteWithoutLocation` (`:125-140`). Only search works.
- **D-10: `MeterReimportDialog` omits key fields.**
  - It does not set `processed_at`, does not store the CSV in `scada-csvs`, does not set interval or unit, and does not invalidate `sites-with-stats`.
  - The meter stays "unprocessed", and later "Configure" has no source.
- **D-11: "Clear Processed" is global.** It updates every processed meter in the database regardless of filters (`MeterLibrary.tsx:1064-1067`).
- **D-12: 1000-row truncation.**
  - `.limit(5000)` does not exceed the Supabase `max-rows` default of 1000 (MeterLibrary `:176`).
  - Unpaged reads: Dashboard, SiteManager, useCrossSite metadata, Excel matching list, site-meters, and every `raw_data` list.
  - Only SitesTab's site stats page correctly.
- **D-13: "Previous processing config" is inert.** It is read from `raw_data[0].processingConfig` (`MeterLibrary.tsx:871`) but never written. `ColumnSelectionDialog`'s `initial*` props are never passed.
- **D-14: "Fix 30-min Averaging" has no confirmation.**
  - It is global and forces `kW`, which **halves** profiles for kWh-per-interval meters.
  - It pulls the `raw_data` of all 30-min meters in one request.
- **D-15: Stored XSS.** Site names are interpolated into `innerHTML` for map markers (`SitesMapView.tsx:163-187`).
- **D-16: Preview state leaks between meters.** `useDailyConsumption`/`useMonthlyConsumption` keep `selectedDate`/`selectedMonth` across meters, and have no fetch-race guard.
- **D-17: Safari breaks monthly figures for shape-B data.** `new Date("YYYY-MM-DD HH:MM:SS")` returns Invalid Date (`useMonthlyConsumption.ts:85`).
- **D-18: Inconsistent energy maths in the same modal.**
  - The daily hook assumes kW and scales by interval.
  - The monthly hook assumes kWh and sums raw values.
  - Cross-site weekly and monthly sum raw values while labelling them kWh.
  - A rebuild must store the value unit with the series and integrate once.

#### Performance

- **D-19: Unbounded `raw_data` downloads.**
  - Overview, Analysis, Stacking and Comparison each fetch every site meter's full jsonb, and Analysis parses every CSV on load.
  - The preview downloads the same blob twice.
  - Cross-site refetches all selected blobs on every add or remove.
- **D-20: SiteMeterOverview fetches `raw_data` and never uses it.**

#### Correctness and UX gaps

- **D-21: Timezone mixing.** UTC-midnight dates are read with local getters in cross-site filters, UTC getters are used in ScadaImportsList, and the parser uses a UTC date key. There is no site timezone.
- **D-22: Cross-site "Total kWh" and "kWh/m²" change meaning** with the aggregation mode. "Average kW" is labelled regardless of the source unit.
- **D-23: Meter pickers have no search.** This affects Cross-site Add Meter, the Excel "Match To Meter" select, and the Stacking tile grid, and they are unusable at scale.
- **D-24: Empty states point to a non-existent "New SCADA Import" tab** (MeterLibrary `:1559`, MeterAnalysis `:494`).
- **D-25: Excel audit accepts total columns as meters.** It also accepts only the first sheet and only `H:MM` time labels.
- **D-26: ProfileStacking double-toggle.** Clicking the tile's checkbox toggles twice through bubbling (`:560-565`).
- **D-27: Comparison divide-by-zero.** `diffPercent` is NaN or Infinity when meter B totals 0.
- **D-28: CSV exports don't escape names.** This affects Comparison, Stacking, Cross-site, SiteMeterOverview and Analysis.
- **D-29: Hidden selections survive filtering in MeterLibrary.** Filters do not clear the selection, so bulk delete or process can act on meters no longer shown.
- **D-30: Excel select-all shows the wrong state.** Its checked state uses filtered indices.
- **D-31: Duplicate deletion is too aggressive.** SitesTab groups by name only, falls back to the site name, and confirms with only a count.
- **D-32: Site metadata gaps.**
  - The active site form cannot edit `total_area_sqm` or `description`, yet the Dashboard sums area.
  - Meters cannot be (re)assigned to a site or category from any live screen.
  - There is no "unassigned meters" filter.
- **D-33: Stale query invalidation.** Several flows invalidate `["sites"]` or `["scada-imports"]`, which nothing live uses, instead of `["sites-with-stats"]`, `["site-meters-overview"]`, `["scada-imports-raw"]` and so on. Counts go stale until a refetch.
- **D-34: Storage orphans.** Deleting a meter never removes its `scada-csvs` object(s). Each wizard save uploads a *new* timestamped object, so multiple CSVs accumulate per meter.
- **D-35: Native `confirm()` everywhere for destructive actions**, with no undo.

#### Security

- **D-36: No data isolation.**
  - All `sites`, `stacked_profiles` and `shop_type_categories` policies are `USING (true)` for any role, including anon per the policy names.
  - `scada_imports` is open to any authenticated user.
  - All deletes, including bulk and global updates, are issued from the client with no ownership check.
  - The stacking project selector lists every project in the database.
- **D-37: Google Places requests are unmetered.** Search goes through the `google-places-search` edge function on every debounced keystroke (≥ 3 chars) with no rate limiting on the client.

#### Hard-coded values to lift into configuration

| Value | Where |
|---|---|
| `SA_CENTER=[24,-29]`, zoom 5/12/14, Mapbox style `satellite-streets-v12` | SiteLocationMap, SitesMapView |
| Palettes (`METER_COLORS`, `DEFAULT_COLORS`, `CHART_COLORS`, `QUANTITY_COLORS`) | MeterLibrary, SiteMeterOverview, CrossSite, MeterAnalysis |
| `MAX_METERS=6` | CrossSite |
| `BATCH_SIZE=20` | MeterLibrary |
| Interval standards list, default V = 400 and PF = 0.9 | SitesTab |
| 30 days/month | SiteMeterOverview |
| Month ≥ 5 days listed, ≥ 20 days preferred | useMonthly |
| Match threshold 40, scores 100/80/60, duplicate tolerance 0.01, 40-slot 30-min rule | Excel audit |
| Area-estimate constants | dead `getMonthlyKwhEstimate` |
| TOU hours | `LoadProfileEditor` (orphan) |
| Validation peak limit 100 000 kW | `validateLoadProfile` |

---

### C.19 Notes for the rebuild (what to keep, what to drop)

**Keep, as product intent**
- Site CRUD with a map pin and place search.
- A meter library with search, filter, sort and bulk actions.
- A per-meter preview with daily and monthly views and TOU shading.
- A site aggregate overview.
- Single-meter time-series analysis.
- Multi-meter stacking with saved sets.
- Two-meter and cross-site (≤ N) comparison with a baseline %.
- Bulk update from an audit workbook, but non-destructive.

**Drop, as unreachable or superseded**
- ScadaImportsList, PivotTable, SiteManager, loadprofiles/GoogleSheetsImport (+ CategoryMapper, ProfilePreviewCard), MeterAnalysisChart, and ScadaImport, unless the parser part says otherwise.
- The dead `reprocessMeters`, `getMonthlyKwhEstimate`, `parseCsvContent` and `processMeter`.

**Fix by design, not by patch**
1. **One interval store.** Put intervals in a separate table or file (e.g. `meter_readings(meter_id, ts timestamptz, value, unit)`), not a jsonb blob. Record the unit and interval explicitly. Keep the site timezone on `sites`.
2. **One profile semantic.** Store 24 h profiles in kW, with an explicit "%-shape" only for templates.
3. **Server-side aggregation** (RPC or views) for daily, monthly, stacking, comparison and pivot, with pagination for lists.
4. **Tenant scoping and RLS by organisation.** Soft-delete with undo for destructive actions.
5. **One wizard host** that is mounted regardless of screen.
6. **Audit re-import** as a preview-and-diff step that writes a new profile version rather than overwriting raw data.


---

## Part D — File formats, parsing, normalisation, data model, downstream shape

> Scope: how load-profile data gets into WM Solar (CSV / Excel / Google Sheets / SCADA exports), how it is parsed and normalised, what is stored, and what shape downstream simulation, tariff and proposal code actually consumes.
> All paths are relative to the repo root (`wmsolar-main/`). `file:line` citations are against the snapshot reviewed on 2026-09-28. There was no git history, so "the recent fix" is described from the code as it stands now.
> Two warnings before reading any section:
> 1. **There are at least six independent CSV parsers** that do not agree with each other on column detection, date order, unit handling or aggregation. Section D.3 lists every one of them.
> 2. **`scada_imports.load_profile_weekday/weekend` has three incompatible meanings** depending on which code path last wrote it: kW per hour, kWh per interval, or a percentage of the day. Downstream code cannot tell which one it has. Section D.9 covers this.

---

### D.0 Map of the import surfaces (live vs orphaned)

| Surface | File | Mounted? | Where the user reaches it | What it writes |
|---|---|---|---|---|
| Text Import Wizard (4-step, Excel-style) | `src/components/loadprofiles/CsvImportWizard.tsx` | **Live**, reused by 4 hosts: `MeterLibrary.tsx:1905`, `SitesTab.tsx:1877`, `MeterReimportDialog.tsx:213`, `projects/ShopTypesManager.tsx:377` (plus orphaned `ScadaImport.tsx:698`) | "Process / Configure" on a meter in Load Profiles → Sites or Meter Library; Shop Types CSV import | Hands `WizardParseConfig` + parsed rows to the host. The host calls `processCSVToLoadProfile` and writes `scada_imports` |
| Bulk CSV dropzone | `loadprofiles/BulkCsvDropzone.tsx` | **Live**: `MeterLibrary.tsx:1299`, `SitesTab.tsx:1572` | Drag/drop many CSVs | One **new** `scada_imports` row per file, plus the CSV in the `scada-csvs` bucket |
| One-Click Batch Processor | `loadprofiles/OneClickBatchProcessor.tsx` | **Live**: `MeterLibrary.tsx:1490` | Select meters → one-click processing | Updates existing rows. Only works for legacy rows that still hold `raw_data[0].csvContent` |
| Column Selection Dialog | `loadprofiles/ColumnSelectionDialog.tsx` | **Live**: `SitesTab.tsx:1598` | "Reprocess" on a site meter | Calls `SitesTab.handleColumnSelected` → `processWithColumn`, which writes a **percentage** profile (see D.9) |
| Sheet (Excel) Import — sites and shops register | `loadprofiles/SheetImport.tsx` | **Live**: `SitesTab.tsx:1745` | "Import Sites & Shops from Excel" | `sites` rows plus **placeholder** `scada_imports` rows (no interval data) |
| SCADA Import (server-processed) | `loadprofiles/ScadaImport.tsx` | **Orphaned.** Nothing imports it; it appears only in a code-review file list at `code-review/ProjectFileBrowser.tsx:78` | — | It would call the `process-scada-profile` edge function |
| CSV Parse Dialog | `loadprofiles/CsvParseDialog.tsx` | **Orphaned.** Never rendered | — | Would return a `ParseConfiguration` for the edge function |
| Google Sheets load-profile import (AI) | `loadprofiles/GoogleSheetsImport.tsx` | **Orphaned.** `pages/TariffManagement.tsx:8` imports `components/tariffs/GoogleSheetsImport`, which is a different component | — | Would call `ai-import-loadprofiles` and write `shop_types` |
| Project bulk upload (the live project path) | `projects/ScadaImportWizard.tsx` + `projects/TenantManager.tsx:729-900` | **Live** (outside this slice's file list; summarised because it writes the same table) | Project → Tenants → Bulk Upload | Two `scada_imports` rows per file (a project copy and a global copy) plus `project_tenants` |
| Shared utils | `loadprofiles/utils/sharedParsingUtils.ts` | **Dead in production.** Only `simulation/test_extraction_suite.ts:1` imports it | — | — |
| Fuzzy filename→meter matcher | `loadprofiles/utils/fuzzyMatcher.ts` | **Dead.** No importer anywhere | — | — |
| Edge functions | `supabase/functions/process-scada-profile` (called only by the orphaned ScadaImport), `ai-import-loadprofiles` (called only by the orphaned GoogleSheetsImport), `normalise-raw-data` (no caller in `src`; a one-off migration job), `ai-import-sheet` and `import-google-sheet` (**tariff** imports used by `components/tariffs/*`, not load profiles), `upload-generation-csv` (generation/council actuals, external API) | | | |

**What this means in practice:** every live load-profile import runs **in the browser** through `processCSVToLoadProfile` (`utils/csvToLoadProfile.ts:320`). The one exception is the SitesTab "Reprocess" path, which uses its own inline algorithm (`SitesTab.tsx:537-687`). The documented "server-side processing for ≥10,000 rows" does not exist in any live path.

---

### D.1 Data model

#### D.1.1 `public.scada_imports` — one row per meter (the load-profile store)
Created in `supabase/migrations/20251208061157_*.sql:2-31`. Columns were added later (see the "added in" column). Generated types are at `src/integrations/supabase/types.ts:1884-1910`.

| Column | Type | Default / constraint | Added in | Meaning / who writes it |
|---|---|---|---|---|
| id | uuid PK | gen_random_uuid() | 20251208061157 | |
| site_name | text NOT NULL | — | 20251208061157 | Bulk: file name without `.csv` (`BulkCsvDropzone.tsx:385-390`) |
| shop_number | text | | 20251208061157 | SheetImport "Breaker" column (`SheetImport.tsx:653,685`) |
| shop_name | text | | 20251208061157 | |
| file_name | text | | 20251208061157 | Also used as the upsert key in the project path (`TenantManager.tsx:811-816`) |
| raw_data | **jsonb** | null | 20251208061157 | Interval data. See D.1.3 for the five shapes found in production |
| load_profile_weekday | numeric[] | **`ARRAY[4.17 ×24]`** | 20251208061157 | "Cached 24-hour profile". Default is 100/24 %, a *percentage* placeholder |
| load_profile_weekend | numeric[] | **`ARRAY[4.17 ×24]`** | 20251208061157 | Same |
| data_points | integer | 0 | 20251208061157 | Count of parsed rows (**not** rows stored in raw_data; see the 5 000 cap in D.3.6) |
| date_range_start / _end | date | | 20251208061157 | |
| weekday_days / weekend_days | integer | 0 | 20251208061157 | Distinct dates per day type |
| category_id | uuid → shop_type_categories ON DELETE SET NULL | | 20251208061157 | |
| created_at / updated_at | timestamptz | now(), trigger | 20251208061157 | |
| project_id | uuid → projects ON DELETE SET NULL | | 20251209051034 | NULL means "global library" meter |
| meter_label | text | | 20251209051034 | |
| meter_color | text | '#3b82f6' | 20251209051034 | |
| area_sqm | numeric | | 20251209135505 | Used for area scaling downstream |
| site_id | uuid → sites; FK re-created **ON DELETE CASCADE** | | 20260108035004, 20260114155508 | Deleting a site deletes its meters |
| processed_at | timestamptz | NULL ("never processed") | 20260113164645 | |
| detected_interval_minutes | integer | NULL | 20260114101546 | Written by Bulk, TenantManager and SitesTab reprocess only. **Not** written by the wizard hosts (MeterLibrary/SitesTab `handleWizardProcess`), OneClick or ScadaImport |
| value_unit | text | **'kWh'** | 20260223075424 | **Written only by `SitesTab.processWithColumn` (`SitesTab.tsx:673`).** Every other writer leaves the default 'kWh', even for kW/W/A files |
| csv_file_path | text | | 20260305094301 | Storage path in the `scada-csvs` bucket (`utils/csvStorage.ts:31-34`) |

Indexes: site_name, shop_name, project_id, site_id, processed_at. There is **no uniqueness** on (site_id, shop_name), (project_id, file_name) or anything else, so duplicates are prevented only by client-side checks.

RLS (`20251215032623_*.sql:28-53`): SELECT, INSERT, UPDATE and DELETE are all allowed `TO authenticated USING (true)`. There is no org or owner scoping: any signed-in user can read or overwrite any meter.

#### D.1.2 Related tables

| Table | Key columns (types) | Source | RLS |
|---|---|---|---|
| `sites` | id uuid, name text NOT NULL, description, location text, total_area_sqm numeric, site_type text (20260108040718), latitude/longitude numeric (20260201143954), created_at/updated_at | `20260108035004_*.sql:2-11` | **"Anyone can …" — anon read/insert/update/delete** (`:16-19`) |
| `shop_types` | id, name NOT NULL, description, load_profile_weekday/weekend numeric[] **NOT NULL DEFAULT 4.17×24** ("percentage of daily consumption per hour"), kwh_per_sqm_month numeric NOT NULL DEFAULT 50, category_id → shop_type_categories (20251205042731) | `20251205041711_*.sql:14-24` | anon full CRUD (`:76-79`) |
| `shop_type_categories` | id, name NOT NULL, description, sort_order | `20251205042731_*.sql:2` | anon full CRUD (`:16-19`) |
| `project_tenants` | id, project_id → projects CASCADE, shop_type_id → shop_types, name NOT NULL, area_sqm numeric NOT NULL, monthly_kwh_override numeric, scada_import_id → scada_imports ON DELETE SET NULL (20251213043700), shop_number/shop_name (20260130084023), include_in_load_profile bool NOT NULL DEFAULT true, is_virtual bool NOT NULL DEFAULT false (20260220130602), cb_rating text (20260223081352) | `20251205041711_*.sql:28-37` | anon full CRUD (`:81-84`) |
| `project_tenant_meters` (the "tenant meters" multi-meter link) | id, tenant_id → project_tenants CASCADE, scada_import_id → scada_imports CASCADE, weight numeric, created_at | `20260113064133_*.sql:2-10` | "Allow … " USING(true), with no role clause, so anon has access (`:15-33`) |

#### D.1.3 What is stored raw vs processed

- **Processed:** the two 24-element arrays, `data_points`, the date range, day counts, `detected_interval_minutes` and `value_unit`.
- **Raw (`raw_data` jsonb)**: five shapes exist, depending on the writer and the era. `normaliseRawData` (`utils/normaliseRawData.ts:26-191`) exists to read all of them:
  1. **Canonical** `[{date:"YYYY-MM-DD", time:"HH:MM:SS", value:number}]`. Written by the wizard hosts, OneClick, ScadaImport and Bulk (Bulk builds it inline, `BulkCsvDropzone.tsx:393-423`).
  2. Canonical plus extra keys (`timestamp`, `kva`, `meterId`, `originalLine`): the edge-function output shape (`process-scada-profile/index.ts:598-606`).
  3. **Wizard/legacy** `[{timestamp:"<date> <time>", value}]`. **Still written by the live project path** `TenantManager.tsx:778-782`, which is not normalised.
  4. **Embedded CSV** `[{csvContent:"<whole file>", processingConfig?:{column,unit,voltageV,powerFactor}}]`. This is the legacy shape; OneClick (`OneClickBatchProcessor.tsx:328-329`), MeterLibrary batch (`MeterLibrary.tsx:360-361, 641-642`) and SitesTab reprocess (`SitesTab.tsx:574-578`) still depend on it. TenantManager falls back to it when it cannot detect columns (`TenantManager.tsx:783`).
  5. `[]` (empty). Written by the MeterLibrary batch reprocess, which deliberately clears interval data "to save space" (`MeterLibrary.tsx:499-500, 520`). **This destroys raw data** for every downstream raw-data consumer.
  - Summary-only objects `[{totalKwh,…}]` are recognised and treated as empty (`normaliseRawData.ts:184-188`).
- **Values in `raw_data` are the raw column values, not unit-converted** (e.g. `BulkCsvDropzone.tsx:396`, `MeterLibrary.tsx:976`, `SitesTab.tsx:1124`). A W or A file stores W or A. The only exception is `SitesTab.parseCsvContentWithColumn`, which converts. Downstream code interprets raw values through `value_unit`, and that is 'kWh' for almost every row (D.1.1). So **raw_data of kW/W/A meters is mis-interpreted as kWh downstream**.
- **Original file:** the storage bucket `scada-csvs` (`20260220064250_*.sql:3-19`): private, with INSERT/SELECT/DELETE for any `authenticated` user (no path scoping, no UPDATE policy). Path is `meters/{meterId}/{Date.now()}_{safeName}` (`csvStorage.ts:15-18`), with the name sanitised to `[a-zA-Z0-9._-]` and capped at 100 characters. Upload is fire-and-forget after the DB write (`BulkCsvDropzone.tsx:458`, `ScadaImport.tsx:331`, `MeterLibrary.tsx:1012`, `SitesTab.tsx:1152`). **Every reprocess uploads another copy and nothing deletes old ones.** `csv_file_path` points only at the latest. The bucket has no file size limit and no MIME restriction.

#### D.1.4 Sizes and limits
- Array lengths: every live writer produces **24** elements. Readers also accept 48 and 96 (`projects/load-profile/hooks/useLoadProfileData.ts:23-36, 63, 224, 331`) and resample other lengths (`:41-51`). No writer in the codebase produces 48 or 96.
- raw_data row size is about 50 bytes per point as JSON (`{"date":"2024-01-01","time":"00:30:00","value":12.34}`). One year at 30 minutes (17 520 points) is about 0.9 MB. At 15 minutes (35 040) about 1.75 MB. At 5 minutes (105 120) about 5 MB. At 1 minute (525 600) about 26 MB. Every save sends the whole array in one PostgREST request (single `insert`/`update`, no batching: `BulkCsvDropzone.tsx:387-426`, `MeterLibrary.tsx:991-1004`), and it is TOAST-stored in one jsonb value.
- `useRawScadaData` pulls `raw_data` for **every** tenant-linked meter in one query (`projects/load-profile/hooks/useRawScadaData.ts:41-45`). A 100-meter mall at 15-minute resolution is roughly 175 MB of JSON into the browser.
- No client-side file-size or row-count limit exists anywhere (grep found no `file.size` gate). `file.text()` / `FileReader.readAsText` loads the whole file, and `split('\n')` duplicates it in memory several times (lines, parsed rows, `parsedRows`, the raw_data array).
- The edge function truncates the returned raw data to **5 000 points** (`process-scada-profile/index.ts:639`) while reporting the full `dataPoints`.
- `upload-generation-csv` inserts readings in batches of 500 (`upload-generation-csv/index.ts:320-324`). OneClick "BATCH_SIZE = 10" (`OneClickBatchProcessor.tsx:29`) is still sequential, one meter at a time with a 200 ms pause between batches.

---

### D.2 Accepted file formats and detection

#### D.2.1 Extensions and inputs by surface

| Surface | Accepted | Reader |
|---|---|---|
| CsvImportWizard | Whatever the host passes (text) | Host reads text |
| BulkCsvDropzone | `.csv` input (`:562`). Drop filter: name ends `.csv` OR MIME `text/csv` / `application/vnd.ms-excel` (`:227-231`) | `file.text()` (`:243`) |
| ScadaImport (orphan) | `.csv` (`:392`) | FileReader text (`:109-151`) |
| SheetImport | `.xlsx,.xls,.csv` (`:865`) | SheetJS `XLSX.read(arrayBuffer,{type:"array"})`, **first sheet only** (`:360-363`) |
| Project ScadaImportWizard | `.csv,.xlsx,.xls` (`projects/ScadaImportWizard.tsx:849`) | Excel converted with `XLSX.read(...,{cellDates:true})` + `sheet_to_csv` of the **first sheet** (`:208-209`) |
| Google Sheets (orphan load-profile AI; live tariff) | Sheet URL → `/spreadsheets/d/{id}` regex (`GoogleSheetsImport.tsx:70-73`) | Sheets API v4 through a service account, range `A1:AZ500` for **every tab** (`ai-import-loadprofiles/index.ts:415`) |

Excel is only supported in SheetImport (a sites/shops register, not interval data) and in the project wizard (first sheet, flattened to CSV). The Load Profiles module has no Excel interval import.

#### D.2.2 Delimiter detection — six different algorithms

| Where | Algorithm |
|---|---|
| `CsvImportWizard.tsx:96-122` | Looks only at the header line (`startRow`). Any tab, semicolon or comma present turns that checkbox on. Several can be on at once (so a comma inside a semicolon file also splits). Default is comma. Space and pipe are never auto-detected |
| `CsvImportWizard.parseWithConfig` `:136-148` | Builds a regex alternation of the checked delimiters plus an escaped "Other" char. **"Treat consecutive delimiters as one" has no effect:** the regex is tested against one character at a time (`:168`), so `a,,b` still yields `["a","","b"]` |
| `BulkCsvDropzone.autoDetectConfig` `:48-109` | A `sep=X` first line sets the delimiter to X. Otherwise it samples the **first data line** after the header: tab if the tab count is greater than both other counts, else semicolon if semicolons outnumber commas, else comma |
| `OneClickBatchProcessor.autoParseCSV` `:166-188` | Sample is the header line. A delimiter is enabled if it appears **2 or more** times; comma is the fallback; pipe is supported through "other" |
| `ColumnSelectionDialog.parseCSVColumns` `:71-74` and `SitesTab.parseCsvContent` `:707-710` | Tab if present; `;` only if there is no comma; else comma. Rows are split with naive `split(separator)`, so quoted commas break columns |
| `sharedParsingUtils.detectDelimiter` `:59-73` and `process-scada-profile detectDelimiter` `:135-153` | Counts `\t ; , \|` over the first 10 lines and takes the maximum. The comment says space is supported but it is never counted. The server row split is naive `split(delimiter)` (`:485`), which is not quote-aware; `' '` splits on `/\s+/` |

Quote handling: only the wizard, Bulk, OneClick and MeterLibrary have a quote-aware char loop (`"` qualifier, `""` escape). The wizard also offers `'` or none. None of them support newlines inside quoted fields, because the file is split on `\n` first.

`sep=` handling: the wizard strips leading `sep=` lines and re-bases the header index (`:128-134, 184`). Bulk uses it to set the delimiter. ColumnSelectionDialog skips it. The server filters any line starting `sep=` (`:424, 463`). OneClick and MeterLibrary batch do **not** handle it.

BOM (`﻿`): stripped **only** server-side (`process-scada-profile/index.ts:423, 462`). Client paths keep it, so the PnP regex anchored at `^,?"` fails on a BOM-prefixed file and **PnP detection silently fails** in the wizard, Bulk and OneClick. The spec's claim that BOM is removed (spec §Delimiter Detection) is true only for the unused server path.

#### D.2.3 Header-row detection

| Where | Rule |
|---|---|
| Wizard | No detection. `startRow = 1` (generic) or `2` (PnP) (`:246-262`). The user edits "Start import at row" (`:621-627`) |
| Bulk | 1. After `sep=` it is 2. PnP strict → `lineOffset + 3`. **This is a 1-based data start used as the header index: `headerIdx = startRow-1` (`:311`) points at the row after `rdate,rtime,…`, so the first data row is consumed as the header.** Then `detectColumns` finds no `date`/`kwh` header names and tries the numeric fallback. (Contrast the wizard, where PnP → startRow 2 is the header line.) PnP "simple" (`pnpscada`/`scada.com` in line 1) → `lineOffset+3`, same off-by-one. PnP with non-standard headers scans up to 10 lines for date/time plus kwh/kw/energy keywords (`:82-96`) and sets `startRow = i+1` (correct) |
| OneClick, ColumnSelectionDialog | First line (of the first 10) that contains any keyword `time,date,rdate,rtime,kwh,kw,power,energy,value,p1,p14,active,timestamp` (`OneClick:125-148`, `ColumnSelectionDialog:79-90`) |
| sharedParsingUtils / server `detectFormat` | First of the first 5 rows whose first cell does not start with a digit (`sharedParsingUtils.ts:305-311`, `process-scada-profile:186-192`). A leading metadata line such as `pnpscada.com,…` is therefore taken as the header |
| normaliseRawData csvContent branch | First of 10 lines containing `rdate`/`date`/`time` (`:125-132`) |

⚠ **Bulk PnP off-by-one:** I infer this from the arithmetic and have not run it against a real PnP file. `startRow = lineOffset + 3` and `headerIdx = startRow - 1 = lineOffset + 2`, while the PnP header is at `lineOffset + 1`. **This needs verifying with a real PnP export before a rebuild copies the logic.**

#### D.2.4 PnP SCADA format
- **Strict signature** (everywhere): line 1 matches `^,?"([^"]+)"?,(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})` (meter name, start, end) AND line 2 contains `rdate`, `rtime` and `kwh` (`CsvImportWizard.tsx:73-92`, `sharedParsingUtils.ts:366-390`, `process-scada-profile:166-180`, `MeterLibrary.tsx:387-396`). Bulk's strict regex **requires** the leading comma (`^,"…"`, `BulkCsvDropzone.tsx:64`).
- **Loose signature** (Bulk, OneClick only): line 1 contains `pnpscada` or `scada.com`. The meter name is `parts[1] || parts[0]` (`Bulk:65-85`, `OneClick:137-162`). OneClick then pulls the date range as the first two `YYYY-MM-DD` matches in the metadata lines.
- Typical columns (from `csvTypeDetection.ts:62`): `rdate, rtime, kWh+, kvarh+, kWh-, kvarh-, kVA, pf, Status`. Value column selection picks the first header containing `kwh+` (`csvToLoadProfile.ts:378`), so import (`kWh+`) wins over export (`kWh-`). Export/generation channels are ignored.
- **Timestamp convention:** PnP `rtime` is (by convention) the **end** of the interval (00:30 covers 00:00-00:30). All code assigns the reading to `parseInt(time.split(':')[0])`, which treats it as interval-start. The 00:30 reading goes to hour 0 (correct by luck), but the 01:00 reading, which covers 00:30-01:00, goes to hour 1. The profile is therefore shifted by up to half an interval, and the `24:00`/`00:00` end-of-day reading lands in the next day. **Not handled anywhere; treat it as a design decision to make in the rebuild.**
- **`24:00` time values:** in `csvToLoadProfile` hour 24 → `weekdayHours[24]` is undefined → `.push` throws a TypeError (`:489/492`). **The whole import fails.** `useValidatedSiteData` (`:118`) and `SitesTab` (`:622`) skip hour ≥ 24 instead.

#### D.2.5 Column detection and patterns (client canonical, `csvToLoadProfile.processCSVToLoadProfile`)
Priority order (`csvToLoadProfile.ts:335-382`):
1. Explicit indices from wizard step 4 (`valueColumnIndex`, `dateColumnIndex`, `timeColumnIndex`).
2. Step-3 `columns[]`: first `dataType==="date"` becomes the date column; **first `dataType==="general"` becomes the value column**. All columns default to "general" (`CsvImportWizard.tsx:294-305`), so if step 4 is left on "Auto-detect" the value column is **the first non-date, non-"status" column, which is usually `rtime`**. Separately, a time column is any column whose name contains `time` and is not skipped.
3. Header patterns: date `rdate,date,datetime,timestamp`; time `rtime,time`; value `kwh+,kwh-,kwh,energy,consumption,reading,value,amount,usage`. Then `findValueColumn` (`:279-306`): patterns `kwh+,…,total,active,power,load` **and** at least 50% of the first 20 rows numeric; else the first column that is not named date/time and is numeric and not date-like.
4. If the date or value column is still missing → an all-zero empty profile (`:414-419`).

Note that the wizard's step-4 effect **auto-fills** the date, time and value selections the moment step 4 opens (`CsvImportWizard.tsx:406-429`), so priority 2 only applies when the auto-detect finds nothing. The wizard's own value patterns (`:366`) include `kw`, `power`, `load` and `demand`, which differ from list 3.

Other column detectors: Bulk scoring (`BulkCsvDropzone.tsx:124-199`): `kwh`/`kwh_del` = 100, `p1 (kwh)` = 95, `kw`/`power` = 80, contains kwh/energy/consumption = 70, contains kw/demand = 60, value/reading = 40, and +20 if more than 80% numeric. A "time" header whose values look like full datetimes is promoted to the date column (`:141-155`). OneClick scoring (`OneClickBatchProcessor.tsx:32-95`) is similar but gives +25 and **forces kWh when max > 1000 or values are monotonic**. Server `autoDetectColumns` (`process-scada-profile:253-334`) matches the spec table, but its value patterns include `kw` and match the *first* header containing it.

Multi-meter / multi-column files:
- A meter-ID column is detected (`meter, meter_id, meterid, device, channel, point, site`) only in `sharedParsingUtils` (dead) and the server (`:199-212`, first 200 rows; more than 1 unique ID means multi-meter). The server computes per-meter profiles (`processMultiMeterData` `:346-389`, a simple average per hour) and returns `meterData`. **No live client path splits by meter**, and the orphaned ScadaImport receives `meterData` but never saves it (`ScadaImport.tsx:197`, the insert at `:308-324` ignores it). A multi-meter CSV imported through any live path is **mixed into one profile**.
- Multiple value columns (e.g. P1..P14, kWh+ and kWh-): exactly **one** column is used. The others are ignored.

#### D.2.6 Timestamp formats, date order, separate date and time
Canonical client parser `parseDateTime` (`csvToLoadProfile.ts:135-202`), tried in order:
1. Text month: `^(\d{1,2})[\s-/]([A-Za-z]{3,9})[\s-/](\d{2,4})([\sT]+HH:MM(:SS)?)?`, e.g. `31-Dec-24 23:30`, `1 January 2024`. A 2-digit year >50 becomes 19xx, else 20xx.
2. Combined numeric: `^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})[\sT]+(\d{1,2}):(\d{2})(:\d{2})?`. **Only `-` and `/` separators; `2024.01.01` is not supported here** (it is in the dead sharedParsingUtils).
3. Date-only with the same pattern, plus a separate time column matched as `^(\d{1,2}):(\d{2})`.

`parseYMD` (`:205-232`) disambiguates:
- `p1 > 31` → Y-M-D (ISO).
- else `p3 > 31` → D/M/Y **unless** the column's `dateFormat` is `"MDY"`.
- else (all ≤31, i.e. 2-digit years) → use the hint (`DMY`, `MDY`, default **`YMD`**).
- So **DD/MM/YYYY is the default for 4-digit years.** MM/DD is used only when the user sets step 3 → Date → MDY on the date column. Bulk, OneClick and MeterLibrary hard-code `dateFormat:'YMD'`, so they can never read MM/DD.
- **No range validation.** `new Date(y, m, d)` silently rolls over. A US file `12/25/2024` read as DMY becomes day 12, month 25 → **12 Jan 2026**, and `31/02/2024` becomes 2 Mar. A US file with day ≤ 12 is **silently swapped** (e.g. 03/04 → 3 April instead of 4 March). No error or warning is raised.
- Not supported: AM/PM (`12:30 PM` → hour 12; `1:00 PM` → hour 1), Excel serial dates (`45292.5` → no match → row dropped; an Excel-exported CSV with numeric dates yields an **empty profile**), Unix epoch, `YYYYMMDD` without separators, `2024.01.01`, and times like `0030`. ISO offsets/`Z` are ignored (the wall-clock is taken as-is, which is acceptable for SAST data).
- The server `parseDate` (`process-scada-profile:46-109`) differs. Native `new Date()` is tried first for strings starting `YYYY-MM-DD`/`YYYY/MM/DD`. D/M/Y accepts `/ - . space` separators and validates month 0-11 and day 1-31 (but not per-month). The default hint is **DMY**. A final native-Date fallback accepts anything JS can parse (e.g. `January 1, 2024`, or ambiguous `01/02/2024 00:00`, which JS treats as MDY), but only after the DMY regex fails.
- `normaliseRawData` (`normaliseRawData.ts:65-113`) and the Bulk inline normaliser (`BulkCsvDropzone.tsx:406-417`) always treat `a/b/YYYY` as **DD/MM**, with no hint. **An MDY file processed with the MDY hint gets a correct profile but a raw_data with day and month swapped** (or invalid "2024-25-12" strings). The legacy `DD Mon YYYY` branch maps an unknown month to "01" silently (`:89`).

#### D.2.7 Interval detection (5/15/30/60)
`detectDataInterval` (`csvToLoadProfile.ts:66-115`): sort the parsed rows by time; take the first **100** consecutive diffs in (0, 240] minutes; round each to the nearest of `[1,5,10,15,30,60,120,180,240]`; return the **mode**, defaulting to 60. A duplicate timestamp gives a diff of 0 and is skipped. A 45-minute gap rounds to 30 or 60 (it is equidistant; the first in the list wins, so 30). Sampling only the first 100 means a file whose cadence changes later (e.g. 60 then 30) is characterised by its start. SitesTab (`:477-534`) uses the first 200. The server's `estimateDataInterval` (in sharedParsingUtils `:392-435`) uses the first 50.

#### D.2.8 kWh vs kW detection
Header-based only; values are never inspected, except OneClick's magnitude heuristic.
- Canonical auto (`csvToLoadProfile.ts:385-410`): `mwh`→MWh; `mw`→MW; `kvah`→kVAh; `kva`→kVA; `kwh|energy|consumption`→kWh; `kw`→kW; `wh`→Wh; `\bw\b|watt`→W; `amp|\ba\b|current`→A; **default kWh**. Note that `"power (kw)"`, `"demand"` and `"load"` without "kw" default to **kWh**.
- The wizard **does not auto-apply** a unit. `selectedValueUnit` starts at **"kW"** (`CsvImportWizard.tsx:236`), and its `detectUnitFromHeader` (`:391-403`) is defined but **never called**. A user who clicks Next through a kWh PnP file therefore processes it as **kW** (averaged). The value is still correct in kW only if the readings are kW. For 30-minute kWh readings the profile is **half the true kW** (see D.5).
- Bulk: only 'kWh' or 'kW', from the header score (`:160-164`).
- OneClick: previous `processingConfig.unit` if present, else the scored unit, **overridden to kWh** for monotonic or >1000 values (`:81-90`).
- TenantManager: `valueUnit:"auto"` → header rules (`TenantManager.tsx:740`).
- MeterLibrary "recalculate": **forced kW** "to ensure averaging (not summing)" (`MeterLibrary.tsx:727`). This directly contradicts the kWh-summing fix.
- Cumulative detection: shared/server count increasing pairs in the first 100/200 rows and compare against `dataRows.length * 0.9`. **The denominator is the whole file**, so any file longer than about 111 (shared) or 222 (server) rows can never be flagged cumulative (`sharedParsingUtils.ts:342-352`, `process-scada-profile:224-234`). No live client path handles cumulative registers at all. A cumulative kWh file imported through the wizard or Bulk produces a profile of **register readings**, i.e. huge numbers, which validation rejects only if the peak exceeds 100 000.

---

### D.3 Parsing and normalisation algorithms, step by step

#### D.3.1 Canonical: `processCSVToLoadProfile(headers, rows, config)` (`csvToLoadProfile.ts:320-606`)
1. Resolve date, time and value column indices and the unit (D.2.5, D.2.8). The voltage default is 400 V and PF 0.9 (`:332-333`); `||` means a PF of 0 becomes 0.9.
2. For each row (`:430-462`):
   - `parseDateTime(date, time, dateFormat)`. On failure, `parseErrors++` and skip. (The count is only logged; it is not returned or capped, despite the spec's "max 100 errors".)
   - `dateKey = date.toISOString().split('T')[0]`. ⚠ `date` is **local midnight**, so in UTC+2 (SAST) `toISOString()` gives **22:00 the previous day**. `dateKey` is therefore the previous calendar day. It is used for `uniqueDates` → `dateRangeStart/End` (**off by one day, one day early, in any positive-offset timezone**) and for the weekday/weekend day-count sets. The counts are unaffected because the shift is consistent.
   - `value = parseFloat(str.replace(/[^\d.-]/g,""))`. ⚠ This strips everything except digits, `.` and `-`: `"1,234.5"`→1234.5 (good); **European decimal `"12,5"`→125 (10×)**; `"1.234,5"`→1.2345; `"1.2E+03"`→1.203; `"-"` or empty → `parseFloat("0")` = 0 (**blank cells become 0, not skipped**; only a truly NaN parse is skipped).
   - Convert: power units → kW (`convertToKw`), everything else → kWh (`convertToKwh`). kVA×PF; A→√3·V·I·PF/1000 (three-phase only); W/1000; MW×1000; Wh/1000; MWh×1000; kVAh×PF.
   - **Negatives are kept** (no strategy client-side).
   - No duplicate check, no outlier filter, no gap handling.
3. Bucket by `row.hour` (0-23) and weekday/weekend (`isWeekend`: local `getDay()` 0 or 6, `:315-318`). Minutes are ignored for bucketing.
4. Detect the interval (D.2.7).
5. Per hour h (`:519-560`):
   - **Power units:** `mean(all readings in bucket)`.
   - **Energy units:** `sum(all readings in bucket) / (number of distinct weekday [or weekend] dates in the file, min 1)`.
   - Round to 2 dp.
6. `totalKwh`: power → Σ(value × interval/60); energy → Σ value.
7. `peakKw` = max of both profiles; `avgKw` = mean of **non-zero** profile values (`:575-584`), so zero hours are excluded.
8. Return `{weekdayProfile[24], weekendProfile[24], weekdayDays, weekendDays, totalKwh, dateRangeStart, dateRangeEnd, dataPoints, peakKw, avgKw, detectedInterval}`.

`validateLoadProfile` (`:629-671`) returns invalid when: `dataPoints===0`; both profiles all zero; **both** profiles flat and equal to each other (non-zero), which is the 4.17 detector; or `peakKw > 100 000`. The dead `sharedParsingUtils.validateProfile` uses different thresholds (warn above 1 000 000, invalid above 10 000 000, fewer than 48 points).

#### D.3.2 Wizard hosts (MeterLibrary, SitesTab, MeterReimportDialog)
`MeterLibrary.handleWizardProcess` (`MeterLibrary.tsx:938-1022`):
1. Build the profile.
2. Fail if `dataPoints===0 || totalKwh===0`. A genuinely zero-consumption meter cannot be imported.
3. Build raw_data from `dateColumnIndex ?? 0`, `timeColumnIndex` and `valueColumnIndex ?? 1`, which **differs from the profile's resolved columns** when the user left step 4 on Auto-detect. The value is the raw, unconverted parse. Then `normaliseRawData`.
4. Validate.
5. Update the row. It does **not** write `detected_interval_minutes` or `value_unit`.
6. Fire-and-forget the storage upload.

The `processingConfig` object is built at `:962-967` and **never saved** (dead). SitesTab's host (`SitesTab.tsx:1095-1160`) is the same but **skips `validateLoadProfile`**. MeterReimportDialog (`:74-82`) follows the same pattern.

#### D.3.3 BulkCsvDropzone (`BulkCsvDropzone.tsx:280-481`)
1. Auto-config (D.2.2/D.2.3).
2. Quote-aware split.
3. Fail if there are fewer than 10 data rows.
4. Detect columns (date or value missing → fail).
5. Build a config with `dateFormat:'YMD'`, the detected unit (kWh or kW) and explicit indices.
6. Build the profile.
7. **Insert a new meter every time.** There is no duplicate check by file name or meter name (the fuzzy matcher exists but is unused), so dropping the same file twice creates two meters.
8. Build raw_data inline: split combined date/time on the first space; ISO or D/M/Y → ISO; time `HH:MM` → `HH:MM:00`; **drop rows whose value is 0 at exactly 00:00:00** (`:423`), which silently loses genuine midnight zero readings.
9. A second `update` writes the profile fields and `detected_interval_minutes` (not `value_unit`).
10. Upload to storage.
11. Status: `needs_review` if validation failed, else `success`. **The invalid profile is still saved.**

#### D.3.4 OneClickBatchProcessor (`OneClickBatchProcessor.tsx:296-423`)
1. Fetch `raw_data`.
2. **Skip unless `raw_data[0].csvContent` exists.** It never falls back to the `scada-csvs` bucket, so every meter imported by Bulk, the wizard or ScadaImport is skipped with "No CSV data stored".
3. Auto-parse (D.2).
4. Profile; `dataPoints===0 || totalKwh===0` → failed; validation → failed.
5. raw_data is rebuilt as `{timestamp: row[dateColumnIndex ?? 0] + time, value}`. ⚠ `parseConfig.dateColumnIndex` and `timeColumnIndex` are **never set** (`:272-284`), so the timestamp is `row[0]` alone. For PnP (`rdate`, `rtime` separate) **every raw point gets time 00:00:00**. The value index falls back to `valueColumnIndex ?? 1`.
6. Overwrite `raw_data` with the normalised data. **This deletes the embedded csvContent**, so a second run skips the meter and the original CSV is gone unless it is in storage (it is not; OneClick never uploads).
7. It does not write `detected_interval_minutes` or `value_unit`.

#### D.3.5 SitesTab "Reprocess" via ColumnSelectionDialog (`SitesTab.tsx:355-447, 537-687`)
1. Load csvContent from `raw_data[0].csvContent`, else from storage (`:377-400`), and show the dialog.
2. On confirm, **first NULL the profile fields** (`:421-430`); if processing then fails, the meter is left with no profile.
3. `processWithColumn` **re-reads `raw_data` from the DB**. It uses `selectedColumn` **only if raw_data is the legacy csvContent shape** (`:574-579`). For normal canonical raw_data (`:580-588`) **the user's column choice is ignored**, and the chosen unit's conversion is applied to the stored raw values.
4. Bucket by hour and day type, **averaging** regardless of unit.
5. **Normalise each profile to percentages summing to 100** (`:646-655`).
6. Save the percentages into `load_profile_weekday/weekend`, plus `detected_interval_minutes` and **`value_unit`** (the only writer of `value_unit`).
7. `new Date("YYYY-MM-DD").getDay()` parses as **UTC midnight**. That is correct in SAST, but in any negative-offset timezone every date is classified as the previous weekday.

**This path replaces a kW profile with a dimensionless percentage shape in the same column.** See D.9.

#### D.3.6 Server `process-scada-profile` (orphaned caller)
- `detect`: BOM/`sep=` stripping, delimiter, format, header row, columns, and the first 5 sample rows.
- `process` (`:451-655`):
  1. Resolve columns (manual if both date and value are given, else auto).
  2. Per row: skip rows with too few columns; `parseDate` with the `dateFormat` hint (default DMY); strip non-numerics; on parse failure skip (first **5** errors kept).
  3. **Cumulative:** `delta = current - previous`, or `current` on rollover. ⚠ **The first row is not converted**: `previousValue === null`, so its absolute register value becomes an interval reading and creates a huge spike (`:565-570`).
  4. Negatives: `filter` (default, skip), `absolute`, or `keep`.
  5. Profile = **simple mean per hour bucket for any unit.** There is no unit conversion and no kWh-sum logic, so for 30-minute kWh files the profile is kWh per half hour, i.e. half the kW.
  6. Returns `rawData` **sliced to 5 000 points**, `stats`, and `meterData` for multi-meter files.
  - Deno runs in UTC, so `getHours()`, `toISOString()` and the `new Date(y,m,d,h)` constructor are consistent. `time` comes from `toTimeString()`.

#### D.3.7 Project path `TenantManager.handleWizardComplete` (`TenantManager.tsx:729-900`)
- Calls `processCSVToLoadProfile(result.headers, result.rows, defaultConfig)` with **`columns: []` and no indices** (`:733-741`). **The column interpretation the user set in ScadaImportWizard is ignored for the profile** and pure auto-detection is used. raw_data, by contrast, uses the wizard's `dataType` interpretation (`:760-782`). The two can therefore be built from **different columns**.
- raw_data is stored in the **non-canonical** `{timestamp,value}` shape, or `[{csvContent}]` when no columns were found.
- Upserts by `(project_id, file_name)`, then also upserts a **global duplicate** (`project_id NULL`) by `file_name` alone. Two different projects that upload `meter.csv` therefore overwrite the same global row. Storage uploads happen for both.

#### D.3.8 `normaliseRawData` (client) vs `normalise-raw-data` (edge)
Both convert shapes 2-4 to canonical form. Differences:
- The edge version returns `null` ("skip") for already-canonical rows.
- The edge csvContent branch **keeps only rows whose date is already `YYYY-MM-DD`** (`normalise-raw-data/index.ts:139`), so SA `DD/MM/YYYY` rows are **dropped**. It also does not split combined datetime cells.
- The edge function iterates every `scada_imports` row with the **service role** and overwrites `raw_data` (`:156-195`). **Running it destroys any remaining embedded CSV**, the only copy for legacy rows.

---

### D.4 Timezone, DST, leap years, duplicates, gaps, outliers

| Concern | Behaviour |
|---|---|
| Timezone | Nothing stores a timezone; all timestamps are treated as naive local wall-clock time. Client code builds `new Date(y,m,d)` in the **browser's** zone, so results depend on the user's machine: `dateRange` is one day early in UTC+ zones (D.3.1); the specific-date viewer uses `selectedDate.toISOString()` (`useSpecificDateData.ts:68`), so picking 15 Mar in SAST queries **14 Mar**; `new Date("YYYY-MM-DD")` is UTC (SitesTab, useSpecificDateData min/max) while `new Date(y,m,d)` is local. It is mixed throughout |
| DST | South Africa has no DST, so data is fine. A browser in a DST zone gets 23/25-hour days around the transitions in interval detection (`date.getTime() + hour*3600000`). No explicit handling |
| Leap years | No special handling. 29 Feb is treated as a normal weekday or weekend day. The annual simulation uses 365 days × 24 = 8 760 (`EnergySimulationEngine.ts:778`), so leap-year data is averaged into the representative profile. Harmless |
| Duplicates | **Not detected anywhere.** Overlapping exports concatenated, or repeated rows: in the energy path, sums increase while the day count does not, so the profile inflates (a doubled file means a 2× profile). Averages in the power path are unaffected. `useValidatedSiteData` sums raw points per hour, which also inflates |
| Gaps / missing intervals | **No gap filling.** Energy path: divides by the count of dates *with any reading*, so partial first/last days and missing intervals bias the profile low. Power path: averages only the readings present (unbiased). Site aggregation: missing hours = 0 (`useValidatedSiteData.ts:146`) |
| Outliers | No statistical outlier removal. Only the thresholds in validation (peak > 100 000 kW means invalid). `useValidatedSiteData` has an `outlierCount` field that is **always 0** (`:162, 230`, a stub). The site-level "outage filter" drops any date whose Σ24 hourly kW (i.e. daily kWh) < **75** (hard-coded, `:15, 211-213`); **a small site under 75 kWh/day loses all its dates** |
| Negative values | Client: kept as-is (they reduce sums and averages). Server: filtered by default. Export channels (`kWh-`) are not modelled |
| Public holidays | **Not handled anywhere** (grep for "holiday" across loadprofiles, load-profile and simulation found nothing). Holidays count as ordinary weekdays |

---

### D.5 kWh → kW conversion for sub-hourly data (the "recent fix") — current behaviour and edge cases

There are **two** places that now implement "sum sub-hourly energy within the hour":

**(a) `csvToLoadProfile.ts:519-560` (profile arrays at import).** For energy units the hourly value is `Σ(readings with hour == h, across all dates of the day type) / (number of distinct dates of that day type)`. For 30-minute kWh (two readings per hour, each 0.5 h of energy) that is kWh in the hour per average day, which numerically equals average kW. For kW units it averages. The comment at `:577-580` asserts that the profile is in kW regardless of unit. Vestiges of an earlier approach remain unused: `readingsPerHourPerDay` (`:509-511`, logged only) and `readingsPerHour = 60/detectedInterval` (`:517`, never used).

**(b) `projects/load-profile/hooks/useValidatedSiteData.ts:6-12, 113-151` (site profiles from raw_data, the primary downstream path).** `ENERGY_UNITS = {kwh, wh, mwh, kvah}`; `isEnergyUnit(null) → true` ("default to kWh for backwards compatibility"). Per date and hour: energy → `sum` of the points; power → `sum/count`. Line 134 `hourEntry.sum += useSum ? kwValue : kwValue` is a leftover no-op ternary.

Edge cases and conflicts:
1. **Unit metadata is almost always 'kWh'** (D.1.1). A kW-unit CSV imported through any path except SitesTab reprocess has `value_unit='kWh'`, so its 30-minute kW readings are **summed**, giving **2×** the true load (4× at 15 minutes). The same happens to the inline tenant path, which hard-codes `value_unit: null` (`useValidatedSiteData.ts:68`), and null means energy.
2. **W/Wh/MW/A meters**: raw_data values are unconverted, and `useValidatedSiteData` never applies unit scaling, only sum vs average. A Wh meter reads 1000× high.
3. **Multi-meter tenants with power units:** `sum/count` where `count` includes readings from *all* meters, so the result **averages across meters instead of summing them** (`:100-151`). Mixed units within a tenant use the first meter's unit (`:142-143`).
4. **Wizard default unit is "kW"** (D.2.8). A user who accepts defaults on a 30-minute kWh file gets a profile of mean kWh per half hour, i.e. **half** the true kW.
5. **MeterLibrary "recalculate" forces kW** (`MeterLibrary.tsx:727`), which reintroduces the halving for kWh data.
6. **Double correction on the fallback path:** `useLoadProfileData.correctProfileForInterval` (`useLoadProfileData.ts:37-40`) divides a 24-length stored profile **by 2 when `detected_interval_minutes===30` and by 4 when 15**. The profiles written by (a) are already kW, so a Bulk-imported 30-minute meter used via the pre-computed profile path (priority 3 at `:218-232`, or multi-meter priority 2 via `getAveragedProfileKw` `:56-82`) is **halved**. This branch runs only when the tenant has no usable raw_data, e.g. MeterLibrary batch wiped it (D.1.3 shape 5), OneClick timestamps collapsed to 00:00, or raw_data is empty. The same helper is duplicated in `useEnvelopeData.ts` and `useStackedMeterData.ts`.
7. The energy path divides by distinct dates, so a file that is **one reading per day** (daily kWh totals, date-only timestamps) puts the whole day's kWh into hour 0.
8. Partial days (D.4) bias hourly energy down.
9. The wizard step-4 preview (`CsvImportWizard.tsx:482-564`) uses yet another estimate: `intervalHours = 24/readingsPerDay`, derived from unique **raw date strings**. If the date column contains full datetimes, every row is a "unique day" and `readingsPerDay = 1`, so peak kW = kWh/24. The preview can disagree with the processed result by orders of magnitude. It uses `Math.max(...allValues)`, which throws `RangeError` above roughly 100k values (1-minute data for more than 70 days).

---

### D.6 How weekday / weekend / typical-day / monthly / specific-date profiles are derived

| Product | Where | Method |
|---|---|---|
| Stored weekday/weekend (import) | `csvToLoadProfile.ts:471-560` | Mon–Fri vs Sat+Sun by local `getDay`. Power: mean of all readings in the hour over all days of the type. Energy: Σ / number of such dates. No holiday handling. No seasonal split |
| Stored weekday/weekend (Reprocess) | `SitesTab.tsx:602-655` | Mean per hour, then **normalised to % (sum 100)** |
| Stored (server) | `process-scada-profile:612-617` | Mean per hour, no unit logic |
| Site typical day (primary downstream) | `useValidatedSiteData.ts` Pass 1-3 then `useLoadProfileData.ts:257-276` | Per tenant, per date, a 24-hour kW array from raw_data (sum or average, D.5), scaled by `tenant.area_sqm / scada_imports.area_sqm`. Site = Σ tenants per date (the **union** of dates; a tenant missing on a date contributes 0). Drop dates with Σ < 75. Typical hour = mean over the "validated dates" filtered by the selected days of week and months. Tenants without raw data fall back to: multi-meter weighted average profile per m² × area × **day multiplier**; then the single SCADA profile (interval-corrected) × area scale × day multiplier; then the shop-type % profile × (kWh/m²/month × area / 30) × day multiplier. `DAY_MULTIPLIERS` = Mon .92, Tue .96, Wed 1.00, Thu 1.04, Fri 1.08, Sat 1.05, Sun .88 (`load-profile/types.ts:74-82`). **Hard-coded, and applied on top of profiles that are already weekday- or weekend-specific** |
| Weekday/weekend daily kWh | `useLoadProfileData.ts:287-361` | Mean Σ24 over validated weekday/weekend dates plus fallbacks. The shop-type weekend is `daily × 0.85` (hard-coded, `:360`) |
| Monthly | `useMonthlyData.ts:43-77` | Groups raw points by `date.substring(0,7)`; `totalKwh = Σ value`. This is correct only for energy readings; kW readings are summed as if kWh |
| Specific date | `useSpecificDateData.ts:65-110` | Filters raw points for one date (with the timezone off-by-one) and **sums** points per hour × area scale, regardless of unit |
| Default when nothing is known | `DEFAULT_PROFILE_PERCENT = 4.17×24` (`types.ts:84`); `LoadAnalysisSection.tsx:53-54` also falls back to 4.17×24 | |

---

### D.7 AI in the import functions

| Function | Caller | Provider / model | Prompt (summary) | Returns | Failure modes |
|---|---|---|---|---|---|
| `ai-import-loadprofiles` action `analyze` | orphaned `loadprofiles/GoogleSheetsImport.tsx:110` | Anthropic Messages API direct `fetch`, `claude-sonnet-4-20250514`, max_tokens 4096, `anthropic-version 2023-06-01` (`:462-479`) | System: SA retail energy expert. User: sheet title, tabs, detected layout/hour-format/unit, and **the first 60 rows of every tab** pipe-joined; asks for shop types, units, profile format, weekday/weekend, TOU, trading hours, quality issues (`:430-460`) | `{title, tabs, rowCounts, analysis (free text), formatDetection, sampleData}` | `ANTHROPIC_API_KEY` missing → `x-api-key: undefined` → a 401 is returned unretried and then `content?.[0]?.text` → "Unable to analyze" with **HTTP 200** (`:481-482`) |
| `ai-import-loadprofiles` action `extract` | same, `:134` | Same model, max_tokens **8192**, **forced tool use** `save_load_profiles` (the name is misleading; it saves nothing) (`:595-683`) | Rules for categories (9 suggested), kWh/m²/month ranges, a **24-value % profile summing to ~100**, weekend estimation, trading hours, confidence; 4 example profiles; the first **300 rows per tab** | `{confidence_score, new_categories, extraction_notes, profiles[{name, category, description, kwh_per_sqm_month, load_profile_weekday[24] %, load_profile_weekend[24] %, trading_hours, confidence, source_tab, warnings}], profiles_count, duplicates_removed, format_detected}` after `validateProfile` | Post-processing (`validateProfile` `:233-322`): pad or trim to 24 with **4.17** for missing entries (and `weekday[i] \|\| 4.17` turns genuine 0% hours into 4.17 when length ≠ 24); renormalise to 100 if off by more than 5; clamp kWh/m² to a typical value if outside 0.5×min to 2×max of a hard-coded name-keyword table (`CONSUMPTION_RANGES` `:35-50`); derive trading hours as the hours > 5%; set a "seasonal" label from the name ("restaurant" becomes `winter_heavy`); confidence −10 per warning. No tool_use means a regex JSON fallback; else 500 with **`raw: aiData` echoed to the client** (`:721-724`). `stop_reason: max_tokens` is not checked, so large sheets are silently truncated. Sheets beyond `A1:AZ500` are truncated. The Levenshtein-under-3 duplicate warning flags "Cafe 1"/"Cafe 2" |
| `ai-import-sheet` (tariffs) | `components/tariffs/AISheetImport.tsx:68,97` | Same model, 4096 / 8192, forced tool `save_tariffs` | SA municipal tariff extraction (IBT blocks, TOU rates) | **Writes** provinces, municipalities, tariff_categories, tariffs and tariff_rates with the **service role**; deletes and replaces the rates of existing tariffs (`:505-667`) | Not load-profile data; included because it is in the file list |
| `import-google-sheet` (tariffs, no AI) | `components/tariffs/GoogleSheetsImport.tsx:61` | — | — | Row-based tariff import with the service role (`:129-316`) | — |

Both Google functions authenticate to Google with `GOOGLE_SERVICE_ACCOUNT_JSON` (read-only spreadsheets scope; RS256 JWT built with djwt). The user must share the sheet with the service account.

---

### D.8 Downstream consumers — the shape actually consumed

| Consumer | Reads | Shape assumed |
|---|---|---|
| `useRawScadaData` → `useValidatedSiteData` → `useLoadProfileData` (`projects/load-profile/hooks/*`) | `scada_imports.raw_data`, `value_unit` | Canonical points; hour = `time.split(':')[0]`; value treated as kWh per interval (summed) unless value_unit is a power unit |
| `useLoadProfileData` fallbacks, `useEnvelopeData`, `useStackedMeterData` | `load_profile_weekday/weekend`, `detected_interval_minutes`, `area_sqm`, `project_tenant_meters.weight` | 24, 48 or 96 elements, **interpreted as kW** (48 and 96 are averaged in pairs or quads; 24 is divided by 2 or 4 for 30- or 15-minute meters) |
| Shop types everywhere | `shop_types.load_profile_*`, `kwh_per_sqm_month` | 24 **percent** values (sum ~100) × daily kWh |
| `MultiMeterSelector.tsx:85-92,754-757`, `SiteMeterOverview.tsx:83-148`, `MeterProfilePreview.tsx:290-308`, `ProjectOverview.tsx:63-71`, `ScaledMeterPreview`, `ProfilePreviewCard`, `ExcelAuditReimport` | `load_profile_*` | **Only length 24** is accepted |
| Simulation `runAnnualEnergySimulation(loadProfile, solarProfile, cfg, tou, solar8760?)` (`simulation/EnergySimulationEngine.ts:749-820`) | `loadProfile = chartData.map(d => d.total)` from `useLoadProfileData` (`useSimulationEngine.ts:210`) | **One 24-hour array (kW ≈ kWh per hour)** repeated for **every day of the 8 760-hour year**. Only the solar side can be 8 760 (TMY). The weekday/weekend split, months and holidays are **not** represented in the annual load; the representative day depends on `selectedDays`/`selectedMonths` (annual-average view = all days and months, `useSimulationEngine.ts:194-195`). TOU tariff periods vary per calendar day, but the load does not |
| Proposal `LoadAnalysisSection.tsx:53-54` | shop types | 24 %, falling back to 4.17×24 |
| `pages/ProjectDetail.tsx:923,938`, `ClientPortal.tsx:65` | Tenants joined with `scada_imports(load_profile_weekday, load_profile_weekend, detected_interval_minutes, …)` (not raw_data) | 24-array |
| `useMonthlyData`, `useSpecificDateData`, `ProjectMeterStacking` | raw_data | Canonical points, summed per hour/month |
| Generation actuals (not load profile) | `generation_records/_daily_records/_readings` via `upload-generation-csv` | Monthly/daily kWh; per-reading kWh (kW × interval, interval from the **first two rows only**, `upload-generation-csv/index.ts:151-159`) |

⚠ **Semantic collision in one column.** `scada_imports.load_profile_weekday` can hold: (i) kW per hour (wizard, Bulk, TenantManager); (ii) kWh per interval, i.e. mean readings (server path, forced-kW recalculation on kWh data, wizard default kW on kWh data); (iii) **percent of day summing to 100** (SitesTab reprocess, and the 4.17 column default on placeholder meters). All consumers treat it as kW. **Placeholder meters created by SheetImport keep the 4.17 default with `data_points = 0`, and no downstream consumer checks `data_points`** before using the profile (grep: only UI badges read it). A placeholder meter linked to a tenant therefore contributes **4.17 kW flat, all day**.

---

### D.9 Spec (`docs/CSV_EXTRACTION_SPECIFICATION.md`) vs code

| Spec claim (line) | Code reality |
|---|---|
| Two-tier: the client handles fewer than 10 000 rows; the server `process-scada-profile` handles 10 000 or more, multi-meter and cumulative (§Architecture 40-56; §Performance 408-415) | No threshold exists anywhere. The only caller of the edge function is the **orphaned** `ScadaImport.tsx`. All live processing runs in the browser. Multi-meter and cumulative are **not** handled in any live path |
| `sharedParsingUtils.ts` is the shared utility (§Related Files 505) | Not imported by any production file; only by a test script |
| BOM removed; `sep=` stripped (167-169) | BOM only on the server; `sep=` in the wizard, Bulk, ColumnSelectionDialog and server, but not OneClick or MeterLibrary batch |
| Delimiters include pipe and space with consecutive grouping (152-158) | Pipe only in OneClick and the server; space is never auto-detected; "consecutive as one" is broken (D.2.2) |
| Header row = first row with a non-numeric first cell (91) | That is only the server/shared rule. The wizard uses a fixed 1/2; others use keyword scans |
| Date formats incl. `YYYY/MM/DD`, `DD-MMM-YY`, priority order (177-185) | Client does not support `.` separators or native parsing; MM/DD only via an explicit step-3 hint (D.2.6); no validation, so invalid dates roll over silently |
| Units auto-detected from headers, default kWh (229-241) | True for canonical auto, but the **wizard never auto-applies and defaults to kW**; MeterLibrary recalculation forces kW |
| Energy aggregation: `sum/numberOfDays` (313-319) | Matches `csvToLoadProfile` (and the new raw-data site path). The server, SitesTab reprocess and forced-kW paths **average** instead |
| Negative handling `filter` default (259-265) | Client keeps negatives; the filter exists only on the server |
| Cumulative detection "90%+ increasing" (104-112) | Denominator bug: never true for files longer than about 111 or 222 rows; the first-row spike is not handled |
| Multi-meter: "each meter processed separately; raw data stored with meterId" (94-102) | Not in any live path; the orphan computes it but never saves it |
| `extremeOutliers` above 10 000 000 → invalid; fewer than 48 points warning (393-401) | Live validation: peak > **100 000** → invalid; no too-few-points check; flat detection requires both profiles to be identical |
| "Maximum 100 errors stored" (403-405) | Client counts and discards errors; the server keeps **5** |
| `raw_data` optional, `{timestamp,value}` (migration comment) | Five shapes (D.1.3); the live project path still writes `{timestamp,value}` |
| Known limitation: placeholder 4.17 profiles when `data_points = 0` (485) | Still true. The DB default is 4.17. `validateLoadProfile` catches all-identical profiles only at import time; placeholders created by SheetImport never pass through it and are consumed downstream |
| `WizardParseConfig.fileType "fixed"` (425) | The radio exists (`CsvImportWizard.tsx:596-615`) but `parseWithConfig` ignores `fileType`. **Fixed width is a stub** |
| `ColumnConfig.dataType "skip"` (454) | Only prevents a column from being chosen as the time column in priority 2; otherwise no effect |
| Edge params `kvaColumn` (471) | Parsed into `rawData.kva` but never used in any profile |

---

### D.10 Wizards and dialogs — controls

Legend: **STUB** = rendered but has no effect or is not wired.

#### D.10.1 `CsvImportWizard` (dialog "Text Import Wizard - Step N of 4", `max-w-4xl`)
Opening behaviour (`:242-277`): PnP is detected → startRow 2, comma, meter name and date range; otherwise the delimiter is detected on line 1. `previousConfig` pre-fills the unit, voltage and PF, and later the value column by header name. ⚠ The step-4 selections (`selectedValueColumn/Date/Time`) are **not reset** when the wizard reopens for another file. The effect at `:406-429` only fills them if null, so the **previous file's column indices carry over** to the next meter in the MeterLibrary/SitesTab processing queue.

Step 1 — File type and start row

| Control | Type | What it's for | Handler → effect | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| PnP banner | Card | Shows the detected meter and date range | — (`:569-586`) | `config.meterName/dateRange` | Only when `detectedFormat==="pnp-scada"` | — |
| Delimited / Fixed width | RadioGroup | File type | `setConfig({fileType})` (`:596-615`) | config.fileType | — | **STUB: "fixed" is ignored by the parser** |
| Start import at row | number input, min 1 | 1-based header row | `setConfig({startRow: parseInt||1})` (`:621-627`) | config.startRow → reparse | No max; a value beyond EOF gives empty headers | Preview shows nothing |
| Raw preview | mono list, 8 lines from startRow | Visual check | `getRawLines` (`:213-216`) | — | — | Empty list when nothing is loaded. **Line numbers are off by the number of blank lines removed** |

Step 2 — Delimiters

| Control | Type | Purpose | Handler | Data | Validation | Notes |
|---|---|---|---|---|---|---|
| Tab / Semicolon / Comma / Space | Checkboxes | Split characters | `updateDelimiter` (`:667-681`) | config.delimiters | None; all off → comma | Multiple can be on |
| Other + char | Checkbox + 1-char input | Custom delimiter | `:682-696` | otherChar (regex-escaped) | Input disabled unless Other is checked | — |
| Treat consecutive delimiters as one | Checkbox | Collapse runs | `:701-709` | config.treatConsecutiveAsOne | — | **STUB (broken, D.2.2)** |
| Text qualifier | Select `"`, `'`, None | Quote char | `:712-726` | config.textQualifier | — | — |
| Parsed preview | Table, 6 rows | Check the split | `ParsedPreviewTable` (`:1323-1371`) | previewData | — | "No preview available" |

Step 3 — Column data format

| Control | Type | Purpose | Handler | Data | Validation | Notes |
|---|---|---|---|---|---|---|
| Column grid | Clickable header/cells | Select a column | `onColumnSelect` (`:1374-1470`) | selectedColumn | — | Shows the type label row |
| General / Text / Date / Skip | RadioGroup | Column type | `updateColumnConfig(sel,{dataType})` (`:750-793`) | config.columns[i].dataType | No-op when no column is selected | "Skip" only excludes the column from time-column detection. "Text" has **no effect**. **Mostly STUB** |
| Date order | Select YMD/DMY/MDY | Date order hint | `:770-787` | columns[i].dateFormat | Disabled unless the column is a Date | The only way to parse MM/DD. Default YMD (acts as DMY for 4-digit years) |

Auto-typing (`:292-308`): a header containing `date` → Date; exactly `status` → Text; else General. **This re-runs on every header change and wipes the user's step-3 choices** whenever the step-1 or step-2 settings change.

Step 4 — Load-profile columns and unit

| Control | Type | Purpose | Handler | Data | Validation | Notes |
|---|---|---|---|---|---|---|
| Date/Timestamp Column | Select (Auto-detect + all columns) | Date column | `setSelectedDateColumn` (`:827-842`) | → config.dateColumnIndex | Auto-filled on entering step 4 | Sample shown |
| Time Column (optional) | Select (None + columns) | Separate time | `:853-868` | timeColumnIndex | Auto-filled from headers containing time/rtime | — |
| Value Column (Required badge) | Select (Auto + columns with avg / "(non-numeric)") | Value column | `:882-912` | valueColumnIndex | **Finish is not blocked when it is Auto or empty** | Also selectable by clicking a table row (`:1096`) |
| Value Unit Type (Required badge) | Select of 9 units | Unit | `setSelectedValueUnit` (`:933-996`) | valueUnit | Always has a value (default **kW**) | Power/Energy badge |
| Power Factor | number 0.1-1.0 | kVA/kVAh/A conversion | `:1004-1011, 1033-1041` | powerFactor | `parseFloat \|\| 0.9` (0 → 0.9); **no clamp** despite min/max | Shown for kVA, kVAh, A |
| Voltage (V) | number ≥1 | A conversion | `:1023-1030` | voltageV | `parseInt \|\| 400` | Assumes **three-phase only** |
| Available Columns table | Table | Pick the value column | row click (`:1088-1112`) | selectedValueColumn | — | "N columns • M numeric" |
| Load Profile Preview | Stat cards | Peak / avg / daily / load factor / points / days / total | `loadProfilePreview` (`:482-564`) | — | — | Numbers differ from real processing (D.5 item 9). Empty state: "Select a value column above" |

Footer: Cancel (`onClose`), Back (disabled on step 1), Next (steps 1-3; **no validation**), Finish (`handleFinish` → `onProcess(finalConfig, previewData)`; disabled while `isProcessing`). Error mode (`:1228-1273`, when `errorMessage && !csvContent`): "Unable to Load CSV Data", advice list, Retry (if `onRetry`) and Close. **No SitesTab or MeterLibrary host passes `onRetry`**, so the only action is Close. The only recovery is re-uploading elsewhere, which is a dead end.

#### D.10.2 `BulkCsvDropzone`

| Control | Type | Purpose | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Drop zone / click | div + hidden `<input type=file accept=.csv multiple>` | Add files | `handleDrop`/`handleFiles` (`:226-277, 550-566`) | reads text | Non-CSV filtered | Toast "No CSV files selected"; empty text "Drop CSV files here — Each file will create a new meter in the library". **Adding files replaces the list** (`setFileMatches(matches)` `:258`) although the UI says "Drop more files to add" |
| Clear | Button | Empty the list | `clearFiles` (`:528-531, 592`) | — | Disabled while processing | — |
| Remove (×) per row | Icon button | Drop one file | `removeFile(idx)` (`:533-535, 639-646`) | — | Only pending and not processing | — |
| Process All (N pending) | Button | Run every file | `processAllFiles` (`:484-520`) | Inserts `scada_imports`; storage | — | ⚠ **Processes every file in the list, including ones already processed** (the count shows only pending), so a second click **duplicates meters** |
| Pause / Resume | Button | Pause between files | `togglePause` (`:522-526`) | ref | Visible while processing | — |
| Stop | Button (destructive) | Stop | `setIsProcessing(false)` (`:667`) | — | — | **STUB: the loop keeps running**; only the buttons change |
| Progress bar, per-file status, result summary | — | — | `:599-697` | — | — | Per-file messages: "Only N data rows (need 10+)", "No date column found in: …", "No value column found in: …", "Failed to create meter", the validation reason → needs_review |

#### D.10.3 `OneClickBatchProcessor`

| Control | Type | Purpose | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Start Processing | Button | Run over `meterIds` | `startProcessing` (`:426-485`) | Reads raw_data; writes profile and **overwrites raw_data** | — | Per-meter results: skipped "No CSV data stored" (the **normal outcome** for any meter not imported in the legacy era), failed "Empty profile - check column mapping" or a validation reason, success "N pts, X kW peak" |
| Pause / Resume | Button | — | `handlePauseToggle` (`:487-491`) | — | While processing | — |
| × (Cancel) | Icon | Close | `handleCancel` (`:493-498`) | — | — | **Does not stop the loop**; `onCancel` unmounts the component while the async loop keeps writing |
| Progress, counts, current meter name | — | — | `:537+` | — | — | — |

#### D.10.4 `ColumnSelectionDialog` ("Select Value Column")

| Control | Type | Purpose | Handler | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Date column badge | Badge | Shows the detected date/time column | `:229-233` | — | Only if found | — |
| Column cards | RadioGroup of numeric columns (skips date and `rdate/rtime/status`) with "Recommended" when nonZeroCount ≥ 90% of the max | Pick the value column | `setSelectedColumn` (`:242-285`) | Column **name** | Auto-selects the most non-zero column when opened without an initial value | "No value columns detected in the CSV data" |
| Value Unit Type | Select, 9 units | Unit | `:298-317` | unit (default **kW**) | — | — |
| Power Factor / Voltage | number | Conversion | `:320-362` | — | `\|\| 0.9` / `\|\| 400` | — |
| Cancel | Button | Close | `onClose` | — | Disabled while processing | — |
| Process with Selected Column | Button | Confirm | `onConfirm(col, unit, V, PF)` → `SitesTab.handleColumnSelected` (`SitesTab.tsx:415-447`) | NULLs the profile first, then writes a **% profile** + value_unit | Disabled with no column/unit or while processing | Toast "Failed to reprocess meter". ⚠ **The column choice is ignored for canonical raw_data** (D.3.5) |

Implementation smell: `setState` inside `useMemo` (`:194-207`). Samples use a naive split (quoted commas misalign columns).

#### D.10.5 `SheetImport` (sites and shops register from Excel)
Expected columns (exact header text, `:371-381`): site = `Shopping Centre | Site | Site Name | Center`; shop = `Shop | Shop Name | Tenant | Store`; `Breaker`; area = `Square Meters | Area | Area (m²) | SQM | m²`; `Data Source`; `File Name`. Rows without a site or shop become parse errors.

| Control | Type | Purpose | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Full Sync | Switch | Delete meters that are not in the file | `setFullSyncMode` (`:849-855`) | — | Disabled while parsing/verifying/importing | ⚠ Orphans are computed only if the switch is on **when the file is parsed** (`:314-317`); turning it on afterwards finds none. ⚠ Orphans are **every `scada_imports` row in the whole database** not matched by site\|shop (`:176-208`), not scoped to the sites in the file, **pre-selected for deletion** |
| Upload Excel | Button + hidden input `.xlsx,.xls,.csv` | Parse | `parseExcelFile` (`:342-467, 865-871`) | Reads the first sheet; queries all sites and meters | Disabled while parsing/verifying | Toast "Failed to parse Excel file"; alert listing parse errors |
| Duplicate/orphan alerts, select all/none | Buttons | Review | `toggleAllOrphanedMeters` (`:984-992`) | — | — | — |
| Orphan checkbox | Checkbox | Keep or delete one | `toggleOrphanedMeter` (`:1021-1023`) | — | — | — |
| Site checkbox / shop checkbox | Checkbox | Select | `toggleSite`/`toggleShop` (`:476-509, 1088-1127`) | — | Shop disabled when it is a duplicate in the file | Status badges New / Add to site / Update / Duplicate |
| Import Selected / Full Sync (N) | Button | Execute | `handleImport` (`:521-751`) | **Deletes orphans first**, creates sites (`ilike` name match with **`%`/`_` acting as wildcards** and `.single()`, which errors when 2 match), creates placeholder meters (4.17 defaults, `data_points 0`), updates existing ones (shop_number, area, file_name) | Disabled when nothing is selected | Toast; per-entity audit log; a site-creation error aborts the rest (`throw` `:624`) after orphans were already deleted, so there is **no transaction** |
| Audit log | Collapsible | History | `:1182+` | In-memory only | — | — |

Duplicate matching: `normalizeName` = lowercase alphanumerics; `isSimilarName` = equality **or substring either way** (`:82-91`), so shop "Spar" matches "Superspar" and "Spar Tops". Updates can land on the wrong meter.

#### D.10.6 `ScadaImport` (orphaned; documented for completeness)
Upload `.csv` → edge `detect` → toasts "Format detected: X / Confidence" or "Could not auto-detect…". Format Preview card (delimiter, header row, date/value columns, sample rows). Options: negative-value strategy Select (filter/absolute/keep), shown only when negatives are detected; "Calculate delta" Switch when cumulative. Process (`handleProcess` `:157-215`) → edge `process`; failures open the wizard. Save form: Site Name* (defaults to the file name), Shop Number (**never saved**), Shop Name, Category. The **`area` state has no input** (`area` is always ""). Save (`:276-357`) validates and inserts; `raw_data` is capped at **5 000** points by the server; `meterData` (multi-meter) is dropped.

#### D.10.7 `CsvParseDialog` (orphaned)
Tabs "Parsing Configuration" / "Preview": separator Select (comma/tab/semicolon/space), header row number, date/time (None = combined)/value (kWh)/kVA (None) column selects, per-column visibility checkbox, rename input, data type Select (DateTime/String/Integer/Float/Boolean). The rename and type settings are **not consumed by anything**. `setState` is called inside `useMemo` (`:115-127`). Process is disabled when there is no preview.

#### D.10.8 `GoogleSheetsImport` (load-profile AI, orphaned)
URL input → Analyze (disabled when there is no URL) → Extract (disabled while running) → grid/list of `ProfilePreviewCard` with a select checkbox and inline edits, a "warnings only" toggle, a category filter `<select>`, select-all, and `CategoryMapper` (bulk re-category and add category) → Save (disabled when nothing is selected) inserts `shop_type_categories` and then `shop_types`. ⚠ `filteredProfiles` calls `.sort()` **in place on state** when no filter is active (`:76-89`), so the array is reordered by confidence while `selectedProfileIds` holds the pre-sort indices. **The wrong profiles can be saved.** The "Share the sheet with the service account" copy does not show the account email.

---

### D.11 Tests (`simulation/`)
- There is no test runner. `package.json` has no `test` script, vitest or jest, and there are no `*.test.*` files under `src`. The files are ad-hoc scripts that `console.log` PASS/FAIL without asserting or exiting non-zero.
- `test_csv_parser.ts`: tests a **copy** of an old date parser pasted into the test, not the product code. `test_csv_parser 2.ts` is an older copy (a Finder-duplicate file name) that reads `data/meter_data.csv`.
- `test_extraction_suite.ts`: imports the **dead** `sharedParsingUtils`: 5 date cases (incl. DMY/MDY and `2024.01.01`), the 4 validation cases, 3 delimiter, 4 unit and 2 delta cases. It exercises none of the live code (`csvToLoadProfile`).
- `test_tenant_matcher.ts` (and its "2" duplicate): a self-contained mock of name matching that does not import `fuzzyMatcher`.
- Fixture `data/meter_data.csv`: 6 rows, header `Timestamp,kwh_export`, deliberately mixed formats (`01-Jan-24 00:00`, `01/01/2024 04:00`, `2024-01-01 05:00`).
- **None of the defects in D.12 would be caught.**

---

### D.12 Defects, gaps, hard-coded values, security, performance, UX dead ends

#### D.12.1 Correctness defects (highest impact first)
1. **Three meanings in one column** (kW / kWh-per-interval / % of day) for `scada_imports.load_profile_*`; all consumers assume kW (D.8). SitesTab reprocess writes percentages (`SitesTab.tsx:646-674`).
2. **`value_unit` defaults to 'kWh' and is written by one path only**, so kW/W/A meters are summed in the site aggregation, giving 2-4× (or 1000×) the load (D.5).
3. **The wizard defaults to kW** and never auto-applies the detected unit, so kWh files are halved (30-minute) or quartered (15-minute) (`CsvImportWizard.tsx:236, 391-403`).
4. **Double interval correction** on the pre-computed profile fallback (`useLoadProfileData.ts:37-40`, also in useEnvelopeData and useStackedMeterData).
5. **Placeholder 4.17 profiles are consumed as kW** (DB defaults plus SheetImport placeholders; no `data_points` guard downstream).
6. **European decimal comma → 10×/100× values** (`replace(/[^\d.-]/g,"")` in `csvToLoadProfile.ts:445` and elsewhere).
7. **MM/DD files silently mis-dated or rolled into other years**; no date validation; raw_data always normalised as DD/MM (D.2.6).
8. **Hour "24" crashes the whole import** (`csvToLoadProfile.ts:489/492`).
9. **Timezone off-by-one** in `dateRange*` (UTC+ zones) and in the specific-date lookup (`useSpecificDateData.ts:68`).
10. **raw_data destroyed** by MeterLibrary batch reprocess (`[]`, `MeterLibrary.tsx:499-520`), by OneClick (csvContent overwritten, times collapsed to 00:00), and by the `normalise-raw-data` edge function (drops DD/MM rows from csvContent).
11. **raw_data and the profile are built from different columns** (wizard Auto-detect vs `?? 0/1` fallbacks; TenantManager ignores the user's column interpretation for the profile).
12. **Multi-meter CSVs are merged into one profile** in all live paths.
13. **Duplicates are not detected**, which inflates the energy path; gaps bias it down; negatives are kept.
14. **Bulk PnP header off-by-one** (inferred, D.2.3). **Bulk drops midnight zero readings** (`:423`).
15. **Blank value cells become 0**, not missing (`parseFloat("0")`).
16. The "Treat consecutive delimiters as one" and "Fixed width" options do nothing.
17. Cumulative detection can never trigger on real-length files; the first-row spike is not handled.
18. `dataPoints===0 || totalKwh===0` blocks zero-consumption meters, and validation blocks legitimately flat loads when weekday equals weekend (e.g. 24/7 refrigeration or a data centre).
19. Step-3 choices are wiped whenever the step-1 or step-2 settings change; step-4 column indices carry over between queued files.
20. `upload-generation-csv`: monthly records use the request `year` or the **current year** (not the row's year) (`:220, 328`); interval comes from the first two rows only; accumulate mode is non-idempotent (re-uploading doubles totals); `generation_readings` insert errors are ignored.
21. GoogleSheetsImport in-place sort desynchronises the selection indices (orphaned code, but a trap if it is revived).

#### D.12.2 Hard-coded values
PF 0.9, voltage 400 V (three-phase only); standard intervals `[1,5,10,15,30,60,120,180,240]`; interval sample of 100 (client), 200 (SitesTab), 50 (shared); 60-minute default; minimum 10 rows (Bulk); validation peak > 100 000 kW; flat tolerance 0.0001; 4.17 placeholder; site outage threshold 75 kWh/day; DAY_MULTIPLIERS; shop-type weekend 0.85; shop-type default 50 kWh/m²/month; 30 days per month; `CONSUMPTION_RANGES` table and 4096/8192 tokens and model id `claude-sonnet-4-20250514`; Google range `A1:AZ500`; prompt row caps of 60/300; server raw_data cap of 5 000; server parse-error cap of 5; OneClick batch size 10 plus a 200 ms pause; the 2-digit-year pivot at 50; the SheetImport site_type "Shopping Centre".

#### D.12.3 Security
- **`verify_jwt = false`** in `supabase/config.toml` for `ai-import-loadprofiles` (`:9-10`), `ai-import-sheet` (`:6-7`), `import-google-sheet` (`:3-4`), `process-scada-profile` (`:18-19`) and `upload-generation-csv` (`:78-79`). None of the first four checks auth in code. Consequences:
  - Anyone on the internet can make `ai-import-*` spend **Anthropic credits** and read any sheet shared with the service account.
  - `ai-import-sheet` and `import-google-sheet` **write and delete tariff data with the service role** (`ai-import-sheet/index.ts:505-667` deletes `tariff_rates`; `import-google-sheet/index.ts:129-316`) for any unauthenticated caller who supplies a sheet ID the service account can read.
- `upload-generation-csv` does its own check (a service-role key, a static API key from the `Monthly_Generation_Upload` env var, or any valid user JWT, `:54-82`), then writes with the service role and **no project ownership check**. Any signed-in user can write or overwrite (`mode:"replace"` deletes) generation records of any project. It compares the static key with `===` (not constant-time).
- `normalise-raw-data` is not listed in config.toml, so the gateway requires *a* JWT, but the **anon key qualifies** and the function has no role check. It rewrites every meter's raw_data with the service role, irreversibly.
- **CORS `Access-Control-Allow-Origin: *`** on every function reviewed.
- Error bodies leak internals: `ai-import-loadprofiles` returns the full `raw: aiData` (`:722`); functions return `error.message`.
- **RLS is open.** `sites`, `shop_types`, `shop_type_categories`, `project_tenants` and `project_tenant_meters` allow **anonymous** full CRUD. `scada_imports` and the `scada-csvs` bucket allow any authenticated user full CRUD with no tenant or org scoping or path ownership.
- SheetImport "Full Sync" can delete **every meter in the system** from a single file (client-side, via the user's RLS rights, which permit it).
- SheetJS `xlsx@^0.18.5` from npm (`package.json:77`): the last npm release, with known advisories (prototype pollution CVE-2023-30533, fixed in 0.19.3; ReDoS CVE-2024-22363, fixed in 0.20.2). Only fixed on the SheetJS CDN build. It parses user-supplied files in SheetImport and ScadaImportWizard.
- `ilike(siteName)` without escaping: `%` and `_` in site names become wildcards (`SheetImport.tsx:599`).

#### D.12.4 Performance (large CSVs)
- The whole file is held as a string, then as a `lines[]` array, `rows[][]`, `parsedRows[]` and raw_data objects, i.e. several times the file size on the main thread. There is no Web Worker, no streaming parser and no chunking. A 1-minute annual file (about 525k rows) will freeze the tab. The wizard reparses the **entire file on every settings change** (`useMemo` on config, `:280-283`) and recomputes the column analysis and preview over all rows.
- `Math.max(...array)` spreads in the wizard preview (`:499-500`) and in ScadaImport save (`:292`) throw `RangeError` for arrays above roughly 100k elements.
- raw_data is saved in one request (up to tens of MB); there is no batching, no compression and no separate interval table. Every tenant-level page load fetches every linked meter's full raw_data (`useRawScadaData`), with a 5-minute stale time.
- Bulk processes files sequentially with two DB round trips each plus an unawaited upload; OneClick is sequential; SheetImport inserts one row per shop sequentially.
- Every reprocess uploads the CSV again, so storage grows without bound.

#### D.12.5 UX dead ends
- Wizard error dialog: Retry is never provided by hosts, so the only exit is Close. The advice to "Re-upload the original CSV" has no entry point in the dialog.
- OneClick "No CSV data stored" is the expected result for all modern meters; users see a batch of skips with no path forward.
- Bulk "Stop" and OneClick "×" do not stop processing. "Process All" reprocesses completed files and creates duplicates. "Drop more files to add" replaces the list.
- ColumnSelectionDialog lets the user pick a column that is then ignored; the profile is NULLed before reprocessing, so a failure leaves the meter empty.
- No per-row parse-error report anywhere in the client paths (counts are only logged to the console); a mis-dated file just produces a strange profile.
- The step-4 preview can differ wildly from the saved result (D.5 item 9).
- Three orphaned import UIs (ScadaImport, CsvParseDialog, load-profile GoogleSheetsImport) and two dead utils (sharedParsingUtils, fuzzyMatcher) suggest features that do not exist in the live product.

---

### D.13 Implications for the rebuild (spec-level, no code)
1. **One parser, one place.** Replace the six parsers with one module (ideally in a Web Worker, streaming), covered by real tests with fixtures: PnP (with BOM and `sep=`), DD/MM, MM/DD, decimal comma, `24:00`, Excel serial dates, gaps, duplicates, cumulative registers and multi-meter files.
2. **Store intervals, not profiles.** Put normalised interval data in its own table (meter_id, ts, kwh, quality flag), with the unit converted to kWh per interval at ingest and the interval length and interval-ending convention recorded. Derive any profile (24, 48, 96, 8 760, weekday/weekend, monthly, holiday-aware) on read. Remove the 4.17 defaults and the "percent vs kW" ambiguity: keep shop-type shapes in a separate, explicitly percentage-typed field.
3. **Make date order and units explicit, validated user choices**, with a detected suggestion and a hard error on invalid dates or ambiguity.
4. **Lock down the edge functions** (JWT and role checks, project ownership, no `*` CORS for write functions), scope RLS by org, and make destructive syncs transactional and scoped to the sites in the file.
5. **Model the full year**: feed the simulation 8 760 load values (or a per-day-type calendar) instead of one repeated 24-hour day.
