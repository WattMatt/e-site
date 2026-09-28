# 04 — Simulation, Solar Forecast & Financial Engine (WM Solar → E-Site "Solar" add-on)

**Source reviewed:** read-only export of `origin/main` of `WattMatt/greencalc-sa` at
`scratchpad/wmsolar-main` (all paths below are relative to that root). Nothing was modified.
**Scope:** Project tab `simulation` (and everything it renders), tab `solar-forecast`, the engine code
(`src/lib/pvsystLossChain.ts`, `src/utils/*`, `src/components/projects/simulation/*`), the irradiance edge
functions, and the standalone `Calculator`, `QuickEstimate`, `SandboxWorkspace` pages.
**Note:** `CLAUDE.md` and `docs/APP_SPEC.md` do not exist in this export (`docs/` only holds
`CSV_EXTRACTION_SPECIFICATION.md`), so everything here is derived from code, migrations and `types.ts`.

---

## 0. Executive summary — read this first

The UI presents a sophisticated, PVsyst-flavoured engine with four irradiance sources, two loss modes, a
TOU-aware 8,760-hour dispatch simulation and a 20-year cashflow. **Most of that sophistication does not reach
the numbers that drive savings, payback, IRR and NPV.** The single most important facts for a rebuild:

| # | Finding (evidence) | Consequence |
|---|---|---|
| E1 | The 8,760-h energy engine does **not** use the irradiance-source profile. `useSimulationEngine` feeds `runAnnualEnergySimulation` with `chartSolarProfile = stableChartData.pvGeneration` (`useSimulationEngine.ts:230-235,254-257`), which `useLoadProfileData` builds from a **hard-coded normalised curve** (`load-profile/hooks/useLoadProfileData.ts:136-141`, sum = 7.6) × DC kWp × (1 − 0.14) (`:124,387-397`). The Solcast alternative (`useSolcastPVProfile`) is never switched on (`useSolarProfiles.ts:178-186` destructures `toggleSolcast` but never calls it; `useSolcastPVProfile.ts:51` starts `useSolcast=false`). | Solcast / PVGIS-monthly / GSA / "Simplified vs PVsyst" toggles have **zero effect** on the energy balance, self-consumption, grid import, savings, payback, IRR, NPV. Only **PVGIS TMY + PVsyst mode** swaps in a real 8,760 series (`useSolarProfiles.ts:307-335`). |
| E2 | That static curve yields ≈ **2,346 kWh/kWp(DC)/yr, identical every day of the year, for every location** (verified numerically: 100 kW AC, DC/AC 1.25, JA 545 W → 294 MWh/yr). Realistic SA values are ~1,550–1,850. | Energy and savings over-stated by roughly 30–50 % in the default path; no seasonality; location irrelevant. |
| E3 | KPI cards mix two different models: "Solar Generated"/"Annual Production" show the *simplified* GHI×0.85×(1−reduction) estimate (`SimulationPanel.tsx:256-263,522`) while "Grid Import", "Self-consumption", "Peak reduction" and all money come from the engine (E1). | Adjacent KPI tiles disagree by ~2× (e.g. 142 MWh "produced" vs 294 MWh used in savings). |
| E4 | "Production reduction" (default 15 %) and the typed "Expected daily output" / "Specific yield" overrides are **not persisted** (`useAutoSave.ts:104-155` has no override fields) and the reduction is **not applied to the engine** in the default path (only to TMY 8760 and the KPI estimate). Overrides scale the engine curve by a ratio computed against the *simplified* estimate, not the engine output (`SimulationPanel.tsx:266-283`, `useSimulationEngine.ts:231-235`). | A user typing "500 kWh/day" does not get 500 kWh/day in the simulation. |
| E5 | Battery strategy dropdown label **"Self-Consumption" maps to value `'none'`** (`advanced-config/DispatchSections.tsx:251`), and `'none'` disables all battery discharge (`EnergySimulationEngine.ts:838-840`). `'self-consumption'` and `'scheduled'` are unreachable from UI. | Picking the default-sounding strategy makes the battery charge and never discharge. |
| E6 | New projects start with `batteryMinSoC = batteryMaxSoC = 0`, C-rates 0 (`useInitialSimulationState.ts:35-47`) → DoD 0 → DC capacity 0 (`SimulationPanel.tsx:138-142`). No round-trip efficiency anywhere in the dispatch (charge kWh = discharge kWh). | Battery is non-functional until the user finds hidden SoC fields; when functional it is loss-free (over-states battery value). |
| E7 | Advanced cashflow values **grid export at the full retail TOU/blended rate** (`AdvancedSimulationEngine.ts:95, 545, 567-569`), ignoring `exportRatePerKwh` (which is 0 because `tariff_plans` has no `export_rate_per_kwh`). The basic calc values export at 0. Because `DEFAULT_FINANCIAL_CONFIG.enabled = true` (`AdvancedSimulationTypes.ts:196`), the advanced figures (IRR/NPV/LCOE/payback) are what the user sees whenever a tariff exists. | IRR/NPV over-stated whenever there is export; basic vs advanced savings disagree. |
| E8 | Insurance is computed as `capex × rate% × 12` (`AdvancedSimulationEngine.ts:450-451`; same ×12 in `FinancialConfigPane.tsx:101` and `SystemCostsManager.tsx:1263`). Default rate 1 % ⇒ **12 % of capex per year**. | Either the label ("% of capital", annual) or the ×12 is wrong; with defaults, insurance swamps O&M and depresses IRR. Must be resolved with the owner. |
| E9 | Of the five "Advanced Simulation" sections, **Seasonal is 100 % dead** (functions `getSeasonalIrradianceFactor/LoadMultiplier` never called), **Grid Constraints only changes a display column** (export income still uses uncapped kWh; wheeling & restricted hours unused), **Load Growth only changes displayed load/import**. Only Degradation and Financial affect money. | UI promises modelling that does not exist. |
| E10 | Timezone: PVGIS TMY (`time(UTC)`) and the Solcast averaged profile (`getUTCHours`) are indexed as **local hour** → PV peaks at ~10:00 instead of ~12:00 SAST (2 h shift). | TOU income/self-consumption wrong in the TMY path (the only path where irradiance matters). |
| S1 | `project_simulations`, `sandbox_simulations`, `project_solar_data` have **"Anyone can …" RLS (`USING (true)`) for SELECT/INSERT/UPDATE/DELETE** and were never tightened (migrations `20251205041711…:86-89`, `20251214061506…:34-52`, `20260120140147…:19-29`). `projects` was later org-scoped (`20260318090000…`) but these children were not. | Anyone holding the public anon key can read/modify/delete every client's simulations and cached solar data. |
| S2 | `geocode-location` (verify_jwt = false) accepts any `project_id` + `save_to_project:true` and writes lat/lng with the **service-role key** (`supabase/functions/geocode-location/index.ts:287-301`). `solcast-forecast`, `pvgis-*`, `global-solar-atlas` are unauthenticated open proxies (`supabase/config.toml`); Solcast burns a paid quota. | Unauthenticated IDOR write + paid-API abuse. |

Everything below is the itemised evidence and the full behavioural spec needed to rebuild (and fix) the engine.

---

## 1. System map (data flow)

```
ProjectDetail (src/pages/ProjectDetail.tsx)
 ├─ systemCosts state (741-775) ← last project_simulations.results_json.systemCosts (781-849)
 ├─ blendedRateType ('solarHours' default, 714-716), useHourlyTouRates (717)
 ├─ Tab "costs" → SystemCostsManager (edits systemCosts; its effect writes maintenancePerYear 238-242)
 ├─ Tab "simulation" (forceMount when on costs/simulation: 1382-1405) → SimulationModes
 │    ├─ "Profile Builder" → SimulationPanel  ← THE engine
 │    │    ├─ useSolarProfiles  → Solcast / PVGIS monthly / PVGIS TMY / GSA fetch + profiles + PVsyst annual + TMY 8760
 │    │    ├─ useSimulationEngine
 │    │    │    ├─ useLoadProfileData ×2 (averaged day; selected day)  ← tenants/SCADA  + STATIC PV curve (E1)
 │    │    │    ├─ runAnnualEnergySimulation (8,760 h, 2026 calendar, TOU from localStorage)
 │    │    │    ├─ tariff queries (tariff_rates, tariff_plans, project_tariff_overrides) → blended rates
 │    │    │    ├─ calculateFinancialsFromAnnual (year-1 bill delta)
 │    │    │    ├─ calculateFinancialMetrics (flat NPV/IRR/MIRR/LCOE)
 │    │    │    └─ runAdvancedSimulation (20-yr cashflow; default ON)
 │    │    └─ useAutoSave → project_simulations ("Auto-saved …" row upsert)
 │    ├─ "Quick Estimate" → navigate /projects/:id/quick-estimate (ignores project)
 │    ├─ "Sandbox" → sandbox_simulations insert → /projects/:pid/sandbox/:id
 │    └─ "Proposal" → navigate /projects/:pid/proposal
 └─ Tab "solar-forecast" → ProjectLocationMap (map, geocode, PVGIS/Solcast summary) + SolarForecastCard (GSA)
Consumers of project_simulations (outside scope): Overview KPIs (ProjectDetail 284-320), Load Profile tab
(1343-1346), PV Layout (1408), Costs tab (1363-1364), proposals.
```

Tab status logic (ProjectDetail `1142-1153`): Simulation = **blocked** if no tariff or no tenant has a load
profile; **complete** if a simulation row exists; else pending. Solar Forecast = complete iff `project.location`
text set (`1160-1165`) — not whether coordinates exist. `simulationCount` is hard-wired to 0/1 (`1005`).

Tab switching (`handleTabChange` 722-738): leaving `simulation` or `costs`, or entering `pv-layout`, awaits
`simulationRef.saveIfNeeded()` → `SimulationPanel.autoSave` → `useAutoSave.triggerSave` (immediate upsert).

---

## 2. Tab "simulation" — `SimulationModes` (`src/components/projects/SimulationModes.tsx`)

Purpose: container with four modes. Default mode `profile-builder` (`:42`). Exposes `saveIfNeeded` (`:46-52`).

| Control | Type | What it's for | Handler → effect | Data R/W | Validation / disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Profile Builder | Tab trigger | Full hourly simulation | `setActiveMode` (`:92-97`) | — | label hidden < sm | — |
| Quick Estimate | Tab trigger | Ballpark tool | `:98-101` | — | — | — |
| Sandbox | Tab trigger | What-if scenarios | `:102-105` | — | — | — |
| Proposal | Tab trigger | Proposal builder entry | `:106-109` | — | — | — |
| Open Quick Estimate | Button | Launch Quick Estimate | `navigate(/projects/:id/quick-estimate)` (`:148`) | — | — | Target page **ignores `:id`** (see §9.2) |
| Quick-estimate info tiles | Read-only | Show area/tenants/connection/location | `:155-171` | tenants.area_sqm, project.connection_size_kva, project.location | — | "Not set" |
| Create Sandbox | Button | Clone project into sandbox | `createSandbox.mutate` (`:69-89,195`) → INSERT `sandbox_simulations{name:"<project> - Sandbox", cloned_from_project_id, project_snapshot: full project JSON}` then navigate | W sandbox_simulations | disabled while pending | toast "Failed to create sandbox" |
| Sandbox list cards | Clickable card | Re-open a sandbox | `navigate(/projects/:pid/sandbox/:id)` (`:212`) | R sandbox_simulations where cloned_from_project_id (`:55-66`) | — | list hidden if empty; always shows "DRAFT" badge (hard-coded) |
| Create Proposal | Button | Open proposal workspace | `navigate(/projects/:pid/proposal)` (`:252`) | — | Not gated on a simulation existing | — |
| Proposal info tiles | Static text | Marketing text ("4 checks required", "PDF & Excel", "Digital signatures") | hard-coded `:259-276` | — | — | Static; may not reflect reality |

---

## 3. Profile Builder — `SimulationPanel` (`src/components/projects/SimulationPanel.tsx`)

### 3.1 State inventory (what the panel owns)

| State | Init | Source line | Persisted? |
|---|---|---|---|
| solarCapacity (kW **AC**) | cache `last-simulation.solar_capacity_kwp` or 0 | 112; `useInitialSimulationState.ts:36-56` | yes (`solar_capacity_kwp`) |
| batteryAcCapacity ("usable" kWh) | round(dc × DoD) or 0 | 113 | derived back from DC + DoD |
| batteryChargeCRate / DischargeCRate | saved or **0** | 114-115 | results_json |
| batteryMinSoC / MaxSoC (%) | saved or **0 / 0** | 116-117 | results_json |
| batteryStrategy | saved or `'none'` | 118 | results_json |
| dispatchConfig | saved or `{chargeWindows:[],dischargeWindows:[],allowGridCharging:false}` | 119 | results_json |
| chargeTouPeriod | saved | 120 | results_json (unused by engine) |
| dischargeTouSelection | saved or all-false matrix | 121 | results_json |
| batteryAuxPowerW | **0, not persisted** | 122 | **no** |
| pvConfig | `getDefaultPVConfig()` | 148 | results_json.pvConfig |
| solarDataSource | `"pvgis_monthly"` | 150 | `simulation_type` + results_json |
| lossCalculationMode | `"simplified"` | 151 | results_json |
| pvsystConfig | `DEFAULT_PVSYST_CONFIG` | 152 | results_json |
| advancedConfig | `DEFAULT_ADVANCED_CONFIG` | 153 | results_json |
| inverterConfig | `{inverterSize:100, inverterCount:1, dcAcRatio:1.25, selectedModuleId:'ja_545'}` | 154; `InverterSizing.tsx:59-66` | results_json |
| dailyOutputOverride / specificYieldOverride | null | 156-157 | **no** |
| productionReductionPercent | 15 | 158 | results_json |
| excludeLoadProfile | false | 160 | **no** |
| selectedDayIndex / showAnnualAverage | 0 / true | 174-175 | no |

Derived battery values (`138-142`): `DoD = max−min`; **DC capacity** `= round(AC / (DoD/100))` (0 if DoD ≤ 0);
charge kW `= AC×Cc` (1 dp); discharge kW `= AC×Cd`; `batteryPower = max(charge, discharge)`.

Auto-load: on first fetch of latest `project_simulations` row (by `created_at desc`), `restoreSimulationState`
is applied once per project (`192-223`). CPI is mirrored from `systemCosts.cpi` into
`advancedConfig.financial.inflationRate` (`235-239`).

Connection limit: `maxSolarKva = connection_size_kva × 0.75` (`330-332`, hard-coded 75 %). Warning card when
connection not set (`391-400`) or AC kW > limit (`402-411`). No hard block.

### 3.2 Layout (top → bottom) and control inventories

#### 3.2.1 Toolbar — `simulation/SimulationToolbar.tsx`

| Control | Type | Purpose | Handler → effect | Data | Disabled | States |
|---|---|---|---|---|---|---|
| Title + location label | Text | Shows `SA_SOLAR_LOCATIONS[pvConfig.location].name` + data label | `:35-43` | pvConfig.location (a **city preset, default Johannesburg**, not the project) | — | If no real data: shows preset GHI |
| Save status chip | Indicator | Autosave feedback | `:45-55` | isAutoSaving, lastSavedAt | — | Nothing shown on save failure (no error path) |
| Solcast / PVGIS / TMY / GSA | ToggleGroup (single) | Choose irradiance source | `onSolarDataSourceChange` (`:58-80`) → triggers auto-fetch effects in `useSolarProfiles` | see §4.1 | item disabled while its fetch is loading | Toasts from hooks; **no effect on engine except TMY+PVsyst (E1)** |
| Simplified / PVsyst | ToggleGroup | Loss model | `:82-96` | — | — | PVsyst reveals §3.2.5 |
| Source badge | Badge | "Forecast / Global Solar Atlas / Typical Year / 19-Yr Avg" | `:98-102` | — | only when hasRealData | — |

#### 3.2.2 Saved configurations — `SavedConfigCollapsible` + `SavedSimulations`

| Control | Type | Purpose | Handler → effect | Data R/W | Validation | States |
|---|---|---|---|---|---|---|
| Collapsible header | Button | Shows loaded sim name/date | `SavedConfigCollapsible.tsx:25-53` | — | — | spinner while loading |
| Compare Selected (n) | Button | Toggle comparison table | `SavedSimulations.tsx:401-411` | — | visible when ≥2 selected | — |
| Save | Dialog trigger | Save named snapshot | `:418-424` | — | — | — |
| Simulation Name | Input | Name | `:435-440` | — | Save disabled if empty | — |
| Dialog Save | Button | INSERT row | `saveMutation` (`:175-257`) → INSERT `project_simulations` (see §7.2), then fires background `generateInfographics` (AI edge fn, out of scope) | W project_simulations | disabled pending/empty | toast success/error; infographic uses hard-coded `dcAcRatio:1.3`, CO₂ 0.9 kg/kWh (`:242-246`) |
| Cancel | Button | Close | `:449` | — | — | — |
| Row (click) / Download icon | Clickable | Load config into panel | `handleLoad` (`:336-380`) → `restoreSimulationState` incl. **systemCosts** | R | — | toast "Loaded configuration"; badge shows "Generic" for anything not Solcast (`:593`) |
| Checkbox | Checkbox | Select for compare (max 3) | `toggleCompare` (`:382-390`) | — | 4th silently ignored | — |
| Drag handle / row drag | DnD | Reorder | `handleDrop` → sequential UPDATEs of `sort_order` (`:278-326`) | W sort_order | — | No error toast on reorder failure |
| Trash | Button | Delete | `deleteMutation` (`:260-275,615-626`) | DELETE | **no confirmation**; can delete the auto-save row | toast |
| Comparison table | Table | Side-by-side kWp, battery, savings, payback, ROI | `:475-547` | row columns | — | — |
| Empty state | Card | "No saved simulations yet…" | `:633-641` | — | — | — |
| `handleSave` | Function | — | `:328-334` | — | — | **dead code** |

Auto-save interplay (defect): autosave updates the newest row whose name starts `Auto-saved` (`useAutoSave.ts:92-102`);
auto-load restores the newest row by `created_at` (`SimulationPanel.tsx:87-99`). After a user saves a named
snapshot, later edits go into the *older* auto-save row, but reload restores the *named* row → **edits appear lost**.

#### 3.2.3 Advanced PV Configuration (PVWatts-style) — `PVSystemConfig.tsx`

Collapsible (`SimulationPanel.tsx:414-438`). Header shows `calculateSystemEfficiency(pvConfig)` %.

| Control | Type | Purpose | Handler | Default / range | Effect on results |
|---|---|---|---|---|---|
| Include detailed losses | Switch | Use compound efficiency instead of flat 85 % | `:307-310` | off | affects only `generateSolarProfile` outputs (comparison/"generic"/PVGIS/GSA *display* profiles) and this card's "expected output". **Not the engine (E1).** |
| Location | Select (only when project has **no** location text) | Pick SA city preset | `:333-356` sets location + tilt=optimal | 10 cities (`:16-27`) | Preset GHI used by generic curve, labels, PVsyst panel GHI. When project has a location text, the select is replaced by read-only text but `pvConfig.location` stays **Johannesburg** → wrong GHI shown for e.g. Cape Town projects. |
| Module Type | Select | Standard 1.0 / Premium 1.05 / Thin film 0.92 | `:369-386` | standard | detailed mode multiplier |
| Array Type | Select | Roof 0.98 / Ground 1.0 / 1-axis 1.25 / 2-axis 1.35 | `:396-417` | fixed_roof | multiplier; tracking widens Gaussian |
| Tilt | Slider 0–90 step 1 | Tilt | `:449-456`; disabled for tracking | 26 | `tiltFactor = 1 − |tilt−|lat||/90×0.15` |
| Set optimal tilt | Icon button | tilt = |lat| | `setOptimalTilt :273-275` | — | — |
| Azimuth | Slider −90…90 step 5 | Orientation (0 = N) | `:471-478`; disabled for 2-axis | 0 | `azFactor = 1 − |az|/180×0.25` |
| DC/AC Ratio | Slider 1.00–1.50 step 0.05 | — | `:506-512` | 1.3 | **stored in `pvConfig.dcAcRatio` and used nowhere.** The live ratio is `inverterConfig.dcAcRatio` (§3.2.7). Two DC/AC ratios exist. |
| Inverter Efficiency | Slider 90–99 step 0.5 | — | `:524-530` | 96 | detailed-mode multiplier only |
| System Losses Calculator | Collapsible | 10 PVWatts losses | `:535-574` | see §5.1 | `totalLossPercent` multiplicative (`calculateTotalLoss :109-117`) — but the **initial** default is the additive sum 15.5 % (`getDefaultPVConfig :91,101`) until any slider moves |
| Reset to Defaults | Button | Reset losses | `resetLosses :269-271` | — | — |
| Each loss | Slider 0–20 step 0.5 | — | `LossSlider :598-637` | — | — |
| Expected Daily Output / Annual / Specific yield | Read-only | Quick estimate | `:278, 579-592` | `solarCapacity(AC) × presetGHI × eff × 0.9` | Uses **AC** kW and an extra 0.9 fudge; `(…).toFixed(0).toLocaleString()` no-op formatting (`:586`); divide-by-zero → "NaN/Infinity kWh/kWp" when capacity 0 |

#### 3.2.4 PVsyst Loss Chain panel — `PVsystLossChainConfig.tsx` (only when mode = PVsyst)

Props from SimulationPanel `440-449`: `dailyGHI = selectedLocation.ghi` (**city preset, not the fetched data**),
`capacityKwp = solarCapacity` (**AC**), `ambientTemp = 25` (unused by the maths). The panel's PR/eGrid/SY therefore
differ from the annual engine result that uses `annualGHI` from the data source and DC kWp.

| Control | Type | Purpose | Handler | Notes / defects |
|---|---|---|---|---|
| Header badge PR | Badge | PR from `calculatePVsystLossChain` | `:198,255-260` | — |
| Reset (↺) | Icon button | Reset to `DEFAULT_PVSYST_CONFIG` | `:242-244,263-270` | Ignores the Settings "PVsyst loss" defaults (`buildPVsystConfigFromVariables` is never called anywhere) |
| Key metrics (PR, kWh/day, kWh/kWp/yr, Total loss) | Read-only | — | `:281-298` | — |
| Module block | Read-only (module metrics provided) | STC eff, module count, area | `:302-321` | STC slider path `:325-338` unreachable here |
| Operation Year | Select 1–25 | "Year for degradation" | `:343-360` | **No numeric effect**: only relabels the waterfall row; `moduleDegradationLoss` is a fixed 3.8 % |
| ~21 loss sliders (Irradiance, Array, Inverter, After-inverter groups) | `LossSlider` (sign toggle, click-to-type 4 dp, slider 0…max) | Edit each loss | `LossSlider :48-179`; updaters `:211-240` | **Sign display is inverted**: positive stored value = loss but rendered "+" in primary/green; negative (a gain, e.g. module quality −0.75) rendered "−" in red. Typed values clamp to [0,max] then re-apply current sign. |
| Loss Waterfall | `LossWaterfallChart` (editable) | Visual + click-to-edit | `onLossChange` map `:614-645` | Editing **Transposition** writes `−newValue` → converts the 0.13 % loss into a gain; zero-valued stages are filtered out and cannot be edited (`LossWaterfallChart.tsx:39-41`); waterfall compounds inverter losses multiplicatively while `calculatePVsystLossChain` sums them (`pvsystLossChain.ts:232-242`) |
| 25-Year Projection | Collapsible → `DegradationProjection` | Year-by-year PR/yield | `generate20YearProjection` (`pvsystLossChain.ts:439-476`) | **Every year identical** (only `operationYear` changes, which the maths ignores). "−x % by Year 20" is just LID⊕module-deg. |

#### 3.2.5 Advanced Simulation panel — `simulation/AdvancedSimulationConfig.tsx` (+ `advanced-config/*`)

Collapsed by default; header badge "n active" counts enabled sections (`:83-86`). **Financial is enabled by default**, so
"1 active" shows on every new project.

| Control | Type | Purpose | Handler → effect | Notes |
|---|---|---|---|---|
| Conservative / Optimistic / SA Market Standard | Buttons | Replace whole advancedConfig with preset | `onChange(preset.config)` (`:127-139`); presets `AdvancedSimulationTypes.ts:244-383` | Presets set `insuranceEnabled:false`; "SA Market" enables grid constraints with export limit **off** (no effect); preset objects captured getter values at module load |
| Reset | Button | `DEFAULT_ADVANCED_CONFIG` | `:141` | — |
| My Presets chips | Buttons | Apply saved preset | `:152-162` | R `simulation_presets` (per user, RLS `auth.uid()=user_id`) |
| Trash on chip | Icon | Delete preset | `confirm()` then delete (`:95-98`) | Icon sits inside the apply button; click also bubbles? (stopPropagation called) |
| Save Current | Dialog | Save advancedConfig as preset | `createPreset` (`:88-93,165-193`) | name ≤50, desc ≤200 |
| **Solar Characteristics → Discharge Strategy list** | Draggable list with checkboxes + TOU checkboxes | Where PV goes (Load / Battery / Grid Export) and when | `DischargeSourcesList` (`DispatchSections.tsx:76-115`) → `dispatchConfig.dischargeSources` | UI shows `DEFAULT_DISCHARGE_SOURCES` **all unchecked** when undefined, but the engine treats *undefined* as "all allowed" (`EnergySimulationEngine.ts:208-211`). The first click creates a 3-item list where the other two are disabled → e.g. ticking only "Load" silently **turns off export and battery discharge**. Unticked "Load" ⇒ `solarUsed = 0` (all PV exported/curtailed). Default TOU for Battery = `['peak']` only. Order = priority (only Battery-vs-Load order is used: `isBatteryPriorityOverLoad :261-269`). |
| Battery Characteristics (only if project includes battery) | | | | |
| · Charging C-Rate | Number 0.01–5 | kW/kWh | clamp (`:168`) | New project value 0 ⇒ 0 kW |
| · Discharging C-Rate | Number 0.01–5 | | `:172` | idem |
| · Depth of Discharge | Read-only | max−min | `:176` | — |
| · Min SoC / Max SoC | Integer 0–100 | Usable window | `:182,186` (auto-bumps the other by 5) | New project **0/0 ⇒ battery = 0 kWh** |
| · Auxiliary Power Draw (W) | Number 0–5000 | BMS/HVAC parasitic | `:193-205` | **Not persisted** |
| · Charge Strategy list (PV / Grid / Generator) | Draggable, checkboxes + TOU | Which sources may charge and when | `ChargeSourcesList :31-70`; sets `allowGridCharging` = grid enabled (`:211-214`) | Generator source has **no engine support**; enabling a source with all TOU boxes later unticked (`[]`) ⇒ never charges; list order is **ignored** by engine |
| · Discharge Strategy | Select | Self-Consumption (**='none'**), TOU Arbitrage, Peak Shaving | `:221-255` | See E5. Peak shaving has **no target input** (engine default 150 kW, `EnergySimulationEngine.ts:547`). |
| · Discharge During matrix | 4×3 checkboxes | TOU arbitrage season/day/period permission | `:258-295` | default all false ⇒ arbitrage never discharges until ticked |
| Seasonal Variation | Switch + 2 sliders (High 90–130 %, Low 70–110 %) | Load multipliers; text claims irradiance factors | `SeasonalSection.tsx` | **Dead** — not referenced by any engine; irradiance factors not even editable |
| Degradation Modeling | Switch; Panel Simple/Yearly (slider 0.2–1.5 %/yr, per-year grid + "Apply to all"), Battery Simple/Yearly (1–6 %/yr), Battery EOL 50–90 % | Multi-year degradation | `DegradationSection.tsx` | Also gates **replacement costs** (only charged when enabled, `AdvancedSimulationEngine.ts:602`). Battery section only when `includesBattery` — but prop `includesBattery` is **not passed** from AdvancedSimulationConfig (`:228` passes `projectLifetime` only) ⇒ battery degradation controls never render. |
| Financial Sophistication | Switch; Tariff escalation 0–25, Inflation 0–15, Discount 0–20, Lifetime 10–30, Sensitivity switch + ±5…40 % | Cashflow parameters | `FinancialSection.tsx` | Discount here is used for discounted CF/PV column & sensitivity NPV, but **headline NPV uses `systemCosts.lcoeDiscountRate`** (Costs tab) — two discount rates |
| Grid Constraints | Switch; Export limit switch + kW; Wheeling switch + R/kWh | Export cap / wheeling | `GridConstraintsSection.tsx` | Export cap only alters the *displayed* `gridExport` via a "6 solar hours/day" approximation (`AdvancedSimulationEngine.ts:507-516`); income unchanged; wheeling unused |
| Load Growth | Switch; growth 0–10 %; New tenant switch, year, monthly kWh | Load projection | `LoadGrowthSection.tsx` | Changes only `loadConsumption`/`gridImport` display columns; no effect on income/NPV |

#### 3.2.6 Config carousel — `simulation/ConfigCarousel.tsx`

Four panes: Inverters, Solar Modules, Battery, Financial. Disabled panes (project lacks solar/battery, or no tariff)
are shown struck-through with a lock; clicking offers "Enable X?" AlertDialog → `onRequestEnable(pane.id)` →
`ProjectDetail.handleRequestEnableFeature` (`893-915`) which rewrites `projects.system_type` to
`"Solar PV,Battery,Generator"` style. Financial pane is `cannotToggle` (message only). Dialog text says "You can
disable it again from the project settings" — verify that exists. Prev/Next arrows wrap around.

**Inverters pane → `InverterSliderPanel.tsx`**

| Control | Type | Purpose | Handler | Notes |
|---|---|---|---|---|
| System Size quick buttons | Buttons (first 6 of 1…10 × inverter size) | Set AC kW | `handleSystemSizeQuickSelect :58-62` | — |
| Custom kW | NumericInput step 5 | Set AC kW | `:64-70` | ignores ≤0 |
| Inverter Size | Select (16 presets 5–250 kW) + Custom | Unit size | `:82-87,141-156` | "Custom" option does nothing (`:83`) |
| Inverter size number | NumericInput int ≥1 | Custom unit size | `:89-94` | — |
| Number of Inverters | Slider 1–20 | Count | sets count and `solarCapacity = count × size` (`:191-203`) | Max 20 cap |
| DC/AC Ratio | NumericInput 1.0–1.5 step 0.001 + Slider step 0.01 | Over-paneling | `:229-246` | label "1.25 (Optimal)" is opinion |
| Metrics box | Read-only | AC, DC kWp, modules, area, 75 % limit | `:255-294` | Uses **desired AC** (solarCapacity) whereas the engine uses **installed AC = size × ceil(count)** (`SimulationPanel.tsx:226-232`) ⇒ DC kWp/module count shown here ≠ engine (e.g. 110 kW with 50 kW units: shown 143 kWp, engine 195 kWp) |
| Validation line | Text | OK / exceeds limit | `:297-313` | — |
| (render-time side effect) | — | — | `if (config.inverterCount !== derived) onChange(...)` inside render (`:40-45`) | setState-during-render; can loop / React warnings |

**Solar Modules pane → `SolarModulesPane.tsx` + `InverterSizeModuleConfig.tsx`**

| Control | Type | Purpose | Handler | Notes |
|---|---|---|---|---|
| Solar Module | Select (9 presets incl. "custom") + extra "Custom Module" item | Module selection | `handleModuleChange :44-63` | Duplicate `custom` value in list (`:100-105`) |
| Width / Length / Power / Efficiency (custom only) | NumericInputs | Custom module | `:65-76,123-176` | Efficiency not checked against W/area; area read-only |
| DC capacity | Read-only | `solarCapacity × dcAcRatio` | `SolarModulesPane.tsx:57-62` | again desired-AC based |
| Expected daily output | NumericInput + reset | Override | sets `dailyOutputOverride` (`:67-77`) | E4 |
| Specific yield | NumericInput + reset | Override (takes precedence) | `:82-92` | E4 |
| Production reduction % | NumericInput 0–100 + reset to 15 | Conservative haircut | `:99-110` | E4 |
| (dead) inverter handlers | — | — | `InverterSizeModuleConfig.tsx:32-42` | never rendered |

**Battery pane → `BatteryPane.tsx`**

| Control | Type | Purpose | Notes |
|---|---|---|---|
| AC Capacity (kWh) | NumericInput int 0–5000 step 10 | Usable kWh | label "AC capacity" actually means usable energy |
| Charge / Discharge Power, DC Capacity | Disabled inputs | Derived | — |
| Daily cycles | Read-only | — | shows `batteryCycles` which is **annual** equivalent cycles (discharge/cap) ⇒ 365× too high label (`:78-79`) |
| Energy throughput | Read-only | annual discharge/365 | — |

**Financial pane → `FinancialConfigPane.tsx`**

| Control | Type | Purpose | Handler | Notes |
|---|---|---|---|---|
| Simulation Tariff Rate | Select (Solar Hours Annual/High/Low, All Hours Annual/High/Low) | Which blended R/kWh feeds year-1 basic calc & legacy advanced path | `onBlendedRateTypeChange` (`:117-163`) → ProjectDetail state | Disabled when Hourly Rates on |
| Hourly Rates | Switch | TOU hourly costing | `:165-172` | **Cosmetic in the basic calc**: `useHourlyTouRates` is never read by `useSimulationEngine` (destructured `:157` only). The advanced engine always uses hourly TOU when `tariffRates` exist, regardless of this switch. |
| Exclude load profile | Checkbox | "Solar-only revenue" | `:189-198` → `toSolarOnly` (`useSimulationEngine.ts:448-462`) | sets load 0 and **export = all solar**, so basic calc (export rate 0) shows **negative-ish/zero savings**, advanced shows all solar at retail. Not persisted. |
| ZAR/kWh (incl. 3-yr O&M) | Read-only + tooltip | `(capex + 3yrO&M)/(E × reduction)` | `:212-225` | Multiplies engine kWh by reduction again |
| ZAR/Wp (DC) | Read-only | `(capex+3yrO&M)/(AC×DC/AC×1000)` | `:226-239` | desired AC based |
| ZAR/Wp (AC) | Read-only | `/(installed AC×1000)` | `:240-251` | — |
| LCOE | Read-only | advanced LCOE else basic | `:252-266` | tooltip default "10 %" vs actual 9 % |
| Initial Yield | Read-only | `(Income₁ − O&M₁ − Ins₁)/capex` | `:98-103,267-280` | fallback insurance ×12 |
| IRR, MIRR, Payback, NPV | Read-only | advanced else basic | `:281-331` | tooltip defaults (10 %, 12 %) differ from real defaults (9 %, 10 %/8 %) |
| No tariff | Empty card | "Select a tariff to enable…" | `:66-82` | — |

#### 3.2.7 KPI cards — `simulation/SimulationKPICards.tsx` (hover formula via `MetricTooltip`)

| Card | Value | Source |
|---|---|---|
| Daily Load | annual load / 365 | engine |
| Solar Generated | `annualSolar/365` where `annualSolar = PVsyst ? engine.totalAnnualSolar : effectiveAnnualProduction` (`SimulationPanel.tsx:522`) | **simplified estimate in default mode; engine in PVsyst mode** |
| Annual Production | PVsyst: `eGrid × reduction` + SY + PR; else = annualSolar | PVsyst annual model (different from engine) |
| Grid Import | engine annual import / 365 | engine |
| Self-Consumption | engine `solarUsed/solar` | engine |
| Peak Reduction | `(peakLoad−peakGridImport)/peakLoad` on the **averaged** day | engine |

#### 3.2.8 Advanced results — `simulation/AdvancedResultsDisplay.tsx` (shown when any advanced section enabled + tariff)

Metric cards NPV/IRR/LCOE/Payback (payback ">25 years" hard-coded text regardless of lifetime; colour thresholds
IRR>10 %, payback<7/<12). Sensitivity 3-card grid (best/expected/worst). Tabs: **Cash Flow** (chart from
yearly→monthly data), **Detailed Table** (24-column annual cashflow, sticky header, `min-w-[1800px]`, totals row),
**Generation**, **Degradation**; Lifetime summary. Read-only; no export button.

#### 3.2.9 Chart tabs — `simulation/SimulationChartTabs.tsx`

| Control | Type | Purpose | Notes |
|---|---|---|---|
| Building / Load / Grid / PV / Battery / Load Shedding / Data Comparison | Tabs | Views | Battery tab only if battery>0; Comparison only when a Solcast profile exists; selecting "compare" sets `comparisonTabViewed` which lazily runs two extra annual sims |
| Prev / Next day | Icon buttons | Day 1–365 of 2026 | `DayNavigationHeader.tsx:53-106` |
| Date title | Popover calendar (2026 only) | Jump to a day | `:67-94` |
| Annual Avg | Switch | Average of 365 days vs a single day | `:109-116` |

Chart data merge (`useSimulationEngine.ts:560-602`): the per-day **load** comes from the filtered load profile for
that weekday/month, but grid/battery series come from the engine which always uses the **all-days average load** ⇒
on a single-day view, `load − solar ≠ gridImport`. In TMY mode, DC/clipping lines are recomputed from the 8760 series.
`batterySOC = state/capacity×100` → **NaN** when capacity 0.

**Load Shedding** (`LoadSheddingAnalysisPanel.tsx`, `LoadSheddingScenarios.ts`): stage select (0–8, default 4) +
tabs Overview / Comparison / Financial / Data Table. Algorithm §4.10. Uses the `solarProfile` from
`useSolarProfiles` (not the engine's), `batteryPower` only, own simple dispatch.

**Data Comparison** (`DataComparisonTab.tsx`): generic vs Solcast profiles, energy & savings deltas (hidden if |Δ|<0.5 %).

---

## 4. Algorithms (step by step, with constants)

### 4.1 Irradiance sources

| Source | Client hook | Edge fn / upstream | Request | Processing | Units returned | Cache |
|---|---|---|---|---|---|---|
| **PVGIS monthly** (default) | `usePVGISProfile.fetchMonthlyRadiation` (`:266-318`) | `pvgis-monthly` → `re.jrc.ec.europa.eu/api/v5_3/MRcalc?lat&lon&startyear=2005&endyear=2023&horirrad=1&mr_dni=1&d2glob=1&avtemp=1` | lat, lng | Average each month across years; daily = monthly/daysInMonth with **Feb = 28.25**; annual = Σ daily×days; synthetic cosine day curve centred 12:00, sunrise `5+(|lat|−25)×0.05`, sunset `19−…`; fixed temp curve 20±8 °C; DNI=0.7 GHI, DHI=0.3 GHI (`index.ts:44-95,160-197`) | `typicalDay.hourlyGhi` in **kWh/m²** per hour (client multiplies ×1000 when peak <5, `useSolarProfiles.ts:143-147`) | `project_solar_data` (project_id, data_type) coordinate tolerance 0.001° (`usePVGISProfile.ts:126-208`) |
| **PVGIS TMY** | `fetchTMY` (`:211-263`) | `pvgis-tmy` → `/api/v5_3/tmy?lat&lon&startyear=2005&endyear=2023` | lat, lng | Typical day = mean by **UTC** hour (`index.ts:110`); summary PSH = Σ mean hourly/1000; `annualGhiKwh = mean(G(h))×8760/1000`; monthly breakdown; **`hourlyGhi8760` chronological in UTC** | W/m² | same table |
| **Solcast** | `useSolcastForecast.fetchForecast` (auto, 168 h, PT60M) | `solcast-forecast` → `api.solcast.com.au/data/forecast/radiation_and_weather` with `SOLCAST_API_KEY` | lat, lng, hours, period, params | Daily summaries grouped by **UTC date**; PSH = Σ ghi/1000 (assumes 60-min periods); 402 → `{success:false, errorCode:'QUOTA_EXCEEDED'}` HTTP 200 | raw `forecasts[]` | **none** (every panel mount re-fetches) |
| Solcast (averaged profile) | `generateAverageSolcastProfile` (`PVSystemConfig.tsx:219-250`) | — | — | mean GHI by **UTC** hour | W/m² | — |
| **GSA** | `useGlobalSolarAtlas.fetchData` | `global-solar-atlas` → `api.globalsolaratlas.info/data/lta?loc=lat,lng` (undocumented public API) | numbers | pass-through | annual `PVOUT_csi` kWh/kWp/yr, `GHI` kWh/m²/yr, monthly arrays | none |
| Fallback | — | — | — | city preset GHI (`SA_SOLAR_LOCATIONS`) | kWh/m²/day | — |

Coordinates: `lat = project.latitude ?? preset.lat`, `lng = project.longitude ?? preset lng map ?? 28.0`
(`useSolarProfiles.ts:102-105`); `hasCoordinates` is always true because presets have lat.

Auto-fetch effects (`useSolarProfiles.ts:108-131`): fire when source selected and data absent and not loading.
PVGIS/GSA effects have **no error guard** ⇒ on failure (loading→false, data null) the effect re-runs ⇒
**infinite retry loop with an error toast each cycle**. Solcast is guarded by `solcastError`.

Annual GHI used by PVsyst annual (`useSolarProfiles.ts:226-250`): GSA annual GHI → PVGIS monthly Σ(avgDaily×days, Feb 28)
→ TMY `annualGhiKwh` → Σ typical-day ×365 → preset×365.

### 4.2 PV yield models (there are six; know which one each number uses)

1. **Engine PV (actually drives energy & money)** — `useLoadProfileData.ts:385-401`:
   `norm[h]` = static curve `[0,0,0,0,0,.02,.08,.20,.38,.58,.78,.92,1.00,.98,.90,.75,.55,.32,.12,.02,0,0,0,0]` (Σ 7.6)
   (Solcast-normalised curve only if `useSolcast` were true — never);
   `DC_h = norm[h] × actualDcKwp × (1 − 0.14) × tempDerate`, `tempDerate = 1 − 0.004×(T−25)` for T>25 (T=25 static ⇒ 1);
   `AC_h = min(DC_h, inverterSize × inverterCount)` (clipping); × `overrideScaleFactor`.
   Same 24 values every day. No inverter efficiency, no location, no tilt, no reduction factor.
2. **Simplified KPI estimate** — `SimulationPanel.tsx:256-263`: `SY = GSA ? PVOUT_csi : annualGHI × 0.85 × (1 − reduction%)`;
   `annual = (AC × DC/AC) × SY / (DC/AC) = AC × SY` (DC/AC cancels ⇒ yield per **AC** kW).
3. **Display/comparison profiles** — `generateSolarProfile` (`PVSystemConfig.tsx:153-216`): with hourly data
   `kWh_h = DCkWp × GHI_h/1000 × systemEfficiency` (horizontal GHI, no transposition); without data a Gaussian
   (peak 12.5 h, σ 3.5 h +1.5/2.5 for tracking, 05–19 h) normalised to `DCkWp × presetGHI × eff × 0.9`; ×(1−reduction).
   GSA variant rescales to `DCkWp × PVOUT_csi / DC/AC` per year (`useSolarProfiles.ts:207-223`).
4. **PVsyst annual** — `calculateAnnualPVsystOutput(annualGHI, collectorArea, stcEff, DCkWp, cfg)` (`pvsystLossChain.ts:535-855`):
   `GlobInc = GHI×(1−transp)`; `GlobEff = GlobInc×(1−nearShade)(1−IAM)(1−soiling)`; `E_coll = GlobEff × area`;
   `EArrNom = E_coll × η_STC`; sequential ×(1−LID)(1−moduleDeg)(1−irrLevel)(1−temp)(1−spectral)(1−elecShade)(1−quality)(1−mismatch)(1−ohmic) = EArrMPP;
   ×(1−invEff)(1−overPower)(1−maxI if>0)(1−overV if>0)(1−Pthresh)(1−Vthresh)(1−night) = EOutInv; ×(1−availability) = E_Grid;
   `SY = E_Grid/DCkWp`, `PR = E_Grid/(GHI×DCkWp)`. Unconditional `console.log` block on every recompute (`:804-817`).
   With defaults & PVGIS ≈2,000 kWh/m² ⇒ PR ≈ 75.7 %, SY ≈ 1,515 kWh/kWp (horizontal; tilt gain not modelled).
   Hourly PVsyst profile for charts = GHI shape × E_Grid/365 × reduction (`useSolarProfiles.ts:277-287`).
5. **TMY 8,760 (only path that feeds the engine with real irradiance)** — `convertTMYToSolarGeneration`
   (`utils/calculators/tmySolarConversion.ts:90-121`), active only when source = TMY **and** mode = PVsyst:
   `DC_i = GHI_i × area × η_STC × DCloss × reduction / 1000`; `AC_i = min(DC_i × INVloss, inverterAC)`;
   `DCloss` = transposition×optical×array factors; `INVloss` = inverter factors (excl. night) × availability.
   Hour index = UTC (E10).
6. **Daily PVsyst panel** — `calculatePVsystLossChain(presetDailyGHI, AC kW, 25, cfg)` (`pvsystLossChain.ts:162-306`),
   inverter losses **summed** not multiplied; `calculateHourlyPVsystOutput` is dead and uses deprecated
   `config.transpositionFactor` (would yield NaN).

Overrides (`SimulationPanel.tsx:266-288`): `scale = SYoverride / calcSY` else `dailyOverride / calcDaily` else 1, where
`calcSY/calcDaily` = PVsyst annual if present else simplified. Applied multiplicatively to the engine curve, TMY 8760,
generic & Solcast profiles (`useSimulationEngine.ts:231-251`) — ratio is against a different model than the one it scales.

### 4.3 Inverter sizing, DC/AC, clipping
- `moduleMetrics` (`SolarModulePresets.ts:173-200`) from **installed** AC = size × count: `DC = AC × ratio`,
  `modules = ceil(DC×1000/Wp)`, `actualDC = modules×Wp/1000`, `area = modules × w × l`, `η = eff/100`.
- Count derived `max(1, ceil(desiredAC / size))` (`InverterSliderPanel.tsx:40`).
- Clipping: engine min(DC, AC) hourly (static curve ⇒ ~1.6 % clip at 1.25). PVsyst uses a fixed 1.037 % "over nominal
  power" loss irrespective of DC/AC. `calculateValidSizes` lists 1…10 × size.
- Two DC/AC ratios (pvConfig 1.3 unused; inverterConfig 1.25 used). Settings `defaultDcAcRatio` 1.2 unused.

### 4.4 Load profile input (boundary with other reviewer)
`useLoadProfileData` with all days & months, `displayUnit "kw"`, PF 0.9, diversity 1.0 (`useSimulationEngine.ts:162-207`).
The engine takes the **single averaged 24-h day** (`loadProfile = chartData.total`) and repeats it 365 times — no
weekday/weekend or monthly variation in load. Peak load = max of the averaged day (under-states real monthly
maxima, which inflates demand-charge savings logic).

### 4.5 Annual 8,760-h energy engine — `runAnnualEnergySimulation` (`EnergySimulationEngine.ts:749-922`)
Calendar: 365 days of 2026 (Jan 1 = Thursday), month from cumulative days, season high if month ∈
`touSettings.highSeasonMonths` (default Jun–Aug), dayType weekday/saturday/sunday, hourMap from TOU settings
(**browser localStorage key `tou-settings`**, global, not tariff-bound; defaults `load-profile/types.ts:143-175`).
No public holidays.

Per hour: `load = loadProfile[h]`, `solar = 8760[i] ?? profile[h]`. Battery: `state₀ = 50 % × cap`, limits
`min = cap×minSoC`, `max = cap×maxSoC`, charge/discharge kW = C-rate powers (fallback `batteryPower`).
Permissions per hour (`precomputeDayPermissions :275-292`):
- charge sources undefined/empty ⇒ PV charge allowed, grid charge = `allowGridCharging`; else per source TOU list
  (empty/undefined periods list with no defaults ⇒ always active).
- discharge sources undefined/empty ⇒ load/battery/export all allowed; else per source (battery default `['peak']`,
  others all periods).

Strategies:
- **self-consumption** (unreachable from UI) `dispatchSelfConsumption :294-367`: PV→load (if allowed) → excess →
  battery (≤ space, ≤ charge kW) → export (if allowed, else curtailed silently). Deficit → battery (≤ available above
  min, ≤ discharge kW) → grid. Battery-first variant when Battery ranked above Load.
- **none** (UI "Self-Consumption"): same but `batteryDischargeAllowed = false`.
- **tou-arbitrage** (`:417-542`): discharge hour iff the discharge TOU matrix permits (season/daytype/period); else
  charge hour iff any enabled charge source active (or legacy `chargeWindows`); charge hours may add **grid charging up
  to power headroom** (`batteryChargeFromGrid`); otherwise falls back to self-consumption with discharge disabled.
- **peak-shaving** (`:544-600`): discharge only the portion of net load above `peakShavingTarget` (default **150 kW**,
  no UI); grid charging in `chargeWindows` or default **22:00–06:00**.
- **scheduled** = tou-arbitrage (unreachable).
- `netBatteryFlows` nets simultaneous charge & discharge.
- Aux drain `W/1000` kWh every hour while above min SoC.
- **No round-trip / conversion efficiency, no inverter/PCS loss, no degradation inside year 1, no generator.**

Outputs: annual totals (load, solar, import, export, solarUsed, solarDirectToLoad, charge, discharge,
chargeFromGrid, parasitic), `selfConsumption = solarUsed/solar`, `coverage = (solarUsed+discharge)/load`,
`peakReduction = (peakLoad − max hourly import)/peakLoad`, `batteryCycles = discharge/cap` (annual).

### 4.6 Tariff → rate hook-in
- Rates: `tariff_rates` for `project.tariff_id`, replaced wholesale by `project_tariff_overrides.overridden_rates`
  when present (`useSimulationEngine.ts:322-368`). Only rows with `charge='energy'` get `rate_per_kwh = amount`;
  `tou` → Peak/Standard/Off-Peak/Any; `season` → High/Winter, Low/Summer, All Year.
- Plan charges: basic → `fixed_monthly_charge`, **first** `demand` row → `demand_charge_per_kva`, network_access →
  `network_access_charge` (fetched but **unused** in money), `legacy_charge_per_kwh = 0` (`:370-414`).
- `getCombinedRate` (`lib/tariffCalculations.ts:249-291`) adds `network_charge_per_kwh`, `ancillary…`, etc. — those
  columns **do not exist** in the current `tariff_rates` schema (only `amount`, `unit`, …), so only the energy rate counts;
  network_demand / ancillary / surcharge / subsidy rows are ignored.
- **`unit` is never read**: the simulation assumes `amount` is R/kWh; the Calculator divides by 100 (c/kWh). Mixed-unit
  tariffs will be wrong by 100×.
- Blended rates (`calculateAnnualBlendedRates :350-384`): TOU rates weighted by annual hour counts for all-hours or
  solar window (06–18); selected by `blendedRateType`; fallback **R 2.50** if none (`useSimulationEngine.ts:425`).
- `exportRatePerKwh = tariff.export_rate_per_kwh || 0` — column does not exist ⇒ always 0 (basic path).

### 4.7 Year-1 financials — `calculateFinancialsFromAnnual` (`simulation/FinancialAnalysis.ts:121-227`)
```
PF = systemCosts.powerFactor ?? 0.9
gridOnly = load×R + (peakLoad/PF)×demand×12 + fixed×12
withSolar = import×R + (peakImport/PF)×demand×12 + fixed×12 − export×exportRate(=0)
annualSavings = gridOnly − withSolar
capex = calculateTotalSystemCost(...)          (utils/simulationConfig.ts:17-59)
      = [AC kW × R/kWp + batteryDC kWh × R/kWh + H&S + water + CCTV + MV]
        × (1 + prof% + PM%) × (1 + contingency%)
payback = capex / (savings − maintenancePerYear)   (∞ if ≤0)
ROI = (savings − maintenance)/capex × 100
```
Notes: R/kWp is multiplied by **AC kW**, not DC kWp. `maintenancePerYear` is only computed when the Costs tab
has been opened (effect in `SystemCostsManager.tsx:238-242`); otherwise 0. Demand saving assumes the averaged-day peak
reduction applies every month. `annual_grid_cost` persisted as `import × 2.5` (hard-coded R2.50).

`threeYearOM` (`useSimulationEngine.ts:482-492`) = (AC×(R/kWp ?? **8500**)×solar% + batt×(R/kWh ?? **3500**)×batt%)
× (1 + (1+CPI) + (1+CPI)²) — fallback costs disagree with Settings defaults (12,000 / 8,000).

### 4.8 Flat metrics — `utils/financialMetrics.ts`
NPV = −capex + Σ savings/(1+r)^y (no escalation, no O&M); IRR Newton–Raphson from 10 %, ≤50 iter (no bracketing,
can diverge); MIRR with reinvestment rate; LCOE = (capex + Σ maint/(1+r)^y)/Σ gen×(1−0.5 %×(y−1))/(1+r)^y
(maintenance not passed by caller ⇒ 0). Used only when advanced results are null.

### 4.9 20-year cashflow — `runAdvancedSimulation` (`AdvancedSimulationEngine.ts:405-828`)
Lifetime = financial.projectLifetimeYears (default from Settings = 20) if financial enabled else 20.
Per year y:
- `panelEff` = 100 − cumulative degradation of years 1…y−1 (simple: (y−1)×rate; yearly: Σ rates) — year 1 = 100 %.
  Note the year-1 energy already contains PVsyst LID 2 % + module degradation 3.8 % when PVsyst/TMY is used ⇒ double count.
- `battRemaining` = same logic, reset after `replacementYear`, floored at EOL %.
- Income (hourly TOU path, whenever `tariffRates` non-empty): pre-computed year-1 income by iterating 8,760 hours ×
  `getCombinedRate(touPeriod, season)` for solarDirect, batteryDischarge, **export (retail rate!)**, and grid-charge cost;
  then × panelEff (× battRemaining for battery & grid charge) × `(1+esc)^(y−1)`.
  Legacy path (no rates): kWh × blended rate × index; export also at blended retail.
- Demand income = `(peakLoad−peakImport)/PF × demandRate × 12 × index` (not degraded).
- Insurance = `capex × ins% × 12 × (1+insEsc)^(y−1)` if financial.enabled && insuranceEnabled (default true) — E8.
- O&M = `maintenancePerYear × (1+CPI)^(y−1)`.
- Replacement (only if **degradation enabled** and y = replacementYear, default 10):
  `[AC×R/kWp×45 %×(70 %×10 % + 30 %×50 %) + battDC×R/kWh×30 %] × (1+CPI)^(y−1)`.
- Net = income − (ins + O&M + gridCharge) − replacement; cumulative; DCF at `financial.discountRate`.
- LCOE = [capex + Σ(O&M+ins) + Σ replacements] (undiscounted) / Σ delivered kWh/(1+lcoeRate)^y — mixes
  undiscounted costs with discounted energy (non-standard, under-states LCOE vs. convention).
- NPV at `systemCosts.lcoeDiscountRate`; IRR NR (bounded −99 %…500 %); MIRR at finance/reinvest rates.
- Sensitivity: best = income×(1+v), costs×(1−v/2); worst = income×(1−v), costs×(1+v); NPV at `financial.discountRate`;
  best/worst **payback is just expected × (1∓…)**, not recomputed.
- Payback = interpolated first year cumulative ≥ 0 (`calculatePayback :833-845`); returns `n+1` if never.
- Displayed `gridImport = base×loadGrowth / panelEff` (dividing by efficiency is wrong physics; display only).

### 4.10 Load-shedding analysis — `LoadSheddingScenarios.ts`
Stages 0–8 with hours/day 0, 2.5, 4, 6, 8, 10, 12, 14, 16 (`:80-90`) but fixed outage **hour lists** with 0,2,4,6,8,10,12,14,16
slots (stage 1 = 2 h not 2.5) (`:93-103`). Single 24-h self-consumption dispatch with `batteryPower`, initial SoC 50 %,
min/max 10/95 % defaults; unmet outage load counted; no export during outage. Annual = daily × 365 (every day at that
stage). `gridOnlyCost = load×365×R` (includes energy the grid could not have delivered), `savings = gridOnly − import×R`,
backup value = served-during-outage × (R5.00 − R) with **hard-coded R5.00/kWh** (`:273-279,307-313`). Recommendations
text thresholds 80 %, 50 %, 20 %.

### 4.11 Which number comes from which model (provenance)

| UI number | Model |
|---|---|
| Energy chart series, grid import, self-consumption, peak reduction, battery cycles | Engine (static PV curve unless TMY+PVsyst) |
| Solar Generated / Annual Production KPIs | Simplified estimate (or PVsyst annual) — not engine |
| Annual savings, payback (basic), ROI (saved) | Year-1 financial on engine |
| IRR, NPV, LCOE, MIRR, payback shown (tariff present) | Advanced 20-yr cashflow (default ON) |
| PVsyst panel PR/eGrid, degradation projection | Daily PVsyst on preset GHI & AC kW |
| Load shedding | Own 24-h model on `useSolarProfiles.solarProfile` |
| Saved `payback_years`, `roi_percentage`, `annual_solar_savings` | Year-1 basic calc (not the advanced numbers the user saw) |

---

## 5. Default & constant register

### 5.1 Loss defaults
PVWatts (`PVSystemConfig.tsx:51-62`): soiling 2, shading 3, snow 0, mismatch 2, wiring 2, connections 0.5, LID 1.5,
nameplate 1, age 0, availability 3 (%) ⇒ multiplicative 14.1 % (initial displayed 15.5 % additive). Simple mode
efficiency 0.85. Engine uses its own 0.14 + temp coeff 0.004/°C.

PVsyst (`pvsystLossChain.ts:93-127`, "SAXDOWNE" project): transposition 0.13, near shading 0.93, IAM 2.57, soiling 3.00,
spectral 1.046, electrical shading 0.23, irradiance level 0.417, temperature 4.916, module quality −0.75 (gain),
LID 2.0, module degradation 3.8, mismatch 3.396, ohmic 1.061, inverter efficiency 1.53, over-nominal power 1.037,
max current 0, over voltage 0, power threshold 0.004, voltage threshold 0.001, night 0.009, availability 2.071,
operationYear 10, η_STC 0.2149.

### 5.2 Financial / cost defaults
Settings (`hooks/useCalculationDefaults/defaults.ts`, **browser localStorage `calculation-defaults`**, per-browser):
R12,000/kWp; R8,000/kWh; DC/AC 1.2 (unused); PSH 5.5 (unused); losses 14 (unused); degradation 0.5 %/yr, first-year
2.0 %, battery 3 %/yr, EOL 70 %, life 20 y; discount 9 %, escalation 10 %, CPI 6 %, VAT 15 % (**never applied**),
insurance 1 %, finance 9 %, reinvest **8 %**; equipment 45 %, module share 70 %, inverter 30 %, module repl 10 %,
inverter repl 50 %, battery repl 30 %, year 10; prof fees 5 %, PM 3 %, contingency 5 %; carbon 0.95 kg/kWh etc.
`buildSystemCostsFromVariables` hard-codes O&M 3.5 % solar / 1.5 % battery. ProjectDetail fallbacks use reinvest
**10 %**, fees **0 %** when `DEFAULT_SYSTEM_COSTS` returns undefined (it will not, so Settings win).
`DEFAULT_SYSTEM_COSTS` is a Proxy re-reading localStorage every 5 s (`FinancialAnalysis.ts:257-266`).
Other hard-codes: R2.50 blended fallback & `annual_grid_cost`; 75 % connection limit; R5 backup value; 150 kW peak
target; 22–06 charge window; infographic DC/AC 1.3 and CO₂ 0.9; threeYearOM fallbacks 8,500/3,500.

### 5.3 Battery defaults
New project: capacity 0, C-rates 0, SoC 0/0, strategy none. Engine fallbacks (if undefined): min 10 %, max 95 %,
initial 50 %. Restore fallback DoD 85 %, C-rate = power/AC or 0.5.

---

## 6. Tab "solar-forecast"

### 6.1 `ProjectLocationMap.tsx` (map + solar data summary)
Props from ProjectDetail `1412-1420`. Mapbox token from `get-mapbox-token` (1 h stale). Map style satellite-streets.

| Control | Type | Purpose | Handler → effect | Data R/W | Validation | Errors / empty |
|---|---|---|---|---|---|---|
| Search location | Input (debounced 300 ms, ≥3 chars) | Google Places autocomplete | `handleSearchChange :372-409` → `google-places-search {query}` | — | — | silent on failure |
| Suggestion item | Button | Pick place | `handleSelectSearchResult :411-442` → `google-places-search {place_id}` → pending pin + flyTo z14 | — | — | toast "Could not get coordinates" |
| Location badge | Badge | project.location | `:582-586` | — | — | — |
| Lat / Long inputs | Text | Manual coords | `handleCoordinateChange :342-346` | — | — | — |
| ✓ Apply | Icon button | Validate & set pending pin | `handleApplyManualCoords :348-361` | — | lat ∈[−90,90], lng ∈[−180,180] | toast invalid |
| ✗ Cancel edit | Icon button | Revert inputs | `:363-369` | — | — | — |
| Map click | Map | Set pending pin | `:281-289` | — | — | — |
| Save Location | Button | Persist coords | `saveLocation :116-164` → reverse geocode (`geocode-location reverse`) → UPDATE `projects{latitude, longitude, location?}` → invalidate → fetch data for current source | W projects | disabled pending | toast error; **overwrites `location` text** with "municipality, province, South Africa" |
| Cancel (pending) | Button | Discard pin | `:506-514` | — | — | — |
| Try Geocode Again | Button | Re-run auto-geocode | `handleManualGeocode :250-253` | — | — | — |
| (auto) geocode on load | Effect | Location text but no coords | `geocodeLocation :167-241` → `geocode-location {project_id, location, save_to_project:true}` (server writes with service role) → fallback city dictionary (`:39-63`) client-side UPDATE | W projects | — | toast warning/error |
| Refresh | Icon button | Refetch (forceRefresh for PVGIS) | `handleRefreshForecast :516-526` | W project_solar_data | disabled loading | — |
| Monthly Avg / TMY / Solcast | ToggleGroup | Summary source | `handleDataSourceChange :484-498` | — | — | **independent from the Simulation tab source** |
| Summary panels | Read-only | PSH, kWh/m²/day, annual, 12 monthly, temp; Solcast 7-day list | `PVGISSummaryDisplay :791-852`, `SolcastSummaryDisplay :855-924` | — | — | "Set site location…", skeleton, error + Try Again |

### 6.2 `SolarForecastCard.tsx` (GSA long-term)
Despite the tab name, this is **not a forecast** — it is GSA long-term averages.

| Control | Type | Purpose | Handler | Defects |
|---|---|---|---|---|
| Latitude / Longitude | NumericInput step 0.0001 | Coordinates | `setLatitude/Longitude :75-79` | **Dead**: `handleFetch` resets them to the project defaults and fetches the defaults (`:33-37`) — typed values are ignored |
| Fetch / Refresh | Button | Call GSA | `fetchData(defaultLat, defaultLng)` | default coords when project has none = Johannesburg (−26.2044, 28.0456) (while Load Profile tab defaults to Cape Town) |
| KPIs | Read-only | PVOUT, GHI, DNI, temp, opt tilt, elevation, GTI, DIF | `:91-129` | not persisted; not linked to Simulation's GSA source |
| Monthly chart + table | Recharts bar + table | PVOUT & GHI per month | `:131-187` | — |
| Empty | Text | "Enter coordinates and click Fetch" | `:191-196` | misleading (coords ignored) |

---

## 7. Data model

### 7.1 Tables used
| Table | Columns used | RLS |
|---|---|---|
| `project_simulations` | id, project_id, name, simulation_type (text: solcast/pvgis_monthly/pvgis_tmy/gsa/legacy), solar_capacity_kwp (**AC kW**), battery_capacity_kwh (**DC**), battery_power_kw, solar_orientation (**stores city key**, e.g. "johannesburg"), solar_tilt_degrees, annual_solar_savings, annual_battery_savings (never written), annual_grid_cost (import×2.5), payback_years, roi_percentage, results_json, sort_order, created_at, updated_at | **Anyone CRUD** (S1) |
| `sandbox_simulations` | name, cloned_from_project_id, project_snapshot, scenario_a/b/c, sweep_config, parameter_history (unused), history_index (unused), is_draft, draft_notes (unused) | **Anyone CRUD** |
| `project_solar_data` | project_id, data_type ('tmy' / 'monthly_radiation'), latitude, longitude, data_json (full edge response incl. 8,760 array), fetched_at | **Anyone CRUD**; no unique (project_id,data_type) ⇒ duplicates make `.single()` error ⇒ cache miss forever |
| `simulation_presets` | user_id, name, description, config (advancedConfig), is_default (unused) | own rows only |
| `tariff_plans`, `tariff_rates`, `project_tariff_overrides` | read | (tariff reviewer) |
| `projects` | latitude, longitude, location, connection_size_kva, system_type, tariff_id | org-scoped (later migration) |
| `pv_layouts.simulation_id` | FK to project_simulations (ON DELETE SET NULL) | — |

### 7.2 `results_json` shape (autosave `useAutoSave.ts:117-154`; named save adds `usingSolcast`, omits blended fields)
```jsonc
{
  "totalDailyLoad": kWh, "totalDailySolar": kWh, "totalGridImport": kWh, "totalSolarUsed": kWh,
  "annualSavings": R, "systemCost": R, "paybackYears": y, "roi": %, "peakDemand": kW, "newPeakDemand": kW,
  "pvConfig": { location, moduleType, arrayType, tilt, azimuth, dcAcRatio, inverterEfficiency,
                losses:{soiling,shading,snow,mismatch,wiring,connections,lightInducedDegradation,nameplateRating,age,availability},
                totalLossPercent, groundCoverageRatio, bifacial, albedo, useDetailedLosses },
  "solarDataSource": "solcast|pvgis_monthly|pvgis_tmy|gsa",
  "inverterConfig": { inverterSize, inverterCount, dcAcRatio, selectedModuleId, customModule? },
  "systemCosts": { solarCostPerKwp, batteryCostPerKwh, solarMaintenancePercentage, batteryMaintenancePercentage,
                   maintenancePerYear, healthAndSafetyCost, waterPointsCost, cctvCost, mvSwitchGearCost,
                   insuranceCostPerYear, insuranceRatePercent, professionalFeesPercent, projectManagementPercent,
                   contingencyPercent, replacementYear, equipmentCostPercent, moduleSharePercent, inverterSharePercent,
                   solarModuleReplacementPercent, inverterReplacementPercent, batteryReplacementPercent,
                   costOfCapital, cpi, electricityInflation, projectDurationYears, lcoeDiscountRate,
                   mirrFinanceRate, mirrReinvestmentRate },
  "blendedSolarRate": R/kWh, "blendedRateType": "...", "useHourlyTouRates": bool,
  "blendedRates": { "allHours": R, "solarHours": R } | null,
  "lossCalculationMode": "simplified|pvsyst", "pvsystConfig": {irradiance{}, array{}, system{inverter{}}, lossesAfterInverter{}, operationYear, stcEfficiency, collectorAreaM2?},
  "productionReductionPercent": %, "advancedConfig": {seasonal, degradation, financial, gridConstraints, loadGrowth},
  "moduleCount": n, "inverterCount": n,
  "batteryStrategy": "none|tou-arbitrage|peak-shaving|...", "dispatchConfig": {chargeWindows[], dischargeWindows[], allowGridCharging, peakShavingTarget?, chargeSources[], dischargeSources[], dischargeTouSelection?},
  "chargeTouPeriod": ..., "dischargeTouSelection": {highSeason:{weekday:{peak,standard,offPeak},weekend:{…}}, lowSeason:{…}},
  "batteryChargeCRate", "batteryDischargeCRate", "batteryDoD", "batteryMinSoC", "batteryMaxSoC"
}
```
Not persisted: overrides, excludeLoadProfile, aux power, selected day/view, any hourly or 20-year results (they are
recomputed on load — so a saved simulation is **not reproducible** if Settings/localStorage/TOU/tariff change).

### 7.3 Browser-local state that changes results
`calculation-defaults`, `tou-settings`, `derating-settings` (Load-Profile tab only) in localStorage — per browser,
not per org/project. Two users see different numbers for the same project.

---

## 8. Edge functions (external APIs & keys)

| Function | verify_jwt | Secrets | Upstream | Input | Output | Failure modes |
|---|---|---|---|---|---|---|
| `pvgis-tmy` | false | none | PVGIS v5.3 `/tmy` | {latitude, longitude, startyear=2005, endyear=2023} | summary, typicalDay (UTC), monthly, hourlyGhi8760 (UTC) | `!lat||!lng` rejects 0 coords (400); 400 "location" → "not covered"; else 500 |
| `pvgis-monthly` | false | none | PVGIS v5.3 `/MRcalc` | same | summary, synthetic typicalDay (kWh units), monthly, rawMonthlyData | same; expects `Hd(h)_m` which MRcalc with `d2glob` likely returns as `Kd` ratio ⇒ DHI may be NaN (verify) |
| `solcast-forecast` | false | `SOLCAST_API_KEY` | Solcast forecast radiation_and_weather | {lat, lng, hours=168, period=PT60M, output_parameters} | summary, daily (UTC dates), hourly raw | 402 → 200 {QUOTA_EXCEEDED}; others 400 |
| `global-solar-atlas` | false (`config.toml:81-82`) | none | `api.globalsolaratlas.info/data/lta` (undocumented) | {latitude, longitude} numbers | pass-through annual/monthly | 502/500 |
| `geocode-location` | false | `MAPBOX_PUBLIC_TOKEN`, service role | Mapbox v5 geocoding (country=ZA) | forward {location, limit, project_id?, save_to_project?} / reverse {latitude, longitude, reverse:true} | coords/suggestions/province+municipality | **writes projects with service role for any project_id** |
| `get-mapbox-token` | false | Mapbox | — | — | token | — |
| `google-places-search` | not listed ⇒ default true (anon JWT suffices) | Google key | Places | {query} / {place_id} | suggestions / coords | — |

Solcast is a 7-day **forecast**; using its average as a representative "annual" profile is methodologically wrong
(E1 makes this moot today). Solcast is also fetched twice potentially (168 h here, 24 h in `useSolcastPVProfile`).

---

## 9. Standalone tools and how they differ

### 9.1 `/calculator` — `src/pages/Calculator.tsx` (+ `components/calculator/*`, `hooks/useTOUCalculation.ts`)
Bill calculator: Province → Municipality → User type → Tariff; consumption, max demand (kVA), solar kWp, battery kWh,
system cost; High/Low-demand split % slider; season switch; load profile type (residential/commercial/solar-optimised,
weekday % slider); TOU clock diagrams; `TariffComparison` (compare several tariffs). Solar = `kWp × 140 kWh/month`
(`:21,192`) subtracted from consumption.
**Broken against the current schema:** reads `rate_per_kwh`, `time_of_use`, `tariff_type`, `fixed_monthly_charge`,
`demand_charge_per_kva`, `critical_peak_rate` which do not exist on `tariff_rates`/`tariff_plans`
(`types.ts` rows); mapped TOU periods all get `start_hour 0 / end_hour 24`; rates divided by 100 (c/kWh assumption);
"High Demand"/"Low Demand" TOU labels never occur. Battery input is dead. Payback = cost / (12 × monthly saving).

### 9.2 `/projects/:id/quick-estimate` — `QuickEstimate.tsx` + `QuickEstimateForm/Results`
Inputs (defaults `:12-25`): city (10 presets with PSH), site area (**unused**), monthly kWh 250,000, solar 500 kW,
battery 0, Use Solcast switch (**unused**), losses 14 %, tariff R2.50, escalation 10 %. Calculate disabled until a city
is chosen; fake 500 ms delay.
Formulas (`:39-100`): daily = kW×PSH×(1−loss); selfCons ratio = min(0.85, consumption/generation) (caps at 85 % even
when load ≫ PV); savings = selfCons × tariff; cost = kW×12,000 + kWh×8,000 (hard-coded, not Settings);
20-yr ROI with 0.5 %/yr degradation & escalation; LCOE = cost/(annual×20×0.9) (no O&M, undiscounted). Battery only adds
cost. **Ignores the project entirely**; Back button navigates to `/simulations`, a non-existent route (→ 404).

### 9.3 `/projects/:projectId/sandbox/:id` — `SandboxWorkspace.tsx` + `components/sandbox/*`
Toolbar: Undo, Redo, Add scenario (A–C), Run simulation (500 ms fake), Save draft, Generate report, **Promote to
project (stub toast "coming soon")**. Scenario card sliders: solar 10–2000 kW, battery 0–1000 kWh, DC/AC 1.00–1.50.
Parameter sweep: enable switch + min/max/step for solar, battery, DC/AC → shows combination count only — **never
executed**. Draft report: copy text, download `.txt`, export PDF via `generate-pdf`.
Model (`useSandboxState.ts:120-152`): PSH 5.5, losses 14 %, fixed self-consumption 75 %, tariff R2.50, costs
12,000/8,000; DC/AC and battery have no energy effect; no load, no tariff, no project data (snapshot ignored).
State is **never hydrated from the DB** (saved scenarios lost on reload); undo/redo logic is inconsistent
(`undo` appends to history while decrementing index) and every slider tick pushes history. Step 0 ⇒ Infinity
combinations. `ProjectCloneSelector.tsx` is unused.

### 9.4 Engine consistency matrix

| Aspect | Profile Builder | Quick Estimate | Sandbox | Calculator |
|---|---|---|---|---|
| Irradiance | static curve (TMY in one mode) | city PSH | 5.5 PSH | 140 kWh/kWp/month |
| Losses | 14 % (engine) | 14 % | 14 % | none |
| Load | tenant hourly avg day | monthly kWh | none | monthly kWh + profile |
| Self-consumption | hourly dispatch | min(85 %, L/G) | 75 % fixed | consumption − PV |
| Tariff | DB TOU/blended (R/kWh) | typed | R2.50 | DB (c/kWh, broken) |
| Costs | Settings/Costs tab | 12,000/8,000 | 12,000/8,000 | typed |
| Battery | 8,760 dispatch | cost only | cost only | ignored |
| Finance | 20-yr cashflow | 20-yr simple | payback only | payback |

---

## 10. Defect register (severity-ranked)

**Critical (numbers wrong / security)**
1. E1/E2 static PV curve drives all energy & money; data sources & PVsyst ignored (`useSimulationEngine.ts:230-257`, `useLoadProfileData.ts:136-141,385-397`).
2. E3 KPI tiles from different models (`SimulationPanel.tsx:256-263,520-594`).
3. E7 export at retail in advanced cashflow (`AdvancedSimulationEngine.ts:95,545,567-569`).
4. E8 insurance ×12 (`AdvancedSimulationEngine.ts:450-451`).
5. E5 "Self-Consumption" = no discharge (`DispatchSections.tsx:251`; engine `:838-840`).
6. S1 open RLS on simulations, sandboxes, solar cache.
7. S2 unauthenticated service-role geocode write; open paid-API proxies.
8. E10 UTC-as-local hour for TMY 8760 and Solcast profile (`pvgis-tmy/index.ts:110,163`; `PVSystemConfig.tsx:232`).

**High**
9. No battery round-trip efficiency; new-project battery = 0 kWh (E6).
10. Capex uses AC kW × R/kWp (`simulationConfig.ts:37-39`); DC kWp shown elsewhere.
11. Installed-AC vs desired-AC mismatch between Inverter pane and engine (`InverterSliderPanel.tsx:39-56` vs `SimulationPanel.tsx:226-232`).
12. Overrides/reduction not persisted and applied against the wrong base (E4).
13. Autosave never fires for projects with no prior simulation (`useAutoSave.ts:180` requires `hasInitializedFromSaved`); autosave vs named-save restore conflict (§3.2.2); autosave failures silent.
14. Seasonal/Grid constraints/Load growth sections non-functional (E9); battery degradation UI never rendered (`AdvancedSimulationConfig.tsx:228`).
15. Hourly-TOU switch cosmetic in basic calc; two discount rates (NPV vs DCF/sensitivity).
16. Double-counted degradation (PVsyst LID+3.8 % in year 1 + advanced degradation).
17. LCOE mixes undiscounted costs with discounted energy.
18. Tariff `unit` ignored; non-energy per-kWh charges (network, ancillary, levies) dropped; first demand row only.
19. Discharge/charge source lists show "all off" while engine treats undefined as "all on"; first click silently disables other flows.
20. Demand-charge saving computed from averaged-day peak × 12 months.
21. Infinite refetch loop on PVGIS/GSA failure (`useSolarProfiles.ts:114-131`).
22. Maintenance/yr is 0 unless the Costs tab was opened (`SystemCostsManager.tsx:238-242`).

**Medium**
23. City preset (default Johannesburg) drives GHI labels, PVsyst panel, fallback profiles regardless of project location.
24. PVsyst model: no transposition (tilt/azimuth unused), fixed temperature loss, fixed clipping loss, operationYear no effect, flat 25-year projection, inverted sign colouring, waterfall transposition sign flip.
25. Two DC/AC ratios; `pvConfig.dcAcRatio` dead; initial total loss additive.
26. Battery "Daily cycles" shows annual cycles; SoC NaN at 0 capacity.
27. Single-day chart mixes per-day load with averaged-day engine flows.
28. Load-shedding: stage 1 hours mismatch, grid-only cost includes undeliverable energy, R5 backup value hard-coded.
29. Saved `payback_years`/`roi_percentage` are basic-calc figures, not the advanced values displayed.
30. `annual_grid_cost` uses R2.50; `solar_orientation` stores a city key.
31. SolarForecastCard lat/lng inputs dead; "forecast" is long-term data; not linked to simulation.
32. ProjectLocationMap source toggle independent of Simulation source; Save overwrites `location` text.
33. Setting-state-during-render in `InverterSliderPanel.tsx:43-45`.
34. `console.log` on every PVsyst recompute (`pvsystLossChain.ts:804-817`).
35. localStorage-scoped calculation defaults/TOU calendar ⇒ non-reproducible results across users.

**Low / dead code**
`handleSave` (SavedSimulations), `calculateHourlyPVsystOutput`, `applyGridConstraints`, `getSeasonal*`,
`AdvancedConfigComparison.tsx`, `FutureEnhancements*`, `LoadSheddingScenarios` exports only via index,
`ModeCard.tsx`, `ProjectCloneSelector.tsx`, dead inverter handlers in `InverterSizeModuleConfig`, unused
`buildPVsystConfigFromVariables`/`defaultDcAcRatio`/`defaultSystemLosses`/`defaultPeakSunHours`/`vatRate`,
`parameter_history`/`history_index`/`draft_notes`/`annual_battery_savings`/`is_default` columns, Sandbox "Promote"
stub, Calculator battery input, QuickEstimate site-area & Solcast switch, `/simulations` route.

---

## 11. Rebuild guidance for E-Site (engine spec, not code)

1. **One engine, one provenance.** A single server-side (or shared-package) function
   `simulate(project, config, weather8760, load8760, tariff) → {hourly8760, annual, cashflow}`; every KPI must come from it.
   Persist inputs **and** outputs (hash of inputs + engine version) so a saved simulation is reproducible.
2. **Weather:** PVGIS TMY 8,760 as the default (convert UTC → Africa/Johannesburg), POA transposition (tilt/azimuth,
   e.g. Hay–Davies/Perez) and cell-temperature model (NOCT/Faiman) from TMY temperature & wind; GSA PVOUT only as a
   sanity check; Solcast only for operational forecasting, never for yield.
3. **Load:** 8,760 (or 12×daytype×24) from meters, not one averaged day; monthly peaks for demand charges.
4. **DC/AC:** one ratio; installed AC = inverter nameplate; hourly clipping from the model, not a fixed %.
5. **Battery:** usable kWh, SoC window, charge/discharge kW, round-trip efficiency, aux load; strategies
   self-consumption / TOU arbitrage / peak-shave (target input) with explicit, persisted source permissions whose
   UI default equals the engine default.
6. **Tariff:** normalise `unit` (c/kWh vs R/kWh), include all per-kWh components, TOU calendar from the tariff
   (not localStorage), explicit export tariff (SSEG/Gen-offset) default 0 with UI, monthly demand on monthly peak.
7. **Finance:** capex on DC kWp (+ fixed items, fees, contingency, VAT decision), O&M computed server-side,
   insurance as annual % of capex (confirm the ×12 with the owner), degradation applied once, standard discounted LCOE,
   one discount rate, IRR with bracketing, payback & sensitivity recomputed per case.
8. **Security:** org-scoped RLS on every solar table; edge functions require JWT and check project membership; server
   holds Solcast/Mapbox/Google keys; per-org rate limiting for paid APIs.
9. **Scope trim:** drop Calculator (broken), fold Quick Estimate and Sandbox into the same engine with fewer inputs,
   drop the dead Advanced sections until implemented.
