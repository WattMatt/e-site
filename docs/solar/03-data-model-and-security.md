# E-Site Solar — Data Model, Entitlements and Security

**Status:** DRAFT for owner review · 2026-09-28
Conventions follow E-Site's migration rules (repo `CLAUDE.md`): every migration ≥ `00185` carries an
`@verify` block; RLS is proven with impersonation assertion scripts (`scripts/db/assert-*.sql`) run red
first; all three suites (`web`, `@esite/shared`, `@esite/db`) green before merge; migration numbers are
claimed **at apply time** after checking the ledger, `origin/main` and open-PR filenames (next free was
`00207` on 2026-09-28, but #191/#193 are stranded below the head).

---

## 1. Schemas

| Schema | Holds | Exposure |
|---|---|---|
| `solar` (new) | Per-project study data: studies, meters, readings, layouts, cases, runs, proposals, operations | New exposed schema → needs the `00126` checklist: GRANT USAGE + default privileges to `authenticated`, `service_role` (**no anon**), add to `config.toml [api].schemas`, **PATCH production PostgREST `db_schema` via the Management API**, `NOTIFY pgrst`. Without the PATCH, REST returns `PGRST002` indefinitely. Decided **[D-22]**. |
| `tariffs` (new) | Platform reference data: licensees, source documents, tariff years, tariffs, charges, TOU calendars, SSEG rules | Same checklist. Read by users whose org has an active Solar subscription **[D-03b]**; written only by the service role and E-Site platform tariff admins through the review workflow **[D-03]**. |
| `billing` (existing) | `org_addon_subscriptions` (new) | Existing schema |
| `projects` (existing) | `reports` rows for new kinds | Existing |

Large meter readings volume (≈ 17,520 rows per channel-year at 30 min; a 40-tenant mall ≈ 1.4 M
rows/yr) lives in `solar.meter_readings`, partitioned by `organisation_id` hash **[D-23]**, or as Parquet
in Storage with only hourly aggregates in Postgres. Decision gate at Phase 3 with a volume test.

---

## 2. Entitlement — org subscription + per-user project access (decisions D-01, D-02, D-04)

### 2.1 Tables
```sql
billing.org_addon_subscriptions (
  id uuid pk, organisation_id uuid not null references public.organisations,
  feature_key text not null check (feature_key in ('solar')),
  status text not null default 'pending'
    check (status in ('pending','active','non_renewing','past_due','cancelled','refunded')),
  paystack_subscription_code text unique, paystack_customer_code text,
  amount_kobo bigint not null,                        -- 199900 = R1,999/yr excl. VAT
  current_period_end timestamptz,            -- required unless status = 'pending' (CHECK)
  last_event_id text,                         -- webhook idempotency
  started_at, cancelled_at, refunded_at, updated_at)
unique (organisation_id, feature_key)
-- RLS: SELECT for org owner/admin only (00187 billing read gate); writes service role (webhook) only

solar.project_access (
  project_id uuid references projects.projects on delete cascade, user_id uuid,
  organisation_id uuid not null,                      -- bound from the project by BEFORE trigger
  level text not null check (level in ('view','edit','edit_financials')),
  granted_by uuid,                            -- bound to the caller by trigger; NULL only on service-path writes
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id))
-- writes: org owner/admin of the project's org only; suppliers/client_viewers cannot be granted (trigger)

solar.access_requests (
  id uuid pk, project_id uuid, organisation_id uuid, requester_id uuid,
  kind text check (kind in ('access','subscribe')), requested_level text, note text,
  status text check (status in ('pending','approved','declined','withdrawn')),
  decided_by uuid, decided_at timestamptz, created_at timestamptz)
unique (project_id, requester_id, kind) where status = 'pending'
```

### 2.2 Helpers (in `public`, so PostgREST RPC reaches them; SECURITY DEFINER, `SET search_path = ''`, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated, service_role`) — as built in migration 00207
- `public.org_has_solar(p_org uuid) → boolean`: active subscription with `current_period_end > now()`
  (status `active` or `non_renewing`), OR the WM-Consulting internal bypass (consistent with `has_feature`).
  Answers only for the service/definer path or an active member of that org (no cross-org oracle).
- `public.solar_is_grantor(p_project uuid)`: caller is an active owner/admin of the project's org.
- `public.solar_access_level(p_project uuid) → text` (`null|view|edit|edit_financials`): NULL unless
  `org_has_solar(project's org)`; `edit_financials` for org owner/admin of the project's org; NULL unless
  `user_has_project_access` (active org membership, 00204) and the effective role is not client_viewer/supplier;
  otherwise the caller's `project_access.level`.
- `public.solar_can_view(p)`, `public.solar_can_edit(p)`, `public.solar_can_see_money(p)` thin wrappers.
- **One eligibility rule** for requesting and being granted access: active member of the project's org whose
  effective project role is non-null and not client_viewer/supplier (org-level PMs without a project row qualify).
- Approval never silently downgrades an existing grant (highest level wins); grantors downgrade explicitly.
- `@verify`: `anon_execute_absent` for all; `behaviour` directives proving (a) a lapsed org returns NULL,
  (b) a member without a grant returns NULL, (c) an org admin returns `edit_financials`.

### 2.3 Enforcement points (all four, not just the page)
1. `projects/[id]/solar/(gated)/layout.tsx`: `requireEffectiveRole(...).ok` (project member, not supplier/
   client_viewer) then `solar.access_level` — NULL ⇒ redirect `/solar/locked` (outside the group).
2. Every server action and `app/api/projects/[id]/solar/*` route re-checks the level it needs
   (`view` / `edit` / `edit_financials`).
3. **Database:** every `solar.*` table: PERMISSIVE SELECT `solar.can_view(project_id)`; money-bearing tables
   (financials, proposals, tariff overrides, bill checks, case finance results) SELECT `solar.can_see_money`;
   writes one RESTRICTIVE policy **per verb** on `solar.can_edit` (or `can_see_money` for money tables).
   Lapsed/refunded ⇒ helpers return NULL ⇒ **hidden but kept** (no reads, no writes; rows untouched).
   Never a RESTRICTIVE `FOR ALL` (it narrows reads too — the `00205` lesson).
4. Purchase: `POST /api/paystack/solar-subscribe` (org from the **project**; caller `OWNER_ADMIN` of that
   org; 409 when active) → Paystack recurring **annual** plan `PAYSTACK_PLAN_SOLAR_ANNUAL`; webhook
   branches `charge.success` (first + renewal → `active`, extend `current_period_end`),
   `subscription.not_renew` (→ `non_renewing`), `subscription.disable` (→ `cancelled`), refund/reversal
   (→ `refunded`); callback allow-list gains `org_addon_subscription`;
   `FEATURE_PRICES.solar = {model:'org_subscription', interval:'annual', amountKobo:199900}` and the existing
   one-time unlock route **rejects** subscription-model keys.
5. Tariff library (`tariffs.*`) SELECT requires `org_has_solar(caller's org)` or
   `is_platform_tariff_admin()`; writes only service role + platform admins through the review queue (D-03).

---

## 3. `solar` schema — tables

All tables: `organisation_id` bound from the project by BEFORE INSERT/UPDATE trigger (never trusted from
the client), `created_at`, `updated_at`, `created_by`. Soft-delete only where noted.

| Table | Key columns | Notes |
|---|---|---|
| `studies` | `project_id` UNIQUE, lat, lng, elevation_m, licensee_id, supply_type, nmd_kva, supply_voltage_v, poc_node_id → structure.nodes, export_mode, export_limit_kw, load_basis, reference_year, common_area_pct, diversity_factor, load_growth_pct, tariff_id, tariff_override_id, export_rule jsonb, escalation jsonb, selected_case_id, constraints_note | One per project |
| `roof_sources` | study_id, kind (drawing/satellite), floor_plan_id, page_index, file_path, source_revision_id, storage_path, m_per_px, north_bearing_deg, attribution | Anchor fields per `floor_plan_markups` |
| `meter_files` | org_id, sha256 UNIQUE per org, storage_path, original_name, parsed_filename jsonb, detected_format, delimiter, decimal_sep, header_row, encoding, status (parsed/accepted/skipped/failed), uploaded_by | Raw file kept once |
| `meters` | org_id, site_label, serial, label, shop_no, area_m2, area_source (register_exact / register_llm / filename / manual), kind (tenant/bulk/council/generator/solar/common/vacant/check/virtual/water/unknown), supply_point_confirmed bool, node_id → structure.nodes, parent_meter_id, existing_pv_channel_id | Org library |
| `meter_series_hashes` | org_id, body_hash, meter_id, file_id | Detects identical data filed under different names/sites (1,311 distinct series in 2,050 source files) |
| `meter_register` | org_id, site_label, file_name, tenant_name, shop_no, area_m2, match_method (exact / LLM / unmapped), confirmed_by | From consolidation summaries; LLM/unmapped rows never auto-applied |
| `study_meters` | study_id, meter_id | Study ↔ library link |
| `meter_channels` | meter_id, file_id, source_column, quantity, direction, unit (enum), interval_min, is_cumulative, tz_convention, is_primary | |
| `meter_readings` | channel_id, ts_end timestamptz, value numeric NULL, quality smallint; PK (channel_id, ts_end) | Upsert on PK ⇒ re-import is idempotent |
| `meter_import_reports` | file_id, report jsonb, accepted_by, accepted_at | |
| `tenant_load_basis` | study_id, node_id, source (metered/synthesised/excluded), meters jsonb [{meter_id, weight}], archetype, density_override_w_m2 | |
| `load_archetypes` | code, name, version, shape (8760 float4 array compressed), seasonal jsonb | Platform data |
| `site_load` | study_id, basis, reference_year, series (8760 float4, kW), md_monthly jsonb (kVA), built_at, inputs_hash | Derived cache |
| `tariff_overrides` + `tariff_override_charges` | study_id, base_tariff_id; charge rows as in `tariffs.charge` + reason | |
| `bill_checks` | study_id, month, entered values, modelled values | |
| `layouts` | study_id, name UNIQUE per study, roof_source_id, module_id, updated_at | |
| `layout_objects` | layout_id, kind (roof/obstruction/array/module_block/inverter/string/equipment/north), geometry jsonb (image px), pixels_per_meter snapshot, props jsonb | **Register in `isAnnotated()`** |
| `cases` | study_id, name, pv_source (layout/manual), layout_id, config jsonb (full case input), finance jsonb, updated_at | |
| `case_runs` | case_id, engine_version, inputs jsonb, inputs_hash, weather_dataset_id, tariff_ref jsonb, status, error, outputs jsonb (KPIs, monthly), hourly_path (Storage, 8760 columns compressed), run_by, started_at, finished_at | Immutable after finish |
| `weather_datasets` | source (pvgis_tmy/upload), lat_round, lng_round, fetched_at, storage_path, meta jsonb | Cache shared per org (lat/lng rounded to 0.01°) |
| `equipment` | org_id (NULL = platform catalogue), kind (module/inverter/battery), make, model, specs jsonb, retired_at | Never hard-deleted |
| `org_settings` | org_id, settings jsonb (versioned), updated_by | Defaults (§11 functional spec) |
| `proposals` | study_id, case_id, version, status, snapshot jsonb, pdf_path, pdf_sha256, share_token_hash, expires_at, issued_by/at, withdrawn_at | Token stored hashed |
| `proposal_events` | proposal_id, kind (issued/viewed/accepted/declined/withdrawn/expired), actor_name, actor_email, ip, user_agent, pdf_sha256, at | Append-only (no UPDATE/DELETE policies) |
| `installations`, `guarantees`, `downtime`, `monthly_report_notes`, `handover_items` | Operations (Phase 7) | Handover items reference E-Site document ids |
| `schematics` | study_id, name, description, floor_plan_id, page_index, file_path, source_revision_id | Anchored like `floor_plan_markups` |
| `schematic_cards` | schematic_id, meter_id, x, y, w, h (image px) | **Register in `isAnnotated()`** |
| `schematic_lines` | schematic_id, from_meter_id, to_meter_id, waypoints jsonb (image px), line_type | Also defines the meter hierarchy; **`isAnnotated()`** |
| `schedule_tasks` | work_item_id → projects.work_items (type `solar_task`), category, zone, start_date date, end_date date, progress, colour, sort_order, is_milestone | Dates as `date`, never timestamptz |
| `schedule_segments`, `schedule_dependencies` (type FS/SS/FF/SF, lag_days), `schedule_baselines` (+ baseline tasks), `schedule_filter_presets` (per user) | Gantt | |
| `solar.schedule_templates`, `handover_templates` | org_id, content jsonb | Org settings |
| `audit_events` | study_id, verb, object_ref, actor, at | Append-only; feeds Overview activity |

### 3.1 RLS pattern (every `solar.*` table with project scope)
- **SELECT** (PERMISSIVE): `solar.can_view(project_id)`. Money is kept in **separate tables**
  (`case_financials`, `case_run_financials`, `proposals`, `tariff_overrides`, `bill_checks`) whose SELECT is
  `solar.can_see_money(project_id)` — simpler to prove than column rules.
- **INSERT / UPDATE / DELETE**: a PERMISSIVE policy per verb on `solar.can_view` plus one RESTRICTIVE policy
  **per verb** on `solar.can_edit` (money tables: `solar.can_see_money`) — the `00200` shape.
- Org library tables (`meters`, `meter_files`, `meter_register`, `equipment` with org_id): SELECT when
  `org_has_solar(organisation_id)` and the caller is a member of that org with a Solar grant on any of its
  projects (or owner/admin); writes by the same with Edit level.
- Append-only tables: SELECT + INSERT policies only.
- **Impersonation assertions** (red first, then green): View user reads layout, cannot write, sees no money;
  Edit user writes inputs, sees no money; Edit + financials sees money; member without a grant reads nothing;
  client_viewer and supplier read nothing even if a grant row is forged; user from another org reads nothing;
  **lapsed subscription ⇒ nobody reads or writes, rows unchanged**; service-role bypass holds.

### 3.2 Storage buckets (private; signed URLs only)
`solar-meter-raw` (raw meter exports, path `<org>/<project>/<sha256>.<ext>`), `solar-runs` (8760 outputs),
`solar-weather`, `solar-roof-images` (satellite captures), `tariff-sources` (platform). Policies keyed on
the path's org/project segment + the same role/entitlement helpers. No public bucket.

---

## 4. `tariffs` schema (platform reference data)

```
tariffs.licensee          id, kind (eskom|municipal|metro|private|development_agency|industrial_private),
                          name, mdb_code, province (from the registry — never from the source file;
                          Sasol is filed under KZN), nersa_licence_no, parent_licensee_id
tariffs.licensee_alias    licensee_id, alias   -- misspelt/variant sheet names in the NERSA books
tariffs.source_document   id, licensee_id, kind (tariff_book|nersa_decision|eskom_schedule|rules|by_law),
                          title, financial_year, status (draft|final|nersa_approved), published_on,
                          storage_path, sha256, page_count, url, retrieved_at
tariffs.tariff_year       id, licensee_id, financial_year ('2026/27'), effective_from, effective_to,
                          approved_increase_pct, source_document_id,
                          state (ingesting|in_review|published|superseded)
                          UNIQUE (licensee_id, financial_year)
tariffs.tariff            id, tariff_year_id, code, name, family,
                          category (domestic|commercial|industrial|agricultural|bulk|public_lighting|sseg|wheeling|other),
                          metering (prepaid|conventional|both|unmetered),
                          structure (flat|ibt|seasonal|seasonal_ibt|tou|tou_ibt),
                          voltage_band, phase, transmission_zone, local_authority bool,
                          min/max_amps, min/max_kva, eligibility jsonb,
                          export_tariff_id → tariffs.tariff (e.g. Homeflex → Gen-Offset Homeflex; Eskom's
                          export credit is a separate tariff keyed by zone × voltage, not a component),
                          predecessor_tariff_id, is_legacy, notes
tariffs.charge            id, tariff_id, component (energy|legacy|basic|service|admin|network_capacity|
                          network_demand|transmission_network|gcc|ancillary|ers|affordability|lv_subsidy|
                          reactive|demand|capacity_amp|export_credit|wheeling_uos|loss_factor|other),
                          season (all|high|low), tou (all|peak|standard|off_peak), day_type,
                          block_min_kwh, block_max_kwh, block_basis (monthly|daily),
                          unit (c_per_kWh|R_per_kWh|R_per_month|R_per_day|R_per_kVA_month|R_per_kW_month|
                                R_per_A_month|c_per_kVArh|R_per_POD_day|pct) NOT NULL,
                          demand_basis (nmd|actual_md|peak_window_md|utilised_capacity),
                          amount_excl_vat numeric(14,6) NOT NULL, vat_rate numeric(5,4),
                          vat_basis (stated_excl|assumed_excl|stated_incl),
                          unit_inferred bool, inference_reason text   -- source units are wrong or absent often
                                                                      -- (Buffalo City, Gamagara, Ekurhuleni unitless)
                          source_document_id, source_locator jsonb ({page, sheet, cell, raw_text, raw_unit|null}),
                          extraction_method (parser|ai|manual), reviewed_by, reviewed_at
tariffs.tou_calendar      id, licensee_id, valid_from, valid_to, high_season_months int[],
                          source (published|assumed_eskom)   -- municipal books state seasons but never hours
tariffs.loss_factor       licensee_id, kind (dx_urban|dx_rural|tx), voltage_band, transmission_zone, factor
tariffs.tou_window        calendar_id, season, day_type (weekday|saturday|sunday), start_minute, end_minute, period
tariffs.holiday_rule      calendar_id, treated_as (saturday|sunday)   -- dates from the existing SA holiday table
tariffs.sseg_rule         licensee_id, tariff_year_id,
                          crediting (net_billing_tou|net_billing_flat|none),     -- Net-Billing Rules p8 §5.4
                          settlement_period (monthly), carry_forward (none|within_financial_year),
                          fy_end_month (Eskom 3, municipal 6),
                          cap_rule (kwh_per_tou_period|value_per_tou_period|energy_charges),
                          offsets (energy_only), forfeit_on_ownership_change bool, max_kva (1000),
                          requires_tou, requires_bidirectional_meter, source_document_id, locator (pp7–12)
tariffs.ingest_run        id, source_document_id, parser, status, stats jsonb, diff jsonb, started_by, at
```
Rules: VAT-exclusive storage; canonical units converted at ingestion with the raw string kept in
`source_locator` and **every inferred unit flagged** (`unit_inferred`, reason) for review; published rows
immutable (corrections = new version via review); read-all for entitled orgs, write service-role + review
UI only; Eskom calendar year changes 1 April, municipal 1 July.

**Source reality (verified 2026-09-28, as-is/09):** 9 province workbooks, 177 licensee sheets, ~7,650
valued rows, 2025/26 only; the column holding the value differs per province (B/C/D/E, or inside the label
text for Cape Town); some values carry the wrong unit label. **WM Solar's seed must not be loaded**: its
parser drops the Standard period on 307 of 325 TOU plans, tags off-peak as peak, stores 628 energy rows
100× low, leaves 387 plans empty, and the SQL does not load. E-Site parsers are written fresh (as-is/09 §7)
with the 10 golden cases there as tests.

Seed plan (Phase 2):
- **Eskom** 2025/26 (in the folder, official xlsm incl. Gen-offset export tariffs, loss factors and
  wheeling tables) + 2026/27 (to acquire): Megaflex, Miniflex, Nightsave, Ruraflex, Businessrate,
  Homepower, **Homeflex** (missed by WM's parser), Landrate, Municflex/Municrate, Gen-offset, WEPS.
- **Municipal** 2025/26 (folder) and 2026/27 (to acquire) for the 9 provinces so the YoY diff runs, plus
  the 8 metros' own books.
- **Municipal export (SSEG) rates:** the NERSA books hold one SSEG tariff in 177 licensees and no export
  rates. Until metro/municipal SSEG schedules are sourced, the export rate for a municipal customer is
  **user-supplied with provenance** on the Tariff tab (functional §5), and municipal TOU hours default to
  the Eskom calendar flagged `assumed_eskom`.

---

## 5. Security baseline (non-negotiable for the add-on)

1. No anon grants, no anon policies, no public buckets anywhere in `solar`/`tariffs`.
2. No service-role key in any client (web or mobile); no user-typed API keys (never ask users to paste
   an Anthropic key).
3. Every external API (PVGIS, geocoding, satellite tiles, LLM) called **server-side** with a server key,
   after role + entitlement checks, rate-limited per org, results cached.
4. Edge functions (if any) deploy with gateway JWT verification on and check project membership in code;
   function-to-function calls forward the caller's Authorization.
5. No `document.write`, no `innerHTML` from data (map popups, exports) — WM had three stored-XSS paths.
6. Share tokens: 32-byte random, stored hashed, expiring, revocable; acceptance records server-stamped.
7. Signed URLs ≤ 7 days for downloads; report reads gated by `REPORT_KIND_READ_ROLES`.
8. `docs/rbac-matrix.md` gains every Solar route/action row in the same PR that adds it.
9. New `notifications` types re-declare the full `notifications_type_check`; probes run with project email
   toggles off (WM projects resolve 12–13 real recipients).
