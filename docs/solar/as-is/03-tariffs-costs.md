# 03 — Tariffs and Costs (WM Solar → E-Site "Solar" add-on)

Source reviewed: read-only export of `origin/main` of `WattMatt/greencalc-sa` at
`scratchpad/wmsolar-main`. All paths below are relative to that root. Review date 2026-09-28.
Nothing in the source was modified.

This document is meant to let the Solar module's tariff and cost features be rebuilt without guessing.
Every claim cites `file:line`. Where the code does something wrong, the defect is stated next to the
behaviour it affects. Section 11 lists all defects together, ordered by severity.

---

## 0. Executive summary (read this first)

1. **The tariff database is shared by the whole app and has no versioning.** There are four tables
   (`provinces → municipalities → tariff_plans → tariff_rates`) plus a project override table. Everyone
   can read them, including anonymous users, and *any logged-in user* can insert, update or delete any
   row (`20260218094522…sql:154-163`). There is no organisation scoping, no audit trail and no history.
   An edit changes past results for every project that points at that plan.
2. **The data is not reproducible from migrations.** The 2026-02-18 rebuild migration drops every old
   tariff table and creates empty new ones. The ~1,978 plans and ~6,092 rates mentioned in its comments
   were loaded outside the migrations. The 2026-02-19 municipality seed (193 names) inserts rows against
   hard-coded province UUIDs that no migration creates, so a fresh database fails on it.
3. **Units are mixed and the maths ignores them.** The AI extractor stores energy in **R/kWh** but
   legacy, ancillary, network-demand and reactive charges in **c/kWh**
   (`process-tariff-file/index.ts:1147-1310`). The manual editors default to **c/kWh**
   (`TariffEditDialog.tsx:176,154`, `TariffBuilder.tsx:124`). The simulation reads `amount` as R/kWh
   and never looks at `unit` (`useSimulationEngine.ts:348`). The Tariff tab's display adds c/kWh and
   R/kVA/month values straight onto R/kWh energy rates (`TariffSelector.tsx:49-74`).
4. **The bill model is a simplified approximation, not a tariff bill.** The simulation charges
   annual kWh × **one blended R/kWh rate**, plus the first `basic` row × 12, plus annual peak kVA ×
   the first `demand` row × 12 (`FinancialAnalysis.ts:165-181`). It ignores the following completely:
   inclining blocks (only block 1 is used), network-access, service/admin (R/POD/day), legacy,
   ancillary, network-demand, GCC, reactive energy and VAT. Grid export earns **R0** in the basic model
   (`useSimulationEngine.ts:444`). In the advanced model it earns the **full retail import rate**
   (`AdvancedSimulationEngine.ts:94-96,545,567-569`).
5. **TOU definitions live in the browser, not in the tariff.** Hour maps and season months are stored
   in `localStorage["tou-settings"]` per browser (`useTOUSettings.ts:4-24`). Three different TOU
   definitions are shipped: the calculation default, the reference grid and the reference clock. They
   disagree with each other (§4.3). Public holidays are not handled anywhere.
6. **Several tariff-management features are broken against the current schema.** These include:
   - the Tariff Builder (every insert fails the enum check);
   - both Google-Sheet imports (they write to tables that were dropped);
   - the category and voltage pickers in the Edit dialog;
   - the extraction-status badges (the columns were dropped);
   - the "persist status" writes, which **wipe `nersa_increase_pct`**;
   - the extraction audit insert (its columns do not exist);
   - Eskom batching (three different names are used for the Eskom supply authority).
7. **Costs are stored only inside a simulation's `results_json`.** Nothing is saved when the project
   has no tenants. The data is reloaded from the newest-*created* simulation, so edits auto-saved into
   an older row can disappear (§8.5). The insurance figure is multiplied by 12, which is inconsistent
   with its label (§8.4).
8. **The security posture is not acceptable for a paid multi-tenant product.** The tariff edge
   functions run with `verify_jwt = false` and the service-role key, and call Anthropic. One of them
   (`upload-tariff-file`) is an open SSRF-to-storage proxy. The `tariff-uploads` bucket allows
   anonymous insert, select and delete. Mapbox popups inject strings from the database as HTML (§12).

**Recommendation for E-Site:** do not port the tariff subsystem as-is. Port the *data model idea*
(plan → rate lines keyed by charge/season/TOU/block) with these changes:
- a mandatory, normalised `unit` enum;
- versioning by `effective_from` with immutable published versions;
- TOU calendars attached to the tariff (or the supply authority) instead of the browser;
- an explicit "draft → reviewed → published" import pipeline instead of AI writing straight into
  production data.

Then write a real bill engine (§6.6) that handles every charge type stored.

---

## 1. Where things are

| Concern | Files |
|---|---|
| Project → Costs tab | `src/pages/ProjectDetail.tsx:740-853, 1267-1270, 1358-1367`; `src/components/projects/SystemCostsManager.tsx` (1,349 lines) |
| Project → Tariff tab | `src/pages/ProjectDetail.tsx:1051-1063, 1271-1274, 1369-1379`; `src/components/projects/TariffSelector.tsx` (1,038); `src/components/projects/ProjectTariffEditor.tsx` (257) |
| Dead project tariff UI | `src/components/projects/EskomTariffSelector.tsx` (926), not imported anywhere |
| Global page `/tariffs` | `src/pages/TariffManagement.tsx` (91) plus `src/components/tariffs/*` (21 files, 11,747 lines) |
| Blended-rate maths | `src/lib/tariffCalculations.ts` (550) |
| Financial maths using tariffs | `src/components/projects/simulation/FinancialAnalysis.ts`, `useSimulationEngine.ts:319-470`, `AdvancedSimulationEngine.ts:28-120, 405-600`, `src/utils/simulationConfig.ts`, `src/utils/financialMetrics.ts` |
| TOU definition | `src/components/projects/load-profile/types.ts:86-217`, `src/hooks/useTOUSettings.ts`, `src/components/settings/TOUSettingsCard.tsx`, `EnergySimulationEngine.ts:683-705` |
| Standalone calculator | `src/pages/Calculator.tsx`, `src/hooks/useTOUCalculation.ts`, `src/components/calculator/TariffComparison.tsx` |
| Edge functions | `supabase/functions/process-tariff-file` (1,665), `upload-tariff-file` (68), `ai-import-sheet` (701), `import-google-sheet` (327), plus `cache-boundaries`, `get-mapbox-token`, `geocode-location`, `google-places-search` (used by the map) |
| Schema | `supabase/migrations/20260218094522…sql` (rebuild), `…20260218102530` (FK), `…20260218195356` (extraction tables), `…20260219070504` (effective dates), `…20260219121343` (municipality seed), `…20260317092000` (project overrides), `src/integrations/supabase/types.ts:172-2452` |
| Reference data | `reference_wm_tariffs/` is **empty** in origin/main |
| Docs | `docs/` holds only `CSV_EXTRACTION_SPECIFICATION.md`. `docs/APP_SPEC.md` and `CLAUDE.md` do **not exist** on origin/main |

Routing: `/tariffs` → `TariffManagement` (`src/App.tsx:80`) and `/calculator` (`App.tsx:88`). Both sit
behind `ProtectedRoute` (login only, `App.tsx:46,75`). There is **no role check**, so every logged-in
user is effectively a tariff administrator. Sidebar entries: `AppSidebar.tsx:35` ("Tariffs") and `:41`
("Calculator").

---

## 2. Data model (as built by migrations)

### 2.1 History

| Migration | Effect |
|---|---|
| `20251202142806` | Original `provinces`, `municipalities`, `tariff_categories`, `tariffs`, `tariff_rates` (legacy shape: `rate_per_kwh`, `time_of_use`, `season` text) |
| `20251202143425` | Legacy `tou_periods` |
| `20251202153328` | Storage bucket `tariff-uploads` (private) with **anon-capable** insert/select/delete policies (§12) |
| `20251217150228…151356` | Legacy Eskom seed (Megaflex/Miniflex/… by zone and voltage, 2025/26) |
| `20260102045429`, `20260103034659`, `20260120102216`, `20260127082449` | Legacy extensions (unbundled columns etc.) |
| **`20260218094522`** | **Drops everything above** (`:15-22`), including the legacy seed, and recreates the NERSA schema below. Sets `projects.tariff_id = NULL` for every project (`:273`) |
| `20260218102530` | `projects.tariff_id` FK → `tariff_plans(id) ON DELETE SET NULL` |
| `20260218195356` | `extraction_runs`, `eskom_batch_status` |
| `20260219070504` | `tariff_plans.effective_from`, `effective_to` (DATE) |
| `20260219121343` | `UNIQUE(name, province_id)` on municipalities, Limpopo clean-up, 193 municipality names seeded |
| `20260317092000` | `project_tariff_overrides` |

`schema-dump.sql:59-160` is **out of date** relative to the migrations. It has no `description`,
`min_kw`, `max_kw`, `effective_from` or `effective_to` on `tariff_plans`, it adds an `updated_at` to
`tariff_rates`, and it has different defaults. Treat the migrations plus `types.ts` as the source of
truth.

### 2.2 Enums (`20260218094522…sql:40-62`)

| Enum | Values |
|---|---|
| `customer_category` | domestic, domestic_indigent, commercial, industrial, agricultural, public_lighting, sports_facilities, public_benefit, bulk_reseller, departmental, availability, other |
| `metering_type` | prepaid, conventional, both, unmetered |
| `tariff_structure` | flat, inclining_block, seasonal, time_of_use, demand, hybrid |
| `voltage_level` | low, medium, high |
| `charge_type` | basic, energy, demand, network_access, network_demand, reactive_energy, service, admin, maintenance, availability, capacity, ancillary, subsidy, surcharge, amperage, notified_demand |
| `season_type` | all, low, high |
| `tou_period` | all, peak, standard, off_peak |

### 2.3 Tables

**`provinces`** (`:69-74`)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL UNIQUE | Also holds the pseudo-province **"Eskom"** (`src/lib/constants.ts:17`) |
| code | text NOT NULL UNIQUE | The UI derives it from the first **2** letters (`ProvinceFilesManager.tsx:152`), the edge function from the first **3** (`process-tariff-file/index.ts:447`). "North West" and "Northern Cape" collide on "NO" |
| created_at | timestamptz | |

**`municipalities`** (`:77-89`, `20260219121343:3`)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| province_id | uuid NOT NULL → provinces ON DELETE CASCADE | |
| name | text NOT NULL | UNIQUE(province_id, name) is declared twice |
| nersa_increase_pct | numeric(5,2) | Shown only in the UI. Never used in any calculation. **Overwritten with NULL** by every extraction in ProvinceFilesManager (§10.4) |
| financial_year | text | Read (`ProvinceFilesManager.tsx:139`), never written, never displayed |
| created_at, updated_at | timestamptz | |

The UI also reads `extraction_status`, `total_tariffs`, `ai_confidence`, `reprise_count` and
`extraction_error` (`ProvinceFilesManager.tsx:215,226,450-461`; `MunicipalityMap.tsx:69-71,286`).
**None of these columns exist after the rebuild.**

**`tariff_plans`** (`:92-118`, `20260219070504`)

| Column | Type | Meaning | Written by |
|---|---|---|---|
| id | uuid PK | | |
| municipality_id | uuid NOT NULL → municipalities CASCADE | Supply authority | all writers |
| name | text NOT NULL | e.g. "Megaflex <= 300km < 500V" | all |
| scale_code | text | Eskom family (Megaflex…) | extractor `:1115`, edit dialog |
| category | customer_category NOT NULL | | extractor (`mapCategory`, default **industrial** `:43`) |
| metering | metering_type | from `is_prepaid` | extractor |
| structure | tariff_structure NOT NULL | Fixed→flat, IBT→inclining_block, TOU→time_of_use (`:11-21`) | all |
| voltage | voltage_level | | extractor |
| phase | text | "Single Phase"/"Three Phase"; the extractor defaults non-Eskom plans to **"Single Phase"** (`:1114`) | |
| min_amps / max_amps | numeric(10,2) | extractor puts `amperage_limit` into **min_amps** (`:1117`) | |
| min_kva / max_kva | numeric | `capacity_kva` → max_kva | |
| min_kw / max_kw | numeric | never written | |
| description | text | always null from extractor | |
| is_redundant | bool default false | Selector hides `true` (`TariffSelector.tsx:637`). **No UI sets it** | |
| is_recommended | bool default false | Badge only. No UI sets it | |
| effective_from / effective_to | date | Tariff year | extractor (from AI or file name), editors |
| created_at, updated_at | timestamptz | No trigger updates `updated_at` | |

There is no unique key on (municipality, name, effective_from). The extractor matches existing plans
in application code (`process-tariff-file/index.ts:1094-1127`).

**`tariff_rates`** (`:121-142`)

| Column | Type | Meaning |
|---|---|---|
| id | uuid PK | |
| tariff_plan_id | uuid NOT NULL → tariff_plans CASCADE | |
| charge | charge_type NOT NULL | What the line charges for |
| season | season_type default 'all' | high = Jun–Aug, low = Sep–May (by convention only) |
| tou | tou_period default 'all' | |
| block_number | int | Extractor sets it to the **array index + 1** of the rate, not the block ordinal (`:1152`) |
| block_min_kwh / block_max_kwh | numeric(10,2) | Inclining-block bounds; max null = ∞ |
| consumption_threshold_kwh / is_above_threshold | numeric / bool | Never written or read |
| amount | numeric(12,4) NOT NULL | Value, in `unit` |
| unit | text NOT NULL | Free text. Observed values: `R/kWh`, `c/kWh`, `R/month`, `R/kVA`, `R/kVA/month`, `R/POD/day`, `c/kVArh` |
| notes | text | Label, e.g. "Legacy charge", "Service charge [DISABLED]" |
| created_at | timestamptz | |

**`project_tariff_overrides`** (`20260317092000…sql:2-11`)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| project_id | uuid → projects CASCADE | |
| source_tariff_plan_id | uuid NOT NULL | **No FK.** Orphans survive plan deletion |
| overridden_rates | jsonb | **Full snapshot copy** of the plan's rate rows with edited amounts |
| overridden_plan_fields | jsonb | Always `{}`. No UI writes it (`ProjectTariffEditor.tsx:39,77`) |
| UNIQUE(project_id, source_tariff_plan_id) | | |

**`extraction_runs`** (`20260218195356:3-17`): municipality_id, run_type, tariffs_found / inserted /
updated / skipped, corrections_made, ai_confidence, ai_analysis, status, completed_at, created_at.
The edge function inserts `source_file_path` and `source_file_name` (`process-tariff-file/index.ts:1360-1361, 1545-1546, 1644`).
**Those columns do not exist, so every insert fails.** The error is not checked, which means **no
audit trail is ever recorded.**

**`eskom_batch_status`** (`:26-44`): municipality_id, batch_index (unique per municipality),
batch_name, status (pending / in_progress / completed / error), tariffs_extracted, timestamps. The UI
reads `error_message` (`ProvinceFilesManager.tsx:1676`), which does not exist.

**`projects.tariff_id`** → `tariff_plans(id) ON DELETE SET NULL` (`20260218102530`). A project
stores **only** the plan id. It keeps no copy of rates, no tariff year and no TOU calendar. Deleting
or re-extracting a plan silently detaches every project that uses it.

### 2.4 Views and function (all unused by the app)

- `v_tariff_lookup` and `v_municipality_summary` (`:169-195`) are referenced only by `types.ts`.
- `calculate_monthly_cost(p_municipality_id, p_category, p_kwh_usage, p_season, p_demand_kva)`
  (`:201-270`) is also referenced only by `types.ts`. It divides energy `amount` by **100**, assuming
  c/kWh (`:235-237`). That is **inconsistent with the extractor's R/kWh**. It also sums every `basic`
  and `demand` row regardless of unit, and ignores TOU rows (`tr.tou = 'all'` only).

### 2.5 How a tariff is represented (canonical examples)

| Real-world component | Row(s) in `tariff_rates` | Unit written by extractor |
|---|---|---|
| Basic / fixed charge | charge=basic, all/all | R/month (`process-tariff-file:1130-1137`) |
| Demand / network-access per kVA | charge=demand, all/all | R/kVA (`:1141-1148`) (period not recorded) |
| Energy, flat | charge=energy, all/all | R/kWh (`:1151-1162`) |
| Energy, IBT block n | charge=energy, all/all, block_min/max | R/kWh |
| Energy, TOU | charge=energy, season∈{high,low}, tou∈{peak,standard,off_peak} | R/kWh |
| Eskom legacy charge | charge=**ancillary**, notes "Legacy charge" | c/kWh (`:1166-1177`) |
| Generation capacity charge | charge=capacity, "[DISABLED]" | R/kVA/month |
| Transmission network charge | charge=**network_demand** | R/kVA/month (`:1192-1203`) |
| Network demand (peak / standard) | charge=network_demand, tou=peak / standard | c/kWh (`:1206-1231`) |
| Ancillary services | charge=ancillary | c/kWh |
| Electrification & rural subsidy | charge=**surcharge** | c/kWh |
| Service charge | charge=service, "[DISABLED]" | R/POD/day |
| Administration charge | charge=admin, "[DISABLED]" | R/POD/day |
| Urban LV subsidy | charge=subsidy | R/kVA/month |
| Affordability subsidy | charge=subsidy | c/kWh |
| Reactive energy | charge=reactive_energy | c/kVArh |

The `charge_type` values `network_access`, `maintenance`, `availability`, `amperage` and
`notified_demand` are defined but **never written** by the extractor. `network_demand` holds two
different things in two units. `ancillary` holds both "legacy" and "ancillary services". `subsidy`
holds two different things in two units. Downstream code cannot tell them apart without `notes`.

### 2.6 Seed / data volume

- Migrations seed **193 municipality names** (`20260219121343`): KwaZulu-Natal 38, Eastern Cape 33,
  Northern Cape 26, Western Cape 25, Free State 19, North West 18, Mpumalanga 17, Gauteng 9,
  Limpopo 7 (14 renamed and 1 deleted in the same migration), Eskom 1 ("Eskom Direct").
- **Zero tariff plans or rates are seeded by migrations.** The rebuild comments say "177 rows"
  (municipalities), "~1,978" plans and "~6,092" rates (`:76,91,120`). That production data was loaded
  out-of-band and cannot be counted from the repository. Per-province tariff counts therefore
  **cannot be derived** from the code.
- The Eskom extraction prompts target **"Eskom 2025-2026"** (`process-tariff-file/index.ts:870`), and
  the UI labels say "National tariffs 2025/26" (`TariffList.tsx:667`). At the review date (Sept 2026)
  the 2026/27 Eskom and municipal tariffs are in force. Nothing in the code flags stale data, and
  nothing refreshes the data.

---

## 3. How tariffs get into the database

There are five entry paths. Only two work against the current schema.

| # | Path | UI | Backend | Status |
|---|---|---|---|---|
| A | Province file extraction (bulk) | Tariffs page → Provinces tab → `ProvinceFilesManager` | `process-tariff-file` | Works, with defects |
| B | "Upload File" phased import | Tariffs tab header → `FileUploadImport` | `process-tariff-file` | Works, with defects |
| C | "Google Sheets" import | `GoogleSheetsImport` | `import-google-sheet` | **Broken.** Writes to dropped `tariffs` / `tariff_categories` (`import-google-sheet/index.ts:135,237,262`); inserts provinces without the NOT NULL `code` (`:146`) |
| D | "AI Sheet import" | `AISheetImport` | `ai-import-sheet` | **Broken.** Same dropped tables (`ai-import-sheet/index.ts:522,556,573,605,626`) |
| E | Manual "Tariff Builder" | Builder tab | direct supabase-js | **Broken.** See §9.6 |
| F | Manual edits | Edit dialog (TariffList), inline editor (FileUploadImport), project overrides | direct supabase-js | Partial (§9.4, §7.3) |
| — | `upload-tariff-file` | *not called anywhere in `src/`* | edge function | Dead but deployed. SSRF (§12) |

### 3.1 `process-tariff-file` pipeline (paths A and B)

Request body: `{ filePath, fileType ('xlsx'|'pdf'), province (default "Western Cape"), action, municipality, effectiveFrom, effectiveTo }` (`:143`).
Authentication: **none** (`supabase/config.toml:15-16` `verify_jwt=false`). It uses the service-role
key (`:153`).

1. **Download** from storage bucket `tariff-uploads` (`:157-167`).
2. **Parse** (`:173-207`):
   - xlsx/xls: SheetJS `sheet_to_json(header:1)`. Text is limited to the first **150 rows per sheet**
     for analysis (`:185`).
   - pdf: `pdf-parse`. If no text comes out it returns 400 "scanned image — please try Excel"
     (`:200-205`). **There is no OCR.**
   - `fileType` `xlsm` is never sent: both UIs map xlsm to `'xlsx'`.
3. **`action: "analyze"`** (`:210-246`): sends the first 50,000 characters to Anthropic
   `claude-sonnet-4-20250514` with a free-text "describe the structure" prompt. Returns
   `{sheets, rowCounts, analysis, sampleText}`. **The HTTP status of the AI call is not checked.**
4. **`action: "extract-municipalities"`** (`:249-529`):
   - Eskom province → municipality list `["Non-Local Authority"]` (`:256-257`).
   - xlsx → every sheet name, minus a trailing `- 12.34%`, becomes a municipality (`:259-266`). **The
     NERSA increase % in the sheet name is discarded rather than stored in `nersa_increase_pct`.**
   - pdf → regex on headings like `NAME - 12.72%` (`:269-283`). Then every known municipality for the
     province is fuzzy-scanned against the text using normalisation plus Levenshtein ≥ 0.8
     (`:286-366`). If nothing matches, it falls back to an AI list (`:374-406`).
   - It looks up the province by name. **If the province is unknown, it inserts a new one**
     (`:443-448`).
   - Each name is matched to a known municipality with a five-step fuzzy matcher (`:488-526`). The
     steps are exact normalised, contains, word-level Levenshtein ≥ 0.8, whole Levenshtein ≥ 0.8, and
     5-character prefix. If none matches it tries an `ilike` lookup, and **otherwise inserts a new
     municipality** (`:529-575`). The 5-character prefix step and the word-level step can
     false-match any two different municipalities that share a 5-character prefix or a ≥ 4-letter
     word (e.g. names containing "Greater …"). A wrong match silently files one municipality's tariffs
     under another.
   - Returns `{municipalities[{id,name,sheetName,matched}], allKnown[{id,name,found}], total, totalKnown, errors}`.
5. **`action: "preview"`** (`:593-627`): returns up to 100 raw rows of the sheet whose name contains
   the municipality name. For a PDF it returns the entire text split into lines.
6. **`action: "extract-tariffs"`** (`:629-1398`):
   - **Municipality lookup:** `municipalities.ilike(name).single()` across **all provinces** (`:637-641`).
     A name that exists in two provinces makes `.single()` error, and the function returns 404
     "not found". The seed itself contains two cross-province duplicates, **"Emalahleni"** (EC and MP)
     and **"Naledi"** (FS and NW) (`20260219121343`). Tariffs for those four municipalities cannot be
     extracted.
   - Loads the existing plans and rates for that municipality. They are passed to the AI as
     "EXISTING TARIFFS … ONLY return NEW or UPDATED" (`:840-842`).
   - **Eskom batching:** this applies only when `municipality === "non-local authority"` (`:659`).
     - There are 17 hard-coded batches (`:661-679`): Megaflex, Municflex, Megaflex Gen, Miniflex,
       Nightsave Urban, Businessrate, Municrate, Public Lighting, Homepower, Homeflex, Homelight,
       Ruraflex, Ruraflex Gen, Nightsave Rural, Landrate, Landlight, Generator Tariffs.
     - Each has sheet-name keywords and a table-structure description (4 zones × 4 voltages = 16
       tariffs).
     - The next non-completed batch comes from `eskom_batch_status` (`:720-735`).
     - For PDFs, batches whose name does not appear in the text are auto-completed (`:742-760`).
     - For Excel, a batch with no matching sheet is marked completed with 0 (`:792-806`).
   - **Text selection:** xlsx takes the first 200 rows of the matching sheet. A PDF uses a regex
     section from the municipality name to the next `NAME - x.xx%` heading, or the whole text with a
     focus instruction. Either way it is **truncated to 15,000 characters** (`:817-836`). Long
     municipal schedules are silently cut off.
   - **AI call:** Anthropic Sonnet 4 via forced tool `save_tariffs`, `max_tokens 8192`, 120 s abort,
     3 retries with 2 s and 4 s back-off (`:885-993`). Tool schema: `:900-958`. Prompt rules:
     - use **VAT-exclusive** values;
     - convert c/kWh to R/kWh;
     - IBT rows must carry block bounds;
     - TOU needs 6 rates;
     - extract effective dates (`:870-872`).
   - **Write (non-transactional)** (`:1087-1340`):
     - Key = `lower(name)|category|effective_from` (`:1088-1090`). If the key exists, update the plan,
       **delete all its rates** and re-insert them. Otherwise insert.
     - Rate rows are built as in §2.5.
     - **Deduplication**: for energy rows it keeps the *lowest* amount per `season|tou|block_number`.
       This is meant to drop VAT-inclusive duplicates (`:1313-1325`), but because `block_number` is the
       array index this only works for rows without block bounds.
     - A rate-insert error is only logged (`:1328-1335`); the plan still counts as inserted.
   - Writes an `extraction_runs` row, which **fails** (§2.3).
   - For Eskom, it marks the in-progress batch completed and returns `batchProgress` (`:1364-1388`).
   - Returns `{extracted, inserted, updated, skipped, existingCount, confidence, errors[≤20], batchProgress?}`.
7. **`action: "reprise"`** (second AI pass) (`:1400-1662`):
   - Re-reads the source: xlsx takes the first 250 rows. A PDF takes **the whole document text**, not
     the municipality section.
   - Sends the source plus the current DB rows to the AI tool `report_corrections`, which returns
     `{analysis, confidence_score, tariffs[{action,existing_name,…}]}`.
   - **Update corrections** delete *all* rates for the plan and re-insert only basic, demand and
     energy (`:1582-1605`). **This destroys every unbundled line** (legacy, network, ancillary,
     service, admin, subsidy, reactive) that the first pass wrote.
   - Corrections always set `phase "Single Phase"` and `category` via `mapCategory` (default
     "industrial"). That is wrong for Eskom plans, which should use `eskomFamilyCategory`.
   - **New corrections** are inserted with no effective dates, so they land in the "No Period
     Specified" bucket and duplicate the dated plans.

**Validation that exists:**
- file extension checks (UI);
- PDF-has-text check;
- enum mapping with defaults;
- the AI's own `confidence_score`;
- lowest-value dedup.

**Validation that does not exist:**
- numeric range checks (e.g. an energy rate between R0.10 and R20/kWh);
- units;
- that TOU plans have exactly 6 energy rows;
- block continuity or overlap;
- that basic/demand amounts are plausible;
- cross-checks against the previous year × NERSA %;
- human approval before production writes.

AI output becomes live, shared production data immediately.

### 3.2 Mapping helpers (`process-tariff-file/index.ts:11-102`)

| Helper | Mapping | Default |
|---|---|---|
| `mapStructure` | fixed→flat, ibt→inclining_block, tou→time_of_use, demand, seasonal, hybrid | flat |
| `mapCategory` | residential/domestic→domestic; indigent→domestic_indigent; business→commercial; agriculture→agricultural; street/public lighting→public_lighting; … | **industrial** |
| `eskomFamilyCategory` | public lighting; home*/landlight → domestic; landrate/ruraflex/nightsave rural → agricultural; municflex/municrate → bulk_reseller; businessrate → commercial | industrial |
| `mapVoltage` | lv/low→low, mv→medium, hv→high | null |
| `mapSeason` | contains high/winter→high; low/summer→low | all |
| `mapTou` | peak, standard, "off*"→off_peak, "high demand"→**peak**, "low demand"→**off_peak** | all |
| `mapMetering` | is_prepaid true/false → prepaid/conventional | null |

`mapTou` maps the "High demand / Low demand" *season* labels onto *TOU periods*. That is
semantically wrong: those labels describe seasons, not periods.

---

## 4. TOU (time-of-use) definitions

### 4.1 Storage and shape

- Type: `TOUSettings = { highSeasonMonths: number[] (0-based), highSeason: {weekday, saturday, sunday: Record<hour, 'peak'|'standard'|'off-peak'>}, lowSeason: {…} }` (`load-profile/types.ts:120-132`).
- Storage: `localStorage["tou-settings"]`. It is **per browser and global to all projects and all
  tariffs** (`useTOUSettings.ts:4-24`; `tariffCalculations.ts:18-35`; `load-profile/types.ts:185-191`).
- It is not stored in the DB and not snapshotted into `project_simulations.results_json` (the auto-save
  payload has no TOU settings, `useAutoSave.ts:104-154`). **Two people opening the same project on
  different machines can get different savings.**
- Editor: Settings → `TOUSettingsCard` (`src/components/settings/TOUSettingsCard.tsx:89-205`). Its
  controls:
  - a Lock/Unlock toggle (`:130`);
  - month badges that toggle high-season months (`:164-176`);
  - 3×24 hour grids per season, where a click cycles peak → standard → off-peak (`:95-106, 63`).
  
  `resetToDefaults` exists in the hook but **no UI button calls it**.

### 4.2 Calculation default (`DEFAULT_TOU_SETTINGS`, `load-profile/types.ts:143-176`)

High season = Jun, Jul, Aug.

| Day | High season | Low season |
|---|---|---|
| Weekday | Peak 06–09, Std 09–12, **Off-peak 12–14**, Std 14–17, Peak 17–19, Std 19–22, Off-peak otherwise | Std 06–07, Peak 07–10, Std 10–18, Peak 18–20, Std 20–22, Off-peak otherwise |
| Saturday | Std 07–12 | Std 07–12, Std 18–20 |
| Sunday | all Off-peak | all Off-peak |

### 4.3 Conflicting reference definitions (display only)

| Source | Weekday | Saturday | Sunday |
|---|---|---|---|
| `TOUTimeGrid.tsx:18-61` (Tariffs → TOU Reference, "Grid" tab) | Both seasons: Std 06–07, **Peak 07–09**, Std 09–17, **Peak 17–20**, Std 20–22 | Std 07–12 | Std 07–12 (comment says "no evening standard") |
| `TOUClockDiagram.tsx:391-432` (TOU Reference "Clock" tab) | Same as grid | Std 07–12 | Std 07–12 **and 18–20** ("NEW 2025") |
| `TOUReference.tsx:29-32` text | "Morning peak 2 h (07–09), evening 3 h (17–20), new Sunday 18–20 standard" | | |
| Calculation default (§4.2) | Differs from all of the above (e.g. high-season peak 06–09 and 17–19, midday off-peak) | | |

**The reference pages tell the user one schedule while the maths uses another.** None of the four
sources is tied to a tariff. Eskom and each municipality can define different TOU windows, and the
schema has no place to store them. (The legacy `tou_periods` table was dropped.)

### 4.4 Season and day calendar

- Blended-rate maths uses fixed day counts: `SEASONAL_DAYS = high {66 weekdays, 13 Sat, 13 Sun} = 92;
  low {195, 39, 39} = 273` (`tariffCalculations.ts:40-43`). These are correct for 2026 Jun–Aug.
  **They do not follow `highSeasonMonths` if the user edits it.**
- The hourly engine builds a 365-day 2026 calendar: 1 Jan = Thursday, season from `highSeasonMonths`,
  Sat/Sun from the weekday (`EnergySimulationEngine.ts:683-705`).
- **Public holidays are not handled anywhere.** Eskom bills SA public holidays as Saturday or Sunday
  schedules. A grep for "holiday" finds nothing outside onboarding text.
- Leap years are ignored (365 days).

### 4.5 Annual hour counts under the default settings (computed from §4.2)

| Window | Peak | Standard | Off-peak | Total |
|---|---|---|---|---|
| 24 h (`getAnnualHours24H`) | 1,305 | 3,077 | 4,378 | 8,760 |
| "Solar" 06:00–18:00 (`getAnnualHoursSolar`) | **849** | 2,411 | 1,120 | 4,380 |

The UI claims the solar window is "6-hour … 2,190h/year with **zero Peak TOU exposure**",
"92.9% Standard, 7.1% Off-Peak" and shows a hard-coded "(0% exposure)" next to the peak-hour count
(`TariffSelector.tsx:242, 370, 435, 454-456`). **All of those statements are false for the code as
shipped.** The window is 12 hours (`tariffCalculations.ts:68`), and 19% of its hours are peak.

---

## 5. Blended-rate algorithm (`src/lib/tariffCalculations.ts`)

Input: an array of legacy-shaped `TariffRate { rate_per_kwh, time_of_use: 'Peak'|'Standard'|'Off-Peak'|'Any', season: 'High/Winter'|'Low/Summer'|'All Year', network_charge_per_kwh?, ancillary_charge_per_kwh?, electrification_rural_per_kwh?, affordability_subsidy_per_kwh? }` (`:182-191`).
Callers must first map the DB rows into this shape (§5.3).

1. `getCombinedRate(rates, tou, season, tariff)` (`:249-292`):
   - Keep only rows with `rate_per_kwh > 0`.
   - Look for a row matching both TOU and season. If none, the "Any" TOU row for that season. If
     none, the flat row (All Year + Any). If none, return 0.
   - Return `base + legacy_charge_per_kwh(tariff) + network + ancillary + elecRural + affordability`.
2. `countTOUHours(hourMap)` over 0–23 and `countSolarTOUHours(hourMap, 6, 18)` (`:50-77`).
3. Per season: `hours = Σ_daytype count[daytype] × SEASONAL_DAYS[season][daytype]` (`:102-118`).
4. `calculateAllHoursBlendedRate(season) = (Hpk·Rpk + Hstd·Rstd + Hop·Rop) / Htotal` (`:302-320`).
   The solar version is the same, using solar-window hours (`:326-344`).
5. `calculateAnnualBlendedRates` (`:350-384`) returns, for each window,
   `{high, low, annual = (high·Hhigh + low·Hlow)/Hannual, hourBreakdown}`.
6. There is no rounding. The UI shows `toFixed(4)`.
7. `isFlatRateTariff` (`:211-218`) is true when every row is All Year + Any. `getFlatRate` (`:223-244`)
   takes the first positive row.
8. Legacy exports `calculateBlendedSolarRate`, `calculateAnnualBlendedRate` and
   `getBlendedRateBreakdown` (`:445-550`) are marked deprecated. They use a hard-coded `SOLAR_CURVE`,
   exclude peak entirely and weight 9:3 months. They are imported only by the dead
   `EskomTariffSelector`.

`TOU_HOURS_*`, `ANNUAL_HOURS_*` and `TOU_PERIODS` are getter objects that **re-read and re-parse
localStorage on every property access** (`:155-177, 411-415`). The UI reads them dozens of times per
render.

**Implication for inclining-block tariffs:** every block row is "All Year + Any", so `getCombinedRate`
returns the **first** positive block (usually the cheapest). Consumption-dependent block pricing is
never modelled in the project simulation.

### 5.1 The six selectable "blended rate types"

`BlendedRateType = allHours | allHoursHigh | allHoursLow | solarHours | solarHoursHigh | solarHoursLow`
(`TariffSelector.tsx:197-199`). The value is chosen in two places:
- the Tariff tab cards (§7.2);
- the Simulation tab dropdown (`FinancialConfigPane.tsx:117-160`).

It is stored in ProjectDetail state (default `solarHours`, `ProjectDetail.tsx:714`) and persisted
inside the auto-saved simulation JSON. `useSimulationEngine.ts:421-432` maps it to a number. With **no
tariff rates it falls back to R2.50/kWh** (`:422`).

### 5.2 "Hourly Rates" toggle

`useHourlyTouRates` defaults to true (`ProjectDetail.tsx:717`) and is toggled in
`FinancialConfigPane.tsx:165-170`. When it is on, the dropdown is disabled and the label reads
"Hourly TOU". **The simulation engine never reads the flag.** It is destructured and ignored
(`useSimulationEngine.ts:80,157`):
- basic financials always use the blended rate;
- advanced financials always use hourly TOU whenever tariff rates exist
  (`AdvancedSimulationEngine.ts:437`).

**The toggle is cosmetic.**

### 5.3 DB → `TariffRate` mappers (two different ones)

| Mapper | Energy base | Adds network / ancillary? | Used for |
|---|---|---|---|
| `useSimulationEngine.ts:343-351` (and overrides `:357-367`) | `amount` if charge=energy, else 0. **No unit conversion** | No | **All financial results** |
| `TariffSelector.tsx:27-76` `mapDbRatesToTariffRates` | `amount` of energy rows | Yes: `network_demand`+`network_access` summed into a per-kWh field, `ancillary` (last one wins); also looks for `electrification_rural` / `affordability_subsidy`, **which are not `charge_type` values** (dead). Lookup key is `season|tou` of the adder row, so Eskom adders stored as `all|all` or `all|peak` **only attach to energy rows keyed the same way** | **Tariff tab display only** |

Consequences:
- The rate the user clicks "Selected for simulation" on in the Tariff tab can differ from the rate
  the simulation uses.
- On flat tariffs (energy `all|all`) the display adds R/kVA/month and c/kWh numbers onto R/kWh, which
  inflates the displayed rate.
- `legacy_charge_per_kwh` is always `0` in the engine (`useSimulationEngine.ts:392`), and
  `Number(selectedTariff.legacy_charge_per_kwh)` in the selector is `undefined → 0` because that column
  no longer exists.

---

## 6. Bill-calculation algorithms actually used

### 6.1 Tariff inputs to the engine (`useSimulationEngine.ts:370-446`)

```
fixedMonthlyCharge  = first rate with charge='basic'          .amount   (unit ignored; assumed R/month)
demandChargePerKva  = first rate with charge='demand'         .amount   (assumed R/kVA/month)
networkAccessCharge = first rate with charge='network_access' .amount   (fetched, NEVER used)
averageRatePerKwh   = selectedBlendedRate (§5.1)               (R/kWh assumed)
exportRatePerKwh    = tariff.export_rate_per_kwh || 0          → column does not exist → always 0
```

Project overrides replace the rate list and the basic/demand/network amounts when a
`project_tariff_overrides` row exists (`:354-367, 397-413`).

### 6.2 Basic financials, "before vs after solar" (`FinancialAnalysis.ts:121-227`)

Inputs come from the 8,760-hour energy simulation: `totalAnnualLoad`, `totalAnnualGridImport`,
`totalAnnualGridExport`, `peakLoad`, `peakGridImport` (kW).

```
PF = systemCosts.powerFactor ?? 0.9                      (no UI sets it)
Grid-only:   E0 = annualLoad × avgRate
             D0 = (peakLoad / PF) × demandRate × 12
             F  = fixedMonthly × 12
             C0 = E0 + D0 + F
With solar:  E1 = annualGridImport × avgRate
             D1 = (peakGridImport / PF) × demandRate × 12
             X  = annualGridExport × exportRate          (= 0 in practice)
             C1 = E1 + D1 + F − X
Savings      S  = C0 − C1 ;  savings% = S / C0
Capex        = calculateTotalSystemCost(...)             (§8.3)
Payback      = capex / (S − maintenancePerYear)          (∞ if ≤ 0)
ROI %        = (S − maintenancePerYear) / capex × 100
Daily/monthly figures = annual / 365 or / 12
```

Modelling gaps and defects in this model:
- **Demand** is the single annual maximum hourly kW, charged in all 12 months. This overstates the
  demand charge for seasonal loads. It ignores the TOU window in which demand is measured
  (Eskom: peak/standard only) and the maximum-of-NMD-or-actual rule. No kVA or notified-demand logic.
- There is no block pricing, no per-POD daily charges, no network-access charge, no unbundled per-kWh
  adders and no reactive energy.
- **There is no VAT.** The extractor deliberately strips VAT (§3.1). The Settings toggle "Include VAT
  in calculations — add 15% VAT to all tariff calculations" is component-local `useState` that is
  never persisted or read (`src/pages/Settings.tsx:31,168-174`). **It is a dead control.** The
  `vatRate: 15` default (`useCalculationDefaults/defaults.ts:59`) is edited in Settings but consumed
  by no calculation.
- **No escalation** is applied in the basic model. NPV, IRR and MIRR use constant annual savings for
  `projectDurationYears` (`financialMetrics.ts:34-65`, called at `useSimulationEngine.ts:486-497`,
  which passes no degradation or maintenance, so LCOE excludes O&M).
- **Solar-only mode** (`excludeLoadProfile`, `useSimulationEngine.ts:449-463`) sets load and import to
  0 and export to all solar. Because the export rate is 0, **savings come out as exactly R0**.
- `project_simulations.annual_grid_cost` is saved as `gridImport × 2.5` — a **hard-coded R2.50/kWh**
  (`useAutoSave.ts:115`).

### 6.3 Advanced financials (`AdvancedSimulationEngine.ts`)

This model is enabled only when any advanced block is enabled (`useSimulationEngine.ts:500-505`). The
tariff-related parts:

- **Hourly TOU income** (`:63-120`). For each of the 8,760 tagged hours,
  `rate = getCombinedRate(rates, hour.touPeriod, hour.season)`. From that it computes:
  - solar-direct income = solarDirectToLoad × rate;
  - battery-discharge income = discharge × rate;
  - **export income = gridExport × rate** (full retail import rate);
  - grid-charging cost = batteryChargeFromGrid × rate.
- **Legacy branch** (`:563-576`): all of the above at `averageRatePerKwh`, and **export at the same
  retail rate**.
- **Escalation**: `energyRateIndex = (1 + tariffEscalation)^(year−1)`, where `tariffEscalation =
  financial.enabled ? financial.tariffEscalationRate : 10` (`:463, 521`). **The Costs tab's
  `electricityInflation` is not used here.**
- **Demand income** = `max(0, peakLoad/PF − peakGridImport/PF) × demandRate × 12 × escalation`
  (`:456-459, 582`).
- **Insurance** = `capex × insuranceRate% × 12` (a "monthly" rate), escalated by
  `insuranceEscalationRate` (`:450-455`).
- O&M = `maintenancePerYear × CPI index`. Here CPI = `financial.inflationRate`, **not**
  `systemCosts.cpi`.

**Export treatment is therefore contradictory between the two models:** R0 in the basic model versus
full retail offset in the advanced model. Neither implements a municipal SSEG / net-billing feed-in
rate, an export cap, or Eskom Gen-offset / WEPS credit. The `ESKOM_TARIFF_CATEGORIES.GENERATOR` list
(`FinancialAnalysis.ts:284`) is reference text only.

### 6.4 Standalone Calculator (`/calculator`)

This path is **inconsistent with the current schema and with the rest of the app.**
- `useTOUCalculation.ts` divides every rate by **100** (assumes c/kWh) (`:95,113,122,148,212`).
- Its day weights do not sum to 1. With weekday% = 71: 0.507 + 0.0207 + 0.0207 ≈ 0.55, which
  understates energy (`:72-74`).
- `Calculator.tsx:104-138` maps every rate row to a Weekday 00–24 "TOU period". It reads the
  non-existent `tariff_type`, `fixed_monthly_charge`, `demand_charge_per_kva`, `critical_peak_*` and
  "High Demand"/"Low Demand" labels from the legacy schema (`:141-206`).

**Out of scope to port. Flag as broken.**

### 6.5 Summary table — which stored charges are costed

| charge (unit) | Tariff tab display | Basic engine | Advanced engine | Calculator |
|---|---|---|---|---|
| energy flat (R/kWh) | yes | yes | yes | ÷100 (wrong) |
| energy TOU (R/kWh) | yes | via blended | hourly | partially |
| energy IBT blocks | first row only (flat badge) | **block 1 only** | block 1 only | ÷100 |
| basic (R/month) | yes "/month" | yes ×12 | no (not income) | legacy field |
| demand (R/kVA) | yes | annual peak ×12 | peak saving ×12 | legacy |
| network_access | adds to kWh rate (wrong) | fetched, unused | no | no |
| network_demand R/kVA/month | **adds to kWh rate** | no | no | no |
| network_demand c/kWh (peak/std) | added only if key matches | no | no | no |
| ancillary (legacy, ancillary, c/kWh) | added only if `all|all` energy | no | no | no |
| surcharge / subsidy / capacity / service / admin | no | no | no | no |
| reactive_energy (c/kVArh) | text only | no | no | no |
| VAT | no | no | no | no |

### 6.6 What a correct engine needs (spec input for E-Site)

For each billing month m (and each POD):
1. Energy = Σ_hours kWh_h × rate(season_m, tou(daytype incl. holidays, hour)).
2. IBT = monthly kWh allocated across blocks.
3. Unbundled per-kWh adders by TOU (legacy, network demand, ancillary, subsidies, surcharges).
4. Fixed = service + admin (R/POD/day × days) + basic (R/month).
5. Demand = max(kVA in chargeable TOU windows, NMD rule) × R/kVA/month. Network access = NMD ×
   R/kVA/month. Plus GCC and transmission as applicable.
6. Reactive = max(0, kVArh − 0.3 × kWh) in chargeable periods × c/kVArh.
7. Export credit = export kWh × feed-in rate(season, tou), capped at import (net billing) where the
   authority says so.
8. VAT at the configured rate, applied last.
9. Escalate per year by authority-specific or default %.

Units must be normalised when stored (one enum per charge) and never inferred from magnitude.

---

## 7. Project → Tariff tab

### 7.1 Purpose and layout

The tab lets the user pick the electricity tariff that the project's savings are calculated against.
Layout, top to bottom:
1. Header "Select Tariff".
2. A toggle pair: "Eskom Direct" / "Municipal Tariff".
3. A four-column selector row: Province, Municipality, Year, Tariff.
4. When a tariff is selected, a card with:
   - name and badges;
   - Edit Rates;
   - summary fields;
   - reactive-energy line;
   - energy-rate chips by season;
   - the "Blended Tariff Rates" panel with six selectable values.

**Tab status:** complete if `project.tariff_id` is set, otherwise pending. The Simulation tab is
"blocked" until a tariff is chosen (`ProjectDetail.tsx:1136-1150`).

**Write path:** choosing a tariff calls `updateProject.mutate({tariff_id})`. That updates
`projects.tariff_id`, invalidates `["project", id]` and toasts "Project updated", or shows the error
message (`ProjectDetail.tsx:1050-1062, 1375`).

### 7.2 Control inventory — `TariffSelector` (`src/components/projects/TariffSelector.tsx`)

| Control | Type | What it's for | Handler → effect (file:line) | Data read / written | Validation / disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Auto province from coordinates | effect (no control) | Pre-selects province from project lat/lng | `:532-577` calls edge `geocode-location {latitude, longitude, reverse:true}`, fuzzy-matches the province name, stores the municipality name in `sessionStorage["tariff-selector-municipality-<projectId>"]` | reads `provinces`, edge function | Skipped if there are no coordinates, a province is already chosen, or the project already has a tariff | Errors only `console.error`. `isReverseGeocoding` state is set but **never rendered** |
| Auto municipality | effect | Selects the municipality after province is set | `:580-621` exact id from sessionStorage (existing tariff), else fuzzy name match | `municipalities` | only after auto-select | silent |
| Prefill from existing tariff | effect | When reopening, show the current plan's province and municipality | `:730-739` | `tariff_plans` + joins | — | — |
| **Eskom Direct** | Button (toggle) | Choose an Eskom-supplied tariff instead of a municipal one | `:752-767` sets isEskomDirect, clears province and period, sets municipality to the row named **"Eskom Direct Supply"** (`:515-528`) | `municipalities.name = 'Eskom Direct Supply'` | — | **If no municipality has exactly that name, nothing is selected and the Tariff list stays disabled with no message.** The seed names it "Eskom Direct" (`20260219121343`); the extractor uses "Non-Local Authority" (§11) |
| **Municipal Tariff** | Button (toggle) | Return to municipal mode | `:768-779` clears municipality and period | — | — | — |
| Province | Select | Pick province | `:786-790` sets provinceId, clears municipality and period | `provinces` order name (`:491-498`) | hidden in Eskom mode | Empty list if the query fails (error not shown) |
| Municipality | Select | Pick supply authority | `:808-813` | `municipalities` where province (`:500-512`) | disabled without province | No "no municipalities" message |
| Year | Select | Filter plans by tariff year | `:832-835` | derived from `effective_from/to` of loaded plans (`:646-685`). "All Periods" appears only if more than one period exists. Auto-picks the first period whose `effective_from` contains the current calendar year, else the most recent (`:688-696`) | disabled without municipality or periods | "No Period Specified" bucket for undated plans. In Jan–Jun it may auto-select next year's plans if they are already loaded |
| Tariff | Select | Choose the plan for this project | `:855-858` `onSelect(id)` → `projects.tariff_id` | `tariff_plans(*, tariff_rates(*))` where municipality and `is_redundant=false` (`:630-643`) | disabled without municipality | Items show `name (category)`. No search. No filter by voltage, phase or amps. No empty-state text |
| Card title and badges | display | Confirms selection; "Overridden" badge if a project override exists | `:915-935` | `useProjectTariffOverride` (`ProjectTariffEditor.tsx:242-257`) | — | — |
| **Edit Rates** | Button → dialog | Adjust this project's copy of the rates without touching the shared DB | `:927` opens `ProjectTariffEditor` | §7.3 | — | — |
| Category / Fixed Charge / Demand Charge / Voltage | display | Summary | `:939-960`. Fixed = first `basic` amount labelled "/month"; Demand = first `demand` labelled "/kVA" | **Base plan, not overrides** | — | Shows R0.00 when missing (does not say "not applicable"). Ignores the unit column |
| Reactive Energy | display | Shows reactive charge | `:962-970` | first `reactive_energy` | only if > 0 | — |
| Energy Rates chips | display | Raw energy rows by season | `:972-1022`. If ≤ 1 energy row or all rows are `all/all`, shows "Fixed Rate" + **first row only** (IBT blocks hidden). Otherwise high and low chips. **Rows with season=all but tou≠all are not shown** | base plan (not overrides) | — | — |
| Blended rate cards (6) | clickable cards | Choose which averaged rate the simulation uses | `BlendedRatesCard :208-463`; clicks at `:297, 322, 338, 379, 404, 420` → `onBlendedRateTypeChange` → ProjectDetail state → auto-saved | computed from **overrides if present, else base** via `mapDbRatesToTariffRates` | Non-selectable if no handler. For flat tariffs a single card with "✓ Used for simulation" | Returns null if nothing is computable. Methodology text and badge are **factually wrong** (§4.5) |
| Info tooltips | tooltip | Rate breakdown | `RateCard :104-193` is **defined but not rendered anywhere** (dead) | — | — | — |

### 7.3 Control inventory — `ProjectTariffEditor` (dialog "Edit Project Tariff Rates")

Purpose: per-project overrides that do not affect the shared tariff DB (`:156-158`).

| Control | Type | What it's for | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Energy rate inputs (one per energy row) | NumericInput | Override an energy amount | `:173-180` updateRate(index, amount) | local state initialised from the existing override or the original rows (`:72-78`) | min 0, step 0.01 | Header says "(c/kWh)" but values are usually R/kWh (`:165`). The unit label falls back to "c/kWh" |
| Other charge inputs | NumericInput | Override basic, demand, etc. | `:200-207` | same | min 0 | Only amount is editable. Cannot add or remove rows, change units or change blocks |
| **Reset to Original** | Button (only if an override exists) | Discard overrides | `:218-226` → `resetMutation` DELETE `project_tariff_overrides` for (project, plan), invalidates, toasts, closes (`:106-123`) | `project_tariff_overrides` | disabled while pending | **No onError handler.** Failure is silent. No confirmation |
| Cancel | Button | Close without saving | `:228` | — | — | — |
| **Save Override** | Button | Persist the override | `:231` → `saveMutation` UPSERT `{project_id, source_tariff_plan_id, overridden_rates: full array, overridden_plan_fields: {}}` on conflict (project, plan) (`:80-104`) | `project_tariff_overrides` | disabled while pending | Toast "Error saving overrides" with the message |

Defects:
- The override is a **full snapshot**. If the shared plan is later corrected, the project silently
  keeps the old values, and nothing indicates drift.
- There is no per-field "overridden" marker.
- RLS lets any authenticated user read or write any project's overrides (§12).

### 7.4 Dead: `EskomTariffSelector.tsx` (926 lines)

It is not imported anywhere. It carries a "Show VAT-inclusive rates" toggle and `*_incl_vat` fields
(`:48-75, 230-237`), divides amounts by 100 (`:148`) and uses legacy blended functions. **Do not port.**

---

## 8. Project → Costs tab (`SystemCostsManager`)

### 8.1 Purpose, data flow and persistence

The tab sets up capital and O&M cost assumptions and financial-return parameters for payback, ROI,
NPV, IRR, MIRR and LCOE.

- **State:** `systemCosts` in ProjectDetail (`ProjectDetail.tsx:741-775`), initialised from
  `DEFAULT_SYSTEM_COSTS`. That is a 5-second-TTL proxy over `buildSystemCostsFromVariables()`, which
  reads `localStorage["calculation-defaults"]` edited in Settings → Calculations
  (`FinancialAnalysis.ts:245-266`; `useCalculationDefaults/getCalculationVariables.ts:89-136`).
- **Load:** the newest `project_simulations` row by **`created_at`**. `results_json.systemCosts` is
  copied into state once per project (`ProjectDetail.tsx:781-850`).
- **Save:** there is **no dedicated storage.** Costs are saved only as `results_json.systemCosts` by
  the simulation auto-save, 1.5 s debounced on changes (`useAutoSave.ts:131, 180-216`), or on a tab
  switch away from Costs (`ProjectDetail.tsx:727-736`). The Simulation tab is force-mounted
  hidden while Costs is active so that its save ref exists (`:1381-1386`).
- `onBlur={() => simulationRef.current?.saveIfNeeded()}` is passed (`:1361`) but `SystemCostsManager`
  destructures `onBlur` and **never calls it** (`SystemCostsManager.tsx:103,112`). Dead prop.
- Capacities shown come from `liveSolarCapacity ?? latestSimulation.solar_capacity_kwp ?? 100` and
  battery `?? 50` (`ProjectDetail.tsx:1363-1364`). Before a simulation exists, costs are illustrated
  on a **fictional 100 kWp / 50 kWh** system.
- The tab status is always "complete — System costs configured" (`ProjectDetail.tsx:1132-1135`), even
  when nothing has been entered.

### 8.2 Defaults (effective values)

| Field | Unit | Settings default (`defaults.ts`) | Hard fallback in code | Notes |
|---|---|---|---|---|
| solarCostPerKwp | R/kWp | 12,000 | 8,500 (`useSimulationEngine.ts:468`) | |
| batteryCostPerKwh | R/kWh | 8,000 | 3,500 (`:469`) | |
| solarMaintenancePercentage | % of solar capex / yr | **3.5 hard-coded** (`getCalculationVariables.ts:99`) | 3.5 | Not driven by Settings |
| batteryMaintenancePercentage | % of battery capex / yr | 1.5 hard-coded | 1.5 | |
| maintenancePerYear | R/yr | derived | 0 | auto-synced (§8.3) |
| healthAndSafetyCost, waterPointsCost, cctvCost, mvSwitchGearCost | R | 0 | 0 | |
| insuranceRatePercent | % "of (Capital+O&M)" | 1.0 | 1.0 | Used as **monthly** % (×12) (§8.4) |
| insuranceCostPerYear | R | 0 | 0 | Never computed or written |
| professionalFeesPercent | % | 5 | 0 | |
| projectManagementPercent | % | 3 | 0 | |
| contingencyPercent | % | 5 | 0 | |
| replacementYear | yr | 10 | 10 | |
| equipmentCostPercent | % of solar capex | 45 | 45 | |
| moduleSharePercent / inverterSharePercent | % of equipment | 70 / 30 | 70 / 30 | Not forced to sum to 100 |
| solarModuleReplacementPercent / inverterReplacementPercent / batteryReplacementPercent | % | 10 / 50 / 30 | same | |
| costOfCapital | % | 9 (= discountRate) | 9 | no control in Costs |
| cpi | % | 6 | 6 | no control in Costs |
| electricityInflation | % | 10 (= tariffEscalation) | 10 | no control in Costs. **Used by no engine** |
| projectDurationYears | yr | 20 | 20 | no control |
| lcoeDiscountRate | % | 9 | 9 | no control |
| mirrFinanceRate | % | 9 | 9 | |
| mirrReinvestmentRate | % | **8** (Settings) | **10** (fallback in ProjectDetail / Reset) | Two different defaults |
| powerFactor | decimal | — | 0.9 | no control anywhere |

The four presets are hard-coded (`SystemCostsManager.tsx:65-98`):

| Preset | Solar R/kWp | Battery R/kWh | Solar O&M % | Battery O&M % |
|---|---|---|---|---|
| Budget | 8,500 | 5,500 | 2.5 | 1.0 |
| Standard | 11,000 | 7,500 | 3.5 | 1.5 |
| Premium | 14,000 | 9,500 | 4.0 | 2.0 |
| Commercial | 9,500 | 6,500 | 3.0 | 1.25 |

### 8.3 Cost formulas (single source `utils/simulationConfig.ts:17-59`, duplicated in `SystemCostsManager.tsx:119-197`)

```
solarCost      = kWp × solarCostPerKwp
batteryCost    = kWh × batteryCostPerKwh           (kWh = 0 in the Costs UI if the project excludes battery)
baseCost       = solarCost + batteryCost
additional     = H&S + water points + CCTV + MV switchgear
subtotal       = baseCost + additional
profFees       = subtotal × prof%
pmFees         = subtotal × pm%
subtotalFees   = subtotal + profFees + pmFees
contingency    = subtotalFees × contingency%
TOTAL CAPEX    = subtotalFees + contingency         ← feeds systemCost, payback, ROI, NPV/IRR/MIRR/LCOE
O&M/yr         = solarCost × solar% + batteryCost × battery%    (on equipment only, not on fees)
3-yr O&M       = O&M × (1 + (1+cpi) + (1+cpi)^2)
lifetime O&M   = Σ_{y=1..N} O&M × (1+cpi)^(y−1)
effective O&M% = O&M / TOTAL CAPEX
replacement    = solarCost×equip%×module%×modRepl% + solarCost×equip%×inv%×invRepl% + batteryCost×batRepl%
escalated repl = replacement × (1+cpi)^(replacementYear−1)
capex incl 3yr O&M = TOTAL CAPEX + 3-yr O&M          (display; also a proposal line)
```

There is no rounding in the maths. Display uses `toLocaleString` with 0 decimals in most places.
**Inconsistency:** the Costs UI zeroes battery cost when `includesBattery` is false
(`SystemCostsManager.tsx:117`), while `calculateTotalSystemCost` in the engine uses whatever
`batteryCapacity` it is given.

### 8.4 Insurance inconsistency

| Location | Formula |
|---|---|
| Costs tab display "Annual Insurance Cost" | `(capex + O&M/yr) × rate% × 12` (`SystemCostsManager.tsx:1259`) |
| Advanced engine | `capex × rate% × 12` (O&M excluded; comment says "monthly amount") (`AdvancedSimulationEngine.ts:448-451`) |
| FinancialConfigPane fallback | `systemCost × rate% × 12` (`FinancialConfigPane.tsx:101`) |

The label says "% of (Total Capital + O&M)" (`SystemCostsManager.tsx:1235`). At the 1% default,
insurance becomes **12% of capex per year**. That is almost certainly unintended; typical values are
0.5–1.5% per year. **A decision is needed before porting.**

### 8.5 Persistence defects

- If `tenantCount === 0`, auto-save returns early (`useAutoSave.ts:191, 219`). **Costs for a project
  without tenants are never saved** and are lost on reload.
- Load uses the newest row by `created_at`. Auto-save *updates* the latest "Auto-saved…" row in place
  and keeps its original `created_at` (`useAutoSave.ts:88-96, 157-168`). If a user saves a named
  simulation and then edits costs, the edits go into the older auto-save row. **The next page load
  restores the named simulation's costs, and the edits appear lost.**
- Costs are not scoped per scenario beyond "latest simulation". No versioning.

### 8.6 Control inventory — `SystemCostsManager`

| Control | Type | What it's for | Handler → effect (file:line) | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Preset cards ×4 (Budget / Standard / Premium / Commercial) | button cards | Apply a price tier | `:410-413` `applyPreset` → sets solar/battery R and O&M %, `maintenancePerYear=0` (then auto-recomputed) (`:322-331`) | state → auto-save | "Active" badge if all 4 values match (`:403-407`). Battery line hidden without battery | — |
| Reset (in "Custom values configured" row) | ghost button | Restore all cost fields to defaults | `:444` `resetToDefaults` (`:333-369`) | state | only shown when values differ from every preset | Resets **all** financial params too, with **no confirmation**. mirrReinvestment resets to Settings (8) or 10 |
| Solar cost per kWp (click-to-edit value) | text → Input | Type an exact R/kWp | click `:493` → input `:478-487`; blur/Enter commits if ≥ 0 (`:250-264`); Esc cancels | `solarCostPerKwp` | min 0, step 100. NaN or negative ignored silently | — |
| Solar cost slider | Slider | Drag R/kWp | `:500-505` | same | 5,000–20,000, step 500. **A typed value outside the range is clamped visually only** | — |
| Battery cost per kWh (click-to-edit) | text → Input | Exact R/kWh | `:550` / `:535-544` (`:267-286`) | `batteryCostPerKwh` | ≥ 0 | shown only if includesBattery |
| Battery cost slider | Slider | Drag | `:557-562` | same | 3,000–15,000, step 500 | — |
| Health & Safety Consultant | NumericInput R | Fixed project cost | `:599-604` | `healthAndSafetyCost` | min 0, step 1,000 | — |
| Water Points | NumericInput R | Fixed cost (panel cleaning water) | `:614-619` | `waterPointsCost` | min 0 | — |
| CCTV | NumericInput R | Fixed cost | `:629-634` | `cctvCost` | min 0 | — |
| MV Switch Gear | NumericInput R | Fixed cost | `:644-649` | `mvSwitchGearCost` | min 0, step 10,000 | — |
| Solar O&M % (input) | Input | Annual O&M as % of solar capex | `:687-696`, commit on blur/Enter (`:288-295, 306-312`) | `solarMaintenancePercentage` | 0–10, otherwise reverts to the previous value | silent revert |
| Solar O&M % slider | Slider | same | `:701-706` | same | 0–10, step 0.1 | — |
| Battery O&M % (input + slider) | Input + Slider | same for battery | `:738-747, 752-757` | `batteryMaintenancePercentage` | 0–10 | battery only |
| Professional Fees % | NumericInput + Slider | % of subtotal | `:798-814` | `professionalFeesPercent` | 0–15, step 0.5 | — |
| Project Management % | NumericInput + Slider | % of subtotal | `:826-842` | `projectManagementPercent` | 0–15 | — |
| Contingency % | NumericInput + Slider | % of subtotal incl. fees | `:854-870` | `contingencyPercent` | 0–15 | — |
| Replacement Year | NumericInput(integer) + Slider | Year of mid-life replacement | `:909-927` | `replacementYear` | 5–20, fallback 10 | — |
| Equipment % | NumericInput + Slider | Equipment share of solar capex | `:948-964` | `equipmentCostPercent` | 0–100, step 5 | — |
| Module Share % | NumericInput + Slider | Module share of equipment | `:974-990` | `moduleSharePercent` | 0–100 | Not linked to inverter share (sum ≠ 100 allowed) |
| Inverter Share % | NumericInput + Slider | Inverter share of equipment | `:1000-1016` | `inverterSharePercent` | 0–100 | same |
| Solar Module replacement % | NumericInput + Slider | % of module cost replaced | `:1037-1053` | `solarModuleReplacementPercent` | 0–100 | — |
| Inverter replacement % | NumericInput + Slider | % of inverter cost replaced | `:1069-1085` | `inverterReplacementPercent` | 0–100 | — |
| Battery replacement % | NumericInput + Slider | % of battery cost replaced | `:1102-1118` | `batteryReplacementPercent` | 0–100 | battery only |
| MIRR Finance Rate | NumericInput + Slider | Borrowing rate for MIRR | `:1168-1184` | `mirrFinanceRate` | 0–25 | **Not used**: `financialMetrics` MIRR treats capex as t=0 so the finance rate has no effect (`financialMetrics.ts:55-65`) |
| MIRR Re-investment Rate | NumericInput + Slider | Reinvestment rate for MIRR | `:1200-1216` | `mirrReinvestmentRate` | 0–25 | — |
| Insurance Rate | NumericInput + Slider | Annual insurance % | `:1238-1254` | `insuranceRatePercent` | 0–5, step 0.1 | Displayed cost is ×12 (§8.4) |
| Summary card | display | Totals: capex excl O&M, annual O&M, capex incl 3-yr O&M, breakdown, effective O&M %, N-yr O&M | `:1265-1345` | derived | — | — |
| (hidden) maintenancePerYear sync | effect | Keeps the derived R/yr in state for engines | `:238-242` onChange when the difference is > R0.01 | state | — | Can loop-trigger auto-save |

---

## 9. Global page `/tariffs` (Tariff Management)

### 9.1 Layout (`TariffManagement.tsx`)

Title "Tariff Management". Seven tabs (`:41-49`):

| Tab | Content |
|---|---|
| **Tariffs** (default) | Import buttons plus `TariffList` |
| Provinces | `ProvinceFilesManager` |
| Municipalities | `MunicipalityMap` plus `MunicipalityManager` |
| Tariff Builder | `TariffBuilder` |
| TOU Reference | `TOUReference` |
| Load Shedding | `LoadSheddingStages` |
| NERSA Guidelines | `NERSAGuidelines` |

Clicking a municipality on the map sets a filter and jumps to the Tariffs tab (`:20-29`).

| Control | Type | Purpose | Handler | Notes |
|---|---|---|---|---|
| Tab strip | Tabs | Navigate sections | `setActiveTab` (`:40`) | Not URL-synced |
| Upload File | Dialog trigger | Phased file import (§9.3) | `FileUploadImport` | works |
| Google Sheets | Dialog trigger | Import from Google Sheet | `GoogleSheetsImport` → `import-google-sheet` | **Broken (dropped tables)** |
| AI Import | Dialog trigger | AI import from Google Sheet | `AISheetImport` → `ai-import-sheet` (analyze, then extract) | **Broken (dropped tables)** |

### 9.2 Tariffs tab — `TariffList`

Purpose: browse the whole tariff DB by province → municipality → period → plan, inspect rates, edit,
and delete.

Data loads:
- `provinces`;
- `municipalities(id, name, nersa_increase_pct, province_id)`;
- plan counts, paginated 1,000 rows at a time (`:174-195`);
- plans per municipality, lazily on expand (`:246-274`);
- rates per plan, lazily (`:277-297`).

**Municipality state is keyed by *name*, not id** (`:228, 249, 265, 770`). Same-named municipalities
in different provinces collide in caches, counts and accordion values.

| Control | Type | What it's for | Handler → effect | Data | Validation / confirm | Error & empty |
|---|---|---|---|---|---|---|
| Municipality filter chip ✕ | Button | Clear the map-originated filter | `:603-610` `onClearFilter` | — | — | — |
| Province filter | Select | Show one province | `:613` | client filter | — | "All Provinces" default |
| **Clear All** | destructive Button → AlertDialog | Delete **every tariff plan and rate in the system** | `:627-634` → confirm `:567-573` → `bulkDelete {type:'all'}` deletes rates, then plans, where `id >= 0000…` (`:343-353`) | `tariff_rates`, `tariff_plans` | One confirmation ("permanently delete all N tariffs") | Toast on error. **Nulls every project's `tariff_id`** via FK. No role gate, no backup, no undo |
| Eskom Direct Supply accordion | Accordion | National Eskom list | `:642-658` lazily loads plans of the municipality named "Eskom Direct Supply" | — | shown only when "All" is selected and there is no filter | "Click to load Eskom tariffs". **Never appears if that exact name is missing** |
| Province accordion trash | ghost Button | Delete all tariffs of a province | `:749-759` → confirm → `bulkDelete {type:'province'}` (`:354-374`) | rates, plans | confirm | — |
| Municipality accordion | Accordion | Lazy-load plans | `:763-767` | `tariff_plans(*, municipality, tariff_rates(*))` | — | spinner / "No tariffs uploaded yet" |
| Preview | Button | Card list of all plans in the municipality with edit | `:792-798` → `handleOpenPreview` (`:300-324`) fresh fetch | plans + rates | — | Falls back to cache on error |
| Municipality trash | ghost Button | Delete the municipality's plans | `:800-815` → confirm with **cached tariff ids** | — | confirm | **If the municipality was never expanded, the id list is empty.** It "deletes 0" and still toasts "Deleted all tariffs in X" |
| Period collapsible | Collapsible | Group plans by `effective_from–to` | `:857-866` | — | — | "No Period Specified" |
| Plan row expand | CollapsibleTrigger | Show charges and energy table | `:902-905` `toggleExpanded` + lazy rates | `tariff_rates` | — | "Loading rates…" |
| Plan trash | icon Button | Delete one plan | `:936-944` `deleteTariff` (rates, then plan) (`:326-339`) | — | **No confirmation** | Toast |
| Charges grid | display | Every non-energy row with notes label | `:951-998`. Amount < 0.01 is shown as `×100 c/kWh`, **which mislabels R values** | — | — | — |
| Energy table | display | season / TOU / blocks / rate | `:1004-1054` | — | — | Unit falls back to 'c/kWh' |
| Preview dialog cards | Card click | Highlight | `:1131-1132` | — | — | "No tariffs extracted for this municipality." |
| Compare Periods | Button | Year-on-year chart for the first name with ≥ 2 periods | `:1097-1109` → `TariffPeriodComparisonDialog` | — | only if a duplicate name exists | — |
| Edit (in preview) | Button | Open the full edit dialog | `:1154-1176` lazy-loads rates → `TariffEditDialog` | — | — | — |

`EskomTariffMatrix` is imported (`:18`) but **never rendered** (dead, 372 lines).

### 9.3 "Upload File" — `FileUploadImport` (phased import dialog)

Purpose: upload one NERSA or municipal file and extract per-municipality tariffs, with side-by-side
source vs DB comparison and inline correction. Steps are shown by `ExtractionSteps`
(upload → extract → review → save).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Upload File | DialogTrigger | Open | `:519-523`. Closing resets all state (`:517`) | — | — | — |
| Drop zone / file input | hidden file input | Choose file | `:536-541` `handleFileSelect` (`:246-282`): validates extension; **parses province and YYYYMMDD dates from the file name** (`:5-26`); uploads immediately to `tariff-uploads/<ts>-<filename>` | storage | xlsx/xls/xlsm/pdf only | Toast "Upload Failed" |
| ✕ (remove file) | icon | Reset | `:549` `resetState` (`:392-414`) | — | — | Storage object is **not** deleted (orphans accumulate) |
| Province | Select | Province for matching | `:558` | — | disabled after phase 1. Default "Western Cape" | — |
| Effective From / To | date inputs | Tariff year for new plans | `:578, 588` | passed to edge fn | disabled after phase 1 | No from < to validation |
| Analyze | Button | AI structure summary | `:598` `handleAnalyze` → action analyze | edge fn | disabled while running | Toast "Analysis Failed" |
| Extract Municipalities | Button | Build the municipality list | `:619` → action extract-municipalities; shows "Found X of Y expected" | may **insert** provinces and municipalities | — | Toast |
| Extract All | Button | Extract tariffs for all pending municipalities sequentially | `:642` (`:338-342`) | edge fn per municipality | only `pending` | per-municipality toast |
| Extract / Retry (per municipality) | Button | Extract one | `:662, 674` (`:284-322`) | edge fn | — | Row shows error |
| Re-extract (done rows) | orange Button | Wipe and redo | `:668` `handleReextractTariffs` (`:344-386`) **deletes ALL plans and rates for that municipality (all periods)** and Eskom batch status, then extracts | DB deletes | **No confirmation** | Nulls project tariff links for all years |
| Preview (eye) | Button | Comparison dialog: source rows or PDF vs extracted plans | `:661-678` → `handlePreview` (`:388-420`): action preview + DB read of all plans of the municipality | — | — | Toast and close on failure |
| Source / PDF view switch | Switch | Toggle text rows vs rendered PDF | `:740-750` downloads the file and renders with pdf.js (worker from cdnjs, `:3`) | storage | PDF only | — |
| PDF prev / next page | icon buttons | Paginate | `:764, 768` | — | bounded | — |
| Edit (per extracted plan) | Button | Inline correction | `:855` `startEditing` | — | — | — |
| Phase / Structure selects, Effective From / To, rate amount inputs | Selects / Inputs | Correct fields | `:866, 876, 894, 903, 917` | local | amount parseFloat or 0 | — |
| Save (inline) | Button | Persist the correction | `:850` `saveEditedTariff` (`:437-485`): updates plan; **deletes all rates and re-inserts** the edited list (loses `notes`, `block_number`, threshold fields; unit defaults 'R/kWh') | DB | — | Toast. Non-transactional (a failure after delete loses rates) |
| Cancel (inline) | Button | Discard | `:849` | — | — | — |

### 9.4 Edit dialog — `TariffEditDialog`

Purpose: full edit of a plan's header and rate lines in the shared DB.

| Control | Type | Purpose | Handler | Validation / defect |
|---|---|---|---|---|
| Tariff Name | Input | Rename | `:228-231` | none (empty allowed → DB NOT NULL passes on empty string) |
| Customer Category | Select | Category | `:236-250` options domestic, commercial, industrial, **agriculture**, **street_lighting** | **The last two are not enum values, so saving fails.** Enum values such as `agricultural`, `public_lighting`, `bulk_reseller` and `other` cannot be chosen, and the select renders blank for them |
| Structure | Select | flat / TOU / IBT | `:254-266` | seasonal, demand and hybrid are not offered |
| Voltage | Select | **LV / MV / HV** | `:270-282` | **The enum is low/medium/high, so picking any option breaks the save.** Existing values show blank |
| Phase | Select | Single / Three | `:286-297` | — |
| Effective From / To | date | Tariff year | `:302-316` | no ordering check |
| Fixed & other charges: amount | number Input | Edit a non-energy amount | `:345-351` | parseFloat or 0. **Cannot add a new fixed charge** (Add Rate adds energy only). Unit is not editable |
| Fixed & other charges: trash | Button | Mark for delete | `:355-361` | — |
| Add Rate | Button | New energy row (all / all, unit c/kWh) | `:381-384` (`:169-186`) | Default unit c/kWh while extracted rows are R/kWh |
| Season / TOU selects | Select | Per energy row | `:415-443` | — |
| From / To kWh | number | IBT bounds | `:448-466` (IBT only) | parseInt. No overlap or continuity checks |
| Amount | number | Rate | `:471-479` | — |
| Unit | Select c/kWh / R/kWh | Unit | `:482-493` | The calculation ignores it |
| Row trash | Button | Delete row | `:496-503` | — |
| Cancel | Button | Close | `:517` | — |
| **Save All Changes** | Button | Persist | `:521` `handleSave` (`:88-167`): update plan; delete marked rows; update each existing row one by one; insert new rows | **Non-transactional.** A partial failure leaves a mixed state. `is_redundant` / `is_recommended` are passed through but have no controls |

### 9.5 Provinces tab — `ProvinceFilesManager`

Purpose: keep source files per province and run bulk AI extraction with auto-reprise. The table
lists the 9 SA provinces plus "Eskom" from `SOUTH_AFRICAN_PROVINCES` (`src/lib/constants.ts:7-18`),
then custom provinces.

Files are matched to a province by **file-name substring**: the file name, stripped to letters, must
contain the province name (`:229-241`). A file uploaded via `FileUploadImport` that lacks the province
in its name never appears here. The storage list is capped at 100 files (`:188`).

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| New province name + Add Province | Input + submit | Create a custom province | `:1127-1137` → insert `{name, code: first-2-letters}` (`:150-164`) | `provinces` | trimmed non-empty | Toast. Code collision risk |
| Refresh | Button | Refetch stats and files | `:1155` | — | — | toast |
| Status badge | display | tariffs / municipalities / file / no data | `:1089-1100` | tariff count from `total_tariffs` (non-existent column), **so it is always 0** | — | — |
| Files (n) | Dialog trigger | List files | `:1184-1253` | storage | — | "No files" |
| Preview (eye) | icon | View a sheet in the dialog | `:1222` → `FilePreviewDialog` (client-side XLSX parse of the downloaded file) | storage | — | retry button |
| Download | icon | Download the file | `:1231` (`:378-402`) | storage | — | toast |
| Delete file | icon | Remove the file | `:1240` → `window.confirm` → storage remove (`:404-424`) | storage | confirm | Extracted data is kept |
| Municipality counts | display | done / pending / error | `:1259-1286` from the non-existent `extraction_status`, **so every municipality counts as pending** | — | — | — |
| Extract | Button | Open the extraction dialog with the first file | `:1291-1300` → `startExtraction` (`:433-474`). If municipalities exist, jumps straight to step 3 | — | only when files exist | — |
| Upload | Button + hidden input | Upload a province file | `:1301-1323` (`:324-376`), path `<ts>-<Province>.<ext>` | storage | extension | toast |
| Delete custom province | icon | Delete the province (cascades municipalities, plans, rates) | `:1324-1333` | `provinces` | **No confirmation** | toast |
| Source file select (dialog) | native select | Pick which uploaded file to use | `:1378-1394` | — | — | — |
| Refresh (dialog) | Button | Recount plans per municipality from the DB | `:1406` (`:477-537`) | — | — | toast |
| Step 1 Analyze | Button | AI analysis | `:1424-1435` (`:539-566`) | edge fn | — | toast |
| Step 2 Extract Municipalities | Button | Build the list | `:1455-1465` (`:568-608`) | edge fn (may insert municipalities) | — | toast |
| Auto-reprise | Switch | After each extraction, loop the reprise until confidence reaches 100 (max 5) | `:1518-1522`; loop `:828-861` | edge fn | default ON | Every loop call costs an Anthropic call. Each reprise can **delete unbundled lines** (§3.1 step 7) |
| Retry All Failed (n) | Button | Re-extract errored municipalities | `:1529-1541` (`:1033-1045`) | — | only if failures exist | — |
| Extract All Tariffs | Button | Sequential extraction of all | `:1543-1553` (`:1021-1031`) | — | disabled while running | Municipalities that already have tariffs are switched to **reprise mode** instead (`:760-779`) |
| Reprise All (n) | Button | Second pass for all "done" municipalities | `:1555-1567` (`:1047-1062`) | — | only if done > 0 | — |
| Progress bar | display | done / total | `:1571` | — | — | — |
| Eskom batch panel | display | Current batch, 15 names | `:1574-1615` (`ESKOM_BATCH_NAMES :96-100`) | — | — | The UI lists **15** names (including "WEPS" and "Excess NCC") while the backend has **17** different batches; "All 15 batches" is hard-coded in toasts (`:632, 662, 681`) |
| Reset Eskom Batches | Button | Delete batch tracking | `:1620-1640` `confirm()` → delete `eskom_batch_status` | — | confirm | shown only for the Eskom province |
| Eskom batch badges | display | Per-batch status | `:1645-1686` | `eskom_batch_status` | — | tooltip uses non-existent `error_message` |
| Per-municipality Reprise | Button | Second AI pass | `:1729-1737` (`:1006-1019`) | edge fn | done only | toast |
| Per-municipality Extract / Retry | Button | Extract | `:1740-1748` | edge fn | pending / error | inline error text |

**Status persistence defect:** after every extraction, success, error or reprise, the code runs
`municipalities.update({ nersa_increase_pct: null })`, commented as "persist status"
(`:743-746, 765-768, 796-799, 866-869`). **This wipes the municipality's NERSA increase % and records
no status.**

**Eskom path defect:** the UI enters the batch loop only when `muni.name` contains "eskom"
(`:627`), but the edge function names the Eskom municipality "Non-Local Authority" (§3.1), so the
loop never starts. Each click extracts one batch and then auto-reprises it.

### 9.6 Tariff Builder tab — `TariffBuilder` (**non-functional**)

Purpose: create a tariff manually.

Controls:
- Municipality* (`:265`, a flat list of all municipalities with no province context, so duplicate
  names are ambiguous);
- Category* (`:279`, required by validation but **never saved**);
- Tariff Name* (`:293`);
- Tariff Type Fixed / IBT / TOU (`:302`, clears rows);
- Phase (`:316`);
- Amperage Limit (`:330`, not saved);
- Voltage LV / MV / HV (`:339`);
- Customer Category (NERSA) (`:353`, values "Domestic" / "Agriculture" / "Street Lighting");
- Capacity kVA (`:370`, not saved);
- Effective From / To (`:380, 389`);
- Basic Charge R/month (`:404`);
- Demand R/kVA (`:414`);
- Network Access (`:424`, not saved);
- Reactive R/kVArh (`:434`, not saved);
- switches Seasonal (`:446`), Prepaid (`:454`, not saved) and Unbundled (`:462`, reveals family
  `:481`, zone `:495`, GCC `:513`, legacy `:524`, service/day `:535` and admin/day `:546`, **none
  saved**);
- CPP rate and hours (`:569, 579`, TOU only, not saved);
- TOU Period Builder (`TOUPeriodBuilder.tsx`, periods by season / day / hours / rate / demand, with
  duplicate-high-to-low; **the periods are never saved**);
- rate rows with Add (`:610`), Season, TOU, From/To, Rate c/kWh, Demand and remove (`:718`);
- Create (`:730`) and Reset (`:734`).

Submit (`:222-233`) → insert (`:91-165`):
- `voltage` defaults to **"LV"**, which is not a `voltage_level` value. **The insert fails on every
  submit.** Even without that, `category` uses the capitalised label ("Domestic"), which is also not a
  valid enum value.
- Rate unit is hard-coded 'c/kWh'.
- The success path invalidates the unused `["tariffs"]` key.

### 9.7 Municipalities tab — `MunicipalityMap` and `MunicipalityManager`

**MunicipalityMap** (828 lines). It fetches:
- a Mapbox token via edge `get-mapbox-token` (`:108`);
- municipalities plus plan counts (`:124-158`). The plan query is **not paginated**, so counts are
  truncated at the PostgREST 1,000-row default while the DB holds ~1,978 plans;
- boundary GeoJSON via edge `cache-boundaries` (`:166-181`).

Polygons are coloured by filter (`FilterType` all / database / done / pending / error, `:57, 241`).
Done/pending/error depend on the non-existent `extraction_status`, so **those filters are
meaningless**.

Controls:
- filter buttons (`:718`);
- search box with Google Places suggestions (`google-places-search` edge function, `:519, 541`),
  reverse geocoding (`geocode-location`, `:552`), and clear (`:752`);
- a click on a suggestion (`:764`) drops a pin and popup;
- polygon click popup (`:369-470`) with "View tariffs" (→ `onMunicipalityClick` → Tariffs tab filter)
  and "YoY trends" (→ `TariffPeriodComparisonDialog`).

Popups are built with `setHTML` from DB strings (`:428, 607-609`) (§12).

**MunicipalityManager** (181 lines):
- **Add**: Province select (`:93`), Name (`:108`), Tariff Increase % (`:117`) and Add button (`:126`,
  disabled without province) → insert (`:40-55`).
- **List**: name, province, increase % and a trash button (`:162-169`). The trash button deletes the
  municipality **without confirmation**, which **cascades to all its plans and rates** and nulls
  project links.
- No edit (rename, increase %, financial year).

### 9.8 Reference tabs (static content, no DB)

| Tab | Component | Content | Notes |
|---|---|---|---|
| TOU Reference | `TOUReference` → `TOUTimeGrid`, `TOUClockDiagram` (incl. pre-2025 vs 2025 comparison with auto-play `TOUComparisonView :673-829`) | 2025/26 Eskom TOU explanation | Inconsistent with itself and with the calculation (§4.3) |
| Load Shedding | `LoadSheddingStages` (+ `EnergyFlowInfographic`, `BatteryStateInfographic`) | Stages 0–8, hours / day, outage block timelines (`:27-50`) | Stage 4 hours equals Stage 3 (6). Educational only |
| NERSA Guidelines | `NERSAGuidelines` | Text on unbundling, Eskom families, Gen-wheeling / offset | Static 2025/26 text; will go stale |

### 9.9 `TariffPeriodComparisonDialog` (YoY)

- Lists plan names with ≥ 2 distinct `effective_from` values in a municipality (`:52-75`).
- Charge filter: Basic / Energy Low / Energy High / Demand Low / Demand High (`:21-27, 219`).
- For "Energy" it **sums** all `tou='all'` rows. For IBT plans that is the sum of block rates, which is
  meaningless (`:126-138`).
- No unit normalisation across years.
- Selects: tariff name (`:203`) and charge (`:219`).

---

## 10. Hard-coded values inventory

| Value | Where | Risk |
|---|---|---|
| R2.50/kWh fallback blended rate | `useSimulationEngine.ts:422` | Projects without rates show plausible fake savings |
| `annual_grid_cost = import × 2.5` | `useAutoSave.ts:115` | Saved KPI is fiction |
| Export rate 0 (non-existent column) | `useSimulationEngine.ts:444` | No export credit |
| PF 0.9 | `FinancialAnalysis.ts:166`, `AdvancedSimulationEngine.ts:456` | No UI |
| SEASONAL_DAYS 66/13/13, 195/39/39 | `tariffCalculations.ts:40-43` | Ignores edited season months and holidays |
| Solar window 06–18 | `tariffCalculations.ts:68` | UI says 6 h |
| DEFAULT_TOU_SETTINGS hour maps | `load-profile/types.ts:143-176` | Unverified vs the Eskom booklet; differs from reference pages |
| Calendar year 2026 | `EnergySimulationEngine.ts:683-686` | Weekday alignment fixed to 2026 |
| Cost presets | `SystemCostsManager.tsx:65-98` | Stale pricing |
| Settings cost defaults (12,000 R/kWp, 8,000 R/kWh, 5/3/5 % fees, 10 % escalation, 6 % CPI, 9 % discount, 1 % insurance) | `useCalculationDefaults/defaults.ts:15-76` | Stored per browser in localStorage |
| O&M 3.5 % / 1.5 % | `getCalculationVariables.ts:99-100` | Not configurable in Settings |
| Eskom batch list (17) vs UI (15) | `process-tariff-file:661-679` vs `ProvinceFilesManager.tsx:96-100` | Drift |
| Anthropic model `claude-sonnet-4-20250514`, 8,192 tokens, 15k / 50k / 12k character truncation | `process-tariff-file` | Silent truncation of large schedules |
| Eskom 2025-26 wording in prompts | `process-tariff-file:870` | Stale |
| Province list incl. "Eskom" | `src/lib/constants.ts:7-18` | Eskom as a "province" is a modelling hack |

---

## 11. Defects and gaps (consolidated, ordered by severity)

**Critical: wrong numbers or data loss**
1. Energy units are mixed (R/kWh vs c/kWh) and the engines ignore `unit` (§2.5, §5.3, §6.4). The
   Calculator divides by 100 while the project engine does not. The SQL function assumes c/kWh.
2. Inclining-block tariffs are costed at block 1 only (§5).
3. Export credit is R0 in the basic model and full retail in the advanced model. There is no feed-in
   tariff model. Solar-only mode yields R0 savings (§6.2, §6.3).
4. Unbundled charges (legacy, network-demand c/kWh, ancillary, service/admin per day,
   network-access, GCC, reactive) are stored but never costed (§6.5). The Tariff tab display adds them
   onto energy with wrong units (§5.3).
5. The Reprise "update" deletes all unbundled lines and re-inserts only basic, demand and energy
   (`process-tariff-file:1582-1605`). Auto-reprise is on by default.
6. `nersa_increase_pct` is wiped by every ProvinceFilesManager extraction (§9.5).
7. Clear All, municipality delete, custom-province delete and Re-extract are destructive, global, and
   have weak or no confirmation. They null `projects.tariff_id` across all users.
8. There is no tariff versioning or immutability. Edits change the basis of past simulations silently.
   Overrides are snapshots that drift (§7.3).
9. The insurance ×12 (§8.4) inflates operating cost roughly 12×.

**High: broken features**
10. The Tariff Builder cannot save (enum mismatch) and drops most fields (§9.6).
11. Google Sheets and AI Sheet imports target dropped tables (§3).
12. The Edit dialog's Category options (agriculture, street_lighting) and Voltage options
    (LV / MV / HV) break the save (§9.4).
13. The Eskom supply authority has three names: "Eskom Direct Supply" (TariffSelector, TariffList),
    "Eskom Direct" (seed) and "Non-Local Authority" (extractor). As a result the Eskom Direct button,
    the Eskom accordion and batch extraction can each silently do nothing.
14. `extract-tariffs` / `reprise` look up the municipality by `ilike(name).single()` across all
    provinces, so duplicate names fail (§3.1).
15. The `extraction_runs` insert and the UI status fields reference non-existent columns, so there is
    no audit trail and the status badges are always pending (§2.3).
16. The "Hourly Rates" toggle and the VAT toggle are dead controls (§5.2, §6.2). The `onBlur` prop in
    Costs is dead.
17. Costs are not persisted when there are no tenants, and can be lost via the `created_at` ordering
    (§8.5).
18. The Calculator page is inconsistent with the current schema (§6.4).

**Medium: correctness and UX**
19. TOU calendars are per browser in localStorage, with no holidays, and conflict with the reference
    pages (§4).
20. Solar-window blended-rate copy is false (6 h / 0 % peak) (§4.5).
21. Demand is charged as the annual peak × 12 with no TOU window or NMD (§6.2).
22. The municipality map counts are truncated at 1,000 rows. TariffList keys by municipality name.
23. The Tariff tab summary shows base values when overrides exist. Energy chips hide season=all TOU
    rows and IBT blocks.
24. The extractor truncates input (15k characters) with no warning. There is no OCR for scanned
    PDFs. The PDF reprise sends the whole document.
25. The extractor `block_number` is the array index. VAT dedup only works for non-block rows.
26. Uploaded files are never cleaned up. The storage list is limited to 100. Province/file association
    relies on the file name.
27. `mirrReinvestmentRate` defaults differ (8 vs 10). The MIRR finance rate has no effect.
    `electricityInflation` and `systemCosts.cpi` are ignored by the advanced engine.

**Gaps (missing capability)**
- No tariff eligibility filtering (voltage, phase, amps, NMD) in the selector. No search.
- No monthly bill breakdown for before and after solar.
- No escalation schedule per authority or year (NERSA % is stored but unused).
- No stale-data warning (current date vs `effective_to`), no 2026/27 refresh, and no source document
  linked to each plan.
- No human review, approval or publish step for AI extraction. No diff view against the previous year.
- No role model for who may edit shared tariffs.

---

## 12. Security findings

| # | Finding | Evidence | Impact |
|---|---|---|---|
| S1 | Tariff tables: public (anon) SELECT, and `FOR ALL TO authenticated USING(true)` write | `20260218094522…sql:154-163` | Any logged-in user of any organisation can alter or delete the national tariff DB. There is no org scoping; the organisations migration of 2026-03-18 does not touch these tables |
| S2 | `extraction_runs` / `eskom_batch_status` write policies have **no role** (`FOR ALL USING(true) WITH CHECK(true)`) | `20260218195356…sql:23,41` | Anonymous writes possible |
| S3 | `project_tariff_overrides`: all verbs for any authenticated user | `20260317092000…sql:15-29` | Cross-tenant read and tamper of project pricing |
| S4 | Bucket `tariff-uploads` has insert / select / delete policies with no role | `20251202153328…sql:6-20` | Anonymous upload, download and delete of source files |
| S5 | `process-tariff-file`, `ai-import-sheet`, `import-google-sheet`, `upload-tariff-file` use `verify_jwt=false` with the service-role key | `supabase/config.toml:3-7,15-16,45-46` | Unauthenticated callers can burn Anthropic credit, write tariffs, and create provinces and municipalities |
| S6 | `upload-tariff-file` fetches any `fileUrl` server-side and stores it with the service role | `upload-tariff-file/index.ts:15-47` | SSRF plus arbitrary content injection into storage. Not used by the UI, so delete it |
| S7 | Mapbox popups built with `setHTML` from municipality and tariff strings | `MunicipalityMap.tsx:428, 607-609` | Stored XSS, since any user (or anon via S5) can insert municipality names |
| S8 | `get-mapbox-token` with `verify_jwt=false` | `config.toml:12-13` | Token disclosure to anyone |
| S9 | `replicate-to-external` copies tariff tables to an external DB with `verify_jwt=false` | `replicate-to-external/index.ts:11-19,56-57`; `config.toml:57-58` | Data egress trigger is unauthenticated |
| S10 | No role gate on `/tariffs` (login only) | `App.tsx:75-80` | All users are admins |

---

## 13. Porting guidance for E-Site (Next.js 15 + Supabase)

1. **Schema.** Use these tables:
   - `solar.supply_authorities` (Eskom and each municipality; licence number; province);
   - `solar.tariff_schedules` (authority, financial year, effective_from/to, source document, status
     draft / published / superseded, published_by / at);
   - `solar.tariff_plans` (schedule FK, eligibility: category, voltage, phase, min/max amps / kVA,
     metering);
   - `solar.tariff_charges` (plan FK; `charge` enum including export / feed-in; `unit` **enum**; season;
     TOU; block bounds; `applies_to` period for demand; `notes`);
   - `solar.tou_calendars` (per authority and year: season months, hour maps per day type, a public
     holiday list with its day-type mapping).
   
   A project should link to a *published* plan version and snapshot the resolved charges at
   simulation time.
2. **RLS.** Reference data: read for authenticated users, write only for a platform-admin role.
   Project overrides: scoped by project membership, following the E-Site `user_has_project_access`
   pattern.
3. **Import.** Edge function behind JWT and role check → writes a **draft** schedule → human diff
   against the prior year × NERSA % → publish. Keep AI as a helper; never write to production data
   directly. Store the source file per schedule.
4. **Engine.** Implement §6.6 in a pure, unit-tested module (one monthly bill for before and after).
   Normalise units at write time. Drop "blended rate" as the costing basis; keep it only as a display
   KPI.
5. **Costs.** A first-class `project_solar_costs` table (per scenario), not inside
   `results_json`. Decide the insurance semantics (annual % of capex), and add power factor and
   escalation controls where they are used.
6. **Drop:** EskomTariffSelector, TariffBuilder (rebuild), both Google-Sheet imports,
   `upload-tariff-file`, legacy blended functions, the Calculator page, and the static reference tabs
   (or regenerate them from the published TOU calendar so they cannot disagree with the maths).

---

*End of 03-tariffs-costs.md*
