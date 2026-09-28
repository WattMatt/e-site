# 08 — WM Solar native iOS/macOS app: full review

**Subject:** `/Volumes/Extreme SSD/DEVELOPER/APPS/WM Solar` (SwiftUI + supabase-swift ≥ 2.0.0). Read-only review, 2026-09-28.
**Purpose:** input to the E-Site solar add-on spec (Next.js web + Expo mobile, paid per project). Everything here is cited `file:line`; paths are relative to `WM Solar/WM Solar/` unless stated otherwise. "Unverified" means it was not run on a device or against a database.
**Not opened:** `Config.xcconfig` values, `*.p12`, `*.cer`, `*.certSigningRequest`, `*.mobileprovision`, `WM Solar.ipa`, `WM Solar.app.dSYM.zip`. The only check made against `Config.xcconfig` was a match count of the two Supabase project refs (see §1.2). No values were printed.

**How this was produced:** I read the repo docs, `memory/`, `migrations/`, all 19 `Core/` services, the models used by them, and the Tariffs, Settings, LoadProfiles and Calculations screens myself. Five sub-reviews each read one screen group line by line; their control tables are in Part 3 and cross-checked against my reads. Size: 110 Swift files, **34,180 lines** (`find … -name '*.swift' | xargs wc -l`). Git has 6 commits: `d6e8f5b` (initial, 2026-03-13), `923f993` (2026-08-05, service-role key removed, most of the app source added to git for the first time), then three PDF commits and a merge (`8b48319`, 2026-08-06).

---

## 0. Verdict in ten lines

1. **The "100 % parity" claim in `PARITY_STATUS.md` is false.** Many of the Core services it counts are never called from any screen: Geocoding, DataImport, Infographic, Sync, ReferenceData, Export, Realtime, BatteryDispatchEngine. `OfflineSyncService.enqueue` is also never called. Of the "28/28 edge functions wired", screens invoke about five (§4.1). Two whole tabs, Handover and Sandbox, cannot be reached from the UI (§2.2).
2. **The app uses a different Supabase project from the web app today.** iOS points at `lyctmmqndqegptzkajhz`; WM_Solar_Web's `.env` and `supabase/config.toml` point at `zhhcwtftckdwfoactkea`. The app also queries at least 8 tables that do not appear in the web `schema-dump.sql` (§1.2).
3. **The native energy and finance engines are simplified and give wrong answers.**
   - Every simulation prices electricity at a hard-coded **R 2.50/kWh** (`Core/FinancialEngine.swift:63`).
   - PV output is a peak-normalised 0–1 curve × kWp, with no irradiance scaling. On the fallback solar profile this gives **~2,580 kWh/kWp/yr**, roughly 1.5× a realistic South African yield (§8.1).
   - They do not match the web engine: web uses 8,760-h TMY, the PVsyst loss chain, a TOU calendar, four dispatch strategies and MIRR.
4. **The Calculator screen runs a third engine.** It uses PSH × 365 × PR, a flat 85 % self-consumption cap and a fixed 25/42/33 % TOU split. Its numbers disagree with the Simulation tab for the same inputs.
5. **Security.**
   - The service-role key shipped inside TestFlight builds 6–40. The repo removed it on 2026-08-05; rotation is not evidenced.
   - Auth tokens are stored in `UserDefaults`.
   - Any user can grant themselves admin (`is_admin` is self-writable).
   - Anyone signed in can read all projects, proposals and share tokens.
   - The Anthropic key is typed in by each user and requests go straight to `api.anthropic.com`.
   - `tou_period_settings` can be wiped globally by any user.
6. **"Offline-first" does not exist in practice.** The queue is never written to. There is no local cache, and every screen is a live Supabase query.
7. **Field capability is almost nil.** Camera, photo-library and location permissions are declared, but there is no camera capture, `PhotosPicker`, `CLLocationManager`, GPS, meter-reading capture or site-survey flow. Photos only arrive through file import.
8. **What is worth carrying into E-Site** is mostly UX: the CSV load-profile import wizard with unit/interval/weekday-weekend handling, signature capture on a proposal, TOU clock diagram, the tariff browser layout, share-sheet delivery, and the two-pass LLM tariff extraction idea (run server-side, not on device).
9. **Distribution:** internal TestFlight only; no App Store release. The last IPA on disk is dated 2026-04-01 (the build-40 era). The 2026-08-05/06 source changes have not been built. SPEC-001…007 are all still `🔲 Pending` (§9.4).
10. **Recommendation for E-Site:** do **not** port the Swift engines or the parity map. Spec the E-Site solar module from the web engine, using this review as a list of UX affordances and known traps (§10).

---

## 1. Identity, platform, backend

### 1.1 App identity and build settings
| Item | Value | Source |
|---|---|---|
| Name / bundle ID | WM Solar / `WM.Watson-Mattheus` (ASC app ID 6760644487, team 4469L4GXVG) | `CLAUDE.md`, pbxproj:297 |
| Platforms | iOS 17.0, macOS 14.0, **visionOS 2.0** (`SUPPORTED_PLATFORMS = "iphoneos iphonesimulator macosx xros xrsimulator"`, `TARGETED_DEVICE_FAMILY = "1,2,7,8"`) | pbxproj:292, 295, 302, 308-309 |
| Version | `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 48` | pbxproj:270, 296 |
| Signing | Manual, cert `77PMK2CKF9`, profile UUID `c5bd403f-…` | `CLAUDE.md`, `memory/decisions.md` |
| Dependencies | One SPM package: `supabase-swift`, upToNextMajor from 2.0.0 | pbxproj:393-396 |
| Info.plist | Only `SUPABASE_URL` and `SUPABASE_ANON_KEY`, substituted from xcconfig; **no `CFBundleURLTypes`** | `Info.plist:1-10` |
| Permission strings | Camera, Location When-In-Use, Photo Library, Photo Library Add | pbxproj:278-281 |
| Entitlements | App Sandbox, network client, user-selected files r/w, camera, photos, location. **No associated domains.** | `WM_Solar.entitlements:1-18` |
| Config fail mode | `fatalError` if either plist key is missing | `AppConfig.swift:11-24` |
| Unit tests | `WM SolarTests/FinancialEngineTests.swift` (257 lines, 22 tests), **not referenced in the pbxproj** (0 matches), so never compiled or run | grep |

### 1.2 Backend: not the same Supabase project as the web app
- **iOS** uses `https://lyctmmqndqegptzkajhz.supabase.co`. `CLAUDE.md` documents this, and `Config.xcconfig` contains that ref once. The ref `zhhcwtftckdwfoactkea` appears 0 times.
- **WM_Solar_Web** uses `zhhcwtftckdwfoactkea`: `supabase/config.toml:1` has `project_id = "zhhcwtftckdwfoactkea"`, and it is the only Supabase URL in `.env`/`src`.
- `memory/decisions.md` says the app "Re-us[es] the same backend … zero backend duplication". **That is not true of the current checkouts.** Either the web app moved projects, or the iOS app was always pointed at another one; which is the live one is unverified.
- **Schema drift.** The web `schema-dump.sql` has 49 `CREATE TABLE`s. iOS queries these tables, none of which is in that dump:
  - `scada_data`, `proposal_signatures`, `tou_period_settings`, `project_tariff_assignments`, `system_costs`
  - `eskom_tariff_plans`, `eskom_tariff_rates`, `tariff_uploads`
  - `gantt_dependencies` (the web dump has `gantt_task_dependencies`)
  - the `avatars` table
- **Implication for E-Site:** neither app's schema is authoritative. The E-Site spec must define its own schema, and treat the table list below as evidence of the domain, not a contract.

**Tables queried from iOS** (`grep -rhoE '\.from\("…"\)'`, 58 names; some are storage buckets):
- `scada_imports` ×12, `proposals` ×10, `municipalities` ×10, `tariff_plans` ×9, `projects` ×8, `profiles` ×8, `provinces` ×7, `handover_checklist_items` ×7
- `tariff_rates`, `project_tenants`, `gantt_tasks`, `checklist_templates` ×6 each
- `project_documents` ×5, `generation_records` ×5, `eskom_tariff_rates` ×5, `eskom_tariff_plans` ×5, `checklist_template_groups` ×5
- `organization_branding` ×4
- `tou_period_settings`, `tariff_uploads`, `project_solar_data`, `project_simulations` ×3 each
- ×2 each: `sites`, `simulation_presets`, `sandbox_simulations`, `pv_layouts`, `project_document_folders`, `gantt_dependencies`, `gantt_baselines`, `gantt_baseline_tasks`, `checklist_document_links`
- ×1 each: `system_costs`, `stacked_profiles`, `shop_types`, `shop_type_categories`, `scada_data`, `report_configs`, `report_analytics`, `proposal_signatures`, `project_tariff_assignments`, `project_schematic_meter_positions`, `project_schematic_lines`, `generation_daily_records`, `gantt_task_segments`, `eskom_batch_status`

**Storage buckets:**
- `project-schematics`, `project-documents`, `portal-assets` (public URL used for signatures)
- `organization-assets`, `avatars` (public URLs)
- `tariff-uploads`, `province-files`
- `pv_layouts` (see Part 3C)

**RPC calls:** none (`.rpc(` 0 hits).

---

## 2. Navigation and screen inventory (summary; full control tables in Part 3)

### 2.1 Shell
- **Root router** (`ContentView.swift:10-54`), first match wins:
  1. portal token → `ClientPortalView`
  2. password reset → `ResetPasswordView`
  3. loading → splash
  4. authenticated → `OfflineStatusBar` + `MainNavigationView` + `ToastOverlay`
  5. otherwise → `AuthView`
- There is no `authStateChanges` listener (A.1).
- **iOS:** a 5-tab `TabView`: Dashboard, Projects, Calculate, Estimate, More. More holds Tariffs, Load Profiles, User Management and Settings (`ContentView.swift:118-144, 211-243`). Several child views open their own `NavigationStack` inside the tab's stack (nested stacks; A.1, B.1).
- **macOS:** a `NavigationSplitView` sidebar with the same destinations, plus ⌘1–⌘6 and ⌘, via a "Navigate" `CommandMenu` (`WM_SolarApp.swift:24-43`).
- **Deep links:** `onOpenURL` parses `…/portal/{token}` and the Supabase recovery URL (`WM_SolarApp.swift:47-84`). **No URL scheme or associated domain is registered**, so these are unreachable from outside the app. `wmsolr://portal/X` would not parse anyway, because `portal` is the host. The recovery `access_token` is stored but never used, so password recovery cannot complete (A.1, A.3).

### 2.2 Screen list and reachability
| Area | Screens / tabs | Reachable? | Part |
|---|---|---|---|
| Auth | AuthView (sign-in / sign-up / forgot), ResetPasswordView | Yes, but recovery is broken | 3A |
| Dashboard | DashboardView (KPIs, recent projects, quick actions) | Yes. The Quick Actions and "View All" do nothing (A.3). | 3A |
| Quick Estimate | QuickEstimateView | Yes | 3A |
| Client Portal | ClientPortalView (+ SignatureCanvas) | Only via deep link, which is unregistered | 3A |
| User Management | UserManagementView (Profile / Security / Sessions / Admin), AdminUsersView, AdminEditUserView | Yes. Admin sub-view gated client-side only. | 3A |
| Projects | ProjectsListView (list + MapKit map), CreateProjectSheet, ProjectDetailView | Yes | 3B |
| Project tabs (`enum ProjectTab`, `Features/Projects/ProjectDetailView.swift:4-18`) | Overview, Tenants, Schematics, Load Profile, Costs, Tariff, Simulation, PV Layout, Solar Forecast, Proposals, Schedule (Gantt), Documents, Generation, Monthly Report: **14 tabs** | Yes | 3B, 3C |
| **HandoverTab** (575 lines) | Checklist, templates, document links | **No.** Never instantiated (`HandoverTab(` 0 hits outside its file) | 3B |
| **SandboxTab** (607 lines) | Scenario A/B simulation | **No.** Not in `ProjectTab` | 3C |
| Tariffs | TariffsView with 11 internal tabs: Browse, Eskom, Documents, Analytics, Compare, Builder, TOU Ref, Load Shed, NERSA, Map, Files (`Features/Tariffs/TariffsView.swift:46-81`). TariffUploadView sheet, TariffUploadsListView. | Yes | 3E |
| Load Profiles | LoadProfilesView (Dashboard / Sites / Meter Library / Cross-Site), CreateSiteView, SiteDetailView, CSVImportView (4 steps), BulkCSVImportView, TenantScheduleImportView, meter detail sheet with daily view | Yes | 3D |
| Calculations | CalculationsView (tariff source, inputs, results tabs: Summary / Cash Flow / Carbon, charts) | Yes | 3D |
| Settings | SettingsView (theme, Anthropic key, display, solar defaults, profile, sign-out) → Branding, Diversity, Derating, TOU Period Editor, Checklist Templates, Calculation Variables, Integrations | Yes | 3E |

`CLAUDE.md` claims 16 project tabs; there are 14 reachable, plus 2 dead.

---

## 3. (see Part 3 at the end: per-screen control tables A–E)

---

## 4. Services layer (`Core/`, 19 files)

### 4.1 Reality check: which services any screen calls
Method: `grep` for each service's `.shared` or static use outside `Core/`.

| Service | Called from a screen? | Evidence |
|---|---|---|
| `SupabaseManager` | Yes, everywhere | — |
| `SimulationEngine` | Yes: SimulationTab, SandboxTab (and Sandbox is unreachable) | `SimulationTab.swift:736`, `SandboxTab.swift:432,457` |
| `FinancialEngine` | Only via `SimulationEngine.run` | `SimulationEngine.swift:339` |
| `BatteryDispatchEngine` | **Never.** The strategy picker at `SimulationTab.swift:67` sets `config.dispatchStrategy`, which the engine never reads. | grep |
| `EdgeFunctionService` | Yes, via Solcast/PVGIS/PDF, plus `ProposalTab.swift:665` and `ProvinceFilesView.swift:488` | — |
| `SolcastService` | Yes: `SolarForecastTab.swift:380` | — |
| `PVGISService` | Yes (`fetchTMY` only): `SolarForecastTab.swift:403`. `fetchMonthly` is never called. | — |
| `PDFGenerationService` | Yes: Proposal, Monthly Report, Tariff tabs | `ProposalTab.swift:500,517`; `MonthlyReportTab.swift:483,503`; `TariffAssignmentTab.swift:153-154,205-206` |
| `TariffExtractionService` | Yes: Tariffs ▸ Documents, and the key in Settings | `TariffUploadView.swift:426,438,503,513`; `SettingsView.swift:116,125,352` |
| `ShareLinkService` | Portal only (`validateToken`, `recordSignature`). `generateToken`/`portalURL` are unused; ProposalTab has its own copy. | `ClientPortalView.swift:373,396`; `ProposalTab.swift:529-545` |
| `OfflineSyncService` | Only `flushQueue` from the status bar. **`enqueue` is never called**, so the queue is always empty. | `UI/Components/ToastView.swift:120,141` |
| `RealtimeService` | **Never.** `subscribe(to:)` has 0 call sites. | grep |
| `ExportService` | **Never.** LoadProfileTab has its own `exportCSV`. | `LoadProfileTab.swift:192` |
| `ReferenceDataService` | **Never** | grep |
| `GeocodingService` | **Never** | grep |
| `DataImportService` | **Never** | grep |
| `InfographicService` | **Never** | grep |
| `SyncService` | **Never** | grep |
| `LaTeXCompileService` | Deleted in `1124269` ("drop dead compile-latex listing"). `CLAUDE.md` still lists it. | git |

**Edge functions a screen actually invokes:**
- `solcast-forecast`, `pvgis-tmy`
- `generate-pdf` (types `proposal`, `monthly_report`)
- `generate-proposal-narrative` (`ProposalTab.swift:653-680`): present in code, but `generateNarrative` has **no caller**. The "AI narrative" is unreachable, and even if it ran, its section keys don't match the proposal's sections (Part 3C).
- `extract-tariffs`: not in the parity list, and not in the web repo's `supabase/functions` (35 dirs). **It probably does not exist**, so ProvinceFiles uploads always end `.failed` after the storage upload (unverified).

`process-tariff-file`, which the parity list claims is wired, is **not called**: the iOS app runs extraction on the device against Anthropic instead.

### 4.2 Per-service detail
| Service | What it does | External API / LLM | Supabase | Defects / notes |
|---|---|---|---|---|
| **SupabaseManager** (`Core/SupabaseManager.swift:4-39`) | Singleton `SupabaseClient(url, anonKey)` with a custom `AuthLocalStorage` | — | Auth | **Tokens persisted in `UserDefaults`** under prefix `dev.wattmatt.wmsolar.supabase.`, even though the type is named `KeychainLocalStorage` (22-38). Refresh tokens are readable from app backups and unencrypted prefs. |
| **EdgeFunctionService** (`Core/EdgeFunctionService.swift:6-47`) | `invoke<T>` / `invokeRaw` wrapper | — | `functions.invoke` with the user JWT | Decoder uses `.convertFromSnakeCase` (21). Any response type with explicit snake_case `CodingKeys` silently decodes nil; this bug killed remote PDF until `8b67a98`. `anyToJSON` turns every Int into a double and any other type into `null` (36-45). No timeout, retry or cancellation. |
| **SimulationEngine** (`Core/SimulationEngine.swift`) | 8,760-h loop over a single 24-h load profile and a 24-h normalised solar curve | — | none (results saved by the Simulation tab) | See §8.1 |
| **FinancialEngine** (`Core/FinancialEngine.swift`) | Cost build-up, 20-y cash flow, NPV, IRR (Newton), LCOE, paybacks, ROI | — | — | Hard-coded tariff R 2.50/kWh (63). See §8.2. |
| **BatteryDispatchEngine** (`Core/BatteryDispatchEngine.swift`) | Per-hour dispatch for self-consumption / TOU arbitrage / peak shaving / scheduled, with hard-coded Eskom TOU hours (36-54) | — | — | **Dead code.** TOU hours are pre-2025 Eskom periods and Saturdays are treated as off-peak (37). Discharge ignores efficiency. |
| **SolcastService** (`Core/SolcastService.swift`) | Calls `solcast-forecast` (hours 168 or 24, `PT60M`) and builds a 24-h profile | Solcast, via edge fn; key held server-side | `solcast-forecast` | `extractHour` reads characters 11–12 of `period_end`, which is **UTC** (110-116). The SAST profile is therefore shifted by 2 h, and `period_end` labels the hour ending. Temperature buckets start at 25 and are then added to (75, 82, 89), biasing the average. Fallback `staticSAProfile` (119-140): its comment says 5.5 kWh/m², but the sine gives **7.54 kWh/m²** (8.88 peak-normalised hours). |
| **PVGISService** (`Core/PVGISService.swift`) | `pvgis-tmy` (2005–2023) and `pvgis-monthly`; maps a typical day to a Solcast-shaped profile | PVGIS (public), via edge fn | 2 edge fns | `peakSunHours = dailyGhiKwh` (75): correct only when GHI is in kWh/m². `fetchMonthly` is unused. |
| **GeocodingService** | `geocode-location`, `batch-geocode-projects/sites`, `google-places-search`, `global-solar-atlas` | Google Places / Geocoding, GSA (server-side) | 5 edge fns | Dead code. No screen geocodes: CreateSite asks for typed lat/long (`CreateSiteView.swift:35-36`), and projects have no lat/long field (B.1). |
| **DataImportService** | `ai-import-loadprofiles`, `ai-import-sheet`, `normalise-raw-data`, `process-scada-profile`, `upload-generation-csv`, `upload-tariff-file`, `export-to-google-sheets` | LLM + Google (server-side, unverified) | 7 edge fns | Dead code |
| **InfographicService** | `generate-report-infographic`, `generate-tour-infographic`, `enhance-tour-content`, `import-google-sheet` | LLM (server-side) | 4 edge fns | Dead code |
| **SyncService** | `cache-boundaries`, `replicate-to-external`, `sync-external-projects/sites`, `dropbox-proxy` | Dropbox, external system | 5 edge fns | Dead code. The Phase-0 report says these web functions now need a service key or user JWT. |
| **OfflineSyncService** (`Core/OfflineSyncService.swift`) | `NWPathMonitor`; queue of `{table, action, JSON payload}` in `UserDefaults`; flush on reconnect | — | Generic insert/update/delete by `id` | **Never enqueued.** If it were used: the NSNumber case precedes Bool, so booleans become 1.0/0.0 (95-101); nested arrays/objects become `null`; no conflict detection or ordering across tables; failed ops retry forever; the whole queue lives in `UserDefaults`. |
| **RealtimeService** (`Core/RealtimeService.swift`) | Realtime v2 channel per table; Combine publisher of (table, action, id) | — | Realtime | Never subscribed. `record["id"]?.value as? String` is likely always nil for uuid columns (55; unverified). |
| **ShareLinkService** (`Core/ShareLinkService.swift`) | Proposal share token, portal lookup, signature recording | — | `proposals` (select by `share_token`, update), `projects`, `proposal_signatures`, bucket `portal-assets` | Portal URL is `<supabase-url>/portal/<token>` (29-31). The Supabase API host serves no portal page, so the link is broken. `validateToken` works for an unauthenticated portal user only if `anon` can SELECT `proposals` by token (52-58), and Phase 0 on web closed exactly that. `recordSignature` sets `status='signed'` **before** inserting the signature row (114-142), so a failed insert leaves a "signed" proposal with no signature. The signature PNG is at a **public URL** (110-112). No signer identity, IP or timestamp from the server. |
| **PDFGenerationService** (`Core/PDFGenerationService.swift`) | Remote `generate-pdf` returns `pdf_url`, which is downloaded. Local fallback: A4 plain text (title, company, sections, "Page N of M"). | — | `organization_branding` `.limit(1)` (30-36), `generate-pdf` | Branding is a single global row with no org scope. The remote path was broken until `8b67a98` (snake-case). Local PDFs have no tables or charts, and `bodyNS.draw(in:)` does not paginate a body taller than the page, so long sections are clipped (217-221). |
| **TariffExtractionService** (`Core/TariffExtractionService.swift`, 1,085 lines) | Download file → extract text → **two-pass Claude extraction** → insert rows | **Anthropic Messages API directly from the device.** Pass 1: `claude-haiku-4-5-20251001`, `max_tokens` 4096, timeout 120 s (405-457). Pass 2: `claude-sonnet-4-20250514`, `max_tokens` 16000, timeout 600 s (461-539). | Storage `tariff-uploads` (REST GET with user JWT, 221-234); writes `tariff_plans`, `tariff_rates`, `municipalities` (auto-created), `tariff_uploads` status | §4.3 |
| **GeocodingService / ReferenceDataService / ExportService / InfographicService / DataImportService / SyncService** | — | — | — | Unused; see above |

### 4.3 TariffExtractionService in detail (the "CoC parsing" item)
`FIX_COC_PARSING.md` is a misnomer: it is about **tariff** extraction, not a Certificate of Compliance.

**Where the key lives.** A per-device Keychain generic password (service `dev.wattmatt.wmsolar.anthropic`, account `api-key`), typed in by the user under Settings ▸ AI Configuration (`TariffExtractionService.swift:31-74`, `SettingsView.swift:84-139`). Every tester needs their own Anthropic key, and usage and billing are not tracked centrally.

**Pipeline** (`processUpload`, 78-217):
1. Download from `tariff-uploads/<file_path>` (86-95).
2. PDF → PDFKit text per page (238-248). XLSX → a hand-written ZIP and XML reader (254-401).
3. Reject if the text is under 100 characters (121-125).
4. Detect the province from the **filename only** (912-937). The `tariff_uploads.province_id` chosen at upload time is ignored.
5. Pass 1 lists municipality names; Eskom is filtered out (145-150).
6. Pass 2 runs once per municipality (`batchSize = 1`, 161) and **resends the whole document each time**, truncated to 180,000 characters (414, 471). A document with 40 municipalities makes 41 LLM calls of about 45k input tokens each. Anything after character 180,000 is never seen.
7. Insert (719-800).

**Prompt** (635-714): a strict JSON schema; c/kWh → R/kWh; VAT-exclusive (÷1.15 if only incl. shown); IBT blocks with 999999 as the last max; TOU × season combinations; categories mapped.

**Parsing:**
- `extractJSON` takes a ```` ```json ```` fence or the first `{` to last `}` (541-558).
- `repairTruncatedJSON` closes open strings and brackets (561-631). **Its trailing-key removal is buggy:** it slices up to the comma, then `break`s after one iteration (604-619).
- Decoders tolerate string or number (983-1070).
- **A missing `amount` becomes 0 and is inserted as a R 0 rate** (1034-1042).

**Writes:**
- `resolveMunicipality`: `ilike name`, then `ilike %name%`, then **INSERT a new municipality** (802-858). Loose matching attaches tariffs to the wrong municipality; unmatched names create duplicates.
- When the province is nil it passes the **municipality name as the province** (723).
- Category mapped to an enum list (734-739, 895-908); voltage → `low`/`medium`/`high` (886-893).
- Plan inserted, then rates one by one. **Not transactional.** Rate failures are only `print`ed (788-796). A plan with zero rates still counts.
- Re-running an upload **duplicates** every plan (no idempotency key).
- Insert errors go to `tmp/tariff_insert_errors.txt` (191-198). Debug JSON goes to `tmp/tariff_extraction_debug.json` (521-522).
- The upload's final status is `completed` if at least 1 plan was inserted (207-214).
- Nothing captures TOU **hour windows**, so rates carry `tou = peak` with no definition of when peak is.

**Status of SPEC-001 against the code:**
| Criterion | Code | Status |
|---|---|---|
| Timeout ≥ 180 s (target 300) | Pass 2 `request.timeoutInterval = 600` (468); pass 1 = 120 s (412); `URLSession.shared` default resource timeout | Mostly met; pass 1 still 120 s |
| `max_tokens` ≥ 16000 | Pass 2 = 16000 (478); pass 1 = 4096 | Met (pass 2) |
| Optional types / `decodeIfPresent` | `ExtractedTariff`/`ExtractedRate` custom decoders (990-1070); `municipality`, `category`, `tariff_name`, `structure`, `charge` still required | Partial |
| Graceful partial JSON + user error | Repair function plus surfaced error with debug path (515-538) | Partial (repair is buggy) |
| Retry ×2 on timeout | None | **Not met** |

`SPEC.md` still marks SPEC-001 `🔲 Pending`.

**Likely defects (unverified at runtime):**
- **XLSX extraction.** The ZIP reader ignores data-descriptor entries (general-purpose flag bit 3), where the local header's compressed size is 0 (296-307). It also prefixes raw DEFLATE data with a zlib header `78 01` before `NSData.decompressed(using: .zlib)` (312-317). Apple's `.zlib` algorithm expects **raw** DEFLATE, so decompression likely fails silently (`try?`). Excel ingestion may therefore return "Could not extract text from Excel file" for most real files.
- **Security.** Tariff tables are shared reference data. After `2026-08-05_fix_admin_rls.sql` §4, any signed-in user can INSERT `tariff_plans`, `tariff_rates` and `municipalities` (`WITH CHECK (true)`) and UPDATE any `tariff_uploads` row.

---

## 5. Data model notes relevant to the E-Site spec
- **Load profiles.** `scada_imports` holds **only derived 24-value arrays**: `load_profile_weekday`, `load_profile_weekend`, plus `weekday_days`, `weekend_days`, `data_points`, `detected_interval_minutes`, `value_unit`, date range, shop metadata (`CSVImportView.swift:712-770`; `BulkCSVImportView.swift:846-869`). **Raw interval data is discarded on iOS.** `scada_data` is read by the meter daily view (`LoadProfilesView.swift:1099`) but never written by the app. When it is empty the daily chart is **fabricated** by multiplying the average profile by `random(0.92…1.08)` (`LoadProfilesView.swift:1116-1129`).
- **Tariffs.** Hierarchy `provinces → municipalities → tariff_plans (category, structure, metering, voltage, phase, amps/kVA ranges, effective dates) → tariff_rates (charge, season, tou, block_number, block_min/max_kwh, amount, unit)`. Eskom is separate: `eskom_tariff_plans(supply_context nla|munic, category, sheet_name, voltage, transmission_zone, structure)` and `eskom_tariff_rates` (`TariffsViewModel.swift:168-209`). Values seen for `structure`: `flat | inclining_block | time_of_use | seasonal | demand | hybrid`. TariffBuilder writes `ibt | tou | hybrid_tou_ibt` (inconsistent; Part 3E).
- **TOU periods.** Three different sources, none shared with the engines:
  - hard-coded dictionaries (`UI/Components/TOUClockDiagram.swift:86-129`)
  - the `tou_period_settings` table (season × day_type × hour → period), editable in Settings but read by nothing else
  - `BatteryDispatchEngine.TOUPeriod.forHour` (`Core/BatteryDispatchEngine.swift:36-54`)
- **Costs.** `SystemCost` claims to live in `project_simulations.results_json` (`Models/SystemCost.swift:3`), yet a `system_costs` table is also read. Part 3B found that nothing writes `system_costs` or `project_tariff_assignments`.
- **Settings.** Almost everything in Settings is device-local `@AppStorage` and **consumed by nothing**: about 50 `calc*` keys, 7 `derate*`, `diversityFactor`, the integration keys, `preferredUnits`, `currencyFormat`, `defaultSolarHours` (grep of every key: no reader outside the defining view). Only branding, checklist templates and TOU periods persist server-side.

---

## 6. iOS-only vs web-only (verified against code, not `PARITY_STATUS.md`)

### 6.1 Present on iOS, absent or different on web
| Feature | iOS evidence | Keep for E-Site? |
|---|---|---|
| Native macOS app with sidebar and ⌘-shortcuts; visionOS target | `ContentView.swift:104-117`, `WM_SolarApp.swift:24-43`, pbxproj:302 | No; E-Site web covers desktop |
| On-device two-pass LLM tariff extraction with a user-supplied Anthropic key | `TariffExtractionService` | Keep the **idea** (municipality scan → per-municipality extraction), but server-side with an org key, batching, idempotency and review-before-publish |
| Theme system: System / Light / Dark / Glass + 6 accents | `App/ThemeManager.swift` | No (E-Site has its own design system) |
| ProvinceFiles tab calling `extract-tariffs` | `ProvinceFilesView.swift:465-503` | No. Fake stats (0.85 confidence, "2025-07-01") and a probably missing function. |
| Local native PDF fallback when `generate-pdf` fails | `PDFGenerationService.swift:92-224` | Maybe. The offline "print what you have" idea is good; this implementation is poor. |
| iOS share sheet for PDFs, PV layout image, portal link | `PVLayoutTab.swift:492`, `ProposalTab.swift:628`, `LoadProfileTab.swift:735`, `ClientPortalView.swift:452` | Yes (Expo `Sharing`) |
| Finger signature capture on a proposal (client portal) | `UI/Components/SignatureCanvas.swift`, `ClientPortalView.swift:396` | Yes, with a server-stamped signature record |

### 6.2 Present on web, absent or reduced on iOS
Based on web component names under `WM_Solar_Web/src`. Function not re-verified here; see the web reviews.

- **Simulation**
  - TMY 8,760-h simulation, PVsyst loss chain config with waterfall, inverter sizing/slider, over-paneling analysis, degradation projection, MIRR (`components/projects/*`, `utils/financialMetrics.ts`, `lib/pvsystLossChain.ts`).
  - TOU-calendar-driven dispatch with 4 strategies, charge-from-grid and aux draw (`simulation/EnergySimulationEngine.ts:749-900`).
  - A real `tariffCalculations.ts` (533 lines) versus the iOS R 2.50 constant.
- **Meters and load profiles:** meter stacking / profile stacking, scaled meter preview, tenant ↔ profile matcher, multi-meter selector, meter analysis, pivot table, Excel audit reimport, one-click batch processor, Google Sheets import, AI sheet import.
- **Tariffs:** tariff edit dialog, municipality manager, tariff period comparison, energy-flow and battery infographics. iOS tariffs are read-only except insert via Builder or extraction; there is no edit or delete.
- **Sandbox:** parameter sweep, project clone selector, draft report (iOS Sandbox is unreachable).
- **Floor-plan markup** (`components/floor-plan/FloorPlanMarkup.tsx`); iOS has a simpler PV canvas.
- **Platform:** onboarding and set-password pages, PWA install, system-costs manager, shop-types manager, `invite-user` edge function (iOS has no invite path).

### 6.3 Mobile-specific capabilities: what exists vs what E-Site Expo should add
| Capability | In WM Solar iOS? | Evidence | Recommendation for E-Site Expo |
|---|---|---|---|
| Camera capture | **No.** Permission string only. | 0 hits for `UIImagePickerController`, `AVCapture`, `PhotosPicker` | **Add:** roof/site/DB/meter photos with EXIF time and GPS, attached to project and survey item |
| Photo library | Via `.fileImporter` only (png/jpeg) | Settings avatar, Branding logo, Documents | Use `expo-image-picker` |
| GPS / location | **No.** Permission string only; no `CLLocationManager`. Lat/long typed by hand. | `CreateSiteView.swift:35-36` | **Add:** "use my location" to set site coordinates, which feeds PVGIS/Solcast |
| Maps | MapKit project map; tariff map with fake coordinates | `ProjectsListView.swift:150-196`, `MunicipalityMapView.swift:254-266` | Keep the project map; drop the fake municipality map |
| Offline | **Effectively none.** Queue never used; no cache. | §4.1 | **Add real offline for field capture only:** survey forms, photos and meter readings, queued in SQLite, synced idempotently. Do not attempt offline simulation. |
| Meter reading capture | **No** | — | **Add:** manual reading entry and photo-of-meter (optional OCR), feeding `generation_records` / consumption validation |
| Site survey | **No** | — | **Add:** roof type/orientation/tilt (compass/inclinometer via `expo-sensors`), shading notes, DB and main-breaker details, cable-route photos |
| File import | CSV/PDF/XLSX via `.fileImporter`. Security-scoped access is missing in CSVImport, TenantScheduleImport and TariffUpload. | Part 3D/3E | Desktop web is the right place for bulk CSV; mobile only needs "attach file" |
| Signatures | Yes (portal) | `SignatureCanvas.swift` | Keep: handover and client acceptance on the phone |
| Share sheet | Yes | §6.1 | Keep |
| PDF preview | `PDFPreviewView` (PDFKit wrapper) | `UI/Components/PDFPreviewView.swift` | Keep |
| Push notifications | **No** | — | Optional (proposal signed, generation alarm) |
| Handover checklist | Built but unreachable | `HandoverTab.swift` | Add to mobile (it is a field activity), wired this time |

---

## 7. Paid-add-on relevance
The iOS app has **no entitlement, paywall or subscription logic**: no `StoreKit`, no plan checks, no per-project flags. Everything is available to every signed-in user.

For E-Site (paid per project), the mobile app must gate on a server-side entitlement. Do not use App Store IAP: B2B per-project billing through Paystack on the web is simpler and avoids Apple's 30 %. Mobile screens should show a "solar module not enabled for this project" state.

---

## 8. Calculations implemented natively, and whether they match the web engine

### 8.1 SimulationEngine (`Core/SimulationEngine.swift`)
**Inputs**
- 24-value load profile, repeated for all 365 days. There is no weekday/weekend split, even though `scada_imports` stores both.
- 24-value solar profile normalised to peak = 1 (`SolcastPVProfile.normalizedProfile`).
- Optional 8,760 temperatures.

**Derates** (`combinedDeratingFactor`, 96-100):
`(1−soiling)(1−shading)(1−mismatch)(1−wiringDC)(1−wiringAC)(1−inverterLoss)(1−transformer)` = 0.98·0.97·0.98·0.98·0.99·0.97·0.99 = **0.868** at defaults (63-72).

**Tilt/azimuth factor** (177-181): `max(0.5, cos(tilt − |lat|) · (0.5 + 0.5·cos(azimuth)))`.

**Seasonal factor** (377-388): `1 + (f_m − 1)·min(|lat|/30, 1.5)` with `f = [1.15, 1.10, 1.00, .88, .75, .68, .70, .78, .90, 1.02, 1.12, 1.18]`.

**Per hour** (201-286):
- `pvDC = norm[h] · kWp · derate · max(1 + γ(T−25), 0.5) · seasonal · tiltAz`, with γ = −0.004
- `invCap = kWp / dcAc`
- `pvAC = min(pvDC, invCap) · ηinv` (0.97)
- clipping = `max(pvDC − invCap, 0)`

**Energy balance, deficit branch** (227-245):
- solarUsed = pvAC
- battery discharge = `min(deficit, P, SoC − SoCmin)`, **with no efficiency applied**
- `gridImport = min(deficit, importLimit)`: **energy above the import limit disappears**, and is not recorded as unserved load

**Energy balance, surplus branch** (245-264):
- battery charge = `min(surplus, P, SoCmax − SoC)`, stored × √RTE
- export = `min(surplus, exportLimit)`: curtailment is not recorded

**Battery start and limits:** SoC starts at 50 % (186). Min/max 10/90 %.

**Summaries** (291-336):
- self-consumption = used / PV
- coverage = used / load
- specific yield = ΣpvAC / kWp
- **"performance ratio" = combinedDeratingFactor × 100**, a constant and not a measured PR
- capacity factor = ΣpvAC / (kWp·8760)

**Structural errors (none depend on runtime):**
1. **No irradiance magnitude.** Output is proportional to the *shape* of the GHI curve, not its size. For the static fallback profile, the daily Σnorm is 8.88 equivalent full-power hours, which gives **≈ 2,578 kWh/kWp/yr** at lat −26.2, tilt 25°, 25 °C (computed from the code's own constants). A realistic Gauteng yield is about 1,600–1,750. Solcast/PVGIS profiles have the same problem: a cloudy-day curve with a low peak is still normalised to 1.
2. **Inverter loss is counted twice:** `inverterLoss` 3 % in the derate plus `inverterEfficiency` 0.97.
3. Dispatch strategy, load growth, degradation, LID, battery degradation and chemistry are **ignored** by the hourly loop. Degradation and LID are applied only in FinancialEngine.
4. There is no calendar (every year is 365 days starting on no particular weekday), no TOU and no tariff.

### 8.2 FinancialEngine (`Core/FinancialEngine.swift`)
**Cost build-up** (46-60):
- `solar = kWp·R/kWp`, `battery = kWh·R/kWh`, `equipment = solar + battery`
- BOS = H&S + water points + CCTV + MV switchgear
- prof fees 5 %, PM 5 %, contingency 7.5 % of equipment (the standard preset: R 11,000/kWp, R 5,500/kWh; `Models/SystemCost.swift:43`)

**Year loop** (82-135):
- degradation `= (1−LID)` in year 1, then `(1−d)^(y−1)·(1−LID)`
- tariff `= 2.50·(1+esc)^(y−1)`: **hard-coded R 2.50, esc 10 %** (63, 68)
- savings = yearPV · (used/PV) · tariff: **no export revenue, no demand-charge saving, no TOU value**
- maintenance = `(solar·1.5 % + battery·1 %)·(1+CPI)^(y−1)`
- insurance = `total·1 %·(1+CPI)^(y−1)`
- replacement in `replacementYear` (10) = **45 % of the total system cost**. `moduleShare`, `inverterShare` and `batteryReplacement` % are ignored.
- `battDeg` is computed but unused (91)

**Metrics:**
- NPV = Σ discounted net − cost
- IRR by Newton-Raphson from 10 %, clamped to [−50 %, 500 %], with no convergence check (179-205)
- LCOE = (cost + Σ disc. O&M/replacement) / Σ disc. kWh (209-225)
- simple payback = cost / year-1 net (153-154)
- discounted payback = first year cumulative ≥ 0, **else the project life, indistinguishable from a real value** (157-158)
- ROI = (Σ gross savings − cost) / cost, which ignores O&M (161)

**Other defaults:** duration 20 years (the docs say "25-year").

### 8.3 Calculator screen (`Features/Calculations/CalculationsViewModel.swift`): a third engine
**Defaults** (9-65): R 12,000/kWp; R 8,000/kWh; PSH 5.5; PVsyst-style loss list; 20 y; discount 9 %; esc 10 %; CPI 6 %; insurance 1 %; replacement shares 70/30 with 10/50/30 %; grid EF 0.95 kg/kWh + 8 % T&D.

**PR** (351-373): Π(1 − loss_i) over 13 losses × (1 + 0.75 % quality gain) = **0.788**. Year-1 yield = kWp · 5.5 · 365 · PR · (1 − 2 %) = **1,550 kWh/kWp**. This is plausible, and very different from §8.1 for the same system.

**Self-consumption:** `min(gen, 0.85·annual load)` (237), a fixed cap unrelated to profile shape.

**Bill model**
- **Municipal** (410-459):
  - basic = the **first** basic rate, regardless of unit (R/day treated as monthly)
  - + demand × maxDemand + network_access
  - IBT by blocks, or TOU as `consumption·(0.25·peak + 0.42·std + 0.33·off)`, or flat
  - no tariff selected → `consumption · 2.50`
- **Eskom** (461-603):
  - service/admin and ancillary R/day × 30
  - network demand/capacity and generation capacity × maxDemand (kVA)
  - environmental levy c/kWh
  - energy: IBT; TOU (same 25/42/33 split, high 3/12 + low 9/12); seasonal 3/9; flat
  - **Solar reduces kWh uniformly across TOU periods, and max demand is not reduced**

**Cash flow** (250-311):
- year-1 savings × (1+esc)^(y−1)
- maintenance 1.5 % of capex (hard-coded; the defaults field is not used)
- insurance and replacement escalate with CPI

**Metrics:**
- payback interpolated (314-321)
- NPV (324-327)
- IRR incl. year 0 (377-399)
- **ROI = year-1 savings / cost** (333), a different definition from FinancialEngine
- **LCOE = cost / Σ kWh**, undiscounted and without O&M (336)
- CO₂ = gen · 0.95 · 1.08; lifetime × 0.9 fudge (339-344)

**Charts:** `hourlyConsumptionProfile` / `hourlySolarProfile` (607-633) are hand-shaped curves that feed no number.

### 8.4 Quick Estimate
See A.5 for the formulas. Part A found that battery size adds cost but no savings, and that the dashboard KPIs double-count projects that have several simulations.

### 8.5 Comparison with the web engine
| Aspect | iOS SimulationEngine / FinancialEngine | iOS Calculator | Web (`WM_Solar_Web/src`) |
|---|---|---|---|
| Solar resource | Peak-normalised 24-h curve × kWp (wrong magnitude) | PSH × 365 | Solcast/PVGIS typical day, GSA monthly synthesis, or **TMY 8,760** (`simulation/useSolarProfiles.ts:145-251`) |
| Losses | 7-item product, inverter counted twice | 13-item PVsyst list | Full PVsyst loss chain (`lib/pvsystLossChain.ts`, 855 lines) |
| Load | One 24-h profile for every day | Monthly kWh | 24-h profile or meter stack, per-day calendar |
| Calendar / TOU | None | Fixed 25/42/33 split | `buildAnnualCalendar(touSettings)`, per-day hour maps (`EnergySimulationEngine.ts:776-834`) |
| Battery | Self-consumption only, SoC 10–90 %, start 50 % | Cost only | 4 strategies, charge/discharge power, grid charging, aux drain, SoC 10–95 % (`EnergySimulationEngine.ts:749-850`) |
| Tariff | **R 2.50/kWh constant** | Municipal/Eskom bill approximation | `lib/tariffCalculations.ts` |
| NPV/IRR | Escalating savings, O&M, replacement | Escalating savings | `utils/financialMetrics.ts`: **flat annual savings**, IRR, **MIRR**, LCOE = cost/(gen·life·0.9) |
| Default capex | R 11,000/kWp, R 5,500/kWh | R 12,000/kWp, R 8,000/kWh | R 8,500/kWp, R 3,500/kWh; solar maintenance 3.5 % (`useSimulationEngine.ts:434-441`) |

**Conclusion.** None of the three native engines matches the web engine, and they do not match each other. The web engine is itself internally inconsistent: its NPV uses flat savings while the rest escalates. That belongs to the web review. E-Site should specify **one** engine with test vectors, server-side or in a shared TS package, and must not port any Swift formula.

---

## 9. Defects, open SPEC items, security, build/distribution

### 9.1 Highest-impact functional defects (cross-part)
| # | Defect | Evidence |
|---|---|---|
| F1 | Every simulation's savings use R 2.50/kWh, not the project tariff | `Core/FinancialEngine.swift:63` |
| F2 | PV yield magnitude is wrong (normalised curve, no GHI scaling) | `Core/SimulationEngine.swift:207-212`; §8.1 |
| F3 | Solcast profile shifted 2 h (UTC hour); temperature average biased | `Core/SolcastService.swift:75-89,110-116` |
| F4 | Battery strategy picker does nothing | `SimulationTab.swift:67`; engine never reads `dispatchStrategy` |
| F5 | Handover and Sandbox tabs unreachable | `ProjectDetailView.swift:4-18` |
| F6 | Password recovery cannot complete; deep links unregistered | A.1 |
| F7 | Portal link points to the Supabase API host; signature status is set before the record | `ShareLinkService.swift:29-31,114-142` |
| F8 | Costs and tariff assignment never persisted (`system_costs`, `project_tariff_assignments` never written) | Part 3B |
| F9 | Daily load view fabricates data with random noise | `LoadProfilesView.swift:1116-1129` |
| F10 | Raw interval data discarded at import; only 24-h averages kept | §5 |
| F11 | iOS file imports without security-scoped access (CSV single, tenant schedule, tariff upload) are likely to fail for Files/iCloud picks | `CSVImportView.swift:198-216`, `TenantScheduleImportView.swift:179-197`, `TariffUploadView.swift:283-300` |
| F12 | Tariff extraction: XLSX path likely broken; R 0 rates on missing amounts; duplicates on re-run; municipality auto-create on fuzzy misses | §4.3 |
| F13 | TariffBuilder writes category/structure values the browser and calculators don't recognise | `TariffBuilderView.swift:88-111` vs `TariffsView.swift:160-168` |
| F14 | ~60 settings persist to the device only and are read by nothing | §5 |
| F15 | TOU reference labelled "Eskom 2025/26" shows the older period hours; Saturday treated as all off-peak in dispatch; Nightsave shown as all off-peak (needs verification against the Eskom 2025/26 tariff book) | `TOUReferenceView.swift:12,79-107`; `TOUClockDiagram.swift:86-129` |
| F16 | ProvinceFiles stats hard-coded (0.85 confidence, "2025-07-01", 0 files) | `ProvinceFilesView.swift:431-434` |
| F17 | Municipality map pins are synthetic jitter around province centres | `MunicipalityMapView.swift:254-266` |
| F18 | Bulk import total kWh wrong by × interval/60; "1,234.5" parses as 0 and is counted | `BulkCSVImportView.swift:826-827, 768` |
| F19 | Tenant schedule import batch-inserts objects with different keys (PostgREST `PGRST102` risk); Category column mapped but never written | `TenantScheduleImportView.swift:457-545` |
| F20 | Stats counts load all rows and are likely capped by PostgREST max-rows (1,000 default; unverified) | `TariffsViewModel.swift:110-128` |
| F21 | Local PDF clips long sections; branding is one global row | `PDFGenerationService.swift:217-221, 30-36` |
| F22 | Unit tests exist but are not in the Xcode project | pbxproj |
| F24 | Simulation / Load Profile tabs add up **every meter the user can see**, not the project's own, and fall back to a flat 50 kW load. Simulation ignores the project's tariff and costs. Five inputs have no effect: dispatch strategy, module type, ground coverage, inverter type, load growth. | Part 3C |
| F25 | Monthly Report draws random daily figures when there is no data; its "specific yield" saturates at a fixed ~907.5 kWh/kWp | Part 3C |
| F26 | Sandbox draft report shows IRR ×100; schematic annotations are discarded on save; a new simulation never writes `results_json` | Part 3C |
| F27 | Overview: Target Date never saved; the tab re-saves the project on every open; Annual Yield and CO₂ figures are 1000× too small. Generation: downtime and warranty entries are lost on leaving the tab, and duplicate months are created. Documents: bulk delete broken, Download no-op on iOS, storage orphaned on delete. | Part 3B |
| F28 | Profile save wipes phone/company/role; Sessions tab hard-coded; Dashboard Quick Actions and "View All" do nothing | Part 3A |
| F29 | Branding: a second Save inserts a duplicate row; ProvinceFiles queue can crash (index out of range) if an item is removed during processing; two contradictory Megaflex Saturday definitions | Part 3E |
| F30 | **macOS target likely does not compile.** `SiteDetailView` uses the iOS-only `EditMode`, `\.editMode` and `.insetGrouped` outside `#if os(iOS)` (lines 21, 118, 173, 195-206). This was not verified by building. | `SiteDetailView.swift` |
| F31 | "Add Meter Manually" is a dead button. Single CSV import never shows upload errors, and going Back from Review reuses the stale result. The bulk importer forces cumulative differencing and reads the interval from the first two rows only. | Part 3D |
| F32 | Calculator: 6 editable settings feed no formula (DC/AC, system losses, VAT, REC price, battery degradation, battery EoL). Municipal c/kWh rates are not converted. The battery adds cost but no savings. Savings are not degraded with the panels. | Part 3D |
| F23 | `print`-only error handling throughout (e.g. `TOUPeriodEditorView.swift:359`, `SettingsView.swift:449,477`, `ChecklistTemplatesView.swift:196-273`, `BrandingSettingsView.swift:238-312`) | grep |

Per-screen stubs and dead buttons are listed in each part's "Stubs" section (A.3, B.3, C, D, E).

### 9.2 Security concerns
| # | Concern | Evidence | Severity |
|---|---|---|---|
| S1 | **Service-role key shipped in TestFlight builds 6–40.** Removed from source in `923f993`; `PHASE0-SECURITY-REPORT.md` item 2 says "Rotate … treat as compromised". Rotation is **not evidenced**. The build-40 IPA (2026-04-01) is still on disk and in testers' hands. | commit message `923f993`; `/Volumes/…/APPS/PHASE0-SECURITY-REPORT.md:14,35-39` | Critical until rotated |
| S2 | **Self-promotion to admin.** `profiles` self-update policy is row-level only, so any user can set `is_admin = true`. The migration itself says so (`migrations/2026-08-05_fix_admin_rls.sql:85-88`). The app gates admin screens on `profiles.is_admin` client-side (A.4). | migration | High |
| S3 | **Blanket read of shared tables.** `USING (true)` SELECT for any authenticated user on `projects`, `proposals` (incl. `share_token`), `project_simulations`, `generation_records`, `scada_imports`, `sites`, `gantt_tasks`, tariffs (`migrations/2026-08-05_fix_admin_rls.sql:103-155`). No org or tenancy model exists anywhere in the app: no org id in queries, and new projects are saved with no owner (B.6). | migration, Part 3B | High for a multi-tenant product |
| S4 | **Blanket write of reference tariffs** (`WITH CHECK (true)`) and `tariff_uploads` update (`…:162-176`). `tou_period_settings` save deletes **all** rows (`TOUPeriodEditorView.swift:326-331`). Part 3E adds: no admin gating at all on Tariffs or Settings; `tou_period_settings`, `checklist_template*` and `organization_branding` have no policies in the repo. Branding is a single global row writable by anyone who can see it. | code | High |
| S5 | **Auth tokens in `UserDefaults`**, not Keychain | `Core/SupabaseManager.swift:22-38` | Medium |
| S6 | **Anthropic key typed in by each user**; document text sent from the device to Anthropic; no central spend control. Integration keys (Solcast, Google, Mapbox) stored in plaintext `@AppStorage`, although unused. | `TariffExtractionService.swift:31-74`, `IntegrationsView.swift:4-7` | Medium |
| S7 | **Public URLs** for signatures (`portal-assets`), avatars, branding logos; storage delete does not follow row delete (B) | `ShareLinkService.swift:110-112` | Medium |
| S8 | Portal (unauthenticated) needs anon SELECT on `proposals` by token and on `projects`. The web Phase 0 lockdown (`20260805100000_phase0_proposals_lockdown.sql`) would break the iOS portal, if they share a DB at all (they currently don't; §1.2). | `ShareLinkService.swift:34-100` | Medium |
| S9 | "Delete My Account" only signs out (A.3) | Part 3A | Medium (POPIA) |
| S10 | Settings claims "All data is encrypted … via Supabase Row Level Security" (`SettingsView.swift:319-335`), which is misleading given S3/S4 | code | Low |
| S11 | Debug files with full LLM output written to the temp dir | `TariffExtractionService.swift:191-198, 521-535` | Low |
| S12 | Secrets in the project root: `.p12`, certs, provisioning profiles, `.ipa`, dSYM. `.gitignore` excludes them, but they sit next to the source on an external drive. | `ls` | Low/Medium (operational) |

### 9.3 Build and distribution state
- **Channel:** TestFlight, **internal testers only** (`fastlane/Fastfile:57` `distribute_external: false`). No App Store submission (`memory/decisions.md` "TestFlight-first").
- **Builds:**
  - `CLAUDE.md` records Build 40 on 2026-04-01 as the latest upload.
  - pbxproj has `CURRENT_PROJECT_VERSION = 48` (pbxproj:270). Builds 41–48 are not documented; unverified whether they were uploaded.
  - `WM Solar.ipa` and `fastlane/report.xml` date from 2026-04-01 07:28/07:31.
  - `build/` last touched 2026-07-05.
  - **The 2026-08-05 security change and the 2026-08-06 PDF fixes have not been built or uploaded** (no artefact after those commits; `PHASE0` item 6: "Full Xcode build … could not be type-checked").
- **Pipeline:** `fastlane ios beta_external`, or `./deploy.sh` (keychain-held ASC API key `8835X6FM6K`, cert `77PMK2CKF9`). The Fastfile changelog is hard-coded to "Build 37: deploy pipeline rebuild…" (`fastlane/Fastfile:58`), which is SPEC-002. Paths in `CLAUDE.md`/`deploy.sh` still point to `/Users/spud/Documents/DEVELOPER/WM Solar`; the repo now lives at `/Volumes/Extreme SSD/DEVELOPER/APPS/WM Solar`. The decision-review cron fails with "Operation not permitted" (`memory/check_decisions.log`).
- **Known gotchas** (from `CLAUDE.md`): xcconfig `//` comment truncation needs `$(SLASH)`; derived data must be outside iCloud-tracked folders; a deployment target was once mis-set to 26.2.

### 9.4 Open SPEC items (`SPEC.md`: all `🔲 Pending`; "Completed Specs: none")
| Spec | Title | Code reality |
|---|---|---|
| SPEC-001 | TariffExtraction timeout / JSON truncation | Partly done in code (600 s, 16k tokens, lenient decoders); retry missing; doc not updated (§4.3) |
| SPEC-002 | Fix TestFlight pipeline | `Appfile` exists (renamed, per `CLAUDE.md`); changelog still hard-coded; `distribute_external` has no comment |
| SPEC-003 | Raw-data preview chart and profile CSV export | Not done in CSVImport/SiteDetail (LoadProfileTab has its own CSV export) |
| SPEC-004 | Visible pending-mutation queue | Moot: nothing is ever queued |
| SPEC-005 | PDF preview before send | Effectively done: `ProposalTab.swift:302` presents `PDFPreviewView(data:)`, as do MonthlyReport:98, TariffAssignment:110, Schematics:241 and the Portal:185. SPEC.md was not updated. |
| SPEC-006 | Dashboard pull-to-refresh | Partly done: `.refreshable` at `DashboardView.swift:166`. The shimmer, macOS refresh button and last-refreshed stamp are not verified (Part 3A). |
| SPEC-007 | Duplicate tariff plan | Not done (no edit or duplicate anywhere in Tariffs) |

---

## 10. What the E-Site spec should take from this (explicit, nothing assumed)
1. **Do not port** any Swift engine, the parity map, the settings pages or the offline queue. Spec one solar engine (from the web engine, fixed) as a TS package with golden test vectors. The Expo app calls it or shows its server-computed results.
2. **Do port these UX affordances:**
   - load-profile CSV wizard: column mapping, unit detection kW/kWh/W/Wh/kVA/kVAh/A/MW/MWh, interval auto-detect, weekday/weekend split, cumulative-register detection, negative handling. **Store raw intervals**, not just 24-h averages, and split Saturday/Sunday/public holiday for TOU.
   - tariff browser: province → municipality → plan → rates grouped by charge/season/TOU/block
   - TOU clock diagram, from a versioned TOU calendar table that the engine also reads
   - proposal share link + client signature
   - share sheet, PDF preview
3. **Mobile (Expo) scope for the add-on** should be **field capture**: site survey (GPS, compass/tilt, photos, roof/DB/meter details), meter-reading capture with photo, handover checklist with signature, offline queue for these only, plus read-only project, proposal and generation views. Heavy modelling stays on web.
4. **Tariff ingestion:** keep the two-pass LLM pattern, server-side (edge function + org key + job table + human review before publish + idempotent upsert + TOU hour windows captured).
5. **Security baseline to state in the spec:** org-scoped RLS on every solar table (the E-Site `organisation_id` / `user_has_project_access` model); per-project entitlement check server-side; no self-editable role flags; Keychain/SecureStore for tokens; signed URLs, not public buckets; server-stamped signature records.
6. **Data to migrate, if any,** lives in Supabase project `lyctmmqndqegptzkajhz` (iOS) and/or `zhhcwtftckdwfoactkea` (web). Decide which is authoritative before any import.

---

# Part 3 — Per-screen control tables

Parts A–E were produced by line-by-line sub-reviews of each screen group and cross-checked against the lead reads above. Order: A shell/auth/dashboard/estimate/portal/user-management; B projects list, detail and tabs part 1; C project tabs part 2 (schematics, load profile, forecast, simulation, sandbox, proposal, monthly report, Gantt, PV layout); D load profiles and calculations; E tariffs and settings. Where a part's statement conflicts with §0–§10, the section above wins (it was verified directly).


---

<!-- Part 3A: merged from ios-parts/A-shell-auth-dashboard-admin.md -->

## A. App shell, auth, dashboard, quick estimate, client portal, user management

Scope was read line by line: `WM_SolarApp.swift`, `ContentView.swift`, `App/AppState.swift`, `App/ThemeManager.swift`, `Features/Auth/*`, `Features/Dashboard/*`, `Features/Estimate/*`, `Features/ClientPortal/ClientPortalView.swift`, `Features/UserManagement/*`, and `UI/Components/{ToastView,StatCard,LoadingView}.swift`.

To trace handlers I also read `Core/SupabaseManager.swift`, `Core/ShareLinkService.swift`, `Info.plist`, `WM_Solar.entitlements`, `Models/UserSession.swift` and `../migrations/*.sql`. I opened no signing or config secret files.

Paths are relative to `WM Solar/WM Solar/`.

---

### A.1 Navigation map

**Entry point.** `WM_SolarApp` is the `@main` app (`WM_SolarApp.swift:3-45`).
- It creates `AppState` and `ThemeManager` as `@StateObject`s (5-6) and injects both as environment objects (11-12).
- It applies `preferredColorScheme(themeManager.colorScheme)` (13) and `.tint(selectedAccent.color)` (14).
- It routes URLs with `.onOpenURL { handleDeepLink }` (15-17).
- On macOS only, it sets a window background of `.ultraThinMaterial` for the Glass theme, otherwise `.regularMaterial` (18-20).

**Root router.** `ContentView.body` (`ContentView.swift:10-54`) picks the first branch that matches, in this order:
1. `appState.portalToken != nil` shows `ClientPortalView(token:)` with an "Exit Portal" overlay button (12-24). **This takes priority over auth.** A signed-in user who opens a portal link sees only the portal.
2. `appState.showPasswordReset` shows `ResetPasswordView()` (25-26).
3. `appState.isLoading` shows a splash with the logo and a `ProgressView` (27-38). `isLoading` starts as `true` (`AppState.swift:9`).
4. `appState.isAuthenticated` shows `OfflineStatusBar()`, then `MainNavigationView()`, with `ToastOverlay()` in a ZStack (39-46).
5. Otherwise it shows `AuthView()` (47-48).

`.task { await appState.restoreSession() }` runs on the root (51-53). `restoreSession` (`AppState.swift:61-69`) reads `client.auth.session`. If a session exists it calls `handleSignIn`; if none, it swallows the error. It always sets `isLoading = false` through `defer`.

There is **no `authStateChanges` listener anywhere** (grep: 0 hits). A token revoked server-side, or a failed refresh, is never reflected in `isAuthenticated` until the next launch.

**macOS layout: sidebar** (`ContentView.swift:104-117`).
- `NavigationSplitView` with `SidebarView(selection:)` has a minimum frame of 900×600.
- The sidebar is a `List(selection:)` over `SidebarSection.allCases`, grouped as:
  - Main: Dashboard
  - Data: Tariffs, Load Profiles, Projects
  - Tools: Calculations, Quick Estimate
  - Account: User Management, Settings

  This comes from `SidebarItem.section` (82-89), rendered at 177-187, with the logo header at 188-202.
- `detailView` maps the selection to a view (148-170). `nil` falls back to Dashboard.
- The sidebar shows **User Management to every user.** Admin gating happens only inside that view (see A.2.8).

**iOS layout: tab bar** (`ContentView.swift:118-144`). `TabView` has five tabs, each wrapped in its own `NavigationStack`:
1. Dashboard → `DashboardView`
2. Projects → `ProjectsListView`
3. Calculate → `CalculationsView`
4. Estimate → `QuickEstimateView`
5. More → `MoreMenuView`

`MoreMenuView` (211-243) holds `NavigationLink`s:
- Data: Tariffs, Load Profiles
- Account: User Management, Settings

⚠ **Nested NavigationStacks on iOS.** `DashboardView` (`DashboardView.swift:9`), `QuickEstimateView` (`QuickEstimateView.swift:7`) and `UserManagementView` (`UserManagementView.swift:10`) each open their own `NavigationStack`. On iOS each is already inside the tab's `NavigationStack` (or, for User Management, pushed onto More's stack). Nesting stacks is unsupported by SwiftUI. Symptoms (double nav bars, broken back navigation) are unverified at runtime.

**Keyboard shortcuts** (macOS only, `WM_SolarApp.swift:24-43`).
- `CommandGroup(replacing: .newItem) {}` removes File ▸ New (25).
- A "Navigate" menu posts `Notification.Name.navigateTo` with a `SidebarItem`:

| Shortcut | Destination | Line |
|---|---|---|
| ⌘1 | Dashboard | 27 |
| ⌘2 | Projects | 29 |
| ⌘3 | Tariffs | 31 |
| ⌘4 | Load Profiles | 33 |
| ⌘5 | Calculations | 35 |
| ⌘6 | Quick Estimate | 37 |
| ⌘, | Settings | 40-41 |

- These are received by `MainNavigationView.onReceive` (`ContentView.swift:113-117`), which sets `selection`.
- User Management has **no shortcut**.
- ⌘, is placed in a custom menu rather than the standard app Settings scene. Whether it conflicts with the system "Settings…" item is unverified. No `Settings {}` scene exists.

**Deep links** (`WM_SolarApp.swift:47-84`).
- **Portal.** The comment at line 48 claims support for `wmsolr://portal/{token}` and `https://…/portal/{token}`. The code searches `url.pathComponents` for `"portal"` (49-55).
  - For `wmsolr://portal/ABC`, `"portal"` is the URL **host**, not a path component. `pathComponents` is `["/", "ABC"]`, so **the custom-scheme form never matches** and falls through silently. Only a form with `portal` in the path works, such as `https://host/portal/ABC` or `wmsolr://x/portal/ABC`.
  - **`Info.plist` declares no `CFBundleURLTypes`**, and the project uses `INFOPLIST_FILE = "WM Solar/Info.plist"` with `GENERATE_INFOPLIST_FILE = YES` (pbxproj 275-276). I found no `INFOPLIST_KEY_CFBundleURLTypes` in the pbxproj grep.
  - The **entitlements contain no `com.apple.developer.associated-domains`** (`WM_Solar.entitlements`).
  - So neither the custom scheme nor a universal link appears to be registered, and `onOpenURL` is likely unreachable from outside the app. This is unverified on device.
  - The generated portal URL is `"\(Constants.Supabase.url)/portal/\(token)"` (`Core/ShareLinkService.swift:30`, `Features/Projects/Tabs/ProposalTab.swift:157`). That is a path on the Supabase API host, which serves no portal page (unverified), so a client clicking the link in a browser would get an error rather than the app.
- **Password recovery** (57-83). The code parses `type` and `access_token` from query items, or from the `#fragment` when no `type` query item exists.
  - When `type == "recovery"` it sets `appState.showPasswordReset = true` and `appState.recoveryAccessToken = <token>`.
  - Fragment values are not percent-decoded (67-70).
  - **`recoveryAccessToken` is written and cleared but never read** (grep: set at `WM_SolarApp.swift:73,80`, nil'd at `ResetPasswordView.swift:90,110`, no other use). No `client.auth.session(from: url)` call exists (grep: 0).
  - So the recovery session is never established. See A.3 #1.
- Unmatched URLs are silently ignored.

**How each in-scope screen is reached:**

| Screen | macOS | iOS |
|---|---|---|
| AuthView | root, when signed out | same |
| ResetPasswordView | root, when `showPasswordReset` (recovery deep link only) | same |
| DashboardView | sidebar Dashboard / ⌘1 / default | Tab 1 |
| QuickEstimateView | sidebar Quick Estimate / ⌘6 | Tab 4 |
| ClientPortalView | root, when `portalToken` set (deep link only) | same |
| UserManagementView | sidebar User Management (no shortcut) | More ▸ User Management |
| AdminUsersView | User Management ▸ segmented "Admin" (only if `appState.isAdmin`) | same |
| AdminEditUserView (sheet) | AdminUsersView row ✎ | same |

---

### A.2 Per-screen control tables

#### A.2.1 ContentView / MainNavigationView / SidebarView / MoreMenuView

| Control | Type | What it's for | Handler → effect (file:line) | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Root `.task` | lifecycle | Restore a saved login | `appState.restoreSession()` `ContentView.swift:51-53` → `AppState.swift:61-69` → `handleSignIn` 18-49 | `auth.session` (UserDefaults-backed, see A.4); `profiles` SELECT `id, full_name, email, avatar_url, is_admin` where `id = uid` (23-29) | — | No session: silent, shows AuthView. Profile fetch failure: silent fallback to `isAdmin=false`, `fullName=nil` (38-46) |
| Exit Portal | Button (overlay) | Leave the client portal | `appState.portalToken = nil` `ContentView.swift:16-18` | none | always enabled | — |
| Sidebar list | List(selection:) | Switch section (macOS) | `selection` binding `ContentView.swift:177-187`; detail switch 148-170 | none | all items shown to all users | — |
| Navigate menu items | Menu buttons + shortcuts | Keyboard navigation (macOS) | `NotificationCenter.post(.navigateTo)` `WM_SolarApp.swift:27-41` → `onReceive` `ContentView.swift:113-117` | none | — | — |
| Tab bar (5 tabs) | TabView | Switch section (iOS) | `ContentView.swift:119-144` | none | — | — |
| More ▸ Tariffs / Load Profiles / User Management / Settings | NavigationLink | Reach secondary sections (iOS) | `ContentView.swift:215-239` | (out of scope, except User Management) | — | — |
| OfflineStatusBar ▸ Sync Now | Button | Push queued offline writes | `syncService.flushQueue()` `ToastView.swift:140-141` → `Core/OfflineSyncService.swift:68` | queued table writes (out of scope) | Visible only when `isOnline && pendingCount > 0` (123, 134, 139) | `syncError` shown, 1 line (156-161) |
| ToastOverlay ▸ ✕ | Button | Dismiss toast | `manager.current = nil` `ToastView.swift:92-93` | none | — | **The overlay is never shown**: `ToastManager` has no caller outside `ToastView.swift` (grep: 0) |

#### A.2.2 AuthView (`Features/Auth/AuthView.swift`, VM `AuthViewModel.swift`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Full Name | TextField (sign-up only) | Name for the new account | binds `viewModel.fullName` `AuthView.swift:35-44`; submit → focus email (42) | sent as `user_metadata.full_name` on signUp (`AuthViewModel.swift:112`) | required, non-blank (VM 31) | "Please enter your full name" (VM 92-93) |
| Email | TextField | Login email | binds `email` (47-63). Submit: forgotPassword → `submit` (57-58), else focus password (60) | — | trimmed for `.whitespaces` only, not newlines (VM 24, 79). No format check | — |
| Password | SecureField / TextField toggle | Login password | binds `password` (68-97). Submit: signUp → focus confirm (82-83), else `submit` (85) | — | non-empty. Sign-up: ≥6 (VM 30). Hint shown when `passwordTooShort` (101-106) | "Password must be at least 6 characters" |
| Eye button | Button | Show/hide password | `showPassword.toggle()` (89-96) | none | — | — |
| Confirm Password | SecureField / TextField (sign-up only) | Re-type password | binds `confirmPassword` (109-136); submit → `submit` (123-125). ✗/✓ icon (127-133) | — | must equal password (VM 30, 37-39) | red ✗ icon |
| Error label | Label | Show failure | `viewModel.errorMessage` (140-145) | — | — | `friendlyError` maps "Invalid login", "already registered", "rate limit", "network" substrings; otherwise the raw `localizedDescription` (VM 152-164) |
| Success label | Label | Show success | `successMessage` (147-152) | — | — | — |
| Sign In / Create Account / Send Reset Link | Button (primary) | Submit current mode | `viewModel.submit(appState:)` (155-171) → VM 56-65 | signIn: `auth.signIn(email:password:)` VM 78-81 → `handleSignIn`. signUp: `auth.signUp(email:password:data:)` VM 109-113; session → `handleSignIn`, else message + switch to signIn (115-123). forgot: `auth.resetPasswordForEmail(email)` VM 143, **no `redirectTo`** | `disabled(isLoading \|\| !isFormValid)` (171) | spinner while loading (158-161) |
| Forgot Password? | Button (signIn mode) | Go to reset-request mode | `switchMode(.forgotPassword)` (174-183) → VM 45-54 clears password, confirm and name | — | — | — |
| Sign Up / Sign In / Back to Sign In | Button (bottom toggle) | Switch mode | `switchMode(...)` (205-236) | — | — | — |

Notes:
- Sign-up is **open self-registration**. Anyone can create an account, and every authenticated user gets read access to all shared tables (see A.4).
- The reset email has no `redirectTo`, so it goes to the project's Site URL default. Whether that URL routes back into the app is unverified; see A.1 on the missing URL scheme.

#### A.2.3 ResetPasswordView (`Features/Auth/ResetPasswordView.swift`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| New Password | SecureField | New password | `$newPassword` (38-39) | — | ≥6. Hint at 41-46 | orange hint |
| Confirm Password | SecureField | Re-type | `$confirmPassword` (48-49) | — | must match (12-14). Hint at 51-56 | "Passwords do not match" |
| Update Password | Button | Set new password | `resetPassword()` (70-84) → `auth.update(user: UserAttributes(password:))` (106). Success: message, sleep 1.5 s, clear reset flags (107-110) | GoTrue user update. **Acts on whatever session is currently stored, not the recovery token** | `disabled(!isValid \|\| isLoading)` (84) | raw `error.localizedDescription` (112) |
| Back to Sign In | Button | Abandon reset | clears `showPasswordReset` and `recoveryAccessToken` (88-91) | — | — | — |

After success the view drops back to the root router. If the user was not already signed in, that is AuthView. No sign-out happens.

#### A.2.4 DashboardView (`Features/Dashboard/DashboardView.swift`, VM `DashboardViewModel.swift`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Greeting | Text | Welcome | `userSession?.displayName ?? "User"` (17) | — | — | — |
| KPI cards: Projects, Solar Capacity, Battery Storage, Annual Savings | StatCard | Portfolio totals | (28-51) | VM (see A.5) | — | All show 0 / "R0" when empty or on error. No empty state |
| Mini stats: Avg Payback, CO₂ Avoided, Active Proposals, Pending Tasks, Municipalities, Tariff Plans | Text tiles | Secondary metrics | (61-66) | VM | — | 0 on error |
| Monthly Generation chart | Chart BarMark | Last 12 generation rows | (71-93) | `generation_records` `month, year, actual_kwh`, ordered year, month (VM 98) | hidden if empty (71) | hidden |
| Projects by Type | Chart SectorMark | Mix of `system_type` | (96-119) | `projects.system_type` | hidden if empty | hidden |
| Recent Projects ▸ View All | NavigationLink(value: "all-projects") | Open full list | (128-132). **No `navigationDestination(for: String.self)` exists**, so this is a dead link | — | — | nothing happens (SwiftUI logs a warning) |
| Recent project row | NavigationLink(value: project.id) | Open project | (137-141) → `navigationDestination(for: UUID.self)` → `ProjectDetailView(projectId:)` (163-165) | first 5 projects by `created_at` desc | — | section hidden when no projects (122) |
| Quick Actions: New Project, Quick Estimate, Import Tariff, Upload CSV | styled HStack, **not buttons** | Suggest shortcuts | `quickAction(...)` (152-155, 208-221). **No action, gesture or link. Four decorative tiles that look tappable** | none | — | — |
| Pull to refresh | `.refreshable` | Reload | `fetchDashboard()` (166-168) | as below | — | — |
| Initial load | `.task` | Load | `fetchDashboard()` (174-176) | as below | — | `LoadingView` overlay only while `isLoading && projectCount == 0` (169-173) |

`fetchDashboard` makes seven sequential, independent queries (`DashboardViewModel.swift:37-107`):
- `projects` (select list at 45-46)
- `project_simulations` (61-62)
- `proposals` `id, status` (78)
- `municipalities` `id` (83)
- `tariff_plans` `id` (88)
- `gantt_tasks` `id, status` (93)
- `generation_records` (98)

None of them filters by user, org or project. Scope is whatever RLS returns, which per `migrations/2026-08-05_fix_admin_rls.sql:111-141` is `USING (true)` for all authenticated users. So **every user sees portfolio-wide totals across all projects in the database.**

Errors are **print-only** (`print("[Dashboard] …")` at 54, 56, 72, 74, 80, 85, 90, 95, 104). `errorMessage` is declared (11) and reset (39) but never set or displayed. The list-all queries have no `.limit` beyond the PostgREST default max rows, which is unverified. With more rows than the server cap, the counts would silently truncate.

#### A.2.5 QuickEstimateView (`Features/Estimate/QuickEstimateView.swift`, VM `QuickEstimateViewModel.swift`)

This screen is purely local. It makes no network calls, reads and writes no data, and has no save, share or export.

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Solar Size | Slider 1…500 step 1 | System kWp | `$vm.solarCapacityKwp` (39) | none | range-bound | — |
| Battery | Slider 0…200 step 5 | Battery kWh | `$vm.batteryCapacityKwh` (53) | none | — | Only adds cost; **has no effect on savings** (A.5) |
| Monthly Consumption | Slider 100…100 000 step 100 | kWh per month | `$vm.monthlyConsumption` (66) | none | — | — |
| Tariff (R/kWh) | TextField(.number) | Energy rate | `$vm.tariffRate` (74) | none | **No bounds.** 0 or negative is accepted: savings ≤0 → payback "N/A" | — |
| Escalation (%) | TextField(.number) | Annual tariff increase | `$vm.annualEscalation` (85) | none | **No bounds** | — |
| Results / Details sections | display | Outputs | shown `if vm.solarCapacityKwp > 0` (11-14). The slider minimum is 1, so this is **always true** | — | — | — |

`systemLosses` (VM 12) is `@Published` but has **no UI control**, so it is fixed at 14%. Constants at VM 15-18 are hard-coded:
- peak sun hours: 5.5
- solar cost: R12 000/kWp
- battery cost: R8 000/kWh
- degradation: 0.5%/yr

The screen does not label any of them as assumptions.

#### A.2.6 ClientPortalView (`Features/ClientPortal/ClientPortalView.swift`, service `Core/ShareLinkService.swift`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Resolve token | `viewModel.load(token:)` (19-21) → VM 367-387 → `ShareLinkService.validateToken` (`ShareLinkService.swift:34-100`); then downloads `pdf_url` via `URLSession` (VM 380-383) | `proposals` `select()` **all columns** where `share_token = token` limit 1 (52-58); `projects` `id, name, client_name, location, system_type` (80-86); an arbitrary HTTP GET of `pdf_url` | — | Loading spinner (26-35). Error view "Proposal Not Found" plus `errorMessage` (39-54). **If the PDF download throws after `portalData` is set**, `errorMessage` is set but the content still renders, and the PDF section shows "Loading document..." **forever** (188-200) |
| Status card | display | Proposal state | (109-138) maps `signed`, `sent`, `viewed`, or default | `proposals.status` | — | default "ready for your review" |
| Project details | display | Project info | (142-163) | — | optional rows hidden | — |
| PDF preview | `PDFPreviewView` | Show proposal PDF | (184-187) | `pdfData` | shown only if `pdf_url` is non-nil (87-89) | spinner if data missing |
| Download PDF | Button | Save or share the PDF | `downloadPDF()` (202-206) → macOS `NSSavePanel` + `data.write` (VM 421-439); iOS temp file + `UIActivityViewController` (VM 443-471) | local file | **Silently no-ops if `pdfData` is nil** (VM 420). Never disabled | success or failure message (209-213) |
| Signer Name | TextField | Who is signing | `$viewModel.signerName` (233) | — | non-empty required to show Submit (239). Not trimmed | — |
| Signature pad | `SignatureCanvas` | Draw signature | binds `signatureData` (237) | — | — | — |
| Submit Signature | Button | Accept proposal | `submitSignature()` (242-251) → VM 389-410 → `ShareLinkService.recordSignature` (103-143), then reload | Storage upload to bucket **`portal-assets`** at `signatures/{proposalId}_{uuid}.png` (105-108); `getPublicURL` (110-112); `proposals` UPDATE `status='signed', updated_at` where id (120-124); `proposal_signatures` INSERT `proposal_id, signer_name, signature_url, signed_at` (134-142) | shown only when a signature exists and the name is non-empty; `disabled(isSubmitting)` (251) | message (260-264) |
| Signed confirmation | display | Show signed state | (273-296), when `status == "signed"` (92-96) | — | — | Claims "The project team has been notified". **No notification code exists** in this path |
| Contact card | display | Generic help text | (300-313). No contact details, no link | — | — | — |

#### A.2.7 UserManagementView (`Features/UserManagement/UserManagementView.swift`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Section picker | segmented Picker | Profile / Security / Sessions / (Admin) / Danger Zone | `selectedTab` (12-22); switch 28-35. The "Admin" tag 4 is rendered only `if appState.isAdmin` (16-18), **between** tags 2 and 3 | — | client-side gate only | — |

**Profile tab** (`ProfileManagementView`, 46-218)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Avatar | AsyncImage / initials | Show avatar | (60-72) | `userSession.avatarUrl` | — | placeholder. **No avatar upload control** |
| Full Name | TextField | Edit name | `$fullName`, prefilled `onAppear` from `userSession.fullName` (146-148) | — | non-blank (176-178) | "Name cannot be empty" |
| Phone / Company / Role-Title | TextField ×3 | Edit extra profile fields | `$phone`, `$company`, `$role` (92-94) | — | **Never prefilled.** They start as `""` every time the view appears | — |
| Email | Text + lock | Read-only | (96-108) | — | — | — |
| Save Profile | Button | Persist profile | `saveProfile()` (121-138, 174-217): `auth.update(user: UserAttributes(data: full_name, phone, company, role))` (186-193), then `profiles` UPDATE `full_name` (195-201), then local `userSession` rebuilt (203-209) | GoTrue `user_metadata`; `profiles.full_name` | `disabled(isLoading)` | raw error text. **Saving writes empty strings over any existing phone, company or role in `user_metadata`** because those fields are never loaded |

**Security tab** (`SecurityManagementView`, 222-405)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| New Password + eye | SecureField / TextField | New password | (246-263) | — | ≥6 (230-232, 265-269) | orange hint |
| Strength bar | display | Strength hint | `passwordStrength` (343-374). Scores 5 criteria but clamps with `min(score,4)`, so ≥4 shows "Strong" | — | — | — |
| Confirm Password | SecureField / TextField | Re-type | (275-289) | — | must match | ✗ / ✓ icon |
| Update Password | Button | Change password | `changePassword()` (302-319, 387-404) → `auth.update(user: UserAttributes(password:))` (393-395) | GoTrue | `disabled(!isValid \|\| isLoading)` | raw error. **No current-password re-authentication** |
| Security tips | static text | Guidance | (326-337) | — | — | — |

**Sessions tab** (`SessionManagementView`, 409-514)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Current Session card | display | Show "This Device · Active" | (417-462). **Hard-coded:** the `desktopcomputer` icon shows on iOS too (422), and "Active" is a static badge. It lists no real sessions | email only | — | — |
| Sign Out of This Device | Button (destructive) | Log out | `appState.logout()` (469-470) → `AppState.swift:51-59` `auth.signOut()`, errors ignored (55), then clears state | GoTrue | no confirmation | none |
| Sign Out of All Devices | Button → alert | Global logout | sets `showSignOutAll` (482-484) | — | — | — |
| Alert ▸ Sign Out All | alert Button | Confirm global logout | `try? auth.signOut(scope: .global)` then clears local state (503-508) | GoTrue | — | **Error swallowed (`try?`).** The UI shows signed out even if revocation failed |
| Alert ▸ Cancel | alert Button | Abort | (502) | — | — | — |

**Danger Zone tab** (`DangerZoneView`, 518-588)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Delete My Account | Button → alert | Delete account | sets `showDeleteConfirmation` (545-547) | — | — | — |
| Alert TextField | TextField | Type DELETE | `$deleteConfirmText` (570) | — | — | — |
| Alert ▸ Delete | alert Button | Confirm deletion | if text == "DELETE": `try? auth.signOut()` and clear state (574-583). **No account or data deletion occurs.** It only signs out | none deleted | wrong text: the alert closes silently with no feedback | none |
| Alert ▸ Cancel | alert Button | Abort | clears text (571-573) | — | — | — |

#### A.2.8 AdminUsersView (`Features/UserManagement/AdminUsersView.swift`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Fetch users | `vm.loadUsers()` (101) → 245-261 | `profiles` SELECT `id, email, full_name, avatar_url, is_admin, created_at, updated_at` order `created_at` desc (250-255) | — | red error label (75-80) |
| Stats: Total Users, Admins, Recent (7d) | StatCard ×3 | User counts | (113-134). `recentCount` parses ISO8601 with and without fractional seconds (227-243) | — | — | — |
| Search | TextField | Filter by email or name | `searchText` → `filteredUsers` (48-55, 64-69) | local | — | "No Users" / "No Results" `ContentUnavailableView` (85-90) |
| Row ✎ | Button | Edit user | sets `selectedUser` and `showEditSheet` (186-194) → sheet (102-108) | — | — | — |
| Row shield | Button | Toggle admin | `vm.toggleAdmin(user:)` (197-205) → `profiles` UPDATE `is_admin = !current` where id (263-277), then reload | `profiles.is_admin` | `disabled` for your own row (206). **No confirmation** | error label |
| Pull to refresh | — | **absent** | — | — | — | — |

**AdminEditUserView (sheet)**, lines 300-422:

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Email / User ID / Joined | display | Info | (315-337) | — | — | — |
| Full Name | TextField | Edit name | `$fullName`, prefilled `onAppear` (390-393) | — | non-blank (378) | — |
| Admin Access | Toggle | Grant or revoke admin | `$isAdmin` (343-344) | — | **Not disabled for yourself.** An admin can remove their own admin here, bypassing the row guard at 206 | — |
| Save Changes | Button | Persist | `save()` (364-379, 398-421) → `profiles` UPDATE `full_name, is_admin` (404-412); `onSave()` reloads the list | `profiles` | `disabled(isLoading \|\| blank name)` | error or success label. **The sheet stays open after a successful save.** Only "User updated" is shown |
| Cancel | toolbar Button | Close | `dismiss()` (386-388) | — | — | — |

`AdminUsersViewModel.updateUser(id:fullName:email:isAdmin:)` (279-295) is **dead code** (grep: no caller). It would also write `is_admin` as the *string* `"true"` / `"false"` (286) and write `profiles.email`, which does not change the auth email.

The sheet uses `sheet(isPresented:)` with `if let selectedUser` (102-108). The known SwiftUI first-presentation empty-sheet race is unverified here.

`AdminUsersView` is shown only through the client-side `isAdmin` picker gate. What a non-admin would receive is governed by RLS; see A.4.

#### A.2.9 Shared components

- `StatCard` (`StatCard.swift:3-46`): display only, with an optional subtitle. No controls.
- `LoadingView` (`LoadingView.swift:3-16`): spinner plus message. No controls.
- `ToastManager` / `ToastOverlay` (`ToastView.swift:49-115`): **infrastructure with zero callers**, so it never displays anything. The auto-dismiss compares messages rather than ids (58), so two identical consecutive toasts would dismiss early.
- `OfflineStatusBar` (`ToastView.swift:119-167`): covered in A.2.1. `OfflineSyncService.enqueue` has **no call sites** (grep), so `pendingCount` can only come from a previously persisted disk queue (`OfflineSyncService.swift:136`). The bar is effectively offline-indicator-only.

---

### A.3 Stubs, dead controls, fake data, and UI/code mismatches

1. **The password recovery flow cannot complete (high).**
   - `recoveryAccessToken` is captured but never used (`WM_SolarApp.swift:73,80`; no reader).
   - No `auth.session(from:)` or `setSession` is called.
   - `ResetPasswordView` then calls `auth.update(user:)` (`ResetPasswordView.swift:106`), which needs an existing session. A signed-out user gets an error. A signed-in user changes their *current* account's password, whatever the link was for.
   - No URL scheme or associated domain is registered (A.1), and `resetPasswordForEmail` sends no `redirectTo` (`AuthViewModel.swift:143`). The link most likely never reaches the app at all. This is unverified on device.
2. **The `wmsolr://portal/{token}` deep link is broken as written.** `portal` is the host, not a path component (`WM_SolarApp.swift:49-50`). No URL type is registered in Info.plist. Generated portal links point at `{SUPABASE_URL}/portal/{token}` (`ShareLinkService.swift:30`), which is not a web page (unverified).
3. **"Delete My Account" deletes nothing.** It only signs out (`UserManagementView.swift:574-581`), while the copy promises permanent deletion of the account and all data (541, 585). This is also an App Store guideline 5.1.1(v) exposure: account deletion must actually delete.
4. **The Sessions tab is fake.** The "This Device · Active" card is hard-coded, and a desktop icon shows on iOS (`UserManagementView.swift:421-451`). It lists no other sessions.
5. **The Profile tab erases metadata.** Phone, Company and Role are never loaded, so every save writes `""` over existing values (`UserManagementView.swift:49-51, 146-148, 187-192`).
6. **The four Dashboard Quick Actions are decorative tiles with no action** (`DashboardView.swift:152-155, 208-221`).
7. **Dashboard "View All" is a dead NavigationLink.** Its String value has no destination (`DashboardView.swift:128`).
8. **Dashboard error handling is print-only.** `errorMessage` is never shown (`DashboardViewModel.swift:11, 54-104`). There is no empty state. Failures read as zeros.
9. **The portal "project team has been notified" claim is false.** The signing path uploads, updates and inserts only (`ClientPortalView.swift:283`; `ShareLinkService.swift:103-143`).
10. **Portal signing order is non-atomic.** The proposal is set to `signed` (`ShareLinkService.swift:120-124`) *before* the signature row is inserted (134-142). If the insert fails, the proposal reads as signed with no signature record, and a retry is impossible because the signature UI is hidden once `status == "signed"` (`ClientPortalView.swift:92`). A failed upload leaves no side effects. Nothing checks the current status either: `draft` or already-`signed` proposals can be (re)signed through a direct call.
11. **The portal PDF can hang.** A PDF download failure leaves "Loading document..." up indefinitely, and "Download PDF" silently does nothing (`ClientPortalView.swift:188-206`; VM 380-385, 420).
12. **Quick Estimate:**
    - The battery slider changes cost only, not savings (VM 46-52).
    - `systemLosses` has no control (VM 12).
    - The `> 0` result gate is always true (View 11).
    - Tariff and escalation are unbounded (View 74, 85).
    - Nothing can be saved, shared or attached to a project.
13. **Theme:**
    - `sidebarVibrancy` is persisted and toggled in Settings (`SettingsView.swift:72`) but **never read** by any view, so it does nothing.
    - On iOS, "Glass" is identical to "Dark". `isGlass` backgrounds are wrapped in `#if os(macOS)` (`WM_SolarApp.swift:18-20`; `ContentView.swift:104-111`).
14. **ToastManager is unused.** `ToastOverlay` is mounted but no feature ever posts a toast (`ToastView.swift:49-70`).
15. **Dead code:** `AdminUsersViewModel.updateUser` (`AdminUsersView.swift:279-295`), which would also send `is_admin` as a string.
16. **Silent failures:**
    - `logout()` ignores sign-out errors (`AppState.swift:52-56`).
    - "Sign Out All" and "Delete" use `try?` (`UserManagementView.swift:505, 577`).
    - A profile fetch failure silently demotes an admin to non-admin for the session (`AppState.swift:38-46`).
17. **Admin edit sheet:** it allows self de-admin, unlike the row guard. The sheet does not dismiss after saving. There is no confirmation on the row shield toggle (`AdminUsersView.swift:197-206, 343, 414-415`).
18. **Nested `NavigationStack`s on iOS** in Dashboard, Quick Estimate and User Management (A.1). Runtime effect unverified.
19. The **wrong confirmation text** in the delete alert closes it with no message (`UserManagementView.swift:574-583`).

---

### A.4 Security notes

- **Auth tokens are stored in `UserDefaults`, not the Keychain.** The type is named `KeychainLocalStorage` but writes `UserDefaults.standard` under the prefix `dev.wattmatt.wmsolar.supabase.` (`Core/SupabaseManager.swift:22-39`). Its own comment admits "For production, consider migrating to Keychain". The access and refresh tokens therefore sit in a plaintext plist in the app container, with no Keychain access-class protection, and are included in unencrypted backups. The misleading name hides this.
- **The client uses the anon key only.** `SupabaseManager.swift:10-18` reads `Constants.Supabase.anonKey` from Info.plist build settings. The fix migration records that an earlier build **shipped the service-role key** (`migrations/2026-08-05_fix_admin_rls.sql:11-15`).
  - Whether that key has been rotated since is unverified. Any IPA from that period, including the `WM Solar.ipa` sitting in the project folder, which I did not open, would expose it if not rotated.
- **Admin role checks are client-side only in the UI.**
  - `appState.isAdmin` comes from a `profiles.is_admin` read at sign-in (`AppState.swift:14-16, 23-37`).
  - The only UI gate is the segmented tab (`UserManagementView.swift:16-18`).
  - The actual protection is RLS: `migrations/2026-08-05_fix_admin_rls.sql:56-83` has self SELECT/UPDATE plus admin SELECT/UPDATE via `public.is_admin()`.
  - Whether that migration was applied to the live project is **unverified** from the repo.
- **Any user can make themselves admin.** The self-UPDATE policy is row-level only (`fix_admin_rls.sql:68-72`). The migration itself documents the gap: "a non-admin user could set is_admin = true on their own row via the API" (85-88).
  - Any signed-up user can PATCH `profiles?id=eq.<self>` `{is_admin:true}` with the anon key and their own JWT.
  - On next launch they get the Admin tab, and under the admin policies they can read and modify every profile.
  - Sign-up is open (`AuthViewModel.swift:109`), so this is reachable by anyone with the app.
- **Every authenticated user can read all shared data** (`fix_admin_rls.sql:103-153`, `USING (true)`). This covers projects, simulations, proposals, gantt tasks, generation records, sites, scada imports, tariffs and tariff uploads. The Dashboard aggregates across all of it.
  - Authenticated users can also INSERT tariff_plans, tariff_rates and municipalities, and UPDATE any tariff_uploads (162-176).
  - There is no org or tenant scoping in the client queries (`DashboardViewModel.swift:43-104`).
- **Portal token handling:**
  - Tokens are `UUID().uuidString`, which is 122 bits of randomness (`ShareLinkService.swift:13`). There is no expiry, revocation, or single-use constraint in the client.
  - Because proposals are `SELECT … TO authenticated USING (true)` (`fix_admin_rls.sql:119-121`), **every authenticated user can read every proposal's `share_token`** and so act as any client in the portal.
  - The portal runs "no auth required" (`ContentView.swift:13`) with the anon key. For a genuinely unauthenticated client to load it, `proposals` and `projects` need an `anon` SELECT policy or RLS disabled, and signing needs anon UPDATE on `proposals`, INSERT on `proposal_signatures`, and INSERT on storage bucket `portal-assets`. None of these policies are in the repo, so actual live behaviour is **unverified**. Either:
    - (a) the portal fails for real clients, or
    - (b) those tables are anon-readable or writable. With RLS off, anyone with the anon key could list every proposal and flip any proposal's `status` to `signed`, since the `.eq("id")` filter is supplied by the client (`ShareLinkService.swift:120-124`).
  - Signing does not re-check that the token maps to the `proposalId` being updated. The UPDATE is keyed only by `proposalId` (120-124).
  - The signature image is stored at a **public URL** (`getPublicURL`, 110-112). Whether `portal-assets` is a public bucket is unverified.
  - `validateToken` does `select()` of **all proposal columns** (54). Whatever the table holds is returned to the portal client, though only a subset is decoded.
  - If a signed-in staff user opens a portal link, the portal queries run with *their* JWT, not as the client. The signature is then recorded under staff credentials, with the signer name free-typed.
  - The portal PDF is fetched from `proposals.pdf_url` with a plain `URLSession` GET (`ClientPortalView.swift:380-382`). Whatever URL is stored there gets fetched, with no host allow-list.
- **Password change requires no re-authentication** (`UserManagementView.swift:393-395`). Anyone holding an unlocked device can change the password.
- **Recovery token in memory:** the `access_token` from the URL is held in `AppState.recoveryAccessToken` (a `@Published` string) but never used (A.3 #1).
- **Global sign-out and logout swallow errors** (A.3 #16). A failed revocation still presents as signed out, and the tokens may remain in UserDefaults. Whether supabase-swift clears local storage on a failed `signOut` is unverified.

---

### A.5 Formulas in scope

**Dashboard** (`DashboardViewModel.swift`). All figures sum every row visible to the user across all projects.

```swift
// 50-53
projectCount   = projects.count
recentProjects = projects.prefix(5)          // by created_at desc
projectsByType = group by system_type ?? "unknown", count, sorted desc

// 65-67
totalSolarKwp      = Σ project_simulations.solar_capacity_kwp
totalBatteryKwh    = Σ battery_capacity_kwh
totalAnnualSavings = Σ annual_solar_savings

// 68-69
avgPaybackYears = mean(payback_years where > 0)

// 70-71
annualGenKwh    = totalSolarKwp * 5.5 * 365 * 0.8
totalCO2Avoided = annualGenKwh * 1.06 / 1000        // tonnes

// 79
activeProposals = count(status in ["sent", "pending_review"])

// 84, 89
municipalityCount = municipalities.count
tariffPlanCount   = tariff_plans.count

// 94
pendingTasks = count(gantt_tasks.status != "completed")   // includes nil status

// 99-103
monthlySolarGeneration = last 12 generation_records rows
                         ordered (year, month), mapped to month name
```

Notes on these figures:
- **Double counting.** `ProjectSimulation` has a `name` and a `project_id` (`Models/ProjectSimulation.swift:5,19`), so a project can have several simulations. The capacity, battery and savings totals therefore **sum every simulation**, not one per project, and are inflated when alternatives exist.
- **CO₂ ignores simulated yield.** It uses hard-coded 5.5 peak sun hours, a 0.8 performance ratio and a 1.06 kg/kWh grid factor. None of these are labelled on screen.
- **`pending_review` is unverified as a real status value.** The portal knows `sent`, `viewed`, `signed` and `draft`.
- **Monthly Generation mixes projects.** The chart takes the last 12 **rows**, not 12 months, and does not aggregate per month across projects. Several projects with the same month produce stacked or duplicate bars. The label does not say that projects are mixed.

**Dashboard currency** (`DashboardView.swift:182-189`):
- values ≥ 1e6 show as `R%.1fM`
- values ≥ 1000 show as `R%.0fK`
- otherwise `R%.0f`

**Quick Estimate** (`QuickEstimateViewModel.swift`). Constants: PSH 5.5, losses 14%, R12 000/kWp, R8 000/kWh, degradation 0.5%/yr.

```swift
// 21-23
dailyGeneration = kWp * 5.5 * (1 - 14/100)

// 25-27, 29-31
annualGeneration  = dailyGeneration * 365
annualConsumption = monthlyConsumption * 12

// 33-35
selfConsumptionRatio = min(0.85, annualConsumption / max(annualGeneration, 1))

// 37-39
selfConsumption = annualGeneration * selfConsumptionRatio

// 41-44
solarCoverage = selfConsumption / annualConsumption * 100      // 0 if consumption 0

// 46-48
systemCost = kWp * 12000 + batteryKwh * 8000

// 50-56
annualSavings  = selfConsumption * tariffRate
monthlySavings = annualSavings / 12

// 58-61: simple payback, no escalation or degradation; 0 → shown "N/A"
paybackYears = systemCost / annualSavings

// 63-72
twentyYearSavings = Σ_{y=1..20} annualGeneration * (1 - 0.005)^(y-1)
                                * selfConsumptionRatio
                                * tariffRate * (1 + esc/100)^(y-1)

// 74-77
twentyYearROI = (twentyYearSavings - systemCost) / systemCost * 100

// 79-83: flat 0.9 degradation proxy; no O&M, financing or discounting
lcoe = systemCost / (annualGeneration * 20 * 0.9)
```

Notes on these figures:
- **Battery has no effect on savings.** Battery kWh adds to `systemCost` only, so a larger battery always lengthens payback. There is no export or feed-in credit.
- **The 0.85 self-consumption cap binds only when consumption is at least 85% of generation.** In that case 15% of generation is assumed lost, with no export value.
- **Payback display** (`QuickEstimateView.swift:186-192`): `Int(years)` years plus `Int(frac*12)` months, truncated rather than rounded.
- **Currency display** (177-184): `NumberFormatter` with `.currency`, code ZAR, symbol "R", 0 decimals.


---

<!-- Part 3B: merged from ios-parts/B-projects-tabs-1.md -->

# B. Projects: list, detail shell, and tabs (part 1)

Scope (every line read): `Features/Projects/ProjectsListView.swift` (489), `ProjectsListViewModel.swift` (113), `ProjectDetailView.swift` (254), `ProjectDetailViewModel.swift` (138), `Tabs/ProjectOverviewTab.swift` (716), `Tabs/ProjectCostsTab.swift` (403), `Tabs/TariffAssignmentTab.swift` (919), `Tabs/GenerationTrackingTab.swift` (737), `Tabs/ProjectTenantsTab.swift` (504), `Tabs/DocumentsTab.swift` (557), `Tabs/HandoverTab.swift` (575), `UI/Components/SignatureCanvas.swift` (131), `UI/Components/PDFPreviewView.swift` (45).
I also checked these supporting files: `ContentView.swift`, `Core/SupabaseManager.swift`, `Core/PDFGenerationService.swift` (29-99), and the models `SystemCost`, `Proposal`, `ProjectDocument`, `HandoverChecklist`, `GenerationRecord`, `ProjectTenant`, `DowntimeComment`, `GenerationSourceGuarantee` and `TariffPlan`. I also read `../migrations/*.sql`.

All paths below are relative to `WM Solar/WM Solar/`.

---

## 1. Navigation

### Entry points
- **iOS:** `ContentView.swift` builds a 5-tab `TabView`. The "Projects" tab is `NavigationStack { ProjectsListView() }` (ContentView ~l.125-128). `ProjectsListView` opens a **second** `NavigationStack` (`ProjectsListView.swift:14`), so on iOS the stacks are nested. Apple does not support that, and push/back behaviour can be erratic (unverified at runtime).
- **macOS:** `NavigationSplitView` with a sidebar. `case .projects: ProjectsListView()` in `detailView` (ContentView ~l.158). The list's own `NavigationStack` pushes the detail view inside the split view's detail column.
- `DashboardView.swift:163-164` also registers `.navigationDestination(for: UUID.self) { ProjectDetailView(projectId:) }`, so project detail can be reached from the Dashboard too.

### List → detail
- Each row is `NavigationLink(value: project.id)` (`ProjectsListView.swift:133`). The destination is `.navigationDestination(for: UUID.self) { ProjectDetailView(projectId:) }` (l.24-26).
- **List vs map mode:** the toolbar toggle flips `showMapView` (l.36-42, icon `map` / `list.bullet`).
  - Map mode (l.150-196) uses a MapKit `Map(selection: $selectedMapProject)`. It draws a `Marker` for every filtered project that has a lat/long, with icon and colour set by `system_type` (l.234-252).
  - Selecting a marker shows a bottom card, which is itself a `NavigationLink(value: selected.id)` (l.165-174).
  - Projects without coordinates are silently left off the map. If none have coordinates, the overlay "No projects with coordinates" appears (l.175-195).
  - Nothing in scope lets the user set lat/long. Neither `CreateProjectSheet` nor the Overview edit form has those fields, so from these screens the map can only be populated by data written elsewhere.
- Search, sort and filter apply to both modes, because both read `viewModel.filteredProjects`.

### Detail shell (`ProjectDetailView.swift`)
- **The brief expects 16 tabs; the code has 14.** `enum ProjectTab` (l.4-18) has exactly 14 cases: Overview, Tenants, Schematics, Load Profile, Costs, Tariff, Simulation, PV Layout, Solar Forecast, Proposals, Schedule (Gantt), Documents, Generation, Monthly Report.
  - **There is no Handover tab and no Sandbox tab in the enum.**
  - `HandoverTab` is never instantiated anywhere in the app (repo-wide grep for `HandoverTab(` returns nothing). **The whole Handover feature is unreachable dead code.** `SandboxTab.swift` exists but is also absent from the enum; it is out of scope and not checked further.
- **Presentation, both platforms:** one custom implementation.
  - A header row: back arrow `dismiss()` (l.136-143), the project name in upper case, and a subtitle (l.164-183) built from location, tenant count, "(n with profiles)", area and kVA.
  - A horizontally scrolling custom tab strip `tabBar` (l.187-228). Each tab is a Button with icon, title and a 6pt status dot (l.209-211).
  - A `TabView(selection: $selectedTab)` holds all 14 tab views (l.63-105).
- **iOS:** `.tabViewStyle(.page(indexDisplayMode: .never))` (l.106-108) makes the pages swipeable horizontally as well as tappable in the strip. The navigation bar is hidden (`.toolbar(.hidden, for: .navigationBar)`, l.113), so the custom back arrow is the only way back (edge-swipe back is likely disabled; unverified).
- **macOS:** the page style is `#if os(iOS)` only, so macOS falls back to the default `TabView` style. That style draws its own native tab strip, and none of the children has a `.tabItem`. **macOS will probably show two tab bars: the custom strip plus an unlabeled native one (unverified visually).**
- **There is no sidebar or segmented variant** of the tab list.
- **Status-dot logic** (l.230-253):
  - Overview: always green.
  - Tenants: green if `viewModel.tenants` is non-empty.
  - Load Profile: `hasLoadProfile`.
  - Costs: `hasCosts`.
  - Tariff: `hasTariffAssignment`.
  - Simulation: green if simulations exist.
  - Proposals: `proposalCount > 0`.
  - Documents: `documentCount > 0`.
  - Generation: green if records exist.
  - All others: always grey.
- **Lifecycle:** `.task { await viewModel.fetchAll() }` and `.refreshable { fetchAll }` (l.122-127). The refreshable modifier sits on the outer `Group`, so the refresh action propagates through the environment into every tab's ScrollView or List. **Pull-to-refresh inside Documents or Tenants would refresh the parent `ProjectDetailViewModel`, not the tab's own view model (unverified).**
- **Tabs in my scope:** Overview, Tenants, Costs, Tariff, Documents and Generation. Handover is in scope as a file but is **not reachable**.

---

## 2. Screen-by-screen control tables

### 2.1 ProjectsListView + ProjectsListViewModel

| Control | Type | What it's for | Handler → effect (file:line) | Data | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Screen load | `.task` | Load projects | `ProjectsListView.swift:122-124` → `fetchProjects()` VM l.56-75 | `projects` SELECT of 13 columns, `order created_at desc`. **No user or org filter.** | none | Error → `errorMessage` set (l.71) plus `print` (l.70). **`errorMessage` is never shown anywhere in the view**, so a failure looks the same as "No Projects Yet". |
| Pull to refresh | `.refreshable` | Reload | l.91-93 → `fetchProjects()` | same | none | same |
| Search | `.searchable` | Filter by name, location or client | l.23 → `searchText`, filter in VM l.32-39 (lower-cased `contains`) | client-side only | none | `ContentUnavailableView.search` (l.97-98) |
| "+" | Toolbar button | New project | l.28-34 → `showCreateSheet = true` | – | none | – |
| Map/List toggle | Toolbar button | Switch view | l.36-42 → `showMapView.toggle()` | – | – | Map empty overlay l.175-195 |
| Sort menu (4 items) | Menu → Button | Newest, Oldest, Name A-Z, Name Z-A | l.46-58 → `viewModel.sortOrder = order`; sorting in VM l.42-51 (`createdAt` string compare; `localizedCaseInsensitiveCompare`) | client-side | – | checkmark on the active item |
| Filter by type ("All Types" + 4) | Menu → Button | Filter by solar_pv, battery, hybrid or generator | l.61-85 → `systemTypeFilter`; VM l.27-29 | client-side | – | "No Matching Projects" (l.99-104) |
| Row tap | NavigationLink | Open project | l.133 | – | – | – |
| Row swipe "Delete" | `.swipeActions` trailing, destructive | Delete project | l.136-143 → `projectToDelete`, `showDeleteConfirmation` | – | `allowsFullSwipe: false` | – |
| Delete alert → "Delete" | Alert button | Confirm deletion | l.109-114 → VM `deleteProject(id:)` l.98-112 | `projects` DELETE `.eq("id")`. Rows in child tables (tenants, docs, storage objects) are left to DB cascades (unverified). | none | Error is `print` plus an `errorMessage` that is never displayed. The row stays. |
| Delete alert → "Cancel" | Alert button | – | l.115 (empty closure; fine) | – | – | – |
| Empty-state "Create Your First Project" | Button | New project | l.270-276 → `showCreateSheet = true` | – | – | shown when `projects.isEmpty && !isLoading` (l.105-107) |
| Map marker | `Map` selection | Pick a project | l.151-163 (`.tag(project)`) | – | only projects with lat/long | – |
| Map bottom card | NavigationLink | Open project | l.165-174 | – | – | – |
| Row logo | `AsyncImage` | Project logo | l.290-297 from `projects.logo_url` (arbitrary URL) | remote fetch | – | falls back to an icon |
| **CreateProjectSheet** "Project Name", "Location", "Description", "Client Name" | TextField ×4 | Project details | l.440-446 | – | Name is required: Create is disabled if the trimmed name is empty (l.483) | – |
| "System Type" | Picker (4 options) | Choose type | l.450-454 | – | default `.solarPV` | – |
| "Cancel" | Toolbar | Close | l.463-465 `dismiss()` | – | – | – |
| "Create" | Toolbar | Insert project | l.469-482 → VM `createProject` l.77-96 | `projects` INSERT of `{name, location?, description?, client_name?, system_type}`. **No owner, org or created_by column is sent.** | disabled while saving; `interactiveDismissDisabled(isSaving)` (l.486) | **The sheet dismisses even when the insert fails** (l.479-480). The error is `print` plus an `errorMessage` that is never shown. `print("Project created")` l.90 is debug output. |

### 2.2 ProjectDetailView / ProjectDetailViewModel

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` / `.refreshable` | Load project and summary data | `ProjectDetailView.swift:122-127` → `fetchAll()` VM l.25-75 | Parallel `async let` reads: `projects` single by id (l.30-36); `project_tenants` by project (l.38-44); `project_simulations` (12 cols, l.46-52); `generation_records` (l.54-61). Then `fetchWorkflowState` (l.77-137): `proposals` select id (l.80-86), `project_documents` select id (l.93-99), `project_tariff_assignments` limit 1 (l.108-117), `system_costs` limit 1 (l.124-133). | – | `LoadingView` while loading. "Project Not Found" with `errorMessage` (l.114-120). **The four main reads are awaited in sequence, so if tenants fail after the project loaded, the project still shows, the error is swallowed, and simulations and generation are left stale** (l.63-69). The workflow queries only `print` on error (l.88, 101, 120, 135). |
| Back arrow | Button | Leave | l.136-143 `dismiss()` | – | – | – |
| Tab strip buttons ×14 | Button | Switch tab | l.191-194 → `selectedTab = tab` | – | – | status dots l.230-253 |
| Page swipe (iOS) | TabView page style | Switch tab | l.106-108 | – | – | – |

The `hasLoadProfile` flag is computed as `tenants.contains { monthlyKwhOverride > 0 }` (VM l.105). Its comment says "does any tenant have a meter linked?", but the code tests a kWh override, not a meter link. That is a UI-claim versus code mismatch.

### 2.3 Overview tab (`ProjectOverviewTab.swift`)

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load fields | `.task` | Fill the form from the project | l.76-78 → `loadFieldsFromProject()` l.83-92 | reads the `Project` passed in | – | – |
| Project Name / Location / Client Name | TextField (auto-save) | Edit project | l.110-124; `onChange` → `debounceSave()` l.634-641 (1.5 s) → `saveProject()` l.644-678 | `projects` UPDATE `ProjectUpdate{name, location, client_name, total_area_sqm, connection_size_kva, budget, system_type, description}` `.eq id` (l.650-666) | Save is skipped if the trimmed name is empty (l.645) | `saveError` label l.199-203; "Saved" toast l.668-672, 682-692; spinner l.102-105 |
| Total Area m² / Connection kVA / Budget R | TextField, decimalPad (iOS) | Numeric project fields | l.128-153, auto-save | Uses `Double(text)`. **Any non-parseable text ("1 000", "1,5", a locale comma) becomes `nil` and writes NULL, which silently wipes the value.** | – | – |
| System Type | Picker (menu) | Change type | l.155-167 (the `#if os(macOS)` branch is identical on both platforms, l.161-165) | auto-save | – | – |
| Target Date toggle + DatePicker | Toggle + DatePicker | "Target date" | l.170-185. The DatePicker's `onChange` → `debounceSave()`. | **Never persisted.** `ProjectUpdate` has no target-date field (l.7-16), `loadFieldsFromProject` never loads one, and the toggle itself triggers no save. **Dead control: the UI suggests a saved setting.** | – | – |
| Description | TextEditor | Notes | l.187-196, auto-save | `description` | – | – |
| Workflow step circles ×8 | Button | Jump to the related tab | l.354-359 → `selectedTab = step.targetTab` (steps l.304-313) | uses VM state only | – | Status colours l.228-248, 367-390. The code comment says "9-Step Workflow" (l.51) but there are 8 steps. |
| KPI cards ×6 | display | Headline numbers from the latest simulation | l.444-508 | `viewModel.simulations.first` | – | With no simulation: "Run a simulation first to see KPIs" (l.494-506) |
| Mini generation chart | Chart | Actual bars plus expected line | l.568-596, `generationRecords.prefix(12)`. **The VM sorts by year and month descending, so this shows the newest 12, but the x axis is month-name only and categorical. Months from different years collide ("Jan" twice) and the order is reversed.** | – | – | hidden if there are no records (l.58-60) |
| Tenants summary | display | Count, area, kWh/mo | l.600-630 | VM tenants | – | hidden if empty |

**Side effect on open.** `loadFieldsFromProject()` changes each `@State` from "" to the stored value. That fires every `onChange` and then `debounceSave()`. **Every time the Overview tab appears, a `projects` UPDATE runs about 1.5 s later and the "Saved" toast flashes, even if nothing was edited.** It also rewrites numeric fields through `String(format:"%.0f")` → `Double`, so **a stored area, kVA or budget with decimals is rounded to an integer and written back** (l.87-89 plus l.654-656). This is inferred from SwiftUI `onChange` semantics; confirm at runtime.

**Stale header.** After a save, `viewModel.project` is not updated, so the header name and subtitle stay stale until a refresh.

### 2.4 Costs tab (`ProjectCostsTab.swift`)

This tab is **entirely local.** `ProjectCostsViewModel` (l.400-403) holds only `@Published var costs: SystemCost = .default`. **There is no Supabase read or write:** `system_costs` is never loaded or saved. Every value resets when the view is rebuilt, and nothing on this screen feeds the simulation. `SimulationEngine.swift:90` uses its own `systemCost: SystemCost = .default`. **Yet the Overview "Costs" step and the tab's status dot read `system_costs` (DetailVM l.124-133). A repo-wide grep finds no writer of `system_costs` anywhere in the app, so that step can never turn green from iOS.**

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Budget / Standard / Premium | Button ×3 | Apply a cost preset | l.249-263 → `viewModel.costs = preset` (`SystemCost.swift:41-45`) | local only | – | **The presets leave the BOS fixed costs (H&S, water, CCTV, MV) nil, so choosing one silently wipes any fixed costs already entered.** |
| Solar Capacity / Battery Capacity | TextField (number) | System size for the summary | l.141-142, 191-208 | local `@State`, defaults **100 kWp / 0 kWh hard-coded** (l.9-10). Not taken from the project or a simulation. | none (negatives allowed) | – |
| Solar Cost R/kWp, Battery Cost R/kWh | Slider | Unit costs | l.23-24 (5000-20000 / 2000-12000) | local | – | – |
| Solar / Battery Maintenance % | Slider | O&M | l.25-26 | local | – | – |
| Health & Safety / Water Points / CCTV / MV Switchgear | Currency TextField (ZAR) | Fixed BOS | l.31-34, 358-369 | local | – | – |
| Insurance / Professional Fees / PM / Contingency % | Slider | Fees | l.39-42 | local | – | – |
| Replacement Year, Equipment %, Module / Inverter / Battery Replacement % | Slider ×5 | Replacement assumptions | l.47-51 | local | – | **Used in no calculation on this screen.** Dead inputs. |
| Cost of Capital, CPI, Elec. Escalation, Project Duration, LCOE Discount Rate | Slider ×5 | Finance assumptions | l.56-60 | local | – | **Only Project Duration is used (in the LCOE). The other four do nothing.** |
| Reset to Defaults | Button | Reset | l.267-311 → hard-coded `SystemCost(...)` plus 100 kWp / 0 kWh | local | no confirmation | **The "defaults" here (12 000 R/kWp, 5 000 R/kWh, contingency 5 %, insurance 0.5 %, CoC 10 %, escalation 8 %, LCOE rate 10 %) differ from the tab's initial `.default` = `standardPreset` (11 000 / 5 500 / 7.5 % / 1.0 % / 9 % / 10 % / 9 %).** |

### 2.5 Tariff tab (`TariffAssignmentTab.swift`)

**The tab is named "Tariff Assignment" but nothing is ever assigned.** No write to `project_tariff_assignments` exists anywhere in the app; the only reference is the read in DetailVM l.110-117. The selections live in a local `@StateObject` and are lost when the view is rebuilt. The Overview "Tariff" step can therefore never complete from iOS.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Load provinces and Eskom names | l.102-106 → `loadProvinces()` l.768-779; `loadEskomDistinctNames()` l.833-863 | `provinces` (id, name, code); `eskom_tariff_plans` `.eq supply_context .eq category`, deduplicated client-side (l.844-857) | – | print only (l.777, 860). "Loading Eskom tariffs..." (l.517-522). |
| Source (Eskom / Municipal) | Segmented Picker | Choose tariff source | l.347-356; `onChange` clears `rates` and `eskomRates` | – | – | **It does not clear `selectedPlan` or `selectedEskomPlan`. Switching back shows the "Selected ... Tariff" card with no rates, and nothing reloads them. The Generate button and breakdown disappear until a different plan is picked.** |
| Province | Picker (menu) | Municipal path | l.371-385 → `loadMunicipalities()` l.781-797 | `municipalities` (id, name, province_id, nersa_increase_pct) `.eq province_id` | – | print only |
| Municipality | Picker | – | l.390-404 → `loadTariffPlans()` l.799-814 | `tariff_plans` `select *` `.eq municipality_id` | shown only if the list is non-empty | print only; an empty result shows nothing |
| Tariff Plan | Picker | – | l.410-424 → `loadRates()` l.816-829 | `tariff_rates` `select *` `.eq tariff_plan_id` `order block_number` | – | print only |
| Supply Context (NLA / Munic) | Picker | Eskom | l.434-442, `onChange` l.457-462 → reset plus `loadEskomDistinctNames()` | as above | – | – |
| Customer Category (4) | Picker | Eskom | l.445-455, `onChange` l.463-468 | as above | – | – |
| Tariff Name | Picker | Eskom | l.472-492. If exactly one variant matches, it is auto-selected and `loadEskomRates()` runs (l.865-918). | `eskom_tariff_rates` `.eq tariff_plan_id`. **If empty, it falls back to rates from all sibling plans** (same name, sheet, context, category) via `.in(...)`, deduplicated by `(charge, season, tou, amount)` (l.879-910). | – | print only |
| Variant | Picker | Eskom, when there are more than one | l.494-515 → `loadEskomRates()` | as above | – | – |
| Generate Cost Report (Eskom) | Button | PDF | l.43-59 → `generateEskomCostReport()` l.126-162 → `PDFGenerationService.fetchBranding()` (`PDFGenerationService.swift:29-37`: `organization_branding` `.limit(1)` with **no org filter**) plus `generateLocalPDF` (l.92+). **Rendered locally, no network needed.** | reads only | shown only when a plan and rates exist; disabled while generating | no error path (the local render cannot throw) |
| Generate Cost Report (Municipal) | Button | PDF | l.60-78 → `generateMunicipalCostReport()` l.164-214 | same | same | same |
| PDF sheet | `.sheet` → `PDFPreviewView` | Preview | l.107-120 | – | – | **The `.toolbar { Done }` is attached to the `NavigationStack`, not to its content (l.115-119), so the Done button will probably not render (unverified). iOS can swipe to dismiss; on macOS the sheet may have no way to close.** The preview has no share, save or print (§3). |
| Blended Rate Type | Picker (6 options) | Show a blended R/kWh | l.271-296 → `blendedRate(for:)` l.227-262 | – | – | shows R 0.00 when there are no energy rates |
| Demand charges | display | Municipal demand rows | l.301-337; Eskom returns `[]` (l.223) | – | – | – |
| Rate breakdown | display | All rate rows | l.629-703 | – | – | – |
| Energy Rate Profile chart | Chart | Bar per rate row | l.707-728 | **Uses only the municipal `viewModel.rates`.** On Eskom the heading "Energy Rate Profile" shows with an empty body. The comment "24hr cost profile chart" (l.95) is not what it draws: one bar per rate row, labelled "Block n". | – | – |

### 2.6 Generation tab (`GenerationTrackingTab.swift`)

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| KPI cards ×4 | display | Totals and performance | l.134-147 | `viewModel.generationRecords` (parent VM) | – | 0 values when empty |
| Monthly Performance chart | Chart | Last 12 months: actual bars, expected and guaranteed lines | l.169-207 | – | – | **The empty state is an empty chart; there is no message.** `chartForegroundStyleScale` (l.201) conflicts with the explicit `.foregroundStyle` on each mark, so the legend may not match (unverified). |
| Cumulative Generation chart | Chart | Lifetime running total | l.211-246 | – | shown only when there are more than 3 records | – |
| Readings list | display | Rows by month, newest first | l.250-303 | – | – | **No edit, no delete, no swipe on readings.** |
| Add Reading | Button → sheet | Manual monthly reading | l.77-89 → `showAddReading` | – | – | – |
| ↳ Month / Year | Picker | Period | l.531-540. **Years are hard-coded `2020...2030`.** | – | – | – |
| ↳ Actual / Expected / Guaranteed kWh | TextField, decimalPad | Values | l.543-554 | – | **Save is disabled only when Actual AND Expected are both empty (l.572).** A guaranteed-only reading cannot be saved. Non-numeric text passes and is saved as NULL. | – |
| ↳ Save | Toolbar | Persist | l.566-571 → `saveReading()` l.581-615 | `generation_records` **`.upsert(reading)` with no `id` and no `onConflict`** (l.603-606). PostgREST upserts on the PK, so this is effectively a plain INSERT: saving the same month twice creates a duplicate row, or fails if a (project, month, year) unique constraint exists (schema not in the repo; unverified). Then `viewModel.fetchAll()`. | – | **Error is `print` only (l.609) and the sheet closes anyway (l.569). Silent failure.** |
| ↳ Cancel | Toolbar | – | l.563 | – | – | – |
| Import CSV | Button → `.fileImporter` | Bulk import readings | l.90-101; importer l.118-124 (`UTType.commaSeparatedText`, one file) → `handleCSVImport` l.619-718 | `generation_records` `.upsert([..])`, `source: "csv_import"` (same no-conflict-key problem, so a re-import duplicates rows). Then `fetchAll()`. | Header must contain `month` and `year`; optional `actual_kwh`, `expected_kwh`, `guaranteed_kwh` (l.643-654). **The parser is a naive `split(",")`: quoted fields and a UTF-8 BOM are not handled (a BOM makes "month" fail to match). Month and year ranges are not validated (month 13 is accepted). Unparseable rows are skipped silently.** | Alert "CSV Import" with success, count or error text (l.125-129, 636-716) |
| Add Downtime | Button → sheet | Log an outage | l.313-322 | – | – | – |
| ↳ Start Date / Duration (h) / Reason (5) / Comment | DatePicker, TextField, Picker, TextField | Event details | l.404-426 | – | Save is disabled unless the duration is greater than 0 (l.455) | – |
| ↳ Save | Toolbar | – | l.437-454 → append to **local `@State downtimeEntries`** | **Not persisted. Lost when you leave the tab.** `Models/DowntimeComment.swift` and a DB table evidently exist but are not used here. | – | – |
| Downtime row trash | Button | Remove an entry | l.378-387 | local only | no confirmation | "No downtime events logged." (l.347-352) |
| Source Guarantees: Inverter / Module Warranty, Battery Warranty, Battery Cycle Guarantee | TextField (numberPad) inside a DisclosureGroup | Warranty data | l.465-502, 504-523 | **Local `@State`, never saved or loaded.** `Models/GenerationSourceGuarantee.swift` (per-month `source_label`, `guaranteed_kwh`) exists but is unused here. | – | – |
| Module Performance Guarantee | Slider 70-100 % | "Output after 10 years" | l.470-492 | local only, and **used in no calculation** | – | – |

### 2.7 Tenants tab (`ProjectTenantsTab.swift`)

The tab has its own `ProjectTenantsTabViewModel` (l.7-131). **Adds, edits and deletes do not refresh the parent `ProjectDetailViewModel.tenants`.** As a result, the header subtitle ("n tenants (m with profiles)"), the Tenants and Load Profile status dots, the Overview workflow steps and the Overview tenant summary all stay stale until a pull-to-refresh or re-entry.

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | List tenants | l.255-257 → `loadTenants()` l.29-45 | `project_tenants` (8 cols) `.eq project_id` `order name` | – | Red banner with "Dismiss" (l.151-164); "Loading tenants..."; "No Tenants – Tap + to add the first tenant." (l.166-174) |
| Error banner "Dismiss" | Button | Clear the error | l.158 → `errorMessage = nil` | – | – | – |
| Floating "+" | Button (overlay) | Add a tenant | l.197-210 → `showAddSheet` | – | – | – |
| Row tap | `onTapGesture` | Edit | l.183 → `editingTenant = tenant` | – | – | – |
| Context menu → Edit / Delete | contextMenu | Edit or delete | l.184-191 | – | – | – |
| Delete alert → Delete / Cancel | Alert | Confirm | l.240-254 → `deleteTenant(id:)` l.119-130 | `project_tenants` DELETE `.eq id` (no project scope check) | – | errors go to the banner |
| **TenantFormSheet** Name* / Shop Number / Shop Name | TextField | Details | l.437-443 | – | Name is required (l.428-431) | – |
| Area (m²) / Monthly kWh Override | TextField, decimalPad | Measurements | l.447-455 | – | `canSave` checks `(Double(area) ?? 0) >= 0`. **Non-numeric text passes and saves area = 0 (l.472). A non-numeric kWh override saves NULL (l.473).** | – |
| Include in Load Profile | Toggle | Flag | l.459 (default true) | – | – | – |
| Save (add) | Toolbar | Insert | l.471-484 → `addTenant` l.47-81 | `project_tenants` INSERT {project_id, name, shop_number, shop_name, area_sqm, monthly_kwh_override, include_in_load_profile} | – | The sheet dismisses immediately; any error appears in the banner |
| Save (edit) | Toolbar | Update | → `updateTenant` l.83-117 | `project_tenants` UPDATE `.eq id` | – | same |
| Cancel | Toolbar | – | l.468 | – | – | – |

`ProjectTenant.areaSqm` is a non-optional `Double` (`Models/ProjectTenant.swift:7`). **If any row has a NULL `area_sqm`, the whole list fails to decode** (unverified: the column's nullability is not in the repo). The avatar colour uses `hashValue` (l.376), which Swift randomises per launch, so colours change from one launch to the next.

### 2.8 Documents tab (`DocumentsTab.swift`)

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Folders and files | l.248-250 → `loadData` l.428-451 | `project_document_folders` `select *` `.eq project_id` `order sort_order`; `project_documents` `select *` `.eq project_id` `order created_at desc` | – | **`print` only (l.449).** "Loading documents..."; "No Documents" (l.183-188) appears only when the project has no folders AND no files at all. **An empty sub-folder renders an empty List with no message.** |
| New Folder | Button → alert with TextField | Create a folder | l.67-73, alert l.251-260 → `createFolder` l.453-476 | `project_document_folders` INSERT {project_id, name, parent_id = current folder, sort_order} | blank names are ignored (l.454) | print only. **There is no rename or delete for folders.** |
| Select / Cancel | Button | Multi-select mode | l.75-82 → `isSelectionMode.toggle()` | – | – | **Dead feature. No row UI ever adds to `selectedDocumentIds`: `documentRow` has no checkbox and tapping a row opens the detail sheet even in selection mode (l.225-229). The "Delete (n)" button (l.84-96 → `bulkDelete` l.534-538) can therefore never appear.** |
| Upload | Button → `.fileImporter` | Upload files | l.98-106 (sets `selectedFolderId`); importer l.261-269 (`.pdf, .png, .jpeg, .spreadsheet, .plainText, .data`, multiple) → `uploadFiles` l.478-519 | **Storage bucket `project-documents`, path `projects/<projectId>/<UUID>_<fileName>` (l.487)**, `upload(path, data:)` with no contentType. Then `project_documents` INSERT {project_id, folder_id, name, file_type = extension, file_path, file_size}. **`uploaded_by` is not set.** | a failed security-scope grant silently skips the file (l.480) | **Per-file errors are `print` only (l.515). If the storage upload succeeds but the row insert fails, an orphan object is left.** An importer `.failure` is ignored (l.266). Whole files are read into memory (l.484). No progress indicator. |
| Search | TextField | Filter by name | l.115, filter l.281-283 | client-side | – | – |
| Sort (6) | Menu | Sort | l.122-134, l.286-299 | client-side | – | `Label(..., systemImage: "")` on inactive items (l.127, 141) passes an empty SF Symbol name (runtime console warning) |
| Type filter (5) | Menu | PDF, Images, Spreadsheets, Other | l.136-148, l.40-51 | client-side | – | – |
| Breadcrumb "Root" | Button | Go up | l.158-165 → `selectedFolder = nil` | – | – | **Only one level of breadcrumb: from nested folders you can only jump to Root.** |
| Folder row | Button | Open a folder | l.195-213 | the count covers direct files only (l.204) | – | – |
| File row tap | `onTapGesture` | Detail / notes sheet | l.225-229 | – | – | – |
| File row swipe-delete | `.onDelete` | Delete a file | l.231-238 → `deleteDocument` l.521-532 | `project_documents` DELETE `.eq id`. **The storage object in `project-documents` is NOT removed, so the file stays in the bucket.** | **no confirmation** | print only |
| File row download | Button (↓) | Download or open | l.374-380 → `downloadDocument` l.540-556 | storage `project-documents` `.download(path:)`, written to `tmp/<doc.name>` | – | **iOS: the file is written to the temp directory and nothing else happens. No share sheet, no QuickLook. Dead button on iPhone and iPad.** macOS: `NSWorkspace.open`. Errors are print only. |
| Detail sheet: Notes TextEditor + Save / Cancel | Form | Document notes | l.304-343; Save → `documentNotes[id] = editingNotes` (l.333-338) | **Local `@State` dictionary only. Notes are lost when you leave the tab.** The orange note icon (l.362-366) only reflects this session. | – | – |

### 2.9 Handover tab (`HandoverTab.swift`) — unreachable

**No screen instantiates `HandoverTab`, and it is not in `ProjectTab`.** Everything below is dead code as shipped. If it were wired up:

| Control | Type | Purpose | Handler → effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Checklist | l.103-105 → `loadData` l.291-358 | `handover_checklist_items` `.eq project_id` `order sort_order`; `checklist_document_links` `.in checklist_item_id`; `checklist_templates` (id, title, group_id) `.in id`; `checklist_template_groups` (id, name) `.in id` | – | print only. "No Checklist Items" (l.76-81). `documentLinks` is not cleared when the item list is empty. |
| Progress bar / "done/total" / % | display | Completion | l.25-39 | – | – | – |
| Add Item | Button → alert (Title, Description) | Custom item | l.41-47, 106-124 → `addItem` l.360-384 | INSERT `handover_checklist_items` {project_id, title, description, is_completed:false, sort_order} | blank titles are ignored | print only |
| ⋯ → Apply Default Template | Menu item | Insert 10 hard-coded items | l.50-52 → `applyTemplate` l.408-447 (10 hard-coded title/description pairs, l.410-421) | 10 separate INSERTs | **No duplicate guard: each tap adds 10 more.** | print only |
| ⋯ → Choose Template... | Menu item → sheet | Pick from the DB | l.53-56 → `loadTemplateGroups` l.491-509 (`checklist_template_groups` and `checklist_templates` with **no org filter**) | – | – | "No Templates" (l.138-143) |
| ↳ template row | Button | Add one item | l.148-151 → `applySpecificTemplate` l.516-541 (INSERT with template_id) | – | no duplicate guard; no feedback; the sheet stays open | print only |
| ⋯ → Mark All Complete | Menu item | Bulk complete | l.58-60 → `markAllComplete` l.449-468 (one UPDATE per item) | `is_completed`, `completed_at`. **`completed_by` is never set.** | **no confirmation** | print only |
| ⋯ → Reset All (destructive) | Menu item | Bulk un-complete | l.61-63 → `resetAll` l.470-489 | – | **no confirmation** | print only |
| Row check circle | Button | Toggle done | l.220-227 → `toggleItem` l.386-406 | UPDATE is_completed, completed_at | – | print only |
| Row paperclip | Button → sheet | Link a document | l.258-267 → `loadProjectDocuments` l.543-555; sheet l.179-216 → `linkDocument` l.557-574 (INSERT `checklist_document_links`) | – | no duplicate guard; **no unlink; linked documents cannot be opened** (only a "n document(s)" count, l.243-252) | "No Documents"; print only |

There is no item delete and no reordering. **There is no signature capture anywhere in Handover.** `SignatureCanvas` is used only by `Features/ClientPortal/ClientPortalView.swift:237` (outside scope).

### 2.10 Shared components

| Component | Behaviour (file:line) | Issues |
|---|---|---|
| `SignatureCanvas` | A `DragGesture(minimumDistance: 0)` appends points to `currentLine`, which is committed to `lines` on end (l.44-55). "Clear" resets the lines and sets `signatureImage = nil` (l.61-65). "Accept Signature" → `captureSignature()` re-renders the strokes into a **fixed 400×160** `Canvas` with `ImageRenderer` at scale 2 and outputs PNG `Data` (iOS `pngData`, macOS TIFF→PNG) (l.94-130). | **The capture area is hard-coded at 400 pt wide** while the on-screen canvas is flexible: strokes beyond x = 400 (iPad, macOS) are clipped, and narrow iPhones get blank padding. The guide line is hard-coded at x 20-380 (l.24-28). Single-point taps (dots) are never drawn (l.85). There is **no visual confirmation** that a signature was accepted, and further strokes after Accept are not re-captured unless Accept is pressed again. Data only goes to the parent binding. |
| `PDFPreviewView` | `PDFKit.PDFView`, auto-scale, single page continuous (l.7-44) | **Preview only: no share, export, save or print control.** `updateUIView` / `updateNSView` call `dataRepresentation()` on every update (l.19, 40), which is expensive. |

---

## 3. Stubs, dead controls, fake data, mismatches (summary)

1. **Handover tab is unreachable.** It is not in `ProjectTab` (`ProjectDetailView.swift:4-18`) and never instantiated.
2. **The tab count is 14, not 16.** Handover and Sandbox files exist but are not wired in.
3. **Tariff "assignment" is never saved.** Nothing writes `project_tariff_assignments` anywhere in the app, so the Overview step and status dot for Tariff can never go green from iOS.
4. **Costs are never saved or loaded.** `system_costs` has no writer in the app. The tab's values do not feed `SimulationEngine`, which uses `SystemCost.default` (`SimulationEngine.swift:90`). Ten of the sliders feed no calculation (replacement ×5, cost of capital, CPI, escalation, LCOE rate, equipment %).
5. **Costs "Reset to Defaults" values differ from the initial defaults** (`ProjectCostsTab.swift:270-293` vs `SystemCost.swift:43-47`). The presets wipe the BOS fixed costs.
6. **Hard-coded estimates dressed as KPIs** on the Overview:
   - Annual Yield = `kWp × 1.6 / 1000` "MWh" (l.541). **1000× too small** (see §5).
   - CO₂ = `kWp × 1.6 × 1.0 / 1000` "t" (l.555). **Also 1000× too small.**
   - "Self-Coverage" = savings / (savings + grid cost), a money ratio labelled as energy coverage (l.545-550).
   - "Grid Impact" = its complement (l.559-564).
   - These are not simulation outputs, even though the cards imply they are.
   - Costs LCOE also assumes 1600 kWh/kWp (l.124).
7. **Overview Target Date is a dead control.** It is not in `ProjectUpdate` and never saved or loaded.
8. **Overview auto-saves on open, and rounds decimals** (see §2.3).
9. **Generation downtime and source guarantees are local `@State` only**, so they are lost when you leave the tab, even though `DowntimeComment` and `GenerationSourceGuarantee` models exist.
10. **Generation save and CSV import upsert with no conflict key**, which creates duplicates on re-entry (§2.6). Save errors are `print` only and the sheet closes on failure. The year range is hard-coded 2020-2030.
11. **Documents:**
    - Select / bulk-delete is dead: it can never select anything.
    - Download does nothing on iOS.
    - Notes are session-only.
    - Deleting a file does not remove its storage object.
    - Folders cannot be renamed or deleted.
    - Every error is `print` only.
12. **The Tenants tab does not refresh the parent VM**, so the header, status dots and Overview go stale after edits.
13. **Print-only error handling:**
    - `ProjectsListViewModel` l.70, 93, 109: `errorMessage` is set but never displayed.
    - DetailVM l.88, 101, 120, 135.
    - Tariff VM l.777, 795, 812, 827, 860, 916.
    - Generation l.609.
    - Documents l.449, 474, 515, 530, 554.
    - Handover l.356, 382, 404, 443, 463, 484, 507, 539, 553, 572.
    - Debug `print`s left in: `ProjectsListViewModel` l.90, 106; Tariff l.858, 914.
14. **The Tariff PDF sheet's Done button is likely not rendered** (toolbar attached outside the NavigationStack content, l.115-119; unverified). The Eskom "Energy Rate Profile" section is empty (the chart reads municipal rates only, l.712). The comment "24hr cost profile" does not match the per-row bar chart.
15. **Overview mini chart:** months from different years collide on a month-name-only x axis (l.573-589).
16. **Comment mismatches:** "9-Step Workflow" vs 8 steps (Overview l.51); "does any tenant have a meter linked?" vs a kWh-override test (DetailVM l.104-105).
17. **macOS detail view probably shows a duplicate, unlabeled native tab strip**, because the page style is iOS-only (l.106-108; unverified).

---

## 4. Mobile-specific capabilities in scope

- **Camera / photo picker:** none in scope.
- **GPS / location:** none. The map only plots stored `projects.latitude/longitude` (`ProjectsListView.swift:152-160`). Nothing in scope captures or edits coordinates, and there is no CoreLocation use.
- **Signatures:** `SignatureCanvas` produces PNG data via `ImageRenderer` (§2.10). It is **not used in any in-scope screen**; its only consumer is ClientPortalView.
- **Offline queue:** none. No in-scope file references `OfflineSyncService`, `SyncService` or `RealtimeService`. Every write is a direct PostgREST call through `SupabaseManager.shared.client` (anon key plus the user session). **Offline, writes simply fail**, and in most places they fail silently (print only).
- **Realtime:** none. The screens load once on appear and on pull-to-refresh.
- **File import:**
  - Generation CSV: `.fileImporter`, `commaSeparatedText`, single file, security-scoped read (`GenerationTrackingTab.swift:118-124, 619-718`).
  - Documents: multi-file `.fileImporter` (`DocumentsTab.swift:261-269, 478-519`), uploaded to the `project-documents` bucket.
- **Share sheet:** **none in scope.** `PDFPreviewView` has no share action. Documents download on iOS neither shares nor previews.
- **Keyboard types:** `.decimalPad` / `.numberPad` under `#if os(iOS)` on the numeric fields.

---

## 5. Formulas in scope

**Costs (`ProjectCostsTab.swift`)**
- `solarCapital = solarCostPerKwp × solarCapacityKwp` (l.72-74)
- `batteryCapital = batteryCostPerKwh × batteryCapacityKwh` (l.76-78)
- `fixedCosts = H&S + water points + CCTV + MV switchgear` (l.80-86)
- `subtotalCapital = solarCapital + batteryCapital + fixedCosts` (l.88-90)
- `professionalFees = subtotal × prof% / 100` (default 5) (l.92-94)
- `projectManagement = subtotal × PM% / 100` (default 5) (l.96-98)
- `contingency = subtotal × cont% / 100` (default 7.5) (l.100-102)
- `totalCapitalCost = subtotal + profFees + PM`, **excluding contingency** (l.104-106)
- `annualMaintenance = solarCapital × solarMaint% + batteryCapital × battMaint%` (l.108-112). Displayed only; not in any total.
- `annualInsurance = totalCapitalCost × insurance%` (l.114-116). Displayed only.
- `totalProjectCost = totalCapitalCost + contingency` (l.118-120)
- `LCOE = totalProjectCost / (solarCapacityKwp × 1600 × durationYears)` (l.122-128). **Undiscounted: it ignores O&M, insurance, replacements, degradation and the "LCOE Discount Rate" slider.** Battery capex is included in the numerator while only PV energy counts in the denominator.
- Contrast with `FinancialEngine.swift:60`: `totalSystemCost = equipment + bos + profFees + pmFees + contingency` includes contingency, so the "Total Capital Cost" shown on this tab will not match what the engine uses.

**Tariff (`TariffAssignmentTab.swift`)**
- Municipal blend is an arithmetic mean of the `amount` of rows where `charge == "energy"`, filtered by type (l.227-244):
  - `solarHours` = rows with tou ∈ {peak, standard, all}. **No hour-of-day weighting**, despite the "(6am-6pm)" label.
  - `solarPeak` ≡ `peakOnly`, and `solarOffPeak` ≡ `offPeakOnly`.
  - If the filtered set is empty, it falls back to the all-energy mean.
  - **No c/kWh → R conversion for municipal rows**, but the result is labelled "R … /kWh" (l.287). A plan stored in c/kWh would display 100× too high.
  - Inclining block tariff (IBT) blocks are weighted equally, whatever the consumption.
- Eskom blend uses the same filters; `avg / 100` if the unit contains "c/" (l.246-262). Also a simple mean, with no season or TOU hour weighting.
- Eskom detail card: `avgCents/100` if the unit contains "c/" (l.550-554). Municipal detail card: a plain mean with the raw unit (l.605-617).

**Generation (`GenerationTrackingTab.swift`)**
- `totalActual`, `totalExpected` and `totalGuaranteed` are plain sums over all records (l.136-138).
- `performanceRatio = totalActual / totalExpected × 100`, or 0 when expected is 0 (l.139). It is green at 95 % or above (l.145). **It is summed across mismatched months: a month with actual but no expected inflates it, and the reverse deflates it.**
- **No guarantee-shortfall calculation.** Guaranteed kWh is only displayed. Downtime does not adjust PR or expected output. The module-performance slider affects nothing.
- Cumulative = running sum of `actualKwh ?? 0` sorted by (year, month) (l.211-220).
- Downtime total = Σ `durationHours` (l.326), local only.

**Overview KPIs (`ProjectOverviewTab.swift`)**
- Annual Yield "MWh" = `kWp × 1.6 / 1000` (l.541). **This is a units bug: kWp × 1600 kWh/kWp = kWp × 1.6 MWh, so dividing by 1000 again understates the yield 1000×.** 100 kWp displays "0.2 MWh" instead of about 160 MWh.
- CO₂ "t/yr" = `kWp × 1.6 × 1.0 / 1000` (l.555). **This has the same 1000× understatement:** 100 kWp shows 0.2 t instead of about 160 t at 1 t/MWh.
- Self-Coverage % = `savings / (savings + gridCost) × 100` (l.545-550).
- Grid Impact % = `gridCost / (savings + gridCost) × 100` (l.559-564).
- Savings and ROI come straight from `project_simulations.annual_solar_savings` / `roi_percentage`.
- Workflow progress = completed steps / 8 (l.316-318, 340).

**Tenants**
- `totalArea = Σ areaSqm`, `totalMonthlyKwh = Σ monthlyKwhOverride` (`ProjectTenantsTab.swift:19-25`, also Overview l.616-617).
- **No per-tenant cost or energy allocation exists in scope.**
- The header's "(n with profiles)" counts tenants with `monthlyKwhOverride > 0` (`ProjectDetailView.swift:171`).

---

## 6. Security

- **There is no ownership or organisation scoping anywhere in scope.**
  - Every query filters only by `project_id` or `id`, never by user or org: projects list `ProjectsListViewModel.swift:61-66`; detail `ProjectDetailViewModel.swift:30-133`; tenants, documents, generation and handover all filter by project_id only.
  - `createProject` sends no owner or org column (l.79-88), so projects are not attributed to their creator.
  - Isolation depends entirely on server RLS, which the repo does not define for these tables.
- **The repo's own migration grants every authenticated user blanket reads.** `../migrations/2026-08-05_fix_admin_rls.sql` creates `FOR SELECT TO authenticated USING (true)` on `projects` (l.111-113), `project_simulations`, `proposals`, `generation_records` (l.139-141), `tariff_plans`, `eskom_*`, `municipalities` and `provinces`.
  - **Any signed-in user can list and open every project and its generation data.**
  - The same file documents that RLS enablement on these tables is "UNKNOWABLE from the repo" (section 6). **Whether any user can also UPDATE or DELETE any project, tenant, document or reading from these screens is therefore unverified.** Nothing in the client prevents it: the delete paths are `.delete().eq("id", …)` only (`ProjectsListViewModel.swift:100-104`, `ProjectTenantsTab.swift:121-125`, `DocumentsTab.swift:523-527`).
  - The same migration adds `INSERT … WITH CHECK (true)` for `tariff_plans`, `tariff_rates` and `municipalities` (l.162-172). Those are not written from in-scope screens.
- **Tables with no policy in the repo at all:** `project_tenants`, `project_documents`, `project_document_folders`, `handover_checklist_items`, `checklist_document_links`, `checklist_templates`, `checklist_template_groups`, `project_tariff_assignments`, `system_costs`, `organization_branding`. Their state is unverified.
- **Storage:**
  - The `project-documents` bucket uses the path `projects/<projectId>/<uuid>_<originalFileName>` (`DocumentsTab.swift:487`). The path is guessable from a project id plus the stored `file_path` in `project_documents`, which any reader of that table can see. Bucket policies are not in the repo (unverified).
  - Deletes leave the objects in place, so "deleted" documents remain downloadable by anyone who has the path.
  - The original file name is embedded unsanitised in the object key and later used as a temp filename (`DocumentsTab.swift:547`, `appendingPathComponent(doc.name)`). A crafted `name` containing `../` could write outside the temp directory (low risk; unverified).
- **Branding leak:** `PDFGenerationService.fetchBranding()` takes the first `organization_branding` row with no org filter (`PDFGenerationService.swift:30-35`). A tariff report could therefore carry another organisation's branding if RLS allows it to be read.
- **Session storage:** `SupabaseManager.swift` stores the auth tokens in **`UserDefaults`**, despite the type being named `KeychainLocalStorage` (the doc comment admits it). Tokens are readable from the app container and backups. This is outside the scope files, but every in-scope call depends on it.
- **Remote content:** `ProjectRowView` loads `projects.logo_url` from an arbitrary URL with `AsyncImage` (`ProjectsListView.swift:290-297`).
- **Audit fields are never populated:** `uploaded_by` on documents, `completed_by` on handover items, and `created_by` / owner on projects.


---

<!-- Part 3C: merged from ios-parts/C-projects-tabs-2.md -->

# C. Project tabs, part 2 (Schematics, Load Profile, Solar Forecast, Simulation, Sandbox, Proposals, Monthly Report, Schedule/Gantt, PV Layout)

Scope root: `WM Solar/WM Solar/`. Paths below are relative to that root. All `file:line` references were read line by line. "Unverified" means the claim depends on the database schema, RLS, storage bucket config or runtime behaviour, which this read-only review could not see. No SQL schema for these tables exists in the repo; the only local migration is `migrations/2026-08-05_fix_admin_rls.sql`.

Already-known context, referenced but not re-derived here:
- (K1) SimulationEngine takes a normalised 0-1 solar profile and multiplies by kWp, with no GHI scaling.
- (K2) FinancialEngine hardcodes `gridTariffRate = 2.50` R/kWh (`Core/FinancialEngine.swift:63`).
- (K3) BatteryDispatchEngine is never called.
- (K4) OfflineSyncService.enqueue and RealtimeService.subscribe are never called.

## 0. How the tabs are reached

`Features/Projects/ProjectDetailView.swift:4-18` defines `ProjectTab` with 14 cases. Its `TabView` (lines 62-104) hosts the tabs. On iOS it uses `.tabViewStyle(.page(indexDisplayMode: .never))` (line 106), so a horizontal swipe changes tabs.

| Tab in scope | Instantiated at | Reachable? |
|---|---|---|
| SchematicsTab | ProjectDetailView.swift:70 | Yes |
| LoadProfileTab | :73 | Yes |
| SimulationTab | :82 (receives the shared `ProjectDetailViewModel`) | Yes |
| PVLayoutTab | :85 | Yes |
| SolarForecastTab | :88 | Yes |
| ProposalTab | :91 | Yes |
| GanttTab ("Schedule") | :94 | Yes |
| MonthlyReportTab | :103 | Yes |
| **SandboxTab** | **nowhere** | **No. There is no `ProjectTab` case and no `SandboxTab(` call anywhere in the app (grep). The whole Sandbox / What-If screen is dead code.** |
| TOUClockDiagram | `Features/Tariffs/TOUReferenceView.swift:46,50,54` (Tariffs area, not a project tab) | Yes, outside project tabs |

⚠ The iOS page-style TabView claims horizontal swipes. That likely competes with the PV canvas pan drag (`PVCanvasView.swift:96-110`), the Gantt horizontal ScrollViews and the Load Profile chip scroller. Not verified at runtime.

---

## 1. SchematicsTab (`Features/Projects/Tabs/SchematicsTab.swift`)

Storage: bucket **`project-schematics`**, object path `{projectId}/{fileName}` (lines 404, 428, 441, 457, 475). No database table is used. The file list is read straight from storage.

| Control | Type | What it's for (user terms) | Handler -> effect (file:line) | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | Lists the project's drawings | `loadFiles` :48-50 -> :398-419 | Storage `list(path: projectId)` on `project-schematics` :403-405. Name, `metadata.mimetype` and `metadata.size` mapped :407-413 | — | Spinner :23-25. Any error, including a missing bucket or RLS denial, is `print`-only :416 and shows the same "No schematics uploaded" empty state :89-104, so a failure looks like an empty folder |
| Upload Schematic | Button | Add drawings | Sets `showFilePicker = true` :33-35 | — | Always enabled; no in-flight state | — |
| File importer | `.fileImporter` | Choose files | :51-63. Types `[.pdf, .png, .jpeg, .svg]`, multiple selection allowed. Loops `uploadFile` :421-438 | Reads bytes via `Data(contentsOf:)` :426. Storage `upload(path, data, upsert: true)` :430-432, then re-lists | Security-scoped access is guarded :422. If `startAccessing…` returns false the call returns silently. No size limit, no type re-check, no content type passed (options only set `upsert`) | `.failure` result ignored :56. Upload errors `print`-only :436. **`upsert: true` silently overwrites any existing file with the same name** |
| File row tap | `onTapGesture` | Preview a drawing | `openPreview` :312-322 -> `fetchFileData` :460-469 | Downloads via **`getPublicURL`** :454-458 + `URLSession` :463 (no auth header) | — | Sheet shows "Loading preview…" :230-238, then "Unable to load preview" :248-256 if the data is nil. Fetch errors `print`-only :466 |
| Thumbnail | `AsyncImage` | Image thumbnail | :191-213 | Public URL :193 | Only for `image/*` except SVG :326-329 | Falls back to a type icon :200-201 |
| Pencil icon (images only) | Button | Annotate an image | :159-173. Fetches the public data, then opens the editor sheet :162-166 | Same public download | Only shown for PNG/JPEG | If the fetch fails, nothing happens and there is no message |
| Trash icon | Button (`.destructive`) | Delete a drawing | `deleteFile` :175-181 -> :440-450 | Storage `remove(paths:)` :443-445 | **No confirmation. Deletes on the first tap** | Errors `print`-only :448 |
| Preview sheet "Done" | Toolbar button | Close | :265-268 | — | — | PDFs use `PDFPreviewView` :241. Images use a pan-scroll view :274-294. SVG and others get "Preview not available…" :296-308 |
| Annotation editor: tool chips Pin / Measure / Label | Buttons | Choose a markup tool | :522-536 | In-memory only | — | — |
| Undo / Clear | Buttons | Remove the last or all markups | :540-554 | In-memory | Disabled when empty | — |
| Canvas tap | `onTapGesture(location)` | Place a markup | `handleTap` :627-644. Position normalised to the GeometryReader size :628, not to the fitted image rect | In-memory | — | — |
| "Pin Label" alert (Add / Cancel) | Alert + TextField | Name a pin | :606-623 | In-memory | Empty label becomes "Pin N" :613 | — |
| Save | Toolbar | Save the markup | **`onSave(imageData)` :601 passes the ORIGINAL bytes. The code comment says "In a full implementation, render annotations onto the image".** Then `uploadAnnotatedFile` :471-485 uploads to `{base}_annotated.{ext}` with upsert | Storage upload | — | Errors `print`-only :483 |
| Cancel | Toolbar | Discard | `dismiss()` :597 | — | — | — |

**Stubs and mismatches**
- **Annotation Save discards every annotation (:601).** It creates an `_annotated` copy that is byte-identical to the original. Nothing is rendered, and pins are not stored anywhere.
- **The "Label" tool produces pins.** For `.label`, `handleTap` opens the same "Pin Label" alert (:634-636), and "Add" always appends `type: .pin` (:611). The `.label` render branch (:679-687) is therefore unreachable.
- **"Measure" does not measure.** It drops a "Ref N" marker (:637-642). There is no distance, no scale and no two-point logic.
- Markup is tap-only. There is no PencilKit, no freehand drawing and no drag, pinch or zoom inside the editor.
- SVG is accepted by the importer but can never be previewed or annotated.
- `SchematicFile.id` is a fresh `UUID()` on every list (:381, :408). Identity is not stable across reloads.

---

## 2. LoadProfileTab (`Features/Projects/Tabs/LoadProfileTab.swift`)

| Control | Type | What it's for | Handler -> effect (file:line) | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | Build the site's 24-h profile | `loadData` :106-108 -> :774-811 | (1) `project_tenants` select, filtered by `project_id` :781-786. **The result is assigned to `tenants` and never used.** (2) **`scada_imports` select `*`, ordered by `created_at`, with NO project or site filter** :789-794. Then `hasData` filter :796 (`Models/Site.swift` `hasData`). (3) `SolcastService.staticSAProfile()` :805 | — | Spinner "Computing profile…" :86-88. **Any thrown error sets `chartData = []` :808-810, which shows the "No load profile data / Import meter data…" empty state :614-629.** A failure is indistinguishable from "no data" |
| Chart variant chips (9) | Buttons in horizontal scroll | Switch chart | `selectedChart = variant` :124-142 | — | — | — |
| Export CSV | Button (shown only when there is data) | Download the hourly table | `exportCSV` :192-208. macOS: `NSSavePanel` + `try? write` :195-200. iOS: writes `Caches/load_profile.csv`, then `ActivityViewController` sheet :202-206, :112-116, :732-740 | Local file only | — | Write errors swallowed by `try?` (:200, :204) |
| Settings | Button -> sheet | Chart assumptions | `showSettings = true` :164-166. Sheet :633-726 (`.medium`/`.large` detents) | — | — | — |
| Settings › Unit picker (kW / kVA) | Picker | Display unit | `displayUnit` :637-640. Applied in `computeProfile` :839-843 as `kW / PF` | — | — | **KPI labels, axis labels and CSV headers still say "kW"/"kWh" when kVA is selected (:222-228, :308, :178)** |
| Settings › Power Factor | Slider 0.80-1.00 step 0.01 | PF for kVA | :647 | — | — | — |
| Settings › Show PV Profile | Toggle | Overlay solar | `showPV` :652 | — | — | — |
| Settings › AC Capacity (kW) | TextField, decimalPad | PV size | `pvCapacityKw` :657 (default **100** :763, not the project's size) | — | No range check | — |
| Settings › System Losses | Slider 0-0.30 | PV derate | `systemLosses` :670 (default 0.14 :764) | — | — | — |
| Settings › Show Battery | Toggle | Overlay battery | `showBattery` :676 (default false) | — | — | — |
| Settings › Battery kWh / kW | TextFields | Battery size | :681, :691 (defaults 50 / 25) | — | No range check | — |
| Settings › Diversity Factor | Slider 0.5-1.0 step 0.05 | Scale the aggregate load | `diversityFactor` :708 (default 0.85 :768) | — | — | — |
| Settings › Done | Toolbar | Apply | `showSettings = false; recompute()` :718-721 | — | — | **Changes are applied only via Done. Swiping the sheet down changes the published values but does not recompute, so the chart goes stale** |
| Data Inspector | Table (read-only) | Hourly numbers | :574-610 | — | — | — |

**How the load profile is chosen** (`computeProfile` :817-905):
1. Take every `scada_imports` row the user can see (RLS), keep rows where `hasData` is true, and use **only `load_profile_weekday`**. Weekend profiles are ignored.
2. Resample each to 24 values (`correctProfileTo24` :908-931): average when the length is an exact multiple of 24, otherwise linear interpolation.
3. **Sum all meters** :824-831, then multiply by `diversityFactor` :834-836.
4. Nothing ties this to the project. Tenants and `include_in_load_profile` are fetched but ignored, and meters are not filtered by project or site. This depends on RLS scope and is unverified, but on any account that can see more than one project's meters, the "site profile" is the sum of unrelated meters.

**Formulas**
- PV: `pv[h] = staticProfile.normalized[h] × pvCapacityKw × (1 − systemLosses)` :848-851. This is the static sine profile, see (K1).
- Battery toy dispatch: start SoC 50%, min 10%, max 90% (:855-857). Discharge is `min(deficit, P, SoC−min)` (:875) and charge is `min(surplus, P, max−SoC)` (:890). There are no efficiency losses and the loop is single-day.
- KPIs :212-231: Daily kWh `= Σ total`, Peak `= max`, Load factor `= (Σ/24)/peak`, Self Use `= Σ solarUsed / Σ pv × 100`, and Grid Import `= Σ gridImport`.

**Fake or hardcoded content**
- **"Seasonal" chart is synthetic.** Summer is `total × 0.85` and winter is `total × 1.15` (:490-519, with captions :528, :534). No seasonal data is used.
- **"Heatmap" is a single row of 24 cells** (:551-568) coloured by hour. It is not a day × hour heatmap.
- **TOU Bands use hardcoded "Eskom Megaflex weekday" hours** (:463-471): peak 07-09 and 18-20, standard 06, 10-17 and 21, off-peak otherwise. There is no season or tariff input. This **disagrees with `EskomTOUDefaults`** in `TOUClockDiagram.swift:88-110` (high-season peak 06-08 and 17-18; low-season peak 07-09 and 18-19).
- The "Stacked" chart shows the first 20 meters' raw weekday profiles (:799-802). No diversity factor is applied, so it will not sum to the "Building" total.

---

## 3. SolarForecastTab (`Features/Projects/Tabs/SolarForecastTab.swift`)

| Control | Type | What it's for | Handler -> effect | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | Centre on the project | `loadProjectLocation` :45-47 -> :351-372 | `projects` select `latitude, longitude` `.eq(id).single()` :357-363. Coordinates of 0/0 are ignored :365 | — | Error shown in red text :132-136 (shared `errorMessage`) |
| Map | `Map(initialPosition:)` + Marker | Visual location | :58-71 | — | — | **`initialPosition` is applied only once, before the async project fetch completes, so the camera likely stays at the Johannesburg default (-26.2041, 28.0473, :342-343) while the marker moves.** Unverified at runtime |
| Latitude / Longitude | TextFields, decimalPad | Override location | Bound to the VM :76, :85 | **Not persisted**. Used only for the two fetches below | No range validation | — |
| Solcast 7-Day | Button | Weather-based forecast | `fetchSolcast` :101-114 -> :374-395 -> `SolcastService.fetchForecast` (`Core/SolcastService.swift:57-64`) | **Edge function `solcast-forecast`**, body `{latitude, longitude, hours: 168, period: "PT60M"}` | Disabled while loading | `QUOTA_EXCEEDED` gets a specific message :387-388. Other failures get a generic or `localizedDescription` message :390, :393 |
| PVGIS TMY | Button | Long-term typical year | `fetchPVGIS` :116-129 -> :397-416 -> `PVGISService.fetchTMY` (`Core/PVGISService.swift:44-51`) | **Edge function `pvgis-tmy`**, body `{lat, lon, startyear: 2005, endyear: 2023}` | Disabled while loading | "PVGIS request failed." :411, or the error :414 |
| Summary cards | Read-only | GHI / PSH / Temp / Annual | :142-158 | — | Shown when `summaryData != nil` | — |
| 7-day chart + daily table | Read-only | Per-day GHI, PSH, temp, cloud | :180-251 | — | — | Nil values render as 0 (:188, :218, :225, :232, :239) |
| PVGIS typical day chart | Read-only | Hourly GHI plus temperature | :255-295 | — | — | **Temperature is plotted as `temp × 20` on the W/m² axis (:282) with no second axis. The line is unlabelled and its scale is misleading** |
| PVGIS monthly chart | Read-only | Avg daily GHI per month | :299-317 | — | — | — |

**Formulas** (:418-436)
- From Solcast: `annualGhi = averageDailyGhi × 365` (:423) extrapolates a 7-day forecast to a year, and `avgTemp` is the first day only (:422).
- From PVGIS: the summary is written **only if `summaryData == nil`** (:428). Once Solcast has run, the PVGIS summary never replaces it.

**Not wired to anything else:** neither response is persisted, and neither feeds the simulation. SimulationTab, LoadProfileTab and SandboxTab all call `SolcastService.staticSAProfile()` (`SimulationTab.swift:733`, `LoadProfileTab.swift:805`, `SandboxTab.swift:422,448`). `SolcastService.fetchPVProfile` and `PVGISService.typicalDayToProfile` exist but have no callers (grep).

---

## 4. SimulationTab (`Features/Projects/Tabs/SimulationTab.swift`)

| Control | Type | What it's for | Handler -> effect | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | Prefill | `loadFromProject` :44-46 -> :711-722. Project lat/lon, then kWp, batt kWh and batt kW from `viewModel.simulations.first` | Already loaded by ProjectDetailViewModel from `project_simulations` | — | — |
| Solar Capacity / DC:AC / Battery kWh / Battery Power | 4 TextFields (decimalPad) | System size | `configField` :57-60, :314-330 | In-memory config | **No validation.** 0 or negative values are accepted. DC:AC = 0 makes the inverter capacity infinite (see `SimulationEngine.swift:215`) | — |
| Dispatch Strategy | Picker (menu), shown if battery > 0 | Battery behaviour | :64-75 | `config.dispatchStrategy` | — | **Ignored.** The engine never reads it (grep: only the declaration at `SimulationEngine.swift:82`). See (K3) |
| Module Type | Picker | Panel technology | :128-140. `onChange` copies `moduleEfficiency` from the type | — | — | **Ignored.** `moduleEfficiency` and `moduleType` are never read by the engine |
| Module Efficiency | Read-only text | — | :143-148 | — | — | Display only |
| Tilt Angle | Slider 0-90 step 1 | Panel tilt | :151-153 | Used :178, :181 | — | — |
| Azimuth | Slider 0-360 step 5 | Panel direction | :156-158 | Used :180-181 | — | — |
| Ground Coverage | Slider 0-1 step 0.05 | Row spacing | :169-171 | — | — | **Ignored** by the engine |
| Inverter Type | Picker | String / Central / Hybrid | :186-193 | — | — | **Ignored** |
| DC:AC (read-only repeat) | Text | — | :196-201 | — | — | — |
| Inverter Efficiency | Slider 0.90-0.99 step 0.005 | Conversion efficiency | :204-206 | Used at `SimulationEngine.swift:216` | — | — |
| Chemistry | Picker | Battery type | :221-231. `onChange` sets the round-trip efficiency | — | — | Used only through RTE |
| Round-trip Efficiency | Read-only | — | :234-239 | Used at `SimulationEngine.swift:252` as `sqrt(RTE)` on **charge only** | — | Effective modelled RTE is `sqrt(RTE)`, not RTE |
| Min SOC / Max SOC | Sliders 0.05-0.30 / 0.80-1.0 | Battery window | :242-249 | Used at `SimulationEngine.swift:187-188` | — | — |
| Loss Chain (7 sliders, 0-15% step 0.5%) | Sliders in a DisclosureGroup | Soiling, shading, mismatch, DC wiring, AC wiring, inverter, transformer | :89-108, :332-340 | Used via `combinedDeratingFactor` (`SimulationEngine.swift:96-100`) | — | "Inverter" loss (default 3%) and "Inverter Efficiency" (default 97%) are **both** applied (`:98` and `:216`), which double-counts inverter losses |
| Annual Degradation | Slider 0-2% | PV ageing | :261-263 | Used in `FinancialEngine.swift:69,86` | — | — |
| Load Growth Rate | Slider 0-10% | Future load | :266-268 | — | — | **Ignored** (never read; `SimulationEngine.swift:85` is its only occurrence) |
| Grid Import Limit / Export Limit | Toggle + Slider 0-1000 kW step 10 | Connection caps | :273-305. Toggle on sets 500 | Used at `SimulationEngine.swift:241-243, 261-263` | — | **The import cap truncates `gridImport` with no unmet-load term (:242), so energy is not conserved.** The export cap discards surplus silently |
| Run Simulation | Button | Run 8,760 h | `runSimulation` :359-360 -> :724-746 | Load: `fetchLoadProfile` :748-772 (**`scada_imports` select `load_profile_weekday` with NO filter at all** :750-754, all meters summed :757-763; fallback **flat 50 kW × 24** :771). Solar: `staticSAProfile()` :733. Then `SimulationEngine.run` :736-740, then **INSERT `project_simulations`** :842-877 | Disabled while running | Fetch errors `print`-only :767 and silently fall back to 50 kW. Save errors go to `errorMessage` :875, **which the view never displays**. `viewModel.simulations` is not refreshed after a save |
| Result KPIs and charts | Read-only | Energy, finance, monthly, cash flow, energy balance | :377-531 | — | Shown when `result != nil` | Pie labels divide by `totalLoadKwh` (:519), so "Grid Export %" is a share of load, not of PV |
| Load Shedding Stage | Picker (None, 1, 2, 3, 4, 6, 8) | Outage what-if | :541-549 | In-memory only | — | — |
| Quick Presets (6 cards) | Buttons | One-tap sizes | `presetCard` :606-641. Sets kWp, batt kWh and batt kW only | — | — | Hardcoded: 5/5/5, 50/50/25, 200/200/100, 500/500/250, 100/0/0, 20/40/20 |
| Saved Simulations list | Read-only rows | History | :645-677 | `viewModel.simulations` (`project_simulations`) | Shown if non-empty | Rows are not tappable, so there is no reopen, delete or compare |

**Which inputs actually reach the engine** (`SimulationEngine.swift:163-352` and `FinancialEngine.swift:36-175`)
- **Used:** solarCapacityKwp, dcAcRatio, tiltAngle, azimuthAngle, latitude, the 7 loss sliders, inverterEfficiency, battery kWh/kW, min/max SoC, RTE (charge side), grid import/export limits, and degradationRatePerYear (finance). `temperatureCoefficient` (−0.004) and `lidLoss` (1.5%) are used but have no UI.
- **Ignored:** dispatchStrategy, moduleType, moduleEfficiency, groundCoverageRatio, inverterType, loadGrowthRatePerYear, and longitude. `batteryDegradationPerYear` is computed into `battDeg` (`FinancialEngine.swift:91`) and then never used.
- **Tariff:** SimulationTab never reads the project's assigned tariff. There is no tariff query in this file, and `grep results_json|tariff_id` finds nothing app-wide. Savings use (K2) R2.50 with 10% escalation (`FinancialEngine.swift:68`).
- **Costs:** `config.systemCost` is always `SystemCost.default = standardPreset` (`SimulationEngine.swift:90`; `Models/SystemCost.swift:43,47`), i.e. R11,000/kWp, R5,500/kWh, 5% prof fees, 5% PM, 7.5% contingency, 9% cost of capital, 6% CPI, 20 years, 45% replacement in year 10. **The Costs tab's values are not passed in.**

**Engine formulas** (quoted)
- Tilt/azimuth: `max(0.5, cos(tilt − |lat|) × (0.5 + 0.5·cos(az)))` (`SimulationEngine.swift:177-181`). At az = 180° this collapses to the 0.5 floor.
- DC: `normProfile[h] × kWp × combinedDerate × max(1 + (−0.004)(T−25), 0.5) × seasonal × tiltAz` (:207-212). T is always 25 °C with the static profile (`SolcastService.swift:136`), so the temperature term is always 1.
- AC: `min(DC, kWp/dcAc) × invEff` (:215-216).
- Seasonal factors Jan-Dec `1.15, 1.10, 1.00, 0.88, 0.75, 0.68, 0.70, 0.78, 0.90, 1.02, 1.12, 1.18`, scaled by `min(|lat|/30, 1.5)` (:377-388).
- Static profile: `sin((h−5)/14·π)` for h = 5…19, normalised to a peak of 1 (`SolcastService.swift:119-139`). Σ normalised ≈ cot(π/28) ≈ **8.88 "kWh per kWp per day"** before derates.
  - My own arithmetic, not run in the app: with default losses (≈0.868 derate), average seasonal ≈0.946 at −26.2°, and 0.97 inverter efficiency, this gives roughly 2,500-2,600 kWh/kWp/yr before clipping. Typical SA yield is ~1,600-1,900. See (K1).
- Annual PR shown in the summary is **`combinedDeratingFactor × 100`** (:334). It is an input, not a result.
- Finance: savings `= yearPv × (solarUsed/pv) × 2.50 × 1.10^(y−1)` (`FinancialEngine.swift:94-99`). O&M escalates with CPI (:102-103), insurance is 1% of capex (:106), replacement is 45% of capex in year 10 (:110-112). NPV, IRR (Newton-Raphson returning a **percentage**, :179-205), LCOE (:209-225), simple payback `= capex / year-1 net cash` (:153-154) and ROI `= (lifetime savings − capex)/capex` (:161).

**Load Shedding formulas** (:553-568, display only, not persisted)
- `hours = stage × 2`
- `annualOutageKwh = hours × 365 × (annualLoad or 438,000)/8760`. 438,000 = 50 kW × 8760, which matches the flat fallback.
- Generator cost **R6.50/kWh hardcoded** (:555).
- `battCoverage = min(1, battKwh / (hours × avgLoadKw))`. This ignores SoC limits and battery power.

**Persistence**
- **`project_simulations` INSERT** (:843-873) writes these columns: `project_id`, `name` ("Simulation <date>"), `simulation_type: "full"`, `solar_capacity_kwp`, `battery_capacity_kwh`, `battery_power_kw`, `payback_years`, `roi_percentage`, `annual_solar_savings` (= year-1 gross savings), and **`annual_grid_cost = totalGridImportKwh × 2.5`** (:866, a second hardcoded tariff).
- Every Run inserts a new row.
- **`results_json` is never written by iOS.** No hourly, monthly, cash-flow or config data is persisted, so a saved simulation cannot be reopened. `Models/SystemCost.swift:3` claims costs are "stored in project_simulations.results_json", but nothing in the app reads or writes that column (grep). The `ProjectSimulation` model has no `results_json` field.
- **`simulation_presets`:** `savePreset` (:788-816), `loadPresets` (:818-831) and `applyPreset` (:833-840) have **no callers**. The table is never touched from iOS. The preset cards are hardcoded, and the columns the dead code would write are `project_id, name, solar_capacity_kwp, battery_capacity_kwh, battery_power_kw, dc_ac_ratio, tilt_angle, azimuth_angle`.

---

## 5. SandboxTab (`Features/Projects/Tabs/SandboxTab.swift`), unreachable (see §0)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Scenario label | TextField | Name | Binding :109 | In-memory | — | — |
| Remove scenario (x) | Button | Delete scenario | `removeScenario` :116-118, :412-415 (pushes undo) | — | Hidden when only 1 scenario | — |
| Solar kWp / Battery kWh / Power kW | TextFields | Scenario size | Bindings :129-149 | — | No validation; edits are **not** recorded in undo history | — |
| Add Scenario | Button | New scenario | `addScenario` :37-39, :405-410. Labels A-E, default 100/0/0 | — | Hidden at 5 scenarios | — |
| Run All Scenarios | Button | Compare | `runAll` :52-65, :417-441 | **Load = flat `[50] × 24` (:421, "Simplified fallback")**. Project load is ignored. Solar = static. Default `SimulationConfig` (only kWp, kWh and kW set) | Disabled while running | The per-scenario spinner is effectively invisible because the loop runs synchronously on the main actor |
| Comparison table | Read-only | Winners highlighted | :183-230 | — | — | Winner chosen by exact `==` on Double |
| Sweep min / max / step | TextFields | Payback vs kWp curve | :243-250 | — | **No validation. `step <= 0` makes `while kwp <= max { … kwp += step }` (:453-471) an infinite loop on the MainActor, which hangs the UI** | — |
| Run Sweep | Button | Sweep | `runSweep` :255-268, :443-474. Same flat 50 kW; battery always 0 | — | Disabled while sweeping | — |
| Generate Draft Report | Button | Text report | `generateDraftReport` :348-356, :558-600 | Text shown in view only; no export or save | — | — |
| Undo / Redo | Buttons | Undo add/remove | :80-97, :538-554 (20-deep stack) | — | Shown only if undo history is non-empty | — |

**Bugs**
- **IRR is ×100 twice.** `FinancialEngine` already returns a percentage (`FinancialEngine.swift:204`). The comparison table (:218) and mini result (:159) display it correctly, but the Draft Report section (:327) and the generated text (:582) multiply by 100 again, e.g. "1500% IRR".
- "Recommended" is chosen solely by fastest simple payback (:333, :588).

**Persistence:** `saveToDatabase` → `sandbox_simulations` (:478-518; columns `project_id, name, scenario_label, solar_kwp, battery_kwh, battery_kw, payback_years, npv, irr, lcoe, annual_savings`) and `loadSavedScenarios` (:520-534) have **no callers**, so the table is never written from iOS.

---

## 6. ProposalTab (`Features/Projects/Tabs/ProposalTab.swift`) + ProposalEditor (`UI/Components/ProposalEditor.swift`)

| Control | Type | What it's for | Handler -> effect | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | List proposals | `loadProposals` :60-62, :394-408 | `proposals` select `*` `.eq(project_id)` ordered by `created_at` desc | — | Spinner :45-47. `ContentUnavailableView` "No Proposals" :48-53. Load errors `print`-only :406 |
| New Proposal | Button | Start a proposal | `startNewProposal` + `showEditor` :31-39, :410-416 | — | — | Does **not** reset branding toggles, checklist or footer |
| Row eye icon | Button (only if `pdf_url` is set) | View the stored PDF | `viewPDF` :258-265, :567-581. `URLSession` GET of `pdf_url` with no auth | `proposals.pdf_url` (written server-side only; iOS never sets it) | — | Status message on bad URL or fetch error |
| Row pencil | Button | Edit | `editProposal` :267-274, :418-432 | Decodes `sections` as `[String: Bool]` | — | **Section text is not reset or loaded.** It carries over from the previously edited proposal, because only `enabled` flags are applied (:426-430) |
| Row context menu (long-press on iOS) | Menu, 6 statuses | Set status | `updateStatus` :277-290, :550-565 | `proposals` UPDATE `status, updated_at` by `id` | The current status is disabled | Errors `print`-only :563. **No workflow gating**, so any status can be set, including "accepted" |
| Back to Proposals | Button | Leave the editor | `showEditor = false` :74-80 | — | — | Unsaved edits are lost without a prompt |
| Proposal Title | TextField | Title | :85 | Saved on save | Empty becomes "Solar PV Proposal" on insert (:466), but an update writes the empty string (:450) | — |
| Section toggles (9) | Toggle per section | Include or exclude | `ProposalEditor.swift:61-71` | Saved as a `{key: bool}` JSON string | — | — |
| Section text | `TextEditor` for executive, warranty, terms and appendix | Custom wording | `ProposalEditor.swift:74-82` | **Never persisted.** Only the enabled map is saved (:438-439). **Never sent to the server PDF** | — | — |
| "Auto-generated from project data" badge | Label for system, financial, energy and timeline | Claim | `ProposalEditor.swift:84-92` | — | — | Claim only. See the fallback note below |
| Generate PDF (inside ProposalEditor) | Button | Build PDF | `onGenerate` → `generatePDF` :90-92; `ProposalEditor.swift:43-54` | as below | **Not disabled while generating** (duplicates the main button) | — |
| Branding › Include Logo / Company Details / Custom Footer + footer text | Toggles + TextField | PDF branding | :97-104 | **Never read by any generation path or saved. Dead controls** | — | — |
| Primary brand colour swatch | Display | "from Settings → Branding" | :106-111 | **Hardcoded `.green` (:383)**, contradicting its caption | — | — |
| Pre-Send Checklist (5 toggles) | Toggles | Sign-off before sending | :121-144 | Not persisted, not enforced | "Ready to send" text only. Nothing is gated, and there is no Send action anywhere | — |
| Copy Link | Button (after a token exists) | Copy the client link | :154-164. Link = **`"\(Constants.Supabase.url)/portal/\(token)"`** | Pasteboard | — | See security notes |
| Save Draft | Button | Save | `saveProposal` :182-188, :434-482 | New proposal: INSERT `project_id, title, version: 1, status: "draft", sections` (JSON string), returning `id`. Existing proposal: UPDATE `title, sections, updated_at` | — | Green or red status label :175-179 |
| Share Link | Button | Create the client link | `generateShareLink` :190-196, :529-548. Saves, then sets `share_token = UUID().uuidString` | `proposals.share_token` | — | **A new token on every press invalidates the previous link.** No expiry |
| Generate PDF | Button | Server PDF | `generatePDF` :198-206, :484-527 → `PDFGenerationService.generateProposal` (`Core/PDFGenerationService.swift:40-61`) | Saves first, then **edge function `generate-pdf`** with body `{type: "proposal", project_id, proposal_id, sections: [enabled keys]}`. Downloads the returned `pdf_url` with no auth | Disabled while generating | On any error: **local fallback PDF** (:510-525) plus a red message quoting the reason |
| PDF preview sheet: Done / Share (iOS) / Save (macOS) | Toolbar | Deliver the PDF | :298-334. `sharePDF` :617-648 writes a temp file and presents `UIActivityViewController` with an iPad popover anchor. `exportPDF` :590-612 uses `NSSavePanel` | Local file | — | Errors reported in the status line |

**How the "AI narrative" is produced**
- It isn't reachable. `generateNarrative` (:653-692) has **no callers and no button** (grep).
- If it were called: **edge function `generate-proposal-narrative`**, body `{project_id, sections: [enabled keys]}`, decoding `executiveSummary / systemDescription / financialAnalysis / recommendations` (convertFromSnakeCase, `EdgeFunctionService.swift:21`).
- **The result would be discarded.** It matches on section keys `executive_summary`, `system_description`, `financial_analysis` and `recommendations` (:676-683), but the real keys are `executive`, `system`, `financial` (`ProposalEditor.swift:11-21`), and there is no `recommendations` section. No text would be applied, yet the status would still read "AI narrative generated" (:687).

**Local fallback content** (:512-521): each enabled non-cover section's title, with its content or the literal **"Auto-generated from project data."** as the body. Nothing is actually generated from project data, and branding comes from `organization_branding` `limit(1)` with no org filter (`PDFGenerationService.swift:29-37`). The fallback is single-column text, and a body taller than the remaining page is clipped because it is drawn into a fixed rect (`PDFGenerationService.swift:217-221`).

**Proposal financial figures:** none are computed on iOS. All financial and energy content is expected from the `generate-pdf` edge function, which this review did not cover.

**Report analytics:** `trackView` (:696-714) → `report_analytics` INSERT `{project_id, report_type: "proposal", action: "view"}` has no callers.

**`proposals` columns used by iOS:** `id, project_id, version, title, status, sections (text JSON {key: bool}), pdf_url, share_token, created_at, updated_at` (`Models/Proposal.swift:3-24`). `version` is always 1 and never incremented. `ReportVersion` is declared but unused here.

---

## 7. MonthlyReportTab (`Features/Projects/Tabs/MonthlyReportTab.swift`)

| Control | Type | What it's for | Handler -> effect | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | Current month | `loadReport` :92-94, :378-474 | see below | — | Spinner :67-69. Errors `print`-only :472, so the KPIs keep their previous or zero values |
| Month picker (1-12) / Year picker (**2023…2027 hardcoded**, :29) | Pickers | Period | :21-33 | — | — | **Changing the period does not reload.** The user must press Load |
| Load | Button | Reload | :36-42 | — | — | — |
| Export PDF | Button | Server PDF | `generatePDF` :44-52, :476-512 → **edge function `generate-pdf`** body `{type: "monthly_report", project_id, month, year}` (`PDFGenerationService.swift:64-85`) | Downloads `pdf_url` | Disabled while generating | Local fallback PDF with 5 text sections plus a red reason message :493-510 |
| Generated Reports eye | Button (if `pdf_url`) | Open a past report | `viewReport` :307-314, :514-528 | `report_configs` (read only, :464-470; not filtered by `report_type`) | — | "No reports generated yet" :289-292. iOS never inserts `report_configs` |
| PDF sheet "Done" | Toolbar | Close | :95-108 | — | — | **No Share or Save action in this sheet**, so the PDF cannot leave the device (unlike ProposalTab) |

**Data read**
- `generation_records` `.eq(project_id).eq(year)` ordered by month, reading `month, year, actual_kwh, expected_kwh, guaranteed_kwh` (:384-405).
- `generation_daily_records` `.eq(project_id).gte(date, 'YYYY-MM-01').lte(date, 'YYYY-MM-31')` (:420-428), wrapped in `try?`.

**Formulas** (:409-417, all hardcoded)
- `performanceRatio = actual / expected × 100`. This is actual vs expected, not the IEC performance ratio.
- `availability = min(100, same ratio)`. **This is the same number relabelled "Availability".** It is not uptime.
- `monthlySavings = actual × 2.5` ("avg tariff", hardcoded R2.50).
- `co2Avoided = actual × 1.06 / 1000` t (1.06 kg/kWh).
- `peakOutput = actual / 30 / 5.5` ("rough estimate"). This is not a measured peak, and `peak_kw` from the daily records is ignored.
- **`specificYield = actual / max(1, peakOutput × 30 / actual × peakOutput)`.** Substituting peakOutput gives `actual / max(1, 0.001102 × actual)`, which **is the constant ≈ 907.5 kWh/kWp whenever actual > 907.5 kWh**. System kWp is never used. The KPI is meaningless.
- YTD cumulative: running sums of actual and expected for months 1…selected (:454-461).

**Fake data**
- **When no daily records exist, the daily chart is random.** `actual = dailyAvg × Double.random(in: 0.7...1.3)` (:440-450), regenerated on every load and presented as "Daily Generation" with no disclaimer.
- The query's upper bound `'YYYY-MM-31'` is an invalid date for 30-day months and February. If `date` is a Postgres `date` column (unverified), those months error inside `try?`, return `[]`, and **always fall back to random data**.
- Daily records are plotted by array index (`day: i + 1`, :432-437), not by calendar date, so gaps shift days.

---

## 8. GanttTab (`Features/Projects/Tabs/GanttTab.swift`) + `UI/Components/Gantt/*`

| Control | Type | What it's for | Handler -> effect | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | Load schedule | `loadData` :129-131, :545-569 | `gantt_tasks` `.eq(project_id)` ordered by `sort_order`, and `gantt_dependencies` `.eq(project_id)` | — | Spinner; "No Tasks" empty view :97-102. Errors `print`-only :567 |
| Zoom − / + | Buttons | Day width 4-30 px, ±2 | :29-47 | — | Clamped | — |
| Add Task | Button → sheet | New task or milestone | :50-56. Form :252-316 | — | — | — |
| Add form fields: Task Name, Milestone toggle, Assignee, Start/End DatePickers (date only) | Form | Task details | :256-278 | — | Add disabled when name is empty (:303). **No end ≥ start check.** The duration label shows `max(1, days)` even when the end is before the start | — |
| Add Task / Add Milestone | Button | Create | `addTask` :281-302, :575-608 | INSERT `gantt_tasks` `{project_id, name, start_date, end_date (yyyy-MM-dd), progress: 0, is_milestone, sort_order: tasks.count, **assigned_to**}` | Guard on empty name | Errors `print`-only :606. The sheet closes regardless |
| Cancel | Toolbar | Close | :309-312 | — | — | — |
| Template | Button | Standard 15-step solar schedule | `applyTemplate` :58-64, :735-818 | 15 INSERTs into `gantt_tasks` (offsets from **today**, :741-755), then 14 FS INSERTs into `gantt_dependencies` by array index (:791-815) | **No confirmation and no duplicate check.** Every press appends another 15 tasks | **If tasks already exist, `tasks[0…14]` (sorted by `sort_order`) are the old tasks, so the dependencies attach to the wrong tasks** (:792-794) |
| Save / Update Baseline | Button | Freeze planned dates | `saveBaseline` :66-72, :504-519. In-memory `@State` snapshot, then `saveBaselineToDb` :642-687 | INSERT `gantt_baselines {project_id, name}` returning `id`, then one INSERT per task into `gantt_baseline_tasks {baseline_id, task_id, start_date, end_date}` | — | Errors `print`-only. **The baseline is never loaded back** (`loadBaselines` :689 and `loadBaselineTasks` :704 have no callers), so the on-screen baseline disappears on relaunch |
| Resources | Button → sheet | Workload per assignee | :74-80. Sheet :320-393 | Derived from tasks | — | "No Assignees" empty view |
| Critical Path | Toggle (switch) | Highlight critical tasks | :83-88 | — | — | — |
| Sidebar list row | List (260 pt fixed width, :108) | Task names, dates, progress ring, assignee | :145-224 | — | — | — |
| Sidebar swipe-to-delete | `.onDelete` | Delete a task | :215-221 → `deleteTask` :610-621 | DELETE `gantt_tasks` `.eq(id)` | **No confirmation.** Dependency cleanup depends on an FK cascade (unverified) | Errors `print`-only |
| Chart bar tap | `onTapGesture` on GanttTaskRow | Task details | `GanttChartView.swift:74-76` → `selectedTask` → sheet :138-140 | — | — | — |
| Task detail › Assigned To | TextField (custom Binding) | Reassign | :427-434 → `updateAssignee` :623-638 | UPDATE `gantt_tasks {assignee}` `.eq(id)`, then a full reload | — | **Fires a network UPDATE plus a full reload on every keystroke.** The getter reads the captured sheet snapshot `task.assignee` (:428), so the field likely snaps back while typing (unverified at runtime) |
| Task detail › Done | Toolbar | Close | :491 | — | — | — |

**Missing:** there is no UI to edit progress, dates, name, colour or dependencies, and no drag-to-move or resize of bars. `loadSegments` (`gantt_task_segments`, :720-733) has no callers.

**Column mismatch:** `addTask` writes **`assigned_to`** (:589, :601), while `GanttTask` decodes **`assignee`** (`Models/GanttModels.swift:10,22`) and `updateAssignee` writes `assignee` (:627). One of these columns is wrong. Which one exists is unverified. Either assignees set at creation never show, or the insert fails.

**Rendering** (`GanttChartView.swift`)
- Weekend shading, week lines, baseline bars (grey, :43-62), task bars, and a red today line (:134-143).
- Width = `max(30, days to latest end) + 14` days (:89-97).
- **Dependency arrows are always drawn as Finish-to-Start**, whatever the type (`GanttDependencyLines.swift:27-31`).
- The timeline header (`GanttTab.swift:229`) and the chart (`GanttChartView.swift:28`) are **separate ScrollViews**, so the header does not scroll with the bars.
- The sidebar `List` scrolls independently of the chart rows (36 pt rows), so they can misalign.

**Critical path** (`CriticalPathCalculator.swift:30-153`)
- CPM forward and backward pass over durations and dependencies only. Actual start dates are ignored; every start node has ES = 0 (:61-101).
- FS/SS/FF/SF constraints are at :78-86 and :131-139. There is no lag support.
- Critical means `slack == 0` (:19-20, :152).
- `durationDays = max(1, dayDiff)` (`GanttModels.swift:38-41`), so **milestones count as 1 day**.
- Tasks in a dependency cycle are never visited and are not reported as an error.

---

## 9. PVLayoutTab (`Features/Projects/Tabs/PVLayoutTab.swift`) + PVCanvasView (`UI/Components/PVCanvas/PVCanvasView.swift`)

| Control | Type | What it's for | Handler -> effect | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Tab load | `.task` | List saved layouts | `loadLayouts` :67-69, :517-529 | `pv_layouts` select `*` `.eq(project_id)` ordered by `created_at` desc | — | Errors `print`-only |
| Layout picker | Picker ("New Layout" + saved) | Open a layout | :150-161. `onChange` → `loadSelectedLayout` :531-551 | Reads `canvas_data` (iOS JSON) first. Otherwise converts web `roof_masks, pv_arrays, equipment, cables, plant_setup` (`Models/PVLayout.swift:131-237`) and the `pdf_data` base64 background (:240-248) | Hidden when there are no saved layouts | Decode failure falls through to the web conversion silently. **Selecting "New Layout" clears objects but not the floor plan. Loading an iOS layout keeps the previous floor plan image** |
| Floor Plan | Button → `.fileImporter` (`.png`, `.jpeg`) | Background image | :163-169, :70-74 → `loadFloorPlan` :579-592 | Local only. **Never uploaded or saved; `floor_plan_url` is never written** | Security-scoped guard :580 (silent return on false) | Import failure is ignored |
| Save | Button → alert with TextField | Save layout | :171-178, :75-82 → `saveLayout` :553-577 | **Always INSERT** `pv_layouts {project_id, name, canvas_data: JSON([PVCanvasObject])}` | Empty name returns silently :555 | Success text in the status bar. Errors `print`-only :575. **Re-saving an opened layout creates a duplicate row. Nothing updates the existing row** |
| Export Layout | Button | Share or save a PNG | `exportCanvasAsPNG` :180-186, :464-498. `ImageRenderer` 1200×800 @2× | macOS `NSSavePanel` + `try? write`. iOS `UIActivityViewController` presented from `connectedScenes.first`'s window root VC | — | **iOS: no `popoverPresentationController` anchor, which crashes UIActivityViewController on iPad** (compare ProposalTab.swift:642-646, which sets one). It also presents from the root VC, which fails silently if another sheet is up |
| Clear | Button (`.destructive`) | Wipe canvas | `clearCanvas` :188-194, :594-598 | In-memory; also clears the floor plan | **No confirmation** | — |
| Tool palette (9 tools) | Buttons | Select, Panel Array, Inverter, Combiner, Main Board, Meter, Cable, Text, Obstruction | `activeTool = tool` :208-225 (`PVCanvasView.swift:23-47`) | — | — | Quick stats: Panels, kWp, Objects :231-235 |
| Canvas tap (non-select tools) | `onTapGesture` | Place an object | `PVCanvasView.swift:111-118` converts screen to canvas coords, then `handleCanvasTap` :383-436 | In-memory | — | Tapping on top of an existing object likely hits that object's own tap gesture (`PVCanvasView.swift:79-83`) and places nothing (unverified) |
| Panel Array tool | Tap → sheet | Place an array | :385-388 (tap point stashed in `cableRoutePoints`). Sheet :90-138 | — | — | — |
| Array sheet › Rows / Columns / Panel Wattage | Steppers 1-20, 1-30, 100-700 step 50 | Array size | :94-96. Summary :100-101 | — | Clamped | — |
| Array sheet › Place / Cancel | Toolbar | Commit / abort | :110-134. Appends a `panelArray` with `width = cols × 40`, `height = rows × 25` and props `rows, cols, panel_wp` | — | — | — |
| Inverter / Combiner / Main Board / Meter tools | Tap | Place equipment | :389-396 → `PVCanvasObject.equipment` (40×40) | — | — | — |
| Cable tool | Taps | Draw a route | :397-418. Each tap after the first appends a 2-point segment object | — | — | **Points are not cleared when switching tools. Only "Finish Cable" (:337-347) clears them**, so the next cable starts from the old endpoint |
| Finish Cable | Button in the status bar (cable tool with ≥2 points) | End route | :338-341 | — | — | — |
| Text tool | Tap | Label | :419-425. Fixed text **"Label"** | — | — | **No way to edit the label text anywhere.** The properties panel has no text field |
| Obstruction tool | Tap | Mark a shading object | :426-432 (60×40) | — | — | — |
| Object tap (Select tool) | `onTapGesture` | Select | `PVCanvasView.swift:79-83` | — | — | Tapping empty canvas does not deselect |
| Canvas drag (Select tool) | `DragGesture` (simultaneous) | Pan | `PVCanvasView.swift:96-110` | — | — | **Objects cannot be moved.** Drag only pans the whole canvas |
| Pinch | `MagnificationGesture` | Zoom 0.3-3.0 | `PVCanvasView.swift:90-95`. **`scale = value` is not multiplied by the previous scale**, so each new pinch jumps back toward 1× | — | — | — |
| Properties › 0°/90°/180°/270° | Buttons | Rotate selected | :297-300 → `setRotation` :605-609 | — | — | No free rotation, resize or position editing |
| Properties › Delete | Button | Remove object | :308-314 → `deleteObject` :600-603 | — | — | — |

**Formulas and constants** (PV layout)
- Panels: `Σ rows × cols` over panel arrays. Missing properties default to 2 × 6 (:362-370).
- kWp: `Σ rows × cols × panel_wp / 1000`, with `panel_wp` defaulting to 550 (:372-381). The same per-array display is at :281-288.
- Web-imported arrays **always get `panel_wp: "550"`** (`PVLayout.swift:172`). Web `moduleConfigId` and `orientation` are ignored.
- **Cable length:** pixel distance only, `sqrt(dx² + dy²)` (:402-405), stored as the object's `width`. **There is no metres conversion and no length display.** `scale_pixels_per_meter` (default 50) is used only to size web walkways and cable trays (`PVLayout.swift:133, 216-229`).
- **Areas:** none. Roof-mask `area` is decoded (`PVLayout.swift:67`) but never shown or used, and no roof or array area is computed.
- **"Estimated Shading Loss" = `obstructionCount × 2 %`** (:452). This is a hardcoded heuristic that isn't fed into the simulation.
- The stored array width and height (cols × 40, rows × 25) do not match the rendered size of 14 × 10 pt cells (`PVCanvasView.swift:258-280`). Stored geometry is decorative.
- The Array sheet reuses `cableRoutePoints` as temporary tap storage (:388, :117). Cancel and Place clear it.
- `showExportSheet` (:17) is declared and never used.

**`pv_layouts` JSON written by iOS:** `canvas_data` is a string holding a JSON array of `PVCanvasObject {id, type (panelArray|inverter|combinerBox|mainBoard|meter|cableRoute|textLabel|obstruction|roofMask), x, y, width, height, rotation, label, properties: {String: String}}` (`PVLayout.swift:280-301`). Cable properties are `startX/startY/endX/endY` (+ `cableType` for web imports). Array properties are `rows/cols/panel_wp`. Web columns (`roof_masks`, `pv_arrays`, `equipment`, `cables`, `plant_setup`, `pdf_data`, `scale_pixels_per_meter`, `folder_id`, `simulation_id`) are read only. **A layout opened from the web and saved on iOS becomes a new, iOS-only row. The web app would need to understand `canvas_data` to see it (unverified).**

---

## 10. TOUClockDiagram (`UI/Components/TOUClockDiagram.swift`), view only

- Pure view with no controls. It draws 24 wedge segments coloured by `periods[hour]` (default `off_peak`) (:37-54), with labels every 3 h (:56-68). Colours: peak red 0.7, standard orange 0.6, off-peak green 0.5 (:70-77).
- `EskomTOUDefaults` (:86-129) is hardcoded:
  - High weekday: off-peak 0-5, peak 6-8, std 9-16, peak 17-18, std 19-21, off 22-23.
  - Low weekday: off 0-5, std 6, peak 7-9, std 10-17, peak 18-19, std 20-21, off 22-23.
  - High Saturday: off 0-6, std 7-19, off 20-23. Two adjacent standard loops `7..<12` and `12..<18` are redundant.
  - Weekend: all off-peak.
- These are not derived from `tariff_plans` or `eskom_tariff_rates`. As noted in §2, they conflict with LoadProfileTab's TOU band hours.

---

## 11. Persistence map (this scope)

| Store | Written by iOS | Read by iOS | Notes |
|---|---|---|---|
| Storage bucket `project-schematics` (`{projectId}/{file}`, `{base}_annotated.{ext}`) | SchematicsTab upload / annotate / delete | list + **public URL** download | No DB table. `upsert: true` |
| `scada_imports` | — | LoadProfileTab (`*`), SimulationTab (`load_profile_weekday`) | **Both reads have no project filter** |
| `project_tenants` | — | LoadProfileTab (unused result) | |
| `projects` | — | SolarForecastTab (lat/lon) | Lat/lon edits are not saved |
| Edge fns `solcast-forecast`, `pvgis-tmy` | — | SolarForecastTab | Results not persisted |
| `project_simulations` | SimulationTab INSERT (10 scalar columns; **no `results_json`**) | ProjectDetailViewModel list | One row per Run |
| `simulation_presets` | dead code only | dead code only | Never touched at runtime |
| `sandbox_simulations` | dead code only | dead code only | SandboxTab unreachable |
| `proposals` | INSERT/UPDATE `title, sections, status, share_token, updated_at, version=1` | list | `pdf_url` is server-set only. Section text not stored |
| Edge fn `generate-pdf` | — | Proposal (`type: proposal`) and Monthly (`type: monthly_report`) | Returns `pdf_url` (decoded camelCase) |
| Edge fn `generate-proposal-narrative` | — | dead code | Key mismatch too |
| `report_analytics` | dead code | — | |
| `organization_branding` | — | local PDF fallback, `limit(1)`, no org filter | |
| `generation_records`, `generation_daily_records`, `report_configs` | — | MonthlyReportTab | |
| `gantt_tasks` | INSERT (add, template), UPDATE `assignee`, DELETE | list | `assigned_to` vs `assignee` mismatch |
| `gantt_dependencies` | INSERT (template only) | list | |
| `gantt_baselines`, `gantt_baseline_tasks` | INSERT on Save Baseline | **never** | Baseline lost on relaunch |
| `gantt_task_segments` | — | dead code | |
| `pv_layouts` | INSERT `project_id, name, canvas_data` | list + web columns | Always inserts; floor plan not saved |

---

## 12. Mobile-specific capabilities in scope

- **Touch canvas:** PVCanvasView supports tap placement, pinch zoom (non-cumulative) and one-finger pan in Select mode. It has no object drag, no resize and no free rotation.
- **Gantt:** swipe-to-delete in the sidebar; bar tap opens details. No bar dragging.
- **Schematic annotation:** tap-only pin and marker placement. **No PencilKit anywhere in scope** (no `PKCanvasView` import), no freehand drawing, and no zoom inside the editor. Saved output is the unmodified original (§1).
- **Camera:** none. No `UIImagePickerController` or `PhotosPicker` in scope. Schematics and floor plans come only from the Files importer.
- **File import + security-scoped access:** `.fileImporter` in SchematicsTab (pdf/png/jpeg/svg, multiple selection) and PVLayoutTab (png/jpeg). Both call `startAccessingSecurityScopedResource()` with `defer stop…` (SchematicsTab.swift:422-423; PVLayoutTab.swift:580-581) and silently abort on false.
- **Share sheet:**
  - LoadProfile CSV via a wrapped `UIActivityViewController` in `.sheet` (LoadProfileTab.swift:112-116, 732-740).
  - Proposal PDF via a presented `UIActivityViewController` with an iPad popover anchor (ProposalTab.swift:617-648).
  - PV layout PNG via a presented `UIActivityViewController` **without** a popover anchor, which likely crashes on iPad (PVLayoutTab.swift:491-496).
  - Monthly report PDF has **no** share path.
- **Clipboard:** the proposal link goes to `UIPasteboard` / `NSPasteboard` (ProposalTab.swift:157-163).
- **Keyboard:** `.decimalPad` on numeric fields (Simulation, Sandbox, Solar Forecast, Load Profile settings).
- **Layout risk on iPhone (unverified):** fixed widths (PV palette 70 + properties 200 pt; Gantt sidebar 260 pt) and single-row toolbars with 6-8 controls (GanttTab.swift:21-89, PVLayoutTab.swift:143-195, MonthlyReportTab.swift:13-53) are desktop-shaped and will crowd or overflow on a 375-pt screen.

---

## 13. Security notes

1. **Unscoped meter reads.** `scada_imports` is queried with no project or site filter in both SimulationTab.swift:750-754 and LoadProfileTab.swift:789-794. Correctness and isolation then rest entirely on RLS (unverified). At best this is the wrong data; at worst it reads other clients' meters if RLS is org-wide or lax.
2. **Schematics are served by public URL** (`getPublicURL`, SchematicsTab.swift:454-458, fetched without auth at :463). This only works if `project-schematics` is a **public** bucket (unverified). If it is, anyone holding `…/project-schematics/{projectUUID}/{filename}` can read client electrical drawings with no expiry. If it is private, thumbnails, preview and annotation silently fail. Upload uses `upsert: true`, so any user with write access can silently overwrite another user's file of the same name. Delete has no confirmation.
3. **Proposal share link:**
   - The token is `UUID().uuidString`, which is random enough, but it has no expiry, is rotated on every press, and is stored in plaintext in `proposals.share_token`.
   - The link is built on the **Supabase API host** (`Constants.Supabase.url + "/portal/" + token`, ProposalTab.swift:157). The app's deep-link handler parses `…/portal/{token}` (`WM_SolarApp.swift:48-53`), but a client without the app would open a Supabase API URL, which is likely not a web page (unverified).
   - Whether anon can read a proposal by token is an RLS question (unverified).
4. **PDF URLs are fetched without auth** (`PDFGenerationService.swift:59, 83`; ProposalTab.swift:574; MonthlyReportTab.swift:521). The server must return public or signed URLs. If they are public and unexpiring, client proposals and reports are world-readable by URL (unverified).
5. **Branding fetch has no org filter** (`organization_branding`, `limit(1)`, PDFGenerationService.swift:30-35). In a multi-org database the fallback PDF could carry another organisation's name, unless RLS restricts it (unverified).
6. **Writes keyed by `id` alone:** proposal status/title updates, Gantt delete/update and share-token updates filter only on `id` (ProposalTab.swift:451, 539, 559; GanttTab.swift:615, 632). Authorisation depends on RLS (unverified).
7. **Error handling hides failures:** most writes are `print`-only (Schematics, Gantt, PV layout save, proposal status, the simulation fetch). SimulationTab's save error is stored but never shown. Users get no signal that data was not saved.
8. **Denial of service on device:** Sandbox sweep with `step <= 0` loops forever on the main actor (SandboxTab.swift:453-471). This is currently unreachable because the tab isn't mounted.
9. **Hardcoded values presented as results:**
   - R2.50/kWh appears in three places in scope (FinancialEngine K2, `annual_grid_cost` at SimulationTab.swift:866, monthly savings at MonthlyReportTab.swift:414).
   - R6.50/kWh generator cost.
   - 1.06 kg CO₂/kWh.
   - Random daily generation.
   - The constant ~907.5 kWh/kWp "specific yield".
   - 2%-per-obstruction shading.

   These are likely to reach clients through PDFs (the monthly local fallback prints savings and CO₂, MonthlyReportTab.swift:495-501). This is a professional-liability issue rather than a security one.


---

<!-- Part 3D: merged from ios-parts/D-loadprofiles-calculations.md -->

# Part D — Load Profiles + Calculations (iOS/macOS SwiftUI)

Root: `/Volumes/Extreme SSD/DEVELOPER/APPS/WM Solar/WM Solar/`. Paths below are relative to it.
Abbreviations: LPV = `Features/LoadProfiles/LoadProfilesView.swift`, LPVM = `LoadProfilesViewModel.swift`, CSV = `CSVImportView.swift`, BULK = `BulkCSVImportView.swift`, TEN = `TenantScheduleImportView.swift`, SDV = `SiteDetailView.swift`, CSV-S = `CreateSiteView.swift`, CV = `Features/Calculations/CalculationsView.swift`, CVM = `CalculationsViewModel.swift`, SITE = `Models/Site.swift`, TP = `Models/TariffPlan.swift`.
Every line was read. Nothing was built or run. "unverified" marks runtime behaviour I could not prove from the source alone.

**Platform context (it matters for several findings):** the target's `SUPPORTED_PLATFORMS` is `"iphoneos iphonesimulator macosx xros xrsimulator"` with `SDKROOT = auto` (from project.pbxproj), so native macOS is a declared destination. SDV uses `EditMode`, `@Environment(\.editMode)` and `.listStyle(.insetGrouped)` (SDV:21,118,195) with no `#if os(iOS)` guard and no shim anywhere in the app. Those APIs do not exist on macOS, so **the native-macOS build of SDV probably does not compile** (unverified, no build was run). On iOS, Load Profiles is reached through More → NavigationLink (ContentView.swift:222). On macOS it is the sidebar detail (ContentView.swift:156). Calculations is wrapped in a NavigationStack by the iOS TabView (ContentView.swift:130-131) and also opens its own NavigationStack (CV:9), so the stacks are nested on iOS.

---

## 1. Screen-by-screen control inventory

### 1.1 LoadProfilesView: shell (LPV:5-88)

| Control | Type | What it's for | Handler -> effect (file:line) | Data read/written | Validation / disabled | Error / empty states |
|---|---|---|---|---|---|---|
| Header "Load Profiles" + spinner | Text + ProgressView | Title; shows a spinner while loading | `vm.isLoading` (LPV:25-28) | — | — | — |
| View picker (Dashboard / Sites / Meter Library / Comparison) | Segmented Picker | Switch between the four tabs | `selectedTab` 0-3 (LPV:34-42); switch at LPV:53-59 | — | — | — |
| Screen load | `.task` | Load sites and meters | `vm.loadDashboard()` (LPV:63 -> LPVM:68-123) | SELECT `sites` ordered by name (LPVM:81-86). SELECT `scada_imports`: 9 columns, newest 5 (LPVM:94-100). SELECT `scada_imports`: 21 columns ordered by meter_label, no limit and no user/org filter (LPVM:107-112). It also reads the auth session only to `print` it (LPVM:73-74) | — | A sites error sets `errorMessage "Sites: …"` (LPVM:90). A recent-meters error is **print-only** (LPVM:103). A meters error sets the message only if none is set yet (LPVM:116-118). Each block's error is independent, so partial data can render |
| Meter detail sheet | `.sheet(item: $selectedMeter)` | Show one meter's profile | `MeterDetailView(meter:)` (LPV:64-74); Done sets nil (LPV:69) | see 1.6 | — | — |
| Create-site sheet | `.sheet(isPresented: $showCreateSite)` | Add a site | `CreateSiteView{…}` → reload + `selectedTab = 1` (LPV:75-81). The `newSite` parameter is unused | see 1.3 | — | — |
| CSV import sheet (new meter) | `.sheet(item: $csvImportSite)` | Import one meter CSV to a site | `CSVImportView(site:)` with no `existingMeter`, so it always INSERTs; onImported → reload + `selectedTab = 2` (LPV:82-87) | see 1.4 | — | — |
| Unused state | — | — | `showCSVImport`, `showTenantImport` (LPV:10,13) are never read | — | — | — |

### 1.2 Dashboard tab (LPV:92-289)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Error banner "Failed to load data" + **Retry** | HStack + Button | Retry the load | `vm.loadDashboard()` (LPV:96-118) | as 1.1 | Shown when `errorMessage != nil` | Shows `error.localizedDescription` |
| Loading block | ProgressView | First-load spinner | Shown when `isLoading && totalSites==0 && totalMeters==0` (LPV:121-130) | — | — | — |
| **Total Sites** card | DashboardCard (Button) | Count of sites and total m² | tap → `selectedTab = 1` (LPV:134-140). Area = Σ `sites.total_area_sqm` (LPVM:18) | in-memory | — | subtitle is nil when area is 0 |
| **Total Meters** card + "N with data / N listed only" | DashboardCard + caption | Meter count | tap → `selectedTab = 2` (LPV:143-172). "with data" = `hasData` (SITE:76-80: data_points>0 OR any weekday value>0) | in-memory | — | the with-data line is hidden when there are 0 meters |
| **Data Points** card | DashboardCard with a nil action | Σ `data_points` | Tap does nothing, although it is still a Button (LPV:175-181, 716-718) | in-memory | — | — |
| **Date Coverage** card | DashboardCard with a nil action | Earliest → latest date | min/max of the `date_range_start/end` strings (LPVM:26-39), formatted "MMM ''yy" (LPV:314-317, 683-690); days via ISO8601 | in-memory | — | "-" when no ranges |
| Recent Imports list | ForEach | 5 newest meters | display only (LPV:204-234) | `recentMeters` | — | "No meters imported yet" |
| Quick action **Browse Sites** | Button | — | `selectedTab = 1` (LPV:251) | — | — | — |
| Quick action **Import Tenant Schedule** | Button | Label says "Upload shop list for a site" | **Only switches to the Sites tab** (LPV:252). No import opens | — | — | UI claim ≠ action |
| Quick action **Meter Library** | Button | — | `selectedTab = 2` (LPV:253) | — | — | — |
| Quick action **Cross-Site Comparison** | Button | — | `selectedTab = 3` (LPV:254) | — | — | — |
| Empty state + **Go to Sites** | ContentUnavailable-style VStack + Button | First-run guidance | `selectedTab = 1` (LPV:263-285) | — | shown when no sites, no meters and no error | — |

### 1.3 Sites tab (LPV:321-481) and CreateSiteView (CSV-S)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| "N sites" + **Add Site** | Button | Create a site | `showCreateSite = true` (LPV:353-359) | — | — | — |
| Site row | List row Button | Open the site | `selectedSiteForDetail = site` → embedded `SiteDetailView` (LPV:377-378, 340-345) | — | — | "Loading sites…" (LPV:366-367); `ContentUnavailableView "No Sites"` (LPV:368-373) |
| Row: tenant-schedule icon | Button (plain) nested inside the row Button | Import a tenant list | `tenantImportSite = site` → `.sheet(item:)` TEN (LPV:439-449, 476-480) | see 1.7 | — | Nested buttons inside a List-row Button: whether the outer row also fires on iOS is **unverified** |
| Row: CSV import icon | Button (plain), nested | Import one meter CSV | `csvImportSite = site` → CSV sheet (LPV:451-461, 82-87) | see 1.4 | — | same nesting caveat |
| Row stats | Text | area, "N meters", "N active" | `vm.meterCount`, `metersWithDataCount` (LPVM:58-63) | in-memory | — | — |
| **All Sites** (back) | Button | Leave site detail | `selectedSiteForDetail = nil` (LPV:326-332) | — | — | — |
| No site **edit** or **delete** anywhere | — | — | — | — | — | Gap: a site created by mistake cannot be removed in-app |
| CreateSite: **Site Name \***, Site Type, Location, Total Area (m²), Latitude, Longitude | TextFields | Site metadata | bound state (CSV-S:25-37) | — | Only name non-blank (CSV-S:17-19). Area kept only if `Double(...) > 0` (CSV-S:93). Lat/Lon via `Double(...)` with **no range check** (CSV-S:96-101). "2,083" → nil and silently dropped. `siteType`/`location` are tested with `isEmpty` BEFORE trimming, so whitespace-only input inserts `""` (CSV-S:87-92) | — |
| **Create Site** | Button | Insert the site | `createSite()` → INSERT `sites` `.select().single()` (CSV-S:48-62, 78-118); then `onCreated` + dismiss | writes `sites` {name, site_type?, location?, total_area_sqm?, latitude?, longitude?}. `description` is never set. No owner/org column is written | disabled when invalid or loading (CSV-S:62) | inline red label with `localizedDescription` (CSV-S:39-45) |
| **Cancel** | Toolbar Button | Close | `dismiss()` (CSV-S:71) | — | — | — |

### 1.4 CSVImportView: single-meter wizard (CSV)

Entry points: the Sites-tab row icon (new meter, INSERT) and the SiteDetail swipe "Re-import" (`existingMeter`, UPDATE; SDV:69-73, 182-185).

| Step / Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Step indicator (File / Columns / Settings / Review) | view | Progress | CSV:95-135 | — | — | — |
| **Cancel** | Toolbar | Close | `dismiss()` (CSV:74-76) | — | — | — |
| **Choose CSV File** | Button | Pick a file | `selectFile()` (CSV:156-165, 184-196). macOS: `NSOpenPanel` [.commaSeparatedText, csv]. iOS: `showFilePicker` → `.fileImporter` (CSV:80-90) | — | — | — |
| File read | — | Load the text | `handleSelectedFile` (CSV:198-219): `String(contentsOf:, .utf8)`. **No `startAccessingSecurityScopedResource`** (lead's finding, confirmed at CSV:198-203), so on iOS a Files-provider URL can fail with "Failed to read file". UTF-8 only | local file | — | red label (CSV:173-177, 217) |
| Auto-mapping | — | Guess the columns | `autoDetectColumns` (CSV:265-299); unit guess `detectUnit(from:)` (CSV:301-312) | — | — | see §2 bugs |
| **Date Column \*** / **Time Column** / **Value Column \*** | Menu Pickers | Map the columns | CSV:329-360 | — | Next is disabled unless date and value are set (CSV:420) | — |
| Detected badges + preview table (8 rows) | Labels + table | Visual check | CSV:364-414 | — | — | Force-unwraps `headers[dateColumnIdx!]` (CSV:366-375). Safe while indices come from `headers`, but a second file with fewer columns and stale indices from the previous file (not reset in `handleSelectedFile`) could crash. Unverified in practice |
| **Back / Next** | Buttons | Navigate | `navigationButtons` (CSV:645-672) | — | Next disabled per step | — |
| Step 3: **Meter Label \***, Shop Name, Shop Number, Area (m²) | TextFields | Metadata | CSV:437-451 | — | Next requires a non-blank label (CSV:494). The Area field has no keyboard type; the value is used only if `Double > 0` (CSV:744) | — |
| Step 3: Site | LabeledContent | read-only | CSV:439-447 | — | — | — |
| Step 3: **Unit** | Picker (10 cases: Auto, kW, kWh, W, Wh, MW, MWh, kVA, kVAh, A) | Declare the value unit | `valueUnit` (CSV:455-459, 774-799) | — | — | — |
| Step 3: **Voltage (V)** | TextField(number) | Only for amps | shown when `valueUnit == .amps` (CSV:461-469); default 400 (CSV:28) | — | no validation (0 or negative accepted) | — |
| Step 3: **Negative Values** | Picker (Filter out / Absolute / Keep) | Negative handling | CSV:473-477 | — | — | — |
| Step 3: **Cumulative meter readings** | Toggle | Register-style data | CSV:479 | — | — | — |
| Step 3: info "N data rows detected" | Text | — | CSV:482-490 | — | — | — |
| Step 4: auto-process | `.task` | Build the profile | `processCSV()` → `CSVProcessor.process` off-main (CSV:623, 676-708) | none | — | "Failed to process CSV — check column mapping and data format" plus **Try Again** (→ step 3) (CSV:604-622, 703) |
| Step 4: result stats (Data Points, Interval, Peak, Average, Total Energy, Weekday/Weekend days, From, To) + LoadProfileChart | Grid + Chart | Review | CSV:514-578 | — | — | chart hidden when the weekday profile is all zero |
| Step 4: **Back** | Button | Back to settings | `step = .configure` (CSV:587-589). **`result` is not cleared**, so returning to Review shows the OLD result. Changes to unit, negatives, cumulative or columns are silently ignored unless processing failed first | — | — | **Bug** |
| Step 4: **Upload to Supabase** | Button | Save | `uploadToSupabase()` (CSV:591-599, 712-769): INSERT, or UPDATE `.eq("id", existing.id)` | writes `scada_imports` (§2.6) | disabled while processing | On failure `errorMessage` is set but **never rendered** in the result branch (it only renders in the file step, CSV:173, and in the no-result branch, CSV:606). **An upload failure is silent**; the spinner just stops |

### 1.5 BulkCSVImportView (BULK): entry is SiteDetail toolbar "Bulk Import CSVs" and the empty-state button (SDV:58-67, 129-131, 251-254)

| Step / Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Step bar (Files / Metadata / Columns / Configure / Import) | view | Progress | BULK:252-280 | — | — | — |
| **Cancel** | Toolbar | Close | `dismiss()` (BULK:234-236). An import Task already running is **not cancelled**; it was spawned unstructured in `advance()` (BULK:331) and keeps uploading. Unverified that it continues after dismiss, but nothing cancels it | — | — | — |
| **Select CSV Files** drop-zone | Button | Pick several files | `showFilePicker = true` (BULK:341). The `.fileImporter` exists **only under `#if os(iOS)`** (BULK:239-247) and there is no NSOpenPanel branch, so **on native macOS this button does nothing** (moot if macOS does not compile; see the platform note) | — | — | — |
| File load | — | Read the files | `addFiles` (BULK:624-659): **does** call `startAccessingSecurityScopedResource`; skips the file silently if it returns false (BULK:627). Dedupes by filename (BULK:631). Reads UTF-8, else ISO-Latin-1 (BULK:639-643); a failed read still adds the file with empty rows. Auto-detect only on the first file (BULK:655-657) | — | — | — |
| **Add More** / **Clear** / per-file ⓧ | Buttons | Manage the list | BULK:366-370, 963-965 | — | — | — |
| Filename convention guide | static | "SITE, SHOP#, SHOP NAME, AREA" | BULK:376-401; parser splits on `", "` (BULK:118-128) | — | — | The SITE token is parsed and shown (BULK:978) but **never used**. Rows always go to the site the sheet was opened from (BULK:848-849) |
| Step 2 Metadata row: **#**, **Shop name**, **m²** | TextFields | Edit the parsed metadata | `BulkMetadataRow` (BULK:971-1010) | — | ✓ icon needs name, number and area>0 (BULK:1007-1009). Footer warns "N missing details — you can continue" (BULK:433-441) | — |
| Swipe delete (Metadata list) | `.onDelete` | Remove a file | BULK:429 | — | — | — |
| Step 3 **Date / DateTime**, **Time (optional)**, **Value** | Menu Pickers | Map columns once for all files | `colPickerRow` (BULK:467-473, 523-547). Mapping comes from `files.first` headers; applied by INDEX to every file | — | Next requires date and value (BULK:318) | A file with a different layout is silently mis-parsed |
| Preview (first file, 4 rows) | table | — | BULK:476-510 | — | — | — |
| Step 4 **Value Unit** | Picker (Auto, kWh, kW, Wh, W, kVAh, kVA) | — | BULK:554-562, 7-46 | — | — | — |
| Step 4 **Negative Values** | Picker | — | BULK:566-570 | — | — | — |
| (no control) Cumulative | constant | — | `isCumulative = true` **hard-coded, no UI** (BULK:199), comment "billing class meters always record cumulative totals" | — | — | Interval data is always differenced (§2) |
| **Start Import** | Button | Run | `advance()` → `.importing` + `runBulkImport()` (BULK:300-310, 324-334, 674-699). Per file: process, then INSERT with 3 attempts and a 1.5 s back-off for any error (BULK:681-693) | writes `scada_imports` (§2.6) | always enabled (BULK:319) | per-file `.failed(localizedDescription)` (BULK:696, 1043-1045) |
| Import progress list + bar | List + ProgressView | Status | BULK:589-620, 1012-1054 | — | — | "N failed — see errors above" (BULK:611-618) |
| **Done (x / n)** | Button | Close + refresh | `onImported(); dismiss()` (BULK:293-298) | — | shown only when every file is terminal | — |
| **Back** | Button | — | hidden on step 1 and while importing (BULK:286-290) | — | — | — |

### 1.6 MeterDetailView (sheet; LPV:782-1177)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Header, Active badge, site/shop/area labels | Text | — | LPV:804-840 | `ScadaImport` passed in | — | — |
| Stat boxes (Data Points, Interval, Weekday Days, Weekend Days) | view | — | LPV:843-848 | — | — | "-" when nil |
| Coverage line | Text | — | LPV:850-863 | — | — | — |
| **Average Load Profile (24h)** chart | Swift Charts, `.allowsHitTesting(false)` | Weekday area/line, weekend dashed | `LoadProfileChart` (LPV:887-891, 1204-1251). There is no chart interaction | stored `load_profile_weekday/weekend` | — | `ContentUnavailableView "No Profile Data"` when the weekday profile is all zero (LPV:1048-1054) |
| **Daily Profile Explorer** "Show" | Toggle | Show one day | `showDailyView`; onChange(true) → `loadDailyProfile()` (LPV:903-906, 1045-1047) | — | — | — |
| ◀ / ▶ | Buttons | Step one day | `stepDate(by:)` clamped to `dateRange` (LPV:915-939, 1150-1154) | — | disabled at the range ends | — |
| Date picker | DatePicker(compact) in `dateRange` | Pick a day | onChange → `loadDailyProfile()` (LPV:926-928, 1042-1044) | — | range = meter date_range, else **last month..today** (LPV:791-798). The initial `selectedDate = Date()` (LPV:786) can sit outside the range | — |
| Weekday/Weekend capsule | Text | — | `isWeekend` = Sun/Sat (LPV:1156-1159) | — | — | — |
| Daily chart (green) + average (grey dashed) + "N kWh" + "±x%" | Chart + Text | Compare the day with the average | LPV:957-1025. **The % is always computed against the WEEKDAY average** (LPV:1017), even on weekends where the dashed line is the weekend average (LPV:961) | — | — | "No data for this date" (LPV:1026-1036) |
| Data load | async | Load readings | `loadDailyProfile()` (LPV:1078-1148): SELECT `scada_data(timestamp,value)` for `scada_import_id` between `"<d>T00:00:00"` and `< "<d>T23:59:59"` (the last second is excluded; strings carry no zone) | **`scada_data` is never written anywhere in the app** (only grep hit is LPV:1099), so this is effectively always empty. When empty: average profile × `Double.random(in: -0.08...0.08)` per hour (LPV:1108-1122), plotted as "Selected Day" in green with **no "modelled" label**, and different on every load. On error: the plain average, silently (LPV:1144-1147) | — | Fabricated data presented as measured |
| `onUpdate` parameter | — | — | **never invoked** (LPV:784) | — | — | — |
| Source file line | Text | — | LPV:1057-1066 | — | — | — |

### 1.7 SiteDetailView (SDV) + MeterRowView + MeterEditView

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` / `.refreshable` | Meters for the site | `loadMeters()` (SDV:55-56, 260-276): SELECT * `scada_imports` WHERE site_id ORDER created_at desc | read `scada_imports` | — | "Loading meters…" (SDV:37-39). **Any error** (load OR delete) replaces the whole list with `ContentUnavailableView "Error"` (SDV:40-42), because `errorMessage` is checked before `meters`. There is no retry button; pull-to-refresh on a non-scrolling ContentUnavailableView is unverified |
| Search | `.searchable` | Filter meters | label / shop name / shop number (SDV:26-33, 49) | — | — | — |
| EditButton (iOS) | Toolbar | Multi-select | SDV:126-128, 118 | — | — | — |
| **Bulk Import CSVs** | Toolbar Button | Open BULK | `showBulkImport = true` (SDV:129-131, 58-67) | — | — | — |
| ⋯ Menu → **Import Tenant Schedule** | Button | Open TEN | `showTenantImport = true` (SDV:133-135, 75-80) | — | — | — |
| ⋯ Menu → **Add Meter Manually** | Button | — | `showAddMeter = true` (SDV:136-138). **No sheet is bound to `showAddMeter`**, so this is a **dead button** | — | — | — |
| Summary badges (Meters, Total Area, Weekday Days = MAX over meters) | view | — | SDV:151-165 | — | — | "—" when area is 0 |
| Meter row tap | onTapGesture | Preview | `selectedMeter = meter` → MeterDetailView sheet with **Done** / **Edit** (SDV:172-175, 82-94) | — | ignored in edit mode | — |
| Swipe **Delete** | swipe | Delete a meter | `deleteTarget` + confirm dialog (SDV:177-180, 101-108) → `deleteMeter` DELETE `scada_imports` by id (SDV:278-290) | delete `scada_imports` | confirmation "permanently remove the meter profile and all its data" | error → full-screen Error view |
| Swipe **Re-import** | swipe | Replace the CSV data | `csvImportForMeter = meter` → CSV with `existingMeter` (UPDATE) (SDV:182-185, 69-73) | — | — | — |
| Swipe **Edit** / preview **Edit** | swipe / toolbar | Edit metadata | `editingMeter` → MeterEditView (SDV:187-190, 90, 96-100) | — | — | — |
| Edit-mode bar: **Select All / Deselect All**, **Delete (n)** | Buttons | Bulk delete | SDV:201-229 → confirm (SDV:109-117) → `deleteSelected` loops one DELETE per id (SDV:292-312) | delete `scada_imports` | disabled when nothing is selected | A mid-loop failure leaves earlier rows deleted, but the local list is not updated (removal happens only after the full loop, SDV:304), then the error view replaces the list |
| MeterEditView: Meter label, Shop name, Shop number, Floor area | TextFields | Metadata | SDV:403-414 | — | area via `Double(...)` | inline red text (SDV:415-417) |
| MeterEditView **Save** | Toolbar | Update | UPDATE `scada_imports` {meter_label, shop_name, shop_number, area_sqm} by id (SDV:426-429, 435-460) | write `scada_imports` | disabled while saving | The synthesized `Encodable` on the Optional fields uses `encodeIfPresent`, so a field cleared to blank (→ nil) is **omitted, not nulled**. The UI suggests clearing works; it does not (unverified at runtime; standard Swift behaviour). "2,083" area → nil, dropped |
| MeterEditView **Cancel** | Toolbar | — | SDV:424 | — | — | — |
| Unused state | — | — | `showCSVImport` (SDV:12) never used | — | — | — |

### 1.8 TenantScheduleImportView (TEN)

| Step / Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Step dots (File / Map Columns / Import) | view | — | TEN:38-44, 86-114 | — | — | — |
| **Cancel** | Toolbar | — | TEN:64-67 | — | — | — |
| **Choose File** | Button | Pick the tenant list | `selectFile()` (TEN:134-141, 160-177): macOS NSOpenPanel [csv, xlsx, xls]; iOS `.fileImporter` [csv, xlsx] (TEN:71-81) | — | — | — |
| File read | — | — | `handleSelectedFile` (TEN:179-197): **xlsx/xls are rejected** with "not yet supported natively", although the copy says "Upload a CSV or Excel file" (TEN:128) and the pickers offer Excel. UTF-8 only; **no security-scoped access** | local | — | red label (TEN:149-153) |
| Column pickers: **Shop Name \***, Shop Number, Meter Label, Area (m²), Meter Color, **Category/Type** | Pickers | Map columns | TEN:292-299, 379-391; auto-detect (TEN:243-279) | — | Import is disabled only when BOTH shop name and meter label are unmapped (TEN:373). The "\*" on Shop Name is not enforced | — |
| Detection badges, preview (10 rows) | view | — | TEN:302-350 | — | — | — |
| **Back** | Button | — | `step = 0` (TEN:357-359) | — | — | — |
| **Import Tenants** | Button | Create meter shells | `step = 2` + `importTenants()` (TEN:364-373, 457-549): builds one dict per row, INSERTs in chunks of 50 | writes `scada_imports` (§2.6) | skips rows with neither shop_name nor meter_label (TEN:517-519) | "No valid tenant rows found…" (TEN:524-527); a chunk error → "Import Failed" + **Try Again** (→ step 1) (TEN:435-449) |
| **Done** | Button | Close + refresh | `onImported(); dismiss()` (TEN:424-434) | — | — | "N tenant meters created" |

### 1.9 Meter Library tab (LPV:485-629)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Search field + ⓧ | TextField + Button | Filter | `vm.searchQuery` (LPV:492-500) → `filteredMeters` matches label / shop name / site name, **not shop number** (LPVM:41-55), unlike SDV search | in-memory | — | "No meters match '…'" (LPV:530-535) |
| **Site** picker | Picker | Filter by site | `vm.selectedSite` (LPV:507-513) | in-memory | — | — |
| Count | Text | — | LPV:517-523 | — | — | — |
| Meter row | Button | Open detail | `selectedMeter = meter` (LPV:539-541); sparkline when the weekday profile > 0 (LPV:610-613) | — | — | — |

### 1.10 Cross-Site Comparison tab (LPV:633-662, 1255-1297)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Site cards with sparkline | read-only | Compare sites | `SiteProfileCard.aggregateWeekday` = **arithmetic MEAN** of the 24-value weekday profiles of meters with data (LPV:1259-1267). This is the average meter, **not** the site total. Weekend ignored; meters whose profile length ≠ 24 dropped | in-memory | — | "Need More Sites" when fewer than 2 sites have data (LPV:638-643) |
| No comparison controls | — | — | There is no chart overlay, selection or normalisation (e.g. per m²) | — | — | "Comparison" in name only |

---

## 2. CSV pipeline spec

### 2.1 Accepted file types and encodings

| | Single (CSV) | Bulk (BULK) | Tenant (TEN) |
|---|---|---|---|
| Picker types | macOS: `.commaSeparatedText`, `csv` (CSV:187). iOS: same (CSV:83) | iOS only: `.commaSeparatedText`, `csv` (BULK:242). **No macOS picker** | macOS: csv, xlsx, xls (TEN:163-168). iOS: csv, xlsx (TEN:74). Excel then rejected (TEN:180-184) |
| Multi-select | no | yes | no |
| Encoding | UTF-8 only (CSV:203) | UTF-8, then ISO-Latin-1 (BULK:639-643, 711-715) | UTF-8 only (TEN:190) |
| Security scope | **none** (CSV:198) | yes (BULK:627, 708) | **none** (TEN:179) |
| `sep=` line | skipped (CSV:226-228) | **not handled**: it becomes the header row | skipped (TEN:204-206) |
| Header | always line 1 | always row 1 | always line 1 |
| Quote handling | toggle on `"`; no `""` escapes; line-based, so quoted newlines break rows (CSV:247-263) | toggle on `"`; quoted newlines supported; `\r` dropped (BULK:888-910) | same as single (TEN:225-241) |
| Blank lines | filtered (CSV:223) | all-empty rows dropped (BULK:901, 908) | filtered (TEN:201-202) |

### 2.2 Delimiter detection
- **Single / Tenant:** counts `;` `,` `\t` over the first 5 lines joined. Tab if tab > comma AND tab > semicolon; else `;` if `;` > `,`; else `,` (CSV:237-245, TEN:215-223).
- **Bulk:** counts over the **first line only**. `;` if `;` > `,` AND `;` ≥ tab; else tab if tab > `,`; else `,` (BULK:878-886).

### 2.3 Date/time formats (all `en_US_POSIX`, device-local time zone, since no `timeZone` is set)

**Single: 18 formats in total** (CSV:857-864)
- 14 datetime: `yyyy-MM-dd HH:mm:ss`, `yyyy-MM-dd HH:mm`, `yyyy/MM/dd HH:mm:ss`, `yyyy/MM/dd HH:mm`, `dd/MM/yyyy HH:mm:ss`, `dd/MM/yyyy HH:mm`, `dd-MM-yyyy HH:mm:ss`, `dd-MM-yyyy HH:mm`, `MM/dd/yyyy HH:mm:ss`, `MM/dd/yyyy HH:mm`, `yyyy-MM-dd'T'HH:mm:ss`, `yyyy-MM-dd'T'HH:mm:ssZ`, `dd MMM yyyy HH:mm`, `d MMM yyyy HH:mm`
- 4 date-only: `yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`, `yyyy/MM/dd`
- The date-only formats are tried **only when no Time column is mapped** (`timeStr != nil ? dateFormats : dateFormats + dateOnlyFormats`, CSV:898). If a Time column is mapped but a row's time cell is empty, `combined = dateStr` is tried against the 14 datetime formats only and the row is dropped.
- Input = `"<date> <time>"` if the time is non-empty, else the date (CSV:890-895).

**Bulk: 17 formats** (BULK:914-932)
- The same 14 datetime formats (different order: `dd/MM` before `MM/dd`, then `yyyy/MM/dd`, `dd-MM-yyyy`, ISO, `MMM`)
- 3 date-only: `yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`. **No `yyyy/MM/dd`**, unlike single.
- Tries `combined`, then falls back to **`rawDate` alone** (BULK:764). **Hazard:** a time format the list does not cover (e.g. `00:30:00.000`, `0:30`, 12-hour `AM/PM`) makes every row parse as the date only, at **hour 0**, so the entire day's energy lands in the 00:00 bucket with no error.
- A new DateFormatter is allocated per row (BULK:935), which is slow on large files.

Both importers resolve ambiguous dates day-first (`dd/MM` is tried before `MM/dd`). Whether a partial match (e.g. `HH:mm` matching `HH:mm:ss` input) succeeds depends on DateFormatter strictness: **unverified**.

### 2.4 Column auto-detection
- **Single** (CSV:265-299): date contains any of `rdate, date, datetime, timestamp`; time contains `rtime, time` and not `date`; value contains `kwh, energy, consumption, reading, value, amount, usage, kw, power`. Fallback value column = the first column where ≥5 of the first 10 rows are numeric.
  - **Bug:** a single `Timestamp` header matches the date rule (`timestamp`) AND the time rule (contains `time`, not `date`), so it is mapped as both. The processor then parses `"<ts> <ts>"`, every row fails, and the user sees "Failed to process CSV" unless they set Time to None.
- **Bulk** (BULK:661-670): else-if chain per header. `date|timestamp` → date, else `time` without `date` → time, else a value pattern. Only the first file's headers are used.
- **Tenant** (TEN:243-279): substring rules. Hazards: `"no"` in shop-number patterns matches **"Notes"**, "Northing" and similar; `"name"` matches "Meter Name" or "Site Name" if they come first (and the "better match later" comment at TEN:256-258 is dead logic, because `shopNameCol` is set immediately); `"tenant"` matches "Tenant Type"; `"meter"` matches "Meter Color"; `"type"` matches any "…Type" column.

### 2.5 Values, units, interval, weekday rule, cumulative, negatives, outliers

| Aspect | Single (CSVProcessor) | Bulk (aggregate) | Tenant |
|---|---|---|---|
| Number cleaning | strip everything except `0-9 . e E -` (CSV:875). `"1,234.5"` → 1234.5 ✓. **Decimal comma** `"1234,5"` → `12345` (×10). Unparseable → row skipped | trim, then replace **`,` → `.`** (BULK:768). `"1,234.5"` → `"1.234.5"` → nil → **0.0** (the row is kept, not skipped). Blank cells also → 0.0 | area: strip everything except `0-9 .` (TEN:502). `"1 234,5"` → 12345 |
| Unit choices | Auto, kW, kWh, W, Wh, MW, MWh, kVA, kVAh, A | Auto, kWh, kW, Wh, W, kVAh, kVA (no MW/MWh/A) | n/a |
| Auto unit | View guesses from the header (CSV:301-312). If still Auto, the processor uses `detectUnitFromHeader`, default **kWh** (CSV:1095-1105). Stored `value_unit` = `"kWh"` when Auto (CSV:728) | `BulkValueUnit.detect` on the header with spaces removed, order kvah › kva › kwh › wh › kw › **w** › default kWh (BULK:36-45). **"Power" (no kW) → contains "w" → W → ÷1000.** **"kVArh" → contains "kva" → kVA** (reactive treated as apparent power, and as power, not energy). Single has the same kVArh→kVA issue (CSV:306/1099) | — |
| Conversion | kW/kWh/auto ×1; W/Wh ÷1000; MW/MWh ×1000; **kVA/kVAh as-is**; **A → √3·V·I/1000** at unity PF, V default 400 (CSV:1069-1077) | per hourly-average: kW/auto/kVA as-is; W ÷1000; kWh and kVAh ÷ (interval/60); Wh ÷1000 ÷ (interval/60) (BULK:24-33) | — |
| Profile maths | Power units (kW, W, MW, kVA, A): hourly mean of readings. Energy units: Σ(readings in hour-of-day bucket) ÷ number of distinct weekday (or weekend) **dates** (CSV:1008-1019). Partial days inflate the divisor, so the profile is under-stated | mean of (differenced) readings per hour bucket, then `toKW` (BULK:814-820) | — |
| Interval detection | sort all parsed timestamps; mode of gaps in minutes (1-240) over the first 200 sorted gaps; snapped to [1,5,10,15,30,60,120,180,240]; default 60 (CSV:1079-1093) | **difference between the first two parsed rows only** (file order, `abs`), integer minutes, no snapping; default **30** (BULK:807-811). The comment says "first 3" | — |
| Weekday/weekend | `Calendar.current` weekday 1 (Sun) or 7 (Sat) = weekend (CSV:914). Device time zone. No public holidays | same (BULK:779-780) | — |
| Cumulative | Manual toggle, or auto-detect when >100 rows: if p95/median > 50 → "not cumulative, outliers" (print only); else if max/median > 100 AND >85% of the first 500 steps are non-decreasing → cumulative (CSV:924-950). Diff = `v[i]-v[i-1]`, kept only if `0 ≤ diff < 0.5·v[i]` (CSV:954-964). First row dropped; resets and small registers dropped. File order assumed, no sort | **Always on** (BULK:199). First row seeds `prev`; `energy = max(0, v − prev)` (BULK:789-799). **Interaction with the 0.0 parse fallback:** a blank or thousands-separated cell becomes 0, then the next row's diff = the full register value. One interval can carry the entire meter total, which corrupts the hour bucket (spike). Genuine interval data (non-cumulative) is differenced into nonsense with no way to switch it off |
| Negatives | filter / abs / keep applied to the RAW value **before** unit conversion and before cumulative differencing (CSV:879-884) | same order (BULK:771-776). Filter = `continue`, but `parsedCount` was already incremented (BULK:765), so `data_points` counts filtered rows | — |
| Outliers | Non-cumulative only: IQR with `q1 = sorted[n/4]`, `q3 = sorted[3n/4]`, **upper fence = q3 + 6·IQR**, no lower fence; applied if fence > 0 (CSV:965-981). Filtered count is **print-only** | **none** | — |
| Peak / avg / total shown | peak = max of the **weekday** profile only; avg = mean of the 48 hourly values (unweighted); total = Σ values × interval/60 for power, Σ values for energy (CSV:1025-1041). **None of these are stored** | peak = max(weekday+weekend profile); **total = (Σ wd kW × wdDays + Σ we kW × weDays) × interval/60** (BULK:826-827). A Σ-over-24-hours kW value is already kWh/day, so the extra `× interval/60` under-states by that factor (×0.5 at 30-min, ×0.25 at 15-min). Shown in the progress row (BULK:1041); **not stored** | — |
| `data_points` | rows surviving parse, negatives, cumulative and outlier filtering (CSV:1062) | rows whose date parsed, including negative-filtered rows and the cumulative seed row (BULK:765, 834) | — |

### 2.6 Exact `scada_imports` columns written

| Path | Columns | Insert vs update |
|---|---|---|
| Single, new (CSV:718-760) | `site_id, site_name, meter_label, load_profile_weekday, load_profile_weekend, weekday_days, weekend_days, data_points, detected_interval_minutes, value_unit, file_name` + conditional `date_range_start, date_range_end, shop_name, shop_number, area_sqm` | INSERT |
| Single, re-import (CSV:748-754) | same dict | UPDATE `.eq("id", existing.id)`. Conditional keys that are blank are **omitted**, so old shop name, number and area persist and cannot be cleared by re-import |
| Bulk (BULK:80-97, 846-869) | `site_id, site_name, meter_label (shop name or filename), load_profile_weekday, load_profile_weekend, weekday_days, weekend_days, data_points, detected_interval_minutes, value_unit (detected unit raw value), file_name, shop_name?, shop_number?, area_sqm?, date_range_start?, date_range_end?`. Optionals are nil-omitted | INSERT only, one row per file, 3 attempts |
| Tenant (TEN:466-515) | `site_id, site_name` + conditional `shop_name, shop_number, meter_label (mapped column, else shop name when the Meter Label column is **unmapped**; an empty mapped cell gets no fallback, TEN:488-498), area_sqm, meter_color` (raw string, no hex validation). **`category` mapped at TEN:26/298 is never written** | INSERT, batches of 50. Rows have **different key sets**; PostgREST bulk insert expects uniform keys (PGRST102 "All object keys must match"), so any batch mixing present and absent optional columns can fail. Chunks inserted before a failure stay committed; **Try Again re-inserts every row → duplicates** |
| MeterEditView (SDV:438-453) | `meter_label, shop_name, shop_number, area_sqm` | UPDATE by id |
| Never written by any path | `processed_at`, `category_id`, peak/total energy, owner/user/org id. `scada_data` is never written at all | — |

**Duplicates:** there is no de-duplication against existing rows anywhere. Bulk dedupes only by filename within one session (BULK:631). The TEN header comment "so that meter CSV data can later be matched to these entries" (TEN:5-7) is **not implemented**: Bulk and the Sites-row CSV import always create NEW rows. Only the per-meter swipe "Re-import" updates a tenant shell. A tenant schedule plus a bulk import of the same shops yields two meters per shop, one "listed only" and one "with data".

---

## 3. Calculations screen

### 3.1 Controls (CV)

| Control | Type | What it's for | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Section tabs: Setup / Results / Charts / Cash Flow / Carbon / Settings | Capsule Buttons | Navigate | `activeSection` (CV:12-24, 54-69) | — | — | — |
| Screen load | `.task` | Load reference data | `loadProvinces`, `loadMunicipalities` (whole table), `loadEskomDistinctNames` in parallel, then `recalculate()` (CV:44-50; CVM:637-663, 705-737) | SELECT `provinces`, `municipalities`, `eskom_tariff_plans` (by supply_context + category) | — | errors set `vm.errorMessage`, which is **never displayed** in CV (print only). Everything fails silently |
| Source **Eskom / Municipal** | Segmented Picker | Choose the tariff source | onChange: clears `eskomRates` AND `tariffRates`, `recalculate()` (CV:87-98). **Selections are not cleared**: switching back shows the old plan chips with no rates. Eskom → R2.50 fallback. Municipal with `selectedTariff` still set → **basic 0 + no energy rows → bill R0 → savings R0** (CVM:411 falls back only when `selectedTariff == nil`) | — | — | Silent wrong numbers |
| Eskom **Supply Context** (Direct NLA / Municipal) | Picker | — | resets name/plan/rates, reloads names (CV:117-126). **No recalculate**, so results keep the old tariff until an input moves | `eskom_tariff_plans` | — | — |
| Eskom **Customer Category** (6) | Picker | — | same (CV:130-140) | same | — | — |
| Eskom **Tariff Name** | Picker | — | resets plan/rates; auto-selects if exactly one variant, then `loadEskomRates()` (CV:147-162) | — | — | Stale results when cleared (no recalc) |
| Eskom **Variant** | Picker (shown if >1) | — | `loadEskomRates()` (CV:165-181; CVM:744-790 with sibling-plan fallback) | `eskom_tariff_rates`, `eskom_tariff_plans` | — | — |
| Plan chips (structure, supply, voltage, zone) | Text | — | CV:184-193 | — | — | — |
| "Loading tariffs…" | ProgressView | — | shown only in the Eskom block (CV:195-200); municipal loading has no indicator | — | — | — |
| Eskom Rate Summary (first 10) | list | — | CV:209-239 | — | — | — |
| Municipal **Province** | Picker | — | clears municipality/tariff/plans/rates (CV:258-267). No recalc | — | — | — |
| Municipal **Municipality** | Picker | — | clears, then `loadTariffs()` (CV:271-280; CVM:665-686) | `tariff_plans` by municipality_id (+ category) | — | — |
| Municipal **User Type** (All + 6 hard-coded: Domestic, Commercial, Industrial, Agricultural, Domestic Indigent, Bulk Reseller) | Picker | Filter plans | reload tariffs (CV:287-295; CVM:189, 674-676). Whether these strings match DB `category` values is **unverified** | — | — | — |
| Municipal **Tariff Plan** | Picker | — | `loadRates()` → `recalculate()` (CV:299-306; CVM:688-701) | `tariff_rates` by tariff_plan_id | — | — |
| Plan chips / Rate Summary (first 8) | view | — | CV:310-351 | — | — | — |
| **Monthly Consumption** | Slider 100-100 000 step 100 kWh | — | `monthlyConsumption` → auto-recalc (CVM:196-201, 200 ms debounce) | — | — | — |
| **Max Demand** | Slider 0-2000 step 5 "kVA" | — | `maxDemand` → recalc | — | — | Used as kVA for Eskom and multiplied by the municipal `demand` rate regardless of that rate's unit |
| **Solar System Size** | Slider 0-2000 step 1 kWp | — | recalc | — | — | — |
| **Battery Storage** | Slider 0-2000 step 5 kWh | — | recalc | — | — | **Adds cost only** (CVM:222, 294-296). There is no savings, arbitrage or demand-shaving benefit, so a battery always worsens payback |
| (no control) `batteryPowerKw` = 25 | — | — | never used (CVM:176) | — | — | — |
| Quick results (Monthly Savings; Current Bill; New Bill; Payback; Annual Gen; Grid Dep.; System Cost) | KPIs | — | CV:372-399 | — | — | — |
| Results: NPV, IRR (green if > discount rate), ROI, LCOE, Payback ("Simple Payback Period"), Lifetime Savings ("20-Year Net Cash Flow") | KPIs | — | CV:403-423 | — | — | "Simple payback" is mislabelled: it is computed from escalated cumulative cash flow (CVM:314-318) |
| Cost breakdown | rows | — | CV:430-451 | — | — | — |
| Eskom / Municipal rate detail tables | tables | — | CV:454-528 | — | — | — |
| Charts: 24-h load vs solar; before/after bar; Solar Coverage / Annual Savings / CO₂; generation by year | Swift Charts (no interaction) | — | CV:534-641 | — | — | — |
| Cash-flow chart + table | Chart + rows | — | CV:645-741 | — | — | — |
| Carbon KPIs + "South Africa Context" | view | — | CV:745-799. Prose hard-codes **"0.95 kg"** (CV:771) even if the user edits the factor | — | — | — |
| Settings rows (TextField, number) | TextFields | Edit defaults | `settingsRow` → onChange → `recalculate()` (CV:967-984) | in-memory only, **nothing persisted**; lost on leaving the screen | no range validation | — |
| **Reset All to Defaults** | Button | — | `vm.defaults = CalculationDefaults(); recalculate()` (CV:870-878) | — | — | — |

Calculations writes nothing to any table, bucket or edge function. It only reads `provinces`, `municipalities`, `tariff_plans`, `tariff_rates`, `eskom_tariff_plans`, `eskom_tariff_rates`.

### 3.2 Formulas (CVM `recalculate`, CVM:216-347)

- **Cost:** solar = kWp × `solarCostPerKwp` (12 000); battery = kWh × 8 000; fees / PM / contingency = subtotal × 5% / 3% / 5%; total = subtotal × 1.13 (CVM:221-227). **VAT (15%) is not applied** anywhere.
- **PR** (`calculatePerformanceRatio`, CVM:351-373): the product of (1 − loss/100) over 13 losses × (1 − moduleQuality/100). With defaults: Π over [0.93, 2.57, 3.00, 1.05, 0.23, 0.42, 4.92, 2.00, 3.40, 1.06, 1.53, 1.04, 2.07] = 0.782237, × 1.0075 = **PR = 0.78810 (78.8%)**. `pvsystPerformanceRatio` (CVM:68-84), shown in Settings, gives the same value (the "double-counted … fix" comment is misleading but the arithmetic matches).
- **Generation:** `ghiPerKwp = PSH × 365` = 2007.5; specific yield = 2007.5 × 0.78810 = **1582.1 kWh/kWp/yr**; year 1 = kWp × 1582.1 × (1 − 2%) = 1550.5 kWh/kWp (CVM:230-233). Year n>1: × (1−0.5%)^(n−1) × 0.98 (CVM:267-274).
- **Self-consumption:** `solarUsed = min(gen, 0.85 × annualConsumption)`; grid = consumption − solarUsed; there is no export value; self-consumption % = used/gen; grid dependency % = grid/consumption (CVM:236-240).
- **Bills:** current = bill(monthly kWh); new = bill(grid/12). **The same `maxDemand` is used in both**, so demand and fixed charges never save (CVM:243-247).
- **Municipal bill** (CVM:410-459): none selected → kWh × **R2.50**. basic = `first("basic").amount` taken as a monthly Rand amount whatever its unit (the lead's finding). + maxDemand × first `demand` amount. + first `network_access` amount (flat). Energy: IBT (`inclining_block`/`ibt`): walk blocks sorted by min with `size = max − min`; a block with nil amount is skipped without consuming kWh. TOU (`time_of_use`/`tou`): consumption × (0.25 peak + 0.42 standard + 0.33 off-peak); standard falls back to peak, off-peak falls back to 0. Otherwise flat = first energy rate. **No c→R conversion**, although `TariffRate.formattedAmount` recognises `c/kWh` units (TP:241-250). A municipal rate stored in c/kWh would be billed 100× too high (unverified whether any rows are stored in cents).
- **Eskom bill** (CVM:461-603): no plan or no rates → R2.50/kWh. Service/admin: unit contains "day" → ×30, else flat. Ancillary: day ×30, `c/kWh` → /100 × kWh, else flat. `network_demand` and `network_capacity`: unit contains "kVA" → × maxDemand, **else added as a flat Rand amount**, so a c/kWh network charge would be added as e.g. "R20.52/month" (unverified which units exist in the data). Generation capacity: only kVA units. Env levy: c/kWh only. Energy: IBT walk, or TOU (3/12 high + 9/12 low season, each 25/42/33), or seasonal 3/12 : 9/12, or flat. `rateInRands` divides by 100 only when the unit starts with "c/". Any other charge type is silently ignored.
- **Cash flow** (CVM:250-311): year-0 = −capex. Year n: savings = year-1 savings × (1+10%)^(n−1). **Savings are NOT reduced for panel degradation** (generation is, CVM:274, but it never feeds savings). O&M = **1.5% of capex, hard-coded** (CVM:252), not a setting. Insurance = capex × 1%; both × CPI^(n−1). Replacement once in `replacementYear` (10): solarCost × 45% × (70% × 10% + 30% × 50%) + battery × 30%, × CPI factor.
- **Payback:** the first year with cumulative ≥ 0, interpolated; else capex / year-1 savings (CVM:314-321).
- **NPV:** −capex + Σ net_n / (1.09)^n (CVM:324-327).
- **IRR:** Newton-Raphson from 10%, 100 iterations, no bracketing; returns the last iterate even when it did not converge (CVM:377-399).
- **ROI:** year-1 savings / capex × 100 (CVM:333). This is a simple annual yield, not ROI.
- **LCOE:** capex / lifetime kWh (CVM:336). No O&M, no discounting.
- **Carbon:** kg = gen × 0.95 × (1 + 8%); t = kg/1000; lifetime = annual × 20 × **0.9 (hard-coded)**; trees = kg/22; cars = kg/4600; credits = t × R190 (CVM:339-344).
- **Recalc triggers:** the 4 sliders (Combine), settings rows, source switch, loadRates, loadEskomRates, Reset. **Not triggered** by clearing a province, municipality, category, Eskom name or context, so stale results show until something else changes.

Worked default (no tariff chosen): 50 kWp → gen 77 524 kWh; consumption 60 000 → used 51 000 (85% cap); grid 9 000 → grid dependency 15%; bills R12 500 → R1 875; saving R10 625/month.

### 3.3 CalculationDefaults: editable vs not

- **Editable in Settings and used:** solarCostPerKwp, batteryCostPerKwh, peakSunHours, nearShading, IAM, soiling, temperature, moduleQuality, LID, mismatch, ohmic, inverterEff, inverterClipping, availability, annualPanelDegradation, firstYearDegradation, discountRate, tariffEscalation, cpiInflation, insuranceRatePercent, equipment%, moduleShare, inverterShare, moduleReplace, inverterReplace, batteryReplace, professionalFees, projectMgmt, contingency, gridEmissionFactor, transmissionLoss, carbonTax, kgCO₂/tree, kgCO₂/car (CV:805-868).
- **Editable but UNUSED by any formula (the fields do nothing):** dcAcRatio (1.2), systemLosses (14%), annualBatteryDegradation (3%), batteryEolCapacity (70%), vatRate (15%), recPricePerMwh (150).
- **Used but NOT editable:** spectralLoss 1.05, electricalShadingLoss 0.23, irradianceLevelLoss 0.42 (all three are inside the PR product), projectLifetimeYears 20, replacementYear 10; plus hard-coded constants outside the struct: 0.85 self-consumption cap, 25/42/33 TOU split, 3/9 season months, 30 days/month, R2.50 fallback, 1.5% O&M, 0.9 lifetime-carbon factor.
- **Neither editable nor used:** financeRate 9, reinvestmentRate 8.

### 3.4 Chart profiles
- `hourlyConsumptionProfile` (CVM:607-619): base = monthly/30/24 × fixed shape (0.4 night, 0.8→1.1 at 06-07, 1.4 for 08-16, 1.1 for 17-19, 0.5 for 20-23). The factors sum to **22.2**, so the chart shows 92.5% of the average daily consumption.
- `hourlySolarProfile` (CVM:621-633): peak = kWp × PR × shape. The factors sum to **9.13**, so the chart implies ~9.1 kWh/kWp/day against the engine's 5.5 PSH (+66%). The curve **jumps back to 1.0 at 15:00** (the `15..<19` branch gives (19−15)×0.25 = 1.0).
- **Neither feeds any number.** They are used only in the Charts tab (CV:541-560). Neither uses imported `scada_imports` load profiles; the Calculations screen has no link to Load Profiles data at all.

---

## 4. Flags (stubs, dead controls, fabricated data, silent errors, UI claims vs code)

1. **Fabricated daily profile:** a random ±8% day is shown as "Selected Day" (LPV:1108-1122). `scada_data` is never written (grep: LPV:1099 is the only reference), so this path is the norm, not the fallback.
2. **Dead:** SiteDetail "Add Meter Manually" (SDV:136-138, no sheet). Dashboard "Data Points" and "Date Coverage" cards are Buttons with no action (LPV:175-189). "Import Tenant Schedule" quick action only switches tab (LPV:252). BULK file picker on native macOS (BULK:239-247). `MeterDetailView.onUpdate` never called (LPV:784).
3. **Unused state:** LPV `showCSVImport`, `showTenantImport`; SDV `showCSVImport`; CVM `batteryPowerKw`; LPVM `assignedMeters`, `unassignedMeters`, `metersListedOnlyCount`, `loadMetersForSite` (no caller found in scope; unverified app-wide).
4. **Silent errors:** CSV upload failure never shown (CSV:765-766 vs render sites CSV:173/606). All Calculations load errors (`errorMessage` never rendered). Recent-meters load (LPVM:103). Outlier and cumulative decisions are print-only (CSV:937, 947, 978). Daily-profile query errors fall back to the average (LPV:1144-1147). Bulk skips files whose security-scope call fails (BULK:627).
5. **Stale result after Back** in CSV review (CSV:587): settings changes ignored.
6. **Bulk forces cumulative differencing** (BULK:199) with no toggle. Combined with the `","→"."` → 0.0 fallback (BULK:768), this produces register-size spikes.
7. **Bulk kWh total wrong** by a factor of interval/60 (BULK:826-827). Bulk interval taken from rows 1-2 only (BULK:807-811). Bulk hour-0 collapse when the time format is unsupported (BULK:764).
8. **Single "Timestamp" header auto-mapped to both Date and Time** (CSV:272-277) → "Failed to process".
9. **Unit mis-detection:** "kVArh" → kVA (both importers); Bulk "Power" → W ÷1000 (BULK:43). kVA/kVAh stored as if kW (CSV:1074, BULK:30-31). Amps at unity PF (CSV:1075).
10. **Decimal-comma locales:** single ×10 error (CSV:875); tenant area ×10 (TEN:502); bulk → 0 (BULK:768).
11. **Tenant import:** Category never written (TEN:26, 298 vs 466-515). Heterogeneous batch keys (TEN:463-539). Excel offered then refused (TEN:74, 128, 163-168 vs 180-184). A partial failure plus Try Again duplicates rows. The promised "later matching" is not implemented (TEN:5-7).
12. **Security-scope missing** in single and tenant importers (CSV:198, TEN:179).
13. **MeterEditView cannot clear fields** (nil omitted by synthesized Encodable, SDV:438-451). The same applies to CSV re-import for shop and area (CSV:738-746).
14. **Daily % always vs weekday average** (LPV:1017). The query window excludes 23:59:59 and has no time zone (LPV:1102-1103).
15. **Cross-site "comparison"** plots the mean meter, not the site total (LPV:1259-1267).
16. **Calculations mismatches:** battery adds cost with no benefit; savings not degraded; "Simple Payback" is not simple; "ROI" is a year-1 yield; 6 editable settings do nothing; 3 PR losses in use cannot be edited; the carbon prose hard-codes 0.95; a municipal tariff selected with no rates gives R0 bills after a source switch; no c→R conversion for municipal rates; Eskom non-kVA network charges added as flat Rand; no recalc when a selection is cleared; the chart solar curve implies ~9.1 PSH and has a 15:00 discontinuity; defaults are not persisted.
17. **macOS build of SDV likely broken** (`EditMode` / `.insetGrouped` without guards, SDV:21, 118, 195). Unverified: no build was run.
18. **Hard-coded values:** R2.50/kWh fallback (CVM:411, 462); 400 V default (CSV:28); 30-min Bulk default interval (BULK:807); 60-min single default (CSV:1080).

---

## 5. Security

- **No ownership columns are written, and no client-side ownership checks exist.** `sites` INSERT (CSV-S:103-109) and every `scada_imports` INSERT, UPDATE and DELETE (CSV:750-760; BULK:865-868; TEN:536-539; SDV:280-284, 298-302, 444-453) write or act by `id` or `site_id` only. There is no user_id, org_id or created_by, and no check that the caller owns the site or meter. Any signed-in user who can open the screen can delete or overwrite any meter whose id they can see, if RLS permits it.
- **Shared reads by design:** LPVM:76-77 comments that reads go through "authenticated SELECT policies". `migrations/2026-08-05_fix_admin_rls.sql` creates `authenticated_read_sites` and `authenticated_read_scada_imports` with `USING (true)` (lines 103-109), and the same for `provinces`, `municipalities`, `tariff_plans`, `eskom_tariff_plans`, `eskom_tariff_rates` (lines 123-149). So **every authenticated user reads every site and every tenant meter (shop names, areas, load profiles) across all customers.** LPVM:107-112 fetches the entire `scada_imports` table unfiltered.
- **Write policies for `sites` and `scada_imports` are absent** from that migration. Its section 6 (lines 194-240) states RLS enablement on these tables is "UNKNOWABLE from the repo" and deliberately left off. So either RLS is off (all writes and deletes open to any authenticated, and possibly anon-key, caller) or on (all these writes fail). Which one is **unverified**; it needs a live `pg_class.relrowsecurity` check.
- **`tariff_rates` has an INSERT policy but no SELECT policy** in that migration (lines 166-168, with no `authenticated_read_tariff_rates`). If RLS is enabled on it, `loadRates()` (CVM:688-701) returns 0 rows, and a selected municipal tariff then bills **R0** silently. Unverified.
- `scada_data` (read at LPV:1098-1106) appears in neither migration; its RLS is unknown.
- Nothing in scope touches storage buckets or edge functions.


---

<!-- Part 3E: merged from ios-parts/E-tariffs-settings.md -->

# E — Tariffs + Settings (WM Solar iOS/macOS) — read-only review

Root: `/Volumes/Extreme SSD/DEVELOPER/APPS/WM Solar/WM Solar/`. Every line of the 19 in-scope files (6,138 lines) was read. All paths below are relative to that root. `T/` = `Features/Tariffs/`, `S/` = `Features/Settings/`, `C/` = `UI/Components/`.

Supporting reads outside scope (only to answer questions this review raised): `Core/TariffExtractionService.swift:31-74` (Keychain), `App/ThemeManager.swift:55-72` (theme persistence), `ContentView.swift:148-168, 212-236` (entry points), `migrations/*.sql` (RLS), and greps for consumers.

**Already established by the lead (cited here, not re-derived):**
- (L1) `TariffUploadView` reads picked files without `startAccessingSecurityScopedResource`.
- (L2) The Builder writes category `residential` and structures `ibt`/`tou`/`hybrid_tou_ibt`, but the browser filters on `inclining_block`/`time_of_use`/`hybrid`.
- (L3) `ProvinceFilesView` hardcodes `fileCount 0`, `avgConfidence 0.85` and `lastExtractedDate "2025-07-01"`, uploads to the `province-files` bucket and calls the edge function `extract-tariffs`.
- (L4) `MunicipalityMapView` places every pin at a jittered fake coordinate derived from its province.
- (L5) No engine reads any `@AppStorage` in CalculationVariables, Derating, Diversity or Integrations, nor SettingsView's `preferredUnits`, `currencyFormat` or `defaultSolarHours`. I re-grepped a sample of these keys and confirmed it: each key string appears only in the file that declares it.
- (L6) `TOUPeriodEditorView.save` deletes ALL rows of `tou_period_settings` and re-inserts them, and nothing else reads that table (confirmed by grep).
- (L7) `organization_branding` is read with `.limit(1)`, so there is one global row.
- (L8) The TOU reference labelled "Eskom 2025/26" uses the pre-2025 period hours.

---

## 1. Control inventory

### 1.1 TariffsView shell (`T/TariffsView.swift`, VM `T/TariffsViewModel.swift`)

| Control | Type | What it's for | Handler -> effect | Data | Validation / disabled | Error / empty |
|---|---|---|---|---|---|---|
| Screen load | `.task` | Load reference data | TariffsView:86-91 runs `loadProvinces` / `loadMunicipalities` / `loadGlobalStats` in parallel | SELECT `provinces` (VM:84-95), `municipalities` (VM:97-108), `tariff_plans` all columns + `tariff_rates` `id` (VM:110-128) | none | provinces/munis: `errorMessage` shown in the title bar (TariffsView:22-27, one line, red). It is **never cleared**. Stats errors are swallowed (VM:125-127, "stats just show 0"). |
| Loading spinner | ProgressView | Busy indicator | TariffsView:18-21 `vm.isLoading` | — | — | Only `loadTariffs` sets `isLoading` (VM:132/145). |
| KPI cards: Provinces, Municipalities, Tariff Plans, Rates, Avg NERSA | display | Headline counts | TariffsView:96-109 | `provinces.count`, `municipalities.count`, `totalPlanCount`, `totalRateCount`, mean of `municipalities.nersa_increase_pct` | — | "Avg NERSA" shows "—" when there is no data. ⚠ Plans and Rates are unpaged SELECTs (VM:112-124). If the project has PostgREST's default max-rows cap (1000), both counts cap silently — **unverified**, since the project config is not in the repo. "Rates" is the one most likely to hit it. |
| Province picker | Picker | Filter municipalities | binding `vm.selectedProvince` (TariffsView:138-144). `onChange` (204-210) clears the municipality, plans, rates, selected tariff and category filter | — | "All Provinces" = nil | — |
| Municipality picker | Picker | Choose the municipality to browse | `vm.selectedMunicipality` (149-155). `onChange` (211-219) clears state and calls `loadTariffs()` | SELECT `tariff_plans` where `municipality_id`, ordered by category, name (VM:130-146) | nil = "Select Municipality" | error goes to `errorMessage` |
| Structure picker | Picker | Filter by tariff structure | `vm.structureFilter` (160-169). Client-side filter (VM:52-61) | tags `flat` `inclining_block` `time_of_use` `seasonal` `demand` `hybrid` | — | Plans saved by the Builder never match IBT/TOU/Hybrid (L2) |
| Category picker | Picker | Filter by category | `vm.categoryFilter` (174-182). Options are derived from the loaded plans (VM:68-71) | — | — | — |
| NERSA % capsule + "N plans" | display | Context for the chosen municipality | 187-202 | `municipalities.nersa_increase_pct` | shown only when a municipality is selected | — |
| Tab buttons ×11 | Button (capsule) | Switch tab | `tabButton` 1072-1086 sets `selectedTab`. Tags: Browse 0, Eskom 10, Documents 1, Analytics 2, Compare 3, Builder 4, TOU Ref 5, Load Shed 6, NERSA 7, Map 8, Files 9 (46-56). Switch at 69-82 | — | — | `default` falls back to Browse |

Note: the province, municipality, structure and category selectors (plus the KPI row) show on **every** tab, including Builder, TOU Ref, Load Shed, NERSA, Map and Files, which ignore them.

### 1.2 Tab 0 — Browse (`TariffsView.swift:395-618`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Empty / loading states | ContentUnavailableView / LoadingView | Guidance | 397-410 | — | — | "Select a Municipality" (shows province and municipality counts); "No Tariffs Found" |
| Category sections | List(.sidebar) Section | Group plans by category | 419-440 | `vm.categories`, `vm.tariffs(for:)` | — | — |
| Tariff row | DisclosureGroup + `.onTapGesture` | Expand a plan to see its rates | 442-531. Tapping calls `vm.loadRates(for:)` (526-530) | SELECT `tariff_rates` where `tariff_plan_id`, ordered by charge/season/tou/block_number (VM:148-164) | fires only when the id differs from the selected tariff | ⚠ `loadRates` sets `selectedTariff` BEFORE the await (VM:149) and never clears `tariffRates`, so for the duration of the fetch the **previous plan's rates render under the new plan**. On an error they stay there. ⚠ Only one plan's rates are held at a time: any other expanded row falls back to a permanent spinner (446-453). ⚠ `.onTapGesture` on a DisclosureGroup may not fire when the chevron itself is clicked (macOS), which leaves a spinner — **unverified**. |
| Row badges | display | Star (recommended), "Redundant", structure, metering, voltage, phase, amp range, kVA, effective-from | 455-523 | `tariff_plans` columns | — | — |
| Tariff detail | display | Rates grouped charge → season → row | 535-618. Charge order from `orderedChargeTypes` (1050-1060), season order (1062-1070), `seasonLabel` "High Season (Winter: Jun-Aug)" / "Low Season (Summer: Sep-May)" (1034-1041), `formatRate` 2 or 4 decimal places (1043-1048) | — | — | "No rate data available" |

### 1.3 Tab 10 — Eskom (`TariffsView.swift:224-391`, VM:168-209)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Supply picker | Picker | Direct Eskom (NLA) or municipal | `vm.eskomSupplyContext` (230-234). `onChange` reloads (303-305) | — | default `nla` (VM:29) | — |
| Category picker | Picker | Residential / Commercial / Industrial / Agricultural / Distributor | `vm.eskomCategory` (238-245). `onChange` reloads (306-308) | — | default `commercial` (VM:30) | — |
| Tab load | `.task` | Initial load | 300-302 → `loadEskomPlans` | SELECT `eskom_tariff_plans` where supply_context & category (VM:171-178), de-duplicated client-side by name/sheet/voltage/zone (VM:180-186). Then SELECT `eskom_tariff_rates` `.in(tariff_plan_id, ids)` (VM:191-199) | — | Spinner "Loading Eskom tariffs..."; "No Eskom Tariffs" empty state. Errors go to the header `errorMessage` plus a `print` (VM:204-206). ⚠ A very large `.in()` id list could exceed the URL length limit (**unverified**). |
| Plan-name group | DisclosureGroup | Expand the variants of a plan | 274-295 | — | — | — |
| Variant row | display | Sheet, structure, voltage and zone chips, then the first 6 rates, then "+ N more" | 311-379 | — | — | ⚠ Rates beyond 6 are **unreachable**; there is no expand control. |

### 1.4 Tab 1 — Documents (`TariffsView.swift:622-678` + `T/TariffUploadView.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| "Upload Documents" | Button | Open the upload sheet | 635-640 `showUpload = true` → `.sheet` (673-677) → `TariffUploadView(provinces:)`. `onUploaded` reloads **global stats only** | — | — | ⚠ The `TariffUploadsListView` on this tab is NOT reloaded after an upload, so new files only appear once the view is re-created. |
| Uploaded Documents list | subview | List of files with extract/retry | `TariffUploadsListView` (UploadView:423-678). `.task` → `loadUploads` (549, 664-677) | SELECT `tariff_uploads` ordered by created_at desc | — | Errors are **swallowed** ("Table might not exist yet", 673-675); empty text "No tariff documents uploaded yet" |
| "Process All (N)" | Button | Extract every pending file | 437-445 → `TariffExtractionService.processAllPending` (service is covered elsewhere) | — | shown when pending > 0 | — |
| "Extract" (per row) | Button | Extract one file | 502-509 → `processUpload` | — | shown for pending/nil status with no in-flight state | Inline stage indicator (553-569) and detail (572-643) |
| "Retry" (per row) | Button | Re-run a failed extraction | 512-519 | — | status `failed` | — |
| "Copy" (failure) | Button | Copy the error to the clipboard | 611-622, NSPasteboard or UIPasteboard | — | — | — |
| "Debug JSON" (macOS only) | Button | Reveal the debug file in Finder | 624-633 reveals `$TMPDIR/tariff_extraction_debug.json` | — | macOS only | ⚠ No existence check. If the service did not write the file, Finder reveals nothing. |
| Row status / result text | display | Status badge; "N plans, M rates"; created date; `errorMessage` | 468-544 | `tariff_uploads` columns | — | ⚠ `uploads` is not reloaded after an extraction finishes, so the badge stays "Pending" (only the in-memory `processingUploads` state changes). |
| Info card | display | 4-step "How Tariff Extraction Works" | 655-669 | — | — | — |

**Upload sheet (`TariffUploadView`)**

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Province picker | Picker | Force a province, or auto-detect | 31-37 | — | optional | — |
| "Choose Files" / "Add More Files" | Button | Pick PDF/XLSX/XLS files | `selectFiles()` 258-279. macOS: modal `NSOpenPanel`. iOS: `showFilePicker` → `.fileImporter` (175-187) | — | de-duplicated by `lastPathComponent` (182, 272) | Cancelling the importer is silent |
| File list row | List row + `.onDelete` (swipe) | Review before upload; swipe to remove | 109-116, row 192-254 (icon, size, extension, detected province chip, status) | — | — | Per-file "Failed" label with the message |
| "Upload All" | Button | Upload and create tracking rows | `uploadAll()` 283-355: storage upload to `tariff-uploads/provinces/<ts>_<name>` (302-310), province resolved (313-323), INSERT `tariff_uploads` with status `pending` (326-341) | Bucket `tariff-uploads`; table `tariff_uploads` | disabled while uploading or empty (146) | `errorMessage` "Some uploads failed" (347). ⚠ A retry re-uploads **every** file, including ones already done, which creates duplicate objects and duplicate rows. ⚠ Storage succeeds first and the INSERT second, so a failed INSERT orphans the object. ⚠ On iOS, reading the file without the security scope fails (L1). |
| "Done" | Button | Close and refresh | 93-103 → `onUploaded()` + dismiss | — | shown only when every file succeeded | — |
| "Cancel" | toolbar | Close | 167-169 | — | — | — |
| Province detection | helper | Guess the province from the filename | 393-418: full names plus prefix abbreviations `ec_`, `kzn-`, etc. | — | — | ⚠ Abbreviations only match as a prefix. "Kwazulu-Natal" is `.capitalized`; matching against province names uses `contains` both ways (317-320). |

### 1.5 Tab 2 — Analytics (`TariffsView.swift:698-849`)

All display only; data comes from `vm.allPlansForStats`, which is unpaged (see the KPI caveat).

| Block | Lines | Notes |
|---|---|---|
| Structure distribution bars | 702-735 | Labels via `structureLabelFor` (991-1001). Builder values `ibt`/`tou`/`hybrid_tou_ibt` fall to `.capitalized`, giving "Ibt", "Tou", "Hybrid_Tou_Ibt", and get their own grey bars (L2). |
| Category distribution | 738-772 | `categoryColor` knows `domestic`; the Builder writes `residential` (grey) |
| Province coverage | 775-823 | ⚠ The NERSA % shown is the **first** municipality's value (`.first`, 788), not an average. O(provinces × plans × munis) filter. |
| Metering types | 826-845 | — |

### 1.6 Tab 3 — Compare (`TariffsView.swift:853-964`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Comparison table | display | "Compare tariff plans side-by-side" | 868-947 | `vm.filteredTariffs` | needs a municipality and ≥2 plans (855-866) | ⚠ **Claim vs code:** compares metadata only (category, structure, metering, voltage, amps). No rates, prices or cost comparison. ⚠ The gate uses `tariffPlans.count` but the table shows `filteredTariffs`, so it can render with 0–1 rows. |

### 1.7 Tab 4 — Builder (`T/TariffBuilderView.swift` + `C/RateMatrixEditor.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Provinces | 38-40 → VM 147-158 | SELECT `provinces` id,name,code | — | `errorMessage` (red label 31-34) |
| Plan Name | TextField | Name of the new plan | 48-49 | — | non-empty checked at save (203) | — |
| Province picker | Picker(.menu) | Scope the municipalities | 54-64. `onChange` → `loadMunicipalities` (160-174), which resets the municipality | SELECT `municipalities` where province_id | — | — |
| Municipality picker | Picker(.menu) | Target municipality | 68-75 | — | required at save | — |
| Category picker | Picker | residential / commercial / industrial | 88-93 (default `commercial`, 139) | — | — | (L2) `residential` vs `domestic` |
| Structure picker | Picker | flat / ibt / tou / hybrid_tou_ibt | 98-104 (default `tou`) | — | — | (L2) |
| Metering picker | Picker | conventional / prepaid | 109-113 | — | — | — |
| "Apply Template Rates" | Button | Fill in sample rates | 118-124 → `applyTemplate()` 176-200 | — | — | ⚠ **Hardcoded sample rates** (flat R2.50/kWh + R15/day; IBT R1.80 / 2.20 / 2.80; TOU base 3.0 high / 2.2 low × 1.5 / 1.0 / 0.6, demand R150/kVA, basic R20/day). "Hybrid" falls to `default`, a single energy line (197-198): no hybrid template exists. Replaces rows without asking. |
| Rate row: Charge / Season / TOU pickers | Picker(.menu) | Per-line attributes | RateMatrixEditor:73-97 | — | Charge limited to energy/demand/basic/network_access | Charges such as service, capacity, reactive energy and ancillary (listed in the browse order, TariffsView:1051-1053) cannot be entered |
| Rate row: Block | TextField(Int?) | IBT block number | 99-103 | — | none (no min/max kWh fields, so IBT blocks have **no kWh bounds**) | — |
| Rate row: Amount | TextField(Double, 4dp) | Rate value | 105-112, decimalPad on iOS | — | none (negatives and zero allowed) | — |
| Rate row: Unit | Picker | R/kWh, R/kVA, R/day, R/month | 114-121 | — | — | ⚠ No R/kVA/month; demand charges are normally monthly |
| Rate row: trash | Button(.destructive) | Delete a line | 123-130 | — | no confirmation | — |
| "Add Rate Line" | Button | Append a blank line | 45-51 | — | — | — |
| "Save Rates" | Button | Create the plan and its rates | 54-67 → `onSave` → `savePlan` (Builder 202-275): INSERT `tariff_plans` (231-236), then INSERT `tariff_rates` (266-269) | `tariff_plans`, `tariff_rates` (the insert policies are `WITH CHECK (true)`, migration 2026-08-05 L162-168) | municipality + name required (203-206) | Success/error labels (27-34). ⚠ Not atomic: a failed rate insert leaves an orphan plan. ⚠ No in-flight disable, so a double tap creates duplicate plans. ⚠ Zero rate lines sends an empty bulk insert (behaviour **unverified**). ⚠ The form is not reset after success, so a second tap duplicates. ⚠ Plans are created with no `effective_from`, voltage, amps or year. |

### 1.8 Tab 5 — TOU Ref (`T/TOUReferenceView.swift` + `C/TOUClockDiagram.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Notes |
|---|---|---|---|---|---|
| Tariff chips: Megaflex / Miniflex / Ruraflex / Nightsave | Button | Choose the tariff family | 17-33 | static | See §2 for correctness |
| Season segmented | Picker | High (Jun-Aug) / Low (Sep-May) | 36-40 | — | ⚠ Saturday ignores the season (84). The Sunday clock ignores everything (54). |
| Clocks: Weekday / Saturday / Sunday | `TOUClockDiagram` | 24-hour wheel | 43-57. Diagram draws 24 wedges (Clock:15-17, 37-54) with labels every 3 h | `EskomTOUDefaults` (Clock:86-129) | Missing hours default to off-peak (Clock:40) |
| Legend | display | Colour key | 60-65 | — | — |
| Period Hours table | display | Hour ranges per period | 112-136 | **weekday only**, whatever you are looking at | — |
| Seasonal Comparison | display | Day counts and peak h/day | 159-188 | hardcoded | See §2 |

### 1.9 Tab 6 — Load Shed (`T/LoadSheddingView.swift`)

| Control | Type | Purpose | Handler -> effect | Notes |
|---|---|---|---|---|
| Stage segmented 1–8 | Picker | Choose a stage | 16-21 (default 2, line 4) | 8 segments; will crowd on iPhone widths (**unverified**) |
| Stage card + 4 tiles | display | MW / slot / slots / hours | 37-80 via `stageInfo` 153-165 | Hardcoded (§2) |
| Impact per System Type | display | 4 system types with 5-dot score | 84-120, data 175-190 | Hardcoded heuristics (§2) |
| Recommended Response | display | Checklist by stage | 124-140, 192-210 | Static text |

No data access. Nothing is saved.

### 1.10 Tab 7 — NERSA (`T/NERSAGuidelinesView.swift`)

Five `DisclosureGroup`s (89-112) of static markdown bullets (15-83). No data, no links, no sources. Content audit in §2.

### 1.11 Tab 8 — Map (`T/MunicipalityMapView.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Search field + clear (x) | TextField / Button | Filter pins by municipality or province name | 17-24. `filteredItems` 86-90 | — | — | No "no results" state |
| Map | `Map(initialPosition:)` | SA overview, centre −29, 25 with 12° span | 32-55 | — | — | — |
| Pin (Annotation button) | Button | Open municipality detail | 37-52 sets `selectedMunicipality`; shows the plan count | positions are **fake**, per province + jitter (254-268, L4) | — | ⚠ ~all municipalities of a province pile into a ~3° jitter box; with only 20 jitter values (`index % 20`, 255), pins overlap exactly |
| Province legend | display | Colour + municipality count | 58-76 | — | — | — |
| Detail sheet | `.sheet(item:)` | Name, province, plan count, NERSA % | 81-83, 92-126 | — | — | "Done" (121). `.presentationDetents([.medium])` |
| Load | `.task` | Data | 78-80 → `loadData` 170-251 | SELECT `municipalities`, `provinces`, `tariff_plans.municipality_id` (unpaged; the per-municipality count may be capped — **unverified**) | — | Errors are **print-only** (249); on failure the map is silently empty |

### 1.12 Tab 9 — Files (`T/ProvinceFilesView.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Province cards | 38-40 → `loadData` 370-440 | SELECT `provinces`, `municipalities`, `tariff_plans.municipality_id` | — | print-only error (438). "No Provinces" empty state (28-34) |
| Province card counters | display | Files / munis / plans / AI confidence / last updated | 126-185 | `fileCount 0`, `files []`, conf 0.85 and date "2025-07-01" are **fake** (431-434, L3) | — | "No files uploaded yet" is shown **always**, because `files` is always empty |
| "Add File" | Button | Pick files for this province | 188-194 → `addFileForProvince` (442-445) | — | — | ⚠ One `.fileImporter` is attached **per card** (199-207), all bound to the same `viewModel.showFilePicker`. Multiple importers on one binding are unreliable in SwiftUI; typically only one presents (**unverified**). |
| fileImporter | file importer | PDF / spreadsheet / CSV | 199-207 → `queueFiles` 447-459 | — | — | Failure or cancel is ignored |
| Queue row "x" | Button | Remove a queued item | 93-101 → `removeFromQueue` | — | only for `.queued` | ⚠ Removing a queued item **while `processQueue` runs** shifts the indices, so `uploadQueue[i]` can go out of range and crash (466-499 iterate the indices across awaits) |
| "Process Queue" | Button | Upload and extract | 108-116 → `processQueue` 465-504: security-scoped read, then storage `province-files/tariffs/<provId>/<name>` (479-483, no upsert), then `EdgeFunctionService.invoke("extract-tariffs")` decoded as `[String:String]` (488-494), then reload | Bucket `province-files`; edge function `extract-tariffs` | disabled when nothing is queued (116) | ⚠ Every failure becomes a bare "Failed" and **the error is discarded** (497-499). ⚠ Re-uploading the same filename fails (no upsert). ⚠ If the edge function returns any non-string JSON value, the decode throws and the item shows Failed even if extraction succeeded (**unverified**). ⚠ This is a second, parallel ingestion path next to Documents (`tariff-uploads` + client-side Claude). Nothing reconciles the two. |

### 1.13 SettingsView (`S/SettingsView.swift`)

| Control | Type | Purpose | Handler -> effect | Storage / data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Theme cards (System/Light/Dark/Glass) | Button | App theme | 33-35, 483-510 → `themeManager.selectedTheme` | UserDefaults `appTheme` (ThemeManager:55-56) | — | — |
| Accent colour circles | Button | Accent | 46-65 → `themeManager.selectedAccent` | UserDefaults `accentColor` (ThemeManager:58-59) | — | — |
| Sidebar Vibrancy | Toggle | Glass sidebar | 69-78 | UserDefaults `sidebarVibrancy` | **macOS only** and only when Glass is active | — |
| Claude API key field + eye | SecureField/TextField + Button | Anthropic key for extraction | 97-113 | loaded on appear (351-355) **into plain `@State`** | — | — |
| "Save" | Button | Store the key | 115-121 → `TariffExtractionService.saveAPIKey` | **Keychain** generic password, service `dev.wattmatt.wmsolar.anthropic`, account `api-key` (Service:31-65) | disabled when empty. No format check. | ⚠ The `SecItemAdd` status is ignored (Service:64) and `hasAPIKey = true` is set anyway, so "Configured" shows even if the write failed. No accessibility class set (default when-unlocked). |
| Trash (key) | Button(.destructive) | Delete the key | 123-132 → `deleteAPIKey` | Keychain | shown when configured | no confirmation |
| Units picker | Picker | Metric / Imperial | 146-154 | AppStorage `preferredUnits` | — | **Not consumed** (L5) |
| Currency picker | Picker | ZAR / USD / EUR / GBP | 156-167 | AppStorage `currencyFormat` | — | **Not consumed** (L5). No FX conversion exists. |
| Default Peak Sun Hours | Slider 3–8, step 0.1 | Solar default | 172-185 | AppStorage `defaultSolarHours` 5.5 | — | **Not consumed** (L5). Duplicates `calcPeakSunHours`. |
| NavigationLinks ×7 | NavigationLink | Branding, Diversity, Derating, TOU editor, Checklists, Calc Vars, Integrations | 190-230 | — | — | — |
| Profile header | display | Avatar / name / email | 235-255 | `appState.userSession` | — | AsyncImage placeholder |
| Display Name | TextField `.onSubmit` | Rename | 257-266 → `updateDisplayName` 439-451 | UPDATE `profiles.full_name` where id | Saves **only on Return**; losing focus discards the edit silently. No empty check. | **print-only error** (449). `appState.userSession` is not refreshed, so the header keeps the old name. |
| "Change Avatar" | Button | Upload an avatar | 268-272 → `showAvatarPicker`. The `.fileImporter` is **iOS-only** (361-367) → `uploadAvatar` 453-479 | Storage `avatars/<uid>/avatar.png` (upsert), then UPDATE `profiles.avatar_url` with the public URL | PNG/JPEG | ⚠ **Dead on macOS**: the button sets a flag nothing observes. ⚠ A JPEG is stored as `.png` with no contentType. ⚠ The URL stays the same, so AsyncImage caching and the unrefreshed session likely keep the old avatar on screen. Errors print-only; a failed security scope returns silently. Needs the `avatars` bucket to be public (**unverified**). |
| "Change Password" | Button → sheet | Set a new password | 274-278 → `passwordChangeSheet` 381-419 → `changePassword` 423-437 → `auth.update(user: .init(password:))` | Supabase Auth | ≥6 chars and matching (401, 424) | Message coloured by `msg.contains("success")` (393). **No current-password re-auth.** Cancel resets. |
| About rows | display | Logo, name, version, "Platform: GreenCalc SA" | 282-317 | `Constants.App` | — | ⚠ The "GreenCalc SA" platform label is hardcoded and does not match the app name |
| Data & Privacy text | display | Security claim | 320-335 | — | — | ⚠ **Claim vs code:** "encrypted in transit and at rest via Supabase Row Level Security". RLS is access control, not encryption, and the repo's own migration says RLS enablement on the shared tables is "UNKNOWABLE from the repo" (2026-08-05 L193-195). |
| "Sign Out" | Button(.destructive) | Log out | 339-348 → `appState.logout()` | — | no confirmation | — |

⚠ `SettingsView` wraps itself in a `NavigationStack` (22). On iOS it is pushed from `MoreMenuView`'s NavigationLink (ContentView:233-237), so it produces a nested NavigationStack: a double nav bar and odd back behaviour (**unverified** at runtime).

### 1.14 TOUPeriodEditorView (`S/TOUPeriodEditorView.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Megaflex defaults, then DB overrides | 169-171 → `load` 230-263: `applyMegaflexDefaults`, then SELECT `tou_period_settings` | `tou_period_settings` (season, day_type, hour, period) | — | print-only (261) |
| Season segmented | Picker | high / low | 28-33 | — | — | — |
| Day Type segmented | Picker | weekday / saturday / sunday | 38-44 | — | — | — |
| 24 hour cells | Rectangle `.onTapGesture` | Cycle peak → standard → off-peak | 78-91 → `cyclePeriod` 265-274 | in-memory | — | No drag-paint; 24 cells in one row, each tiny on iPhone |
| Period Summary | display | Hours per period + ranges | 99-125 | — | — | — |
| "Eskom Megaflex" preset | Button | Reset to defaults | 132-134 → `applyMegaflexDefaults` 282-321 | — | — | ⚠ Resets **all six** season/day grids, not just the one on screen, unlike the other two presets. No confirmation. |
| "All Off-Peak" / "All Standard" | Button | Fill the current grid | 137-145 → `setAll` 276-280 | — | — | — |
| "Save TOU Periods" | Button | Persist | 158-164 → `save` 323-361: DELETE all rows (`.neq id 0000…`, 327-331), then INSERT all cells (352-355) | `tou_period_settings` (global, no user/org column) | no in-flight disable | ⚠ **print-only error** (359). The user sees nothing. ⚠ Non-atomic: if the delete succeeds and the insert fails, the table is left **empty**. ⚠ **Nothing reads the table** (L6). The success message never clears. |

### 1.15 CalculationVariablesView (`S/CalculationVariablesView.swift`)

Nine collapsible sections (180-214; "solar" open by default, line 74). Each is a group of `paramSlider`s (216-230) bound to `@AppStorage`. There are no text fields, no reset-to-default button and no save button (writes are immediate). The copy says "Override per-project in simulation settings" (83); **none of these values feed any engine (L5)**. The full key list is in §2.5.

### 1.16 IntegrationsView (`S/IntegrationsView.swift`)

| Control | Type | Purpose | Handler -> effect | Storage | Validation | Status indicator |
|---|---|---|---|---|---|---|
| Solcast API key + eye | SecureField/TextField | Irradiance API | 41-59 | **plaintext UserDefaults** `solcastApiKey` (4) | none | "Active" whenever the string is non-empty (33-38). ⚠ `Core/SolcastService.swift:58` calls the `solcast-forecast` edge function and never reads this key. |
| PVGIS toggle | Toggle | Enable PVGIS | 98-99 | UserDefaults `pvgisEnabled` (5) | — | "Enabled/Disabled". ⚠ `PVGISService` (45, 55) never checks it. |
| Google Sheets key + eye | SecureField/TextField | Import from Sheets | 138-160 | **plaintext UserDefaults** `googleSheetsApiKey` (6) | none | "Active" if non-empty. ⚠ No Google Sheets import code consumes it (grep). The feature tags "Tariff Import / Meter Data Import / Batch Export" are **unimplemented claims**. |
| Mapbox token + eye | SecureField/TextField | Boundaries | 194-216 | **plaintext UserDefaults** `mapboxAccessToken` (7) | none | "Active" if non-empty, else "Using MapKit". ⚠ The map is MapKit-only (MunicipalityMapView) and there are no boundary overlays: **claim vs code**. |
| Supabase Edge Functions card | display | Backend status | 229-260 | — | — | ⚠ **Hardcoded green "Connected"** (242-247). No probe. The five function names are a static list (251-255); four are invoked somewhere in the app (grep), `extract-tariffs` only from ProvinceFilesView. |

**There are no "Test connection" buttons in this file.** Every status dot is a `String.isEmpty` or `Bool` check, so a wrong key reads as "Active".

### 1.17 DiversityFactorsView (`S/DiversityFactorsView.swift`)

| Control | Type | Purpose | Handler -> effect | Storage | Notes |
|---|---|---|---|---|---|
| Diversity slider 50–100% | Slider | Global diversity factor | 40-48. `onChange` clears the selected preset | AppStorage `diversityFactor` 0.75 | **Not consumed** (L5). ⚠ The under-slider labels are inverted: 50% is labelled "Low diversity" (51), but a low factor means **high** diversity (the page's own text at 24 says so). |
| 7 preset tiles | Button | Set a building-type value | 67-93 | same | ⚠ Setting the value fires `onChange` (48), which clears `selectedPreset`. The order at 69-70 (animated set, then `selectedPreset = name`) likely wins, but the highlight may flicker or drop (**unverified**). |
| Impact rows | display | Explanation | 101-112 | — | "Reduces peak kVA by X%": the text claims an effect that no engine applies |

### 1.18 DeratingParametersView (`S/DeratingParametersView.swift`)

Seven sliders, each 0.80–1.00 with step 0.005 (125-149), plus a combined factor (24-38) and a waterfall (77-119). All AppStorage; **not consumed** (L5). ⚠ The waterfall keeps `var running` in the ViewBuilder and mutates it inside the `ForEach` closure (90-93). ForEach content can be evaluated lazily and more than once, so the bars may compound incorrectly across re-renders (**unverified**, logic smell). ⚠ These duplicate settings in CalculationVariables with different values: soiling (0.97 here vs 3% loss), mismatch (0.98 vs 2%), LID (0.985 = 1.5% here vs 2% there), inverter (0.97 vs 0.97). The two pages disagree on LID.

### 1.19 ChecklistTemplatesView (`S/ChecklistTemplatesView.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Groups + items | 53-55 → `loadData` 177-198 | SELECT `checklist_template_groups`, `checklist_templates` ordered by sort_order | — | print-only (196). Spinner; "No Template Groups" |
| "Add Group" | Button → `.alert` + TextField | New group | 23-29, alert 56-65 → `addGroup` 200-215 | INSERT `checklist_template_groups` (name, sort_order = count) | empty is ignored silently | print-only (213) |
| Group "+" | Button → `.alert` (2 TextFields) | New item | 101-108, alert 66-83 → `addItem` 238-261 | INSERT `checklist_templates` (group_id, title, description, sort_order) | empty title ignored silently | print-only. `groups[0]` fallback (247) would crash if `groups` were empty (unreachable in practice). |
| Group trash | Button(.destructive) | Delete a group and its items | 110-116 → `deleteGroup` 217-236: DELETE items, then the group | both tables | **no confirmation**; one click deletes a whole group | print-only. Non-atomic. |
| Item x | Button(.destructive) | Delete an item | 144-151 → `deleteItem` 263-275 | `checklist_templates` | no confirmation | print-only |

No edit or reorder of existing groups or items. Consumer: `Features/Projects/Tabs/HandoverTab.swift:334-343, 494-501` (grep).

### 1.20 BrandingSettingsView (`S/BrandingSettingsView.swift`)

| Control | Type | Purpose | Handler -> effect | Data | Validation | Error / empty |
|---|---|---|---|---|---|---|
| Load | `.task` | Current branding | 138-140 → `load` 213-240 | SELECT `organization_branding` `.limit(1)` (L7) | — | print-only (238) |
| Logo preview | AsyncImage | — | 26-46 | `logo_url` | — | — |
| "Upload Logo" | Button → `.fileImporter` (png/jpeg) | Upload a logo | 49-52, 141-145 → `uploadLogo` 294-314: storage `organization-assets/branding/logo_<uuid>.<ext>`, then public URL → `logoUrl` | Bucket `organization-assets` | ⚠ "max 2MB" (62) is **not enforced** | print-only. ⚠ The URL is only persisted on Save; leaving the page orphans the object. |
| "Remove" | Button | Clear the logo | 54-60 sets `logoUrl = nil` | — | — | Does not delete the storage object; persisted only on Save |
| Company Name, Tagline, Email, Phone, Website, Address, Reg No., VAT No. | TextField ×8 | Proposal branding | 76-86 | — | **none** (email, URL and VAT format unchecked) | — |
| Primary / Secondary / Accent hex | TextField | Colours | 97-100, 148-156; preview 103-113 via `Color(hex:)` 181-191 | — | invalid hex falls back to a default **in the preview only**; the invalid string is still saved | — |
| "Save Branding" | Button | Persist | 127-134 → `save` 242-292: UPDATE by id, or INSERT when no row | `organization_branding` | no in-flight disable | ⚠ **print-only error** (290). ⚠ After an INSERT, `brandingId` is never set (282-285), so a second Save **INSERTs another row**; with `.limit(1)` and no order, which row is read is then undefined. |

Consumer: `Core/PDFGenerationService.swift:31-33` (also `.limit(1)`).

---

## 2. Hardcoded reference content (all "needs verification" unless marked as an internal inconsistency)

### 2.1 TOU reference and TOU defaults

**EskomTOUDefaults (`C/TOUClockDiagram.swift`):**
- High-season weekday (88-97): off-peak 00–06, peak 06–09, standard 09–17, peak 17–19, standard 19–22, off-peak 22–24. This is the **pre-2025 Megaflex** pattern (L8).
- Low-season weekday (100-110): off-peak 00–06, standard 06–07, peak 07–10, standard 10–18, peak 18–20, standard 20–22, off-peak 22–24. Also the pre-2025 pattern.
- Weekend (113-117): Sunday all off-peak.
- ⚠ **`megaflexHighSaturday` (120-128) is wrong even against the pre-2025 schedule.** Lines 123-125 mark **07:00–20:00 all standard** (the 12..<18 loop sets "standard"). The pre-2025 Megaflex Saturday is standard 07–12 and 18–20, off-peak otherwise. `TOUPeriodEditorView.swift:294-299` has it right (12–18 off-peak). **The app ships two contradictory Saturday definitions.**

**TOUReferenceView:**
- The title "Eskom 2025/26 TOU Reference" (12) is paired with the pre-2025 hours (L8). Needs verification against the Eskom 2025/26 schedule of TOU periods, which changed from 1 April 2025 (needs verification).
- Megaflex Saturday uses the high-season Saturday for both seasons (84) and so inherits the 07–20 error above.
- Miniflex ("simplified", 88-101): in low season, 06–09 and 17–19 become **standard**, so there are **no peak hours in low season**. The code's own low-season Megaflex has peak 07–10 and 18–20. Saturday returns all off-peak. Likely wrong.
- Nightsave (102-105): "all off-peak" for every day, which is **certainly not** a valid representation; Nightsave has peak/off-peak differentiation.
- Ruraflex (106-107): uses Megaflex weekday hours for **Saturday too**; the Sunday clock is fixed off-peak. Ruraflex periods differ from Megaflex (needs verification).
- Seasonal Comparison (164-186): "92 days" (Jun–Aug, correct) and "273 days" (Sep–May, correct for a non-leap year). "Peak hours: 5h/day" for both seasons matches pre-2025. Needs verification for 2025/26.
- The Period Hours table (117) always shows weekday hours.

### 2.2 LoadSheddingView

- `stageInfo` (155-162): Stage N = N×1,000 MW. Slot length "2.5 hrs" for stages 1–5 and "4 hrs" for stages 6–8. Slots/day 1, 2, 3, 4, 5, 4, 5, 6. Hours off 2.5, 5, 7.5, 10, 12.5, 16, 20, **24 hrs (Stage 8)**.
  - Needs verification: Eskom/municipal schedules use 2 h or 4 h blocks (2 h + 30 min is a CoJ/CityPower convention) and rotate over 4-day cycles. "Stage 8 = 24 hrs off" is almost certainly wrong.
  - The MW-per-stage figures are nominal.
- **Internal inconsistency:** the Grid Only line computes `Double(s) * 2.5` hours/day (187), so Stage 6 = 15 h and Stage 8 = 20 h, contradicting the card's 16 h and 24 h.
- "Grid-Tied Solar": for stages ≤2 the impact text is "Minimal — generates during daylight" (178). This contradicts the anti-islanding reality the same line states for higher stages: a grid-tied system produces nothing during any outage. Wrong regardless of stage.
- Diesel "R8-12/kWh" (184): needs verification for 2025/26 diesel prices.
- Resilience scores (179, 182, 185, 188) are arbitrary formulas.
- Context: needs verification whether load shedding is current in 2025/26. The page presents it as an operational reference with no date.

### 2.3 NERSAGuidelinesView

The subtitle claims "Municipal Tariff Guidelines 2025/26" (11). None of it is sourced; every bullet needs verification. Items that look doubtful or wrong:
- "Municipalities must unbundle tariffs … by 2025/26" (24): needs verification.
- "NERSA encourages TOU for C&I > 100 kVA" (36): needs verification.
- "Residential IBT must include a free basic electricity (FBE) block of 50 kWh/month" (37): FBE is a national indigent-support policy, not a NERSA IBT structural rule. Likely misattributed.
- Eskom categories (45-52):
  - "Homepower ≤100A single-phase" and "Homeflex ≤100A": Eskom defines these by kVA (≤100 kVA), not amps. Needs verification.
  - "Miniflex 100 kVA – 1 MVA": needs verification (Eskom's Miniflex range is commonly stated as 25 kVA – 5 MVA).
  - "Megaflex > 1 MVA": needs verification.
  - "Transflex" and "Nightsave Rural": needs verification that they still exist in the 2025/26 tariff book.
  - Newer categories (e.g. Municflex, Megaflex Gen, Homelight) are absent.
- TOU rules (60-67):
  - The hours are pre-2025 (L8).
  - "Public holidays follow Sunday TOU schedule": needs verification (Eskom maps specific holidays to Saturday or Sunday treatment).
  - "Peak:Off-peak ratio ≥ 3:1": unsourced.
- Approval matrix (75-81): "submit by 1 December", "increase ≤ Eskom + 1%", "cross-subsidy limited to 10%", "lifeline ≤350 kWh limited to 50%", "prepaid must not exceed conventional by >5%", "published 30 days before". **All look fabricated or unsourced**; each needs verification against NERSA's actual municipal tariff guideline and benchmarks for 2025/26.

### 2.4 TariffsView labels

- `seasonLabel` (1034-1041): High = Jun–Aug, Low = Sep–May. Matches Eskom's convention.

### 2.5 CalculationVariablesView — every key and default (all AppStorage; consumer: none, L5)

| Section | Key = default (line) |
|---|---|
| Solar | `calcPeakSunHours`=5.5 (5), `calcPanelWattage`=550 (6), `calcPanelEfficiency`=0.21 (7), `calcDcAcRatio`=1.25 (8), `calcAnnualDegradation`=0.005 (9), `calcFirstYearLID`=0.02 (10), `calcSystemLifespan`=25 (11), `calcAlbedo`=0.2 (12), `calcTiltAngle`=30 (13) |
| Financial | `calcDiscountRate`=0.10 (16), `calcEscalationRate`=0.08 (17), `calcInflationRate`=0.06 (18), `calcCPI`=0.055 (19), `calcTariffEscalation`=0.10 (20), `calcExportRate`=0.50 (21), `calcCarbonCreditsRate`=0.0 (22), `calcVAT`=0.15 (23) |
| Battery | `calcBatteryRoundTrip`=0.92 (26), `calcBatteryMinSoC`=0.10 (27), `calcBatteryMaxSoC`=0.95 (28), `calcBatteryCycleLife`=6000 (29), `calcBatteryDegradation`=0.02 (30), `calcBatteryReplacementYear`=12 (31) |
| Grid | `calcGridAvailability`=0.95 (34), `calcPowerFactor`=0.95 (35), `calcTransformerEfficiency`=0.98 (36), `calcMaxGridExport`=100 kW (37) |
| Installation | `calcCableRunAvg`=25 m (40), `calcRoofLoadCapacity`=15 kg/m² (41), `calcPanelAreaM2`=2.58 (42), `calcRowSpacingFactor`=1.5 (43), `calcInstallDaysPerKwp`=0.5 (44) |
| Inverter | `calcInverterEfficiency`=0.97 (47), `calcInverterClippingLoss`=0.02 (48), `calcInverterNightConsumption`=15 W (49), `calcMPPTTracking`=0.99 (50), `calcInverterLifespan`=15 (51) |
| Module | `calcTempCoeffPmax`=−0.0035 (54), `calcNOCT`=45 (55), `calcBifacialGain`=0.0 (56), `calcMismatchLoss`=0.02 (57), `calcSoilingLoss`=0.03 (58) |
| Weather & load | `calcAmbientTempAvg`=22 (61), `calcWindSpeedAvg`=3.0 (62), `calcLoadGrowthRate`=0.02 (63), `calcDemandDiversityFactor`=0.85 (64), `calcAfterDiversityMaxDemand`=0.70 (65) |
| Environmental | `calcCO2PerKwh`=1.06 kg (68), `calcWaterSavingsPerMwh`=1.5 kL (69), `calcSO2PerKwh`=0.0078 (70), `calcNOxPerKwh`=0.0041 (71), `calcTreesEquivalent`=16.5 (72) |

Flags:
- The VAT slider range goes to 20% and displays "%.0f" (109), so 15.5% would show as 16%. SA VAT is 15%; needs verification that the proposed 2025 increase was withdrawn.
- CO₂ 1.06 kg/kWh (68): needs verification against Eskom's current published grid emission factor, which is commonly reported slightly under 1.0.
- Water 1.5 kL/MWh, SO₂ 7.8 g/kWh, NOx 4.1 g/kWh, "trees/MWh 16.5": unsourced; needs verification.
- Tariff escalation 10% and CPI 5.5%: needs verification against 2025/26 NERSA/SARB figures.
- Export rate "50% of import": arbitrary.
- Duplicates with different values: `calcPeakSunHours` vs SettingsView `defaultSolarHours` (both 5.5); `calcDemandDiversityFactor` 0.85 vs DiversityFactorsView `diversityFactor` 0.75; LID, soiling, mismatch and inverter vs Derating (§1.18).
- The Temp Coeff slider (150) formats with "%.2f" × 100, so −0.35%/°C shows as "-0.35"; fine.

### 2.6 DeratingParametersView defaults (4-10)

| Key | Default |
|---|---|
| `derateTempCoeff` | 0.96 |
| `derateSoiling` | 0.97 |
| `derateShading` | 0.95 |
| `derateMismatch` | 0.98 |
| `derateCabling` | 0.98 |
| `derateInverter` | 0.97 |
| `derateLID` | 0.985 |

- Combined ≈ **81.2%**, i.e. 18.8% total losses (computed).
- Copy (19) says "PVsyst-style loss chain", but it is a simple product with no irradiance or temperature model.
- The help text "Modern inverters: 96-98%" (66) and "LID typically 1-3%" (70) are plausible; needs verification.
- The slider floor is 0.80 (143). A heavily shaded site (worse than 20% loss) cannot be represented.

### 2.7 DiversityFactorsView presets (7-15)

| Building type | Factor |
|---|---|
| Office | 0.70 |
| Retail | 0.75 |
| Industrial | 0.85 |
| Residential | 0.65 |
| Hospital | 0.90 |
| School | 0.60 |
| Data Centre | 0.95 |

- Default 0.75 (4). Unsourced; needs verification (e.g. against SANS 10142 / NRS 034 ADMD practice for residential, which uses ADMD in kVA rather than a single factor).

### 2.8 Other hardcoded values

- Builder template rates (TariffBuilderView:180-198): sample values, not tariffs.
- SettingsView "South Africa average: 5.5 hours" (182): needs verification; SA PSH varies by region.
- Integrations: "Free tier: 10 API calls/day" (60) and "PVGIS v5.2 with SARAH-2" (101): needs verification; PVGIS has released newer versions and datasets (SARAH-3).
- ProvinceFilesView fake statistics (L3).
- Map coordinates (L4).

---

## 3. Settings persistence

| Setting | Storage | Consumer |
|---|---|---|
| Theme | UserDefaults `appTheme` (ThemeManager:55-56) | ThemeManager (app-wide) |
| Accent | UserDefaults `accentColor` (ThemeManager:58-59) | ThemeManager |
| Sidebar vibrancy (macOS) | UserDefaults `sidebarVibrancy` (ThemeManager:61-62) | ThemeManager |
| Claude API key | **Keychain** `dev.wattmatt.wmsolar.anthropic` / `api-key` (TariffExtractionService:31-74) | TariffExtractionService (covered elsewhere) |
| preferredUnits | AppStorage (SettingsView:8) | none (L5) |
| currencyFormat | AppStorage (SettingsView:9) | none (L5) |
| defaultSolarHours | AppStorage (SettingsView:10) | none (L5) |
| Display name | Supabase `profiles.full_name` (SettingsView:443-447) | AppState session load (not refreshed after the edit) |
| Avatar | Storage `avatars/<uid>/avatar.png` + `profiles.avatar_url` (SettingsView:460-474) | SettingsView header via `appState.userSession` |
| Password | Supabase Auth (SettingsView:430) | Auth |
| 41 `calc*` keys (§2.5) | AppStorage (CalculationVariablesView:5-72) | none (L5) |
| 7 `derate*` keys | AppStorage (DeratingParametersView:4-10) | none (L5) |
| `diversityFactor` | AppStorage (DiversityFactorsView:4) | none (L5) |
| `solcastApiKey` | **plaintext UserDefaults** (IntegrationsView:4) | none; Solcast goes through an edge function (SolcastService:58) |
| `pvgisEnabled` | UserDefaults (IntegrationsView:5) | none; PVGISService:45,55 ignores it |
| `googleSheetsApiKey` | **plaintext UserDefaults** (IntegrationsView:6) | none |
| `mapboxAccessToken` | **plaintext UserDefaults** (IntegrationsView:7) | none; the map is MapKit |
| TOU period grid | Supabase `tou_period_settings` (global; TOUPeriodEditorView:327-355) | none (L6) |
| Checklist templates | Supabase `checklist_template_groups` / `checklist_templates` | HandoverTab.swift:334-343, 494-501 |
| Branding | Supabase `organization_branding` (one global row read, L7) + Storage `organization-assets/branding/` | PDFGenerationService.swift:31-33 |
| Tariff Builder plans | Supabase `tariff_plans` / `tariff_rates` | Browse tab (mis-filtered, L2) and whatever reads tariffs elsewhere (not in scope) |
| Tariff uploads (Documents) | Storage `tariff-uploads/provinces/` + `tariff_uploads` | TariffExtractionService |
| Province files | Storage `province-files/tariffs/<prov>/` + edge fn `extract-tariffs` | none that I could see in the client |

---

## 4. Flags

**Stubs, fakes and hardcoded data**
- ProvinceFilesView: fake file count, confidence and date (L3); "No files uploaded yet" is shown permanently.
- Map pins at fake coordinates (L4).
- Integrations shows "Connected" hardcoded (IntegrationsView:242-247), and "Active" means only that the field is non-empty. **There are no Test-connection buttons.**
- The Compare tab has no price comparison (§1.6).
- The Builder has no hybrid template; its rates are sample numbers.
- TOU Ref: Nightsave all off-peak, Miniflex with no low-season peak, and a wrong Saturday (§2.1).
- NERSA and Load Shedding content is unsourced (§2.2–2.3).

**Dead or non-functional controls**
- "Change Avatar" on macOS: the importer is iOS-only (SettingsView:361-367).
- Every Settings slider/picker backed by AppStorage (L5), plus the PVGIS toggle and the three integration keys: no consumer.
- The TOU editor's Save writes a table nobody reads (L6).
- ProvinceFilesView "Add File" may not present, since 9 importers share one binding (**unverified**).
- Eskom rates beyond the first 6 per variant cannot be viewed (TariffsView:346-374).

**Print-only or swallowed errors**
- `print` only: TOUPeriodEditor save/load (359, 261); Branding load/save/upload (238, 290, 312); Checklists (every function: 196, 213, 234, 259, 273); Map load (249); ProvinceFiles load (438); display name and avatar (SettingsView:449, 477); Eskom errors (VM:206, which is also surfaced).
- Swallowed entirely: global stats (VM:125-127); uploads list (UploadView:673-675); ProvinceFiles processing errors (497-499).
- The Keychain save status is ignored (TariffExtractionService:64).

**Claim vs code**
- "Encrypted at rest via RLS" (SettingsView:328).
- "Override per-project in simulation settings" (CalculationVariablesView:83).
- "Mapbox adds municipality boundary overlays" (IntegrationsView:213).
- "Import tariffs and load profiles from Google Spreadsheets" (125).
- "Uploaded Documents" is not refreshed after an upload or extraction.
- "PNG or JPG, max 2MB" is not enforced (Branding:62).
- "Compare tariff plans side-by-side" compares no prices.
- "Eskom 2025/26" (L8).
- "Platform: GreenCalc SA" (SettingsView:314).

**Data-integrity bugs**
- Branding second-save duplicate row (Branding:281-285).
- TOU delete-then-insert can empty the table (TOUPeriodEditor:327-355).
- Builder orphan plan, and duplicates on double tap (Builder:231-269).
- Upload retry duplicates (UploadView:293-349).
- ProvinceFiles queue removal during processing can index out of range and crash (ProvinceFilesView:466-499).
- Stale rates shown under a newly tapped tariff (VM:149).
- Unpaged counts may cap at the PostgREST max-rows limit (**unverified**).

**Inconsistencies**
- Two Saturday TOU definitions (TOUClockDiagram:120-128 vs TOUPeriodEditor:294-299).
- Duplicate settings with conflicting defaults: PSH, diversity (0.75 vs 0.85), LID (1.5% vs 2%).
- Inverted diversity labels (DiversityFactorsView:51-53).
- Two separate tariff ingestion paths (Documents vs Files) with different buckets and engines.

**Platform-specific**
- macOS-only: Sidebar Vibrancy; "Debug JSON".
- iOS-only: avatar importer.
- Probable nested NavigationStack when SettingsView is pushed from the iOS More menu (**unverified**).

---

## 5. Security

- **No admin gating at all, not even client-side.** `ContentView.swift:148-168` (sidebar) and `212-236` (iOS More menu) route every signed-in user to TariffsView and SettingsView unconditionally. `appState.isAdmin` exists (AppState:14) but is used only by UserManagement. Every global write below is reachable by any authenticated user through the UI.
- **Global, un-scoped writes (no user_id/org_id column in any payload):**
  - `tou_period_settings`: a delete of **every row** (`.neq("id", zero-uuid)`, TOUPeriodEditor:327-331) plus bulk insert. Any user can wipe the table for everyone. Impact is currently limited only because nothing reads it (L6).
  - `checklist_template_groups` / `checklist_templates`: any user can create or delete **all** handover templates, and HandoverTab consumes them.
  - `organization_branding`: any user can overwrite the single branding row that PDFGenerationService stamps on proposals. Company name, VAT number, contact details and logo URL are all editable, so this is a proposal-tampering path.
  - `organization-assets` bucket: any user can upload arbitrary PNG/JPEG with no size limit, and the public URL is used on PDFs.
  - `tariff_plans` / `tariff_rates`: the Builder lets any user create plans for any municipality. Migration `2026-08-05_fix_admin_rls.sql` L162-168 grants `INSERT … WITH CHECK (true)` to `authenticated`, so there is no server-side restriction even where RLS is on.
  - `tariff_uploads` rows + the `tariff-uploads` bucket, and the `province-files` bucket + `extract-tariffs` invocation: any user can upload and trigger extraction. **No INSERT policy for `tariff_uploads`, and no storage INSERT policy for `tariff-uploads`, appears in the repo's migrations** (only SELECT and UPDATE on the table and SELECT on the bucket, L151-153, 174-176, 189-191). Either RLS is off on those, or uploads fail; the repo cannot tell (**unverified**).
- **RLS state is unknown.** The migration itself says RLS enablement on the shared tables is "UNKNOWABLE from the repo" (L193-195). No migration in the repo mentions `tou_period_settings`, `checklist_template*`, `organization_branding`, or the `avatars`, `organization-assets` or `province-files` buckets. Whether those writes are blocked, open, or rely on dashboard-made policies must be checked on the live project.
- **Secrets in plaintext UserDefaults:** the Solcast, Google and Mapbox keys (IntegrationsView:4-7). These are readable from the app's preferences plist (and they are unused). The Anthropic key correctly goes to the Keychain, but it is loaded into view state and can be revealed on screen (SettingsView:98-106, 351-355). Separately, a user-held Anthropic key calling Claude directly from the client is an architecture point for the extraction review.
- **Password change without re-authentication** (SettingsView:430). The minimum is 6 characters, client-side only.
- **Avatar path** `avatars/<uid>/avatar.png` with `upsert: true`: it relies on storage policies scoping writes to the caller's own folder. Not in the repo (**unverified**).
- **Destructive actions without confirmation:** checklist group delete (cascades to items), TOU Save (global wipe and rewrite), the Megaflex preset (resets all six grids), API-key delete, Sign Out.
