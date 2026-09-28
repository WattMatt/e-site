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
| `solar` (new) | Per-project study data: studies, meters, readings, layouts, cases, runs, proposals, operations | New exposed schema → needs the `00126` checklist: GRANT USAGE + default privileges to `authenticated`, `service_role` (**no anon**), add to `config.toml [api].schemas`, **PATCH production PostgREST `db_schema` via the Management API**, `NOTIFY pgrst`. Without the PATCH, REST returns `PGRST002` indefinitely. **[D-22]** alternative: put tables in `projects` to avoid the PATCH. |
| `tariffs` (new) | Platform reference data: licensees, source documents, tariff years, tariffs, charges, TOU calendars, SSEG rules | Same checklist. Read by every authenticated user whose org has any Solar entitlement **[D-03]**; written only by the service role and platform tariff admins through the review workflow. |
| `billing` (existing) | `project_feature_unlocks` (new), optional `org_addon_subscriptions` (new) | Existing schema |
| `projects` (existing) | `reports` rows for new kinds | Existing |

Large meter readings volume (≈ 17,520 rows per channel-year at 30 min; a 40-tenant mall ≈ 1.4 M
rows/yr) lives in `solar.meter_readings`, partitioned by `organisation_id` hash **[D-23]**, or as Parquet
in Storage with only hourly aggregates in Postgres. Decision gate at Phase 3 with a volume test.

---

## 2. Entitlement (per project)

### 2.1 Tables
```sql
billing.project_feature_unlocks (
  id uuid pk, organisation_id uuid not null,          -- bound to the project's org by BEFORE trigger
  project_id uuid not null references projects.projects on delete cascade,
  feature_key text not null check (feature_key in ('solar')),
  paystack_reference text unique not null,
  amount_paid_kobo bigint not null,
  unlocked_at timestamptz not null default now(), unlocked_by uuid,
  notes text, revoked_at timestamptz, revoked_reason text)
unique (project_id, feature_key) where revoked_at is null
-- RLS: SELECT for user_has_project_access(project_id); no client writes (service role only)
```
Optional org-wide subscription **[D-01]**: `billing.org_addon_subscriptions(organisation_id, feature_key,
status, paystack_subscription_code, current_period_end)` on the MV-subscription pattern.

### 2.2 Helper
`public.has_project_feature(p_project_id uuid, p_feature_key text) returns boolean` — SECURITY DEFINER,
`SET search_path = ''`, true when (active unlock row) OR (active org add-on subscription for the project's
org) OR (project's org = WM-Consulting internal bypass, consistent with `has_feature`). `REVOKE ALL FROM
PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role`. `@verify`: `anon_execute_absent`, plus a
`behaviour` directive proving a locked project returns false.

### 2.3 Enforcement points (all four, not just the page)
1. `projects/[id]/solar/(gated)/layout.tsx`: role gate (`requireEffectiveRole(... SOLAR_TECH_READ_ROLES).ok`) then
   `requireProjectFeature(projectId,'solar','/projects/[id]/solar/unlock')`.
2. Every server action and `app/api/projects/[id]/solar/*` route re-checks role + entitlement.
3. **Database:** RESTRICTIVE write policies on every `solar.*` table include `has_project_feature(project_id,'solar')`
   (split per verb — a RESTRICTIVE `FOR ALL` also narrows reads, the `00205` lesson). Reads stay allowed
   when revoked (read-only state, **[D-02]**).
4. Purchase: `POST /api/paystack/project-feature-unlock` (org derived from the **project**; caller must be
   `OWNER_ADMIN` of that org; 409 when active); webhook branch `metadata.type === 'project_feature_unlock'`
   (idempotent on `paystack_reference`, duplicate-purchase handling as today), refund/reversal branch sets
   `revoked_at`; callback allow-list gains the type; `FEATURE_PRICES.solar = {model:'project', amountKobo:[D-01]}`
   and the existing org unlock route must **reject** `model:'project'` keys.

---

## 3. `solar` schema — tables

All tables: `organisation_id` bound from the project by BEFORE INSERT/UPDATE trigger (never trusted from
the client), `created_at`, `updated_at`, `created_by`. Soft-delete only where noted.

| Table | Key columns | Notes |
|---|---|---|
| `studies` | `project_id` UNIQUE, lat, lng, elevation_m, licensee_id, supply_type, nmd_kva, supply_voltage_v, poc_node_id → structure.nodes, export_mode, export_limit_kw, load_basis, reference_year, common_area_pct, diversity_factor, load_growth_pct, tariff_id, tariff_override_id, export_rule jsonb, escalation jsonb, selected_case_id, constraints_note | One per project |
| `roof_sources` | study_id, kind (drawing/satellite), floor_plan_id, page_index, file_path, source_revision_id, storage_path, m_per_px, north_bearing_deg, attribution | Anchor fields per `floor_plan_markups` |
| `meter_files` | org_id, sha256 UNIQUE per org, storage_path, original_name, parsed_filename jsonb, detected_format, delimiter, decimal_sep, header_row, encoding, status (parsed/accepted/skipped/failed), uploaded_by | Raw file kept once |
| `meters` | org_id, site_label, serial, label, shop_no, area_m2, kind, node_id → structure.nodes, parent_meter_id, nets_existing_pv bool | Org library |
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
- **SELECT** (PERMISSIVE): `user_has_project_access(project_id)` AND
  `coalesce(user_effective_project_role(project_id),'') in (SOLAR_TECH_READ_ROLES)`; financial columns are
  not split by RLS — cost-bearing tables (`cases.finance`, `case_runs.outputs` money fields, proposals,
  tariff overrides, bill checks) get a RESTRICTIVE SELECT requiring `COST_VIEW_ROLES`, or the money is
  moved into separate `*_financial` tables **[D-04]** (preferred: separate tables, simpler to prove).
- **INSERT / UPDATE / DELETE**: one RESTRICTIVE policy **per verb** requiring
  `user_effective_project_role(project_id) in (SOLAR_WRITE_ROLES)` AND `has_project_feature(project_id,'solar')`,
  plus a PERMISSIVE policy per verb on `user_has_project_access` (the `00200` shape).
- Org library tables (`meters`, `meter_files`, `equipment` with org_id): access by
  `organisation_id = any(get_user_org_ids())` for SELECT; writes by org role in `SOLAR_WRITE_ROLES`.
- Append-only tables: SELECT + INSERT policies only.
- **Impersonation assertions** (red first, then green) for: contractor reads layout but not finance;
  client_viewer reads nothing; a user from another org reads nothing; revoked project refuses writes but
  allows reads; service role bypass holds.

### 3.2 Storage buckets (private; signed URLs only)
`solar-meter-raw` (raw meter exports, path `<org>/<project>/<sha256>.<ext>`), `solar-runs` (8760 outputs),
`solar-weather`, `solar-roof-images` (satellite captures), `tariff-sources` (platform). Policies keyed on
the path's org/project segment + the same role/entitlement helpers. No public bucket.

---

## 4. `tariffs` schema (platform reference data)

```
tariffs.licensee          id, kind (eskom|municipal|metro|private), name, mdb_code, province,
                          nersa_licence_no, parent_licensee_id
tariffs.source_document   id, licensee_id, kind (tariff_book|nersa_decision|eskom_schedule|rules|by_law),
                          title, financial_year, status (draft|final|nersa_approved), published_on,
                          storage_path, sha256, page_count, url, retrieved_at
tariffs.tariff_year       id, licensee_id, financial_year ('2026/27'), effective_from, effective_to,
                          approved_increase_pct, source_document_id,
                          state (ingesting|in_review|published|superseded)
                          UNIQUE (licensee_id, financial_year)
tariffs.tariff            id, tariff_year_id, code, name, family, category, metering (prepaid|conventional|both),
                          structure (flat|ibt|tou|tou_ibt), voltage_band, phase, min/max_amps, min/max_kva,
                          eligibility jsonb, predecessor_tariff_id, is_legacy, notes
tariffs.charge            id, tariff_id, component (energy|legacy|basic|service|admin|network_capacity|
                          network_demand|transmission_network|gcc|ancillary|ers|affordability|lv_subsidy|
                          reactive|demand|capacity_amp|export_credit|wheeling_uos|loss_factor|other),
                          season (all|high|low), tou (all|peak|standard|off_peak), day_type,
                          block_min_kwh, block_max_kwh, block_basis (monthly|daily),
                          unit (c_per_kWh|R_per_kWh|R_per_month|R_per_day|R_per_kVA_month|R_per_kW_month|
                                R_per_A_month|c_per_kVArh|R_per_POD_day|pct) NOT NULL,
                          demand_basis (nmd|actual_md|peak_window_md|utilised_capacity),
                          amount_excl_vat numeric(14,6) NOT NULL, vat_rate numeric(5,4),
                          source_document_id, source_locator jsonb ({page, sheet, cell, raw_text, raw_unit}),
                          extraction_method (parser|ai|manual), reviewed_by, reviewed_at
tariffs.tou_calendar      id, licensee_id, valid_from, valid_to, high_season_months int[]
tariffs.tou_window        calendar_id, season, day_type (weekday|saturday|sunday), start_minute, end_minute, period
tariffs.holiday_rule      calendar_id, treated_as (saturday|sunday)   -- dates from the existing SA holiday table
tariffs.sseg_rule         licensee_id, tariff_year_id, crediting (net_billing|none), settlement_period,
                          cap_rule, requires_tou, requires_bidirectional_meter, source_document_id, locator
tariffs.ingest_run        id, source_document_id, parser, status, stats jsonb, diff jsonb, started_by, at
```
Rules: VAT-exclusive storage; canonical units converted at ingestion with the raw string kept in
`source_locator`; published rows immutable (corrections = new version via review); read-all for
entitled orgs, write service-role + review UI only; Eskom calendar year changes 1 April, municipal 1 July.

Seed plan (Phase 2): Eskom 2025/26 + 2026/27 (all standard families incl. Megaflex, Miniflex, Nightsave,
Ruraflex, Businessrate, Homepower, Homeflex, Landrate, Municflex/Municrate, Gen-offset/WEPS),
NERSA-approved municipal 2026/27 for the 9 provinces (the folder holds 2025/26 — both to be ingested so the
YoY diff runs), plus the 8 metros' own books, plus SSEG rules for licensees where published.

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
