# E-Site Solar — Calculation Engine Specification

**Status:** DRAFT for owner review · 2026-09-28
**Location in code:** `packages/shared/src/services/solar/` (pure TypeScript, no I/O, unit-tested).
Server routes load inputs, call the engine, persist outputs. The browser never computes a figure that
is shown as a result.

Every default below is an **org setting** (`01-functional-spec.md §11`) unless marked *fixed*. Values
marked **[D-nn]** await an owner decision (`06-open-decisions.md`).

---

## 1. Engine contract

### 1.1 Entry point
```
simulateCase(input: CaseInput): CaseResult
runFinancials(energy: CaseResult, fin: FinanceInput, tariff: TariffModel): FinanceResult
costBill(load8760: Float64Array, tariff: TariffModel, calendar: TouCalendar, year: number): MonthlyBill[]
```

### 1.2 Time base (fixed)
- Reference year of **8,760 hours** (no 29 Feb; a leap-year source drops 29 Feb). Hour index 0 =
  01 Jan 00:00–01:00 **SAST (UTC+2, no DST)**.
- Stored values are **interval-ending averages**: `load[h]` is average kW over hour h = kWh in hour h.
  Source files differ (format A labels interval *beginnings*); normalisation (§2.1) converts per format.
- Sub-hourly data (5/15/30 min) is kept for **maximum-demand** calculations (§2.6) and aggregated to
  hourly for energy.
- Weather sources in UTC (PVGIS TMY, Solcast) are shifted +2 h **before** use (WM Solar did not — PV
  peaked 2 h early).

### 1.3 Reproducibility (fixed)
Every run stores: `engine_version` (semver, bumped on any formula change), the full `CaseInput`
snapshot (JSON), `inputs_hash = sha256(canonical JSON of CaseInput)`, weather dataset id + fetch date,
tariff id + year + override hash, and the outputs. A case is **Stale** when the hash of its current
inputs differs from the last run's `inputs_hash`. Old runs are never recomputed in place.

### 1.4 Units (fixed)
Internally: kW, kWh, W/m², °C, m/s, ZAR (VAT-exclusive), fractions (0–1) for losses and percentages.
Tariff charges are converted to canonical units at ingestion (`03-data-model-and-security.md §4`), never
inferred from magnitude.

---

## 2. Load model

### 2.1 Meter normalisation (per channel)
Formats observed in the source corpus (as-is/10, 2,140 files read 2026-09-28) are recognised explicitly;
anything else goes to a generic path that requires the user to confirm every choice.

| Format | Signature | Values | Time label | Files |
|---|---|---|---|---|
| **A** | `sep=,` line, blank line, `date,p14,…` | Average kW per 30 min; channel vocabulary `p/q/s/a` × `14/23/12/34`, `_l1..3`, `u`, `i` (fixed table) | **Interval-beginning** (last label of the day 23:30); DD/MM/YYYY SAST; 591 files newest-first | 1,242 |
| **B** | PnP SCADA preamble with serial on line 1, `"P (per kW)" … DATE, TIME, STATUS`, comma-plus-space | Average kW; status `Calc` = estimated | Interval-ending | 703 (102 are **daily** 1,440-min files) |
| **C** | PnP `Time,P1 (kWh),…` | kWh per 30 min (→ kW); trailing `S (kVA)` = demand | Interval-ending | 73 |
| D/E/G | Escaped single-line copies, downloader logs, consolidation summaries | Not load data | — | Routed to Skip or to **Import meter register** |

0. **Identity and de-duplication (before anything else):** body hash of the parsed series (not only the
   file sha256) and, for PnP B/C, the line-1 serial checked against the filename and the org's meter
   register. The corpus holds 2,050 meter files but only 1,311 distinct series — one PnP series appears
   under 121 filenames at six malls. A file whose series or serial already exists must be resolved (link to
   the existing meter / skip / override with a reason) before import.
1. Timestamps parsed with the **file-level** date order (confirmed when ambiguous), `24:00` → next day
   00:00, row order normalised (newest-first files reversed). **The source labelling convention is set
   per format** (A = interval-beginning, B/C = interval-ending; generic = user-confirmed), then every
   reading is stored at its interval **end** (`ts_end`, UTC).
2. Cumulative registers: detected when ≥ 98 % of steps are non-decreasing over **all** rows and the
   median step ≪ level; converted to deltas (first row dropped). A decrease is a rollover or meter
   exchange and is shown to the user; it is never silently absorbed.
3. **Units are never defaulted.** Each recognised format maps its columns through a fixed unit table;
   the generic path requires the user to pick a unit. Energy → power (`kW = kWh × 60 / interval_min`)
   applies only to energy channels (format C `kWh`, format A `a14`). `kVA` stored as apparent power;
   `kvarh` for reactive costing. (WM's client path defaulted A-format kW to kWh and doubled every file.)
4. Missing / blank / non-numeric → **NULL** with quality flag `missing`; never 0. A PnP `Calc` value of
   exactly 0 is padding → **missing**; other `Calc` values → **estimated**.
5. Quality flags: 0 ok, 1 missing, 2 estimated (gap-filled or source-calculated), 3 negative, 4 spike,
   5 duplicate timestamp, 6 meter status ≠ OK, 7 scale-corrected (e.g. a segment recorded in W instead of
   kW, confirmed by the user). Spike detection includes **reset pairs** (a negative followed by a matching
   positive) and **level shifts**; WM dropped the negatives but kept their matching positive spikes.
6. **Daily-interval channels** (1,440-min PnP files) are not load data: they count toward coverage only
   and are excluded from §2.2 and §2.6.
7. Channels carrying volume (water) are refused as load data.

### 2.2 Gap filling and reference-year alignment
- Gaps ≤ 2 h: linear interpolation (flag 2).
- Gaps > 2 h and ≤ 14 days: filled from the mean of the same day-type (weekday / Saturday / Sunday or
  public holiday) and same hour in the surrounding ±4 weeks (flag 2).
- Gaps > 14 days: not filled; the channel's coverage falls below 12 months and readiness stays amber.
- **Reference-year alignment:** for each date of the reference year, take the source date in the data
  with the same month, the same day-type and the nearest day-of-month (public holidays map to
  holidays). This preserves weekday/weekend and holiday patterns instead of averaging them away
  (WM repeated one 24-hour average all year).
- Data longer than 12 months: the most recent complete 12 months are used by default; the user may
  choose the year on Load → Site profile.
- **Site common window (S2):** meters at one site can differ by up to three years, and some files cover
  only 7 days. S2 uses the most recent 12 months common to ≥ 80 % of metered tenants (setting). Months a
  meter does not cover are filled by S3 synthesis for that tenant scaled to the meter's observed
  kW/m² — **never by zero**. A meter with < 30 days of data is used only as a shape sample for its
  tenant's synthesis.

### 2.3 Site series by basis
- **S1 Bulk:** `site[h] = bulk[h]` + (existing PV generation if the bulk meter sits downstream of it; the
  flag names the **specific PV channel** — in every observed PV meter generation is on the **import**
  channel `p14`/`P1`). A meter *labelled* bulk is not trusted as the point of supply until the user confirms
  it and the monthly reconciliation against Σ tenants is shown (YARONA's "BULK METER" ≈ one anchor tenant;
  Σ tenants ≈ 2.5 × it). Meters of kind `check` are excluded from both S1 and S2.
- **S2 Tenants:** `site[h] = (Σ_tenants Σ_meters w_m × meter_m[h] + Σ_unmetered synth_t[h]) × (1 + common_area_pct)`.
- **S4 Monthly bills:** archetype shape per §2.4 scaled so that for each month m,
  `Σ_{h∈m} site[h] = bill_kWh_m`; if billed kVA is given, the month is additionally reshaped so
  `max_{h∈m} site[h] = kVA_m × PF` (PF default 0.95) by an **energy-preserving stretch about the monthly
  mean** (owner decision 5, 2026-09-28): `site'[h] = mean_m + (site[h] − mean_m) × s`, with
  `s = (kVA_m × PF − mean_m) / (max_m − mean_m)`, which keeps `Σ_{h∈m}` unchanged. Guards: a flat month
  cannot take a peak (left unchanged, warned); billed `kVA_m × PF` below the monthly mean would need
  `s < 0` and invert the shape, so the month is left unchanged with "billed kVA below average demand;
  check PF/kVA"; if the stretch drives hours negative they are clamped to 0 and the month re-scaled to
  `bill_kWh_m`, and the warning reports the peak actually achieved against the billed one. (Diversity,
  §2.5, is unrelated: S4 never applies `k`.)

### 2.4 Synthesis from the tenant schedule (S3)
For tenant t with area `A_t` (m², `structure.nodes.shop_area_m2`), category → density `D_c` (W/m², org
setting per category, average over operating hours) and archetype shape `s_a[h]` (8760 normalised so
that the mean over operating hours = 1):
```
synth_t[h] = A_t × D_c × s_a[h] / 1000        (kW)
synth_t[h] = 0 for h before the tenant's beneficial-occupation date (year 1 only)
```
Archetype shapes (retail 09:00–18:00 weekdays + Saturday, fast food 07:00–22:00 daily, supermarket
with 24 h refrigeration base 35 %, office/bank weekday 07:00–18:00, gym 05:00–21:00, anchor 24 h
base) are stored data (`solar.load_archetypes`), versioned, with a seasonal HVAC multiplier by month
**[D-06]**. Densities are seeded from the GCR category densities where the categories match.

### 2.5 Diversity (peak only)
Diversity factor `k` (default 1.0) never scales hourly energy (WM multiplied every hour by 0.8, which
cut energy by 20 %). It is used for one thing only: the **design maximum demand of synthesised tenants**,
`MD_synth = k × Σ_t max_h synth_t[h]`, which feeds the demand-charge estimate and the transformer check
when no measured data exists. Measured series (S1/S2) already contain real diversity, so the control is
disabled for them with the tooltip "Measured data already reflects diversity".

### 2.6 Maximum demand
Monthly maximum demand (kVA) for demand charges uses the **highest sub-hourly interval** available
(30-min if present, else hourly) in the tariff's chargeable TOU windows. Per format: B/C with a measured
`S (kVA)` channel use it directly; A files (mostly `p14` only) divide kW by the PF assumption (default 0.95,
shown as assumed); the choice is made per month, so a month the kVA channel does not cover falls back to
kW / PF rather than being dropped; daily B files cannot produce MD. The averaged profile's peak is never
used as MD.

For a site series with no sub-hourly data behind it — the S2 aggregate, S3 and S4 — MD is taken from the
**hourly site series and the PF** (owner decision 7, 2026-09-28): `MD_m = max_{h∈m} site[h] / PF` (kVA),
labelled hourly-based. A month of the series with no data has no MD (null), never 0 kVA.

---

## 3. PV model

### 3.1 Array auto-fill (Layout)
Inputs: roof polygon (m, from page scale), edge setback `e` (default 0.5 m flat / 0.3 m pitched),
obstruction polygons + their setbacks, module dimensions (L × W m), orientation, inter-module gap
(default 20 mm), mounting.
- Usable area = roof polygon inset by `e`, minus obstructions buffered by their setback.
- Flush-mount (pitched roof): grid of modules aligned to the roof's fall line, dimensions on plan
  **foreshortened along the fall line only** by cos(pitch) (WM applied it across the slope).
- Racked rows on flat roofs: row pitch `p = L_proj + d`, where `L_proj = L_slope × cos(tilt)` and the
  shading gap `d = L_slope × sin(tilt) / tan(α)`, α = solar elevation at 09:00 and 15:00 on 21 June at
  the site latitude (rule **[D-11]**, default "no inter-row shading between 09:00 and 15:00 on the winter
  solstice"), rows perpendicular to the array azimuth.
- Placement maximises module count by testing 0/90° grid orientation and 8 grid origin offsets; ties →
  fewer partial rows.

### 3.2 Array geometry
Azimuth convention: 0° = north, 90° = east, 180° = south, 270° = west (clockwise from true north).
Array azimuth = sheet direction of the fall line (or row normal) + north reference offset. Tilt in
degrees from horizontal.

### 3.3 String sizing (per inverter MPPT)
```
Voc_cold = Voc_STC × (1 + β_Voc × (T_min − 25)) × n        ≤ V_dc_max(inverter)   (hard fail)
Vmp_hot  = Vmp_STC × (1 + γ_Vmp × (T_cell_max − 25)) × n    ≥ V_mppt_min           (fail)
Vmp_cold = Vmp_STC × (1 + γ_Vmp × (T_min − 25)) × n         ≤ V_mppt_max           (warn)
I_string_parallel × Isc_STC × 1.25                          ≤ I_mppt_max           (fail)
```
T_min = site minimum ambient (from TMY, default −5 °C inland / 0 °C coastal), T_cell_max = max ambient
+ 35 °C (racked) / + 45 °C (flush). Recommended n = the largest n that passes all hard checks.

### 3.4 Irradiance and transposition (hourly)
- Source: PVGIS TMY (GHI, DNI, DHI, T2m, WS10m) for the site, UTC → SAST.
- Solar position: NREL SPA (or equivalent, accuracy ≤ 0.01°) at the hour midpoint.
- Plane-of-array: **Perez 1990** diffuse model (fallback Hay–Davies), ground albedo 0.2 (setting),
  beam = DNI × cos(AOI) for AOI < 90°.
- Incidence-angle modifier: ASHRAE `IAM = 1 − b0 (1/cos(AOI) − 1)`, b0 = 0.05 (module setting).

### 3.5 DC and AC power
```
T_cell = T_amb + POA × (NOCT − 20) / 800                     (NOCT model; Faiman optional)
P_dc   = P_STC × (POA_eff / 1000) × (1 + γ_Pmax × (T_cell − 25)) × (1 − L_dc)
L_dc   = 1 − Π(1 − l_i) over soiling, shading, mismatch, DC wiring, LID/LeTID, nameplate
P_ac   = min( P_dc × η_inv(P_dc / P_dc,rated), P_ac,rated ) × (1 − l_ac_wiring) × availability
Clipping = Σ max(0, P_dc × η_inv − P_ac,rated)
```
`η_inv` from the catalogue efficiency curve (default flat Euro-efficiency 97.5 %). Losses are
**multiplicative** (WM displayed an additive sum next to a multiplicative calculation).
Near shading from obstructions: a simplified horizon per array from obstruction heights and
distances, applied to the beam component hour by hour **[D-11]**; otherwise the fixed shading loss input.

### 3.6 Degradation
Year n energy = Year-1 × (1 − d₁) × (1 − d)^(n−1), d₁ = first-year (default 2.0 %), d = annual (0.5 %).
Applied **once**, in the cashflow (not also in the hourly model).

### 3.7 Validation targets (tests)
- For 5 SA reference sites (Johannesburg, Pretoria, Cape Town, Durban, Upington) × 3 orientations the
  engine's specific yield must be within ±3 % of PVGIS PVcalc for identical loss inputs. Public references
  only — no PVsyst dependency **[D-19]**.
- The WM static curve (≈ 2,346 kWh/kWp everywhere) must fail this test — it is the regression guard.

---

## 4. Energy balance and battery (hourly)

For each hour h:
```
pv      = P_ac[h]                     load = site[h] × (1 + case load adj)
direct  = min(pv, load)
surplus = pv − direct                 deficit = load − direct
```
**Battery** (usable capacity C kWh, SoC bounds [s_min, s_max]·C, charge limit Pc, discharge limit Pd,
round-trip efficiency η_rt split as η_c = η_d = √η_rt):

| Strategy | Charge | Discharge |
|---|---|---|
| Self-consumption | from surplus: `c = min(surplus, Pc, (s_max·C − SoC)/η_c)` | to deficit: `d = min(deficit, Pd, (SoC − s_min·C)·η_d)` |
| TOU arbitrage | surplus first; grid charging in off-peak if enabled, up to s_max | only in peak (then standard) windows of the pinned tariff calendar |
| Peak shaving (target T kW) | surplus; grid in off-peak if enabled | `d = min(max(0, load − direct − T), Pd, …)` |
Backup reserve r: discharge never below max(s_min, r)·C.
SoC[h+1] = SoC[h] + c·η_c − d/η_d.
```
export  = min(surplus − c, export_limit)     (0 when export mode = No)
curtail = surplus − c − export
import  = deficit − d (+ grid charging)
```
Outputs per hour: pv, direct, battery charge/discharge, SoC, export, curtail, import. Monthly MD after
solar recomputed from the sub-hourly load minus the hour's PV/battery contribution spread evenly across
its sub-intervals (documented approximation; conservative).

KPIs: specific yield = ΣP_ac / kWp_DC; PR = ΣP_ac / (ΣPOA/1000 × kWp_DC); self-consumption = (direct +
battery discharge from PV) / ΣP_ac; solar fraction = (direct + discharge) / Σload.

---

## 5. Bill engine (per billing month, per point of delivery)

Given a tariff (charges with canonical units), its TOU calendar and public holidays:
1. **Energy:** `Σ_h kWh_h × rate(season(month), tou(day_type, hour))` plus every per-kWh adder by TOU
   (legacy, **network demand charged in c/kWh** — e.g. Eskom Homeflex — ancillary, subsidy/affordability,
   electrification, surcharges). A per-kWh network-demand adder is never confused with an R/kVA demand charge.
   Structures: flat, IBT, **seasonal** (flat rate per season), **seasonal IBT**, TOU, TOU+IBT.
2. **Inclining blocks:** monthly kWh allocated across blocks in order (daily-basis blocks: block
   limits × days in month).
3. **Fixed:** every fixed component with a **per-day unit** (Eskom R/POD/day **and** municipal R/day, e.g.
   Cape Town) × days in the month, plus per-month components (R/month).
4. **Demand:** `max(chargeable MD, NMD rule) × R/kVA/month` (demand basis per charge: actual MD, MD in
   peak/standard windows, or utilised capacity).
5. **Network access / capacity:** either NMD × R/kVA/month, R/A/month for amp-based domestic tariffs, or
   **R/POD/day** (Eskom SPU network capacity charge, e.g. Homeflex) × days — the unit decides.
6. **Reactive:** `max(0, kvarh − 0.30 × kWh)` in chargeable periods × c/kvarh (only when kvarh data exists;
   otherwise shown as "not modelled"). The component comes from the normalised charge row, never from the
   source label (City Power labels a c/kVArh reactive charge "Demand").
7. **Export credit (NERSA Net-Billing Rules, pp7–12):** carried as **state across months**.
   - Export kWh per TOU period p in month m is valued at the export rate for that period (Eskom:
     the linked Gen-offset tariff by zone × voltage; municipal: user-supplied rate with provenance until
     SSEG schedules are ingested).
   - **Cap:** the credited kWh in each TOU period is capped at that period's **import** kWh (p7 §5.2),
     and the credit offsets **energy charges only** (never fixed, demand or network-capacity charges).
   - **Carry forward:** credit that exceeds the month's offsettable energy charges carries to the next month
     (`credit_in_m+1 = credit_out_m`); it is **never paid as cash** and the balance is **reset to zero at the
     distributor's financial-year end** (Eskom March, municipal June — `sseg_rule.fy_end_month`).
   - Non-TOU customers use `net_billing_flat` (p8 §5.4). Credit is forfeited on change of ownership
     (flag only; not modelled). Systems above `max_kva` (1,000 kVA) are refused net billing with a warning.
   - Output per month: export kWh by period, credit earned, credit used, credit carried, credit forfeited
     at FY end. The annual financial model uses credit **used**, so carried credit is neither lost within
     a year nor treated as cash.
8. **VAT:** stored as a rate; results reported excl. VAT, with VAT shown separately. VAT is not a
   saving for VAT-registered customers **[D-16]**.
9. Every stored charge is costed or explicitly listed as "not modelled" with a reason — no charge is
   silently ignored (WM costed only a blended energy rate, the first basic charge and the first demand charge).

**Validation:**
- The **10 golden tariff cases** in `as-is/09 §7.2` (hand-computed bills from the source books) run as unit
  tests of normaliser + engine; cases 2, 3, 7 and 10 exercise the exact defects of WM's seed (missing
  Standard period, off-peak tagged as peak, 100× unit error).
- Eskom's own worked examples / Tariff Comparison Tool outputs for Megaflex, Miniflex and Homeflex
  reproduced within ±1 % (public references only **[D-19]**). Real customer bills can be added later via the
  Tariff tab's bill check, but no release gate depends on them.

**Optional — wheeling scenario (only if off-site PV is in scope, [D-26]):** Option 1: full tariff bill −
wheeled kWh × (TOU WEPS/avoided-cost rate excl. losses), wheeled kWh capped per TOU period (Wheeling Rules
pp19–20), with loss factors from `tariffs.loss_factor`. Option 2: netting with fully unbundled use-of-system
charges (p21).

---

## 6. Financial model (annual, years 1…N, N default 25)

```
Saving_n  = Bill_before_n − Bill_after_n            (both from §5, tariff escalated by e_n)
Export_n  = included in Bill_after_n as credit
Energy_n  = Year-1 PV × degradation factor_n  (§3.6); battery capacity fade 2 %/yr to EOL 70 % [setting]
Opex_n    = O&M_n + Insurance_n + Monitoring_n      each escalated by CPI
Insurance = capex × i%  per year                    (i default 0.5 %) — NO ×12 [D-05]
Repl_n    = inverter repl. cost in its year; battery repl. cost in its year (real cost, escalated)
Tax_n     = company tax on (Saving − Opex − allowance) when tax enabled; Section 12B: 100 % of qualifying
            PV cost in year 1 for systems ≤ 1 MW (125 % under the 2023–2025 enhanced incentive only if the
            owner confirms eligibility) [D-16]
Debt_n    = annuity on loan % × capex at the loan rate over the term (if debt-financed)
Net_n     = Saving_n − Opex_n − Repl_n − Tax_n − Debt_n
CF_0      = −capex × (1 − loan %)
NPV       = Σ Net_n / (1+r)^n + CF_0
IRR       = r such that NPV = 0 (bracketed bisection on [−99 %, 200 %], reported "n/a" if no sign change)
Simple payback = first year cumulative Net ≥ −CF_0 (interpolated)
Discounted payback = same on discounted flows
LCOE      = (capex + Σ PV(Opex_n + Repl_n)) / Σ PV(Energy_n)          (discounted, standard definition)
```
Rules: one discount rate `r` (default org WACC **[D-07]**); tariff escalation `e_n` = approved % for years
with a published tariff, then the org default path; load growth applies to `Bill_before` and
`Bill_after` via re-simulation factors per year (energy balance rescaled, not re-run hourly per year).
Load-shedding value is computed separately and shown as an additional line, never merged into IRR by default.

**Validation:** a spreadsheet reference model (XLSX) of one case, built independently, must match
NPV/IRR/LCOE to 4 significant figures.

---

## 7. Defaults register (seed values for org settings)

| Setting | Default | Note |
|---|---|---|
| Soiling | 2 % | |
| Near shading (no obstructions drawn) | 1 % flush / 3 % racked | |
| Mismatch | 1 % | |
| DC wiring | 1.5 % | |
| AC wiring | 1 % | |
| LID/LeTID | 1.5 % | module datasheet overrides |
| Availability | 99 % | |
| Albedo | 0.20 | |
| First-year / annual degradation | 2.0 % / 0.5 %/yr | |
| Battery RTE / SoC min / SoC max | 90 % / 10 % / 95 % | new cases no longer start at 0/0 |
| O&M | R 150 /kWp/yr | **[D-07]** confirm |
| Insurance | 0.5 %/yr of capex | **[D-05]** |
| Discount rate | 11 % nominal | **[D-07]** |
| CPI | 5 % | |
| Tariff escalation beyond published | 9 % → 7 % linear to year 10 → CPI+1 % | **[D-07]** |
| Analysis period | 25 years | |
| Inverter replacement | year 12, 60 % of inverter capex (real) | |
| Battery replacement | year 10, 50 % of battery capex (real) | |
| Diversity | 1.0 | |
| Common-area allowance | 15 % (malls) | |
| Power factor (when no kVA data) | 0.95 | |
Values WM hard-coded (R 2.50/kWh fallback, 1,600/1,700 kWh/kWp fallbacks, R 12 k/kWp) are **not** used
anywhere: missing inputs block a run with a named reason instead of silently substituting a number.
