# Design — Generator Cost-Recovery (Tenant Generator Report) as a per-seat paid extra

**Date:** 2026-06-08
**Status:** LOCKED 2026-06-08 — Arno: "all, in order recommended". D1–D9 + the §14 questions are locked to the recommended defaults (D2 admin-buys-&-assigns · D3 reassignable seat pool · D8 new `gcr.zone_generators` · R2 000 stacks per seat, no MVP cap · on-billing legality = a P5 pre-launch check owned by WM · **D10** tenant participation `shared`/`own`/`none` (opt-out handled) · **D11** opt-out absorption = remaining tenants, PROPOSED pending WM). All overridable at implementation-plan review.
**Companion:** pre-mortem `2026-06-08-generator-cost-recovery-premortem.md` (same folder).
**Source of truth (to clone):** `engi-ops-nexus` — the "Generator Report" feature (`src/utils/svg-pdf/generatorReportPdfBuilder.ts`, `src/components/tenant/Generator*`, `src/pages/GeneratorReport.tsx`). React/Vite + Supabase, project-scoped.

---

## 1. Context & Goal

Port the nexus **generator cost-recovery engine** into esite and sell it as a **per-seat one-time unlock (R2 000 per user)**. The feature apportions the capital + running cost of standby generators across the tenants of a multi-tenant building and produces a professional multi-page PDF cost-recovery report.

**Success = all three:**
1. **Technical** — an org can define generator zones/costs/settings, assign tenants (with floor area + category) to zones, and generate a PDF whose numbers are **identical** to nexus.
2. **Commercial** — users pay R2 000/seat to unlock; output is accurate enough to bill real tenants against.
3. **Operational** — ships without derailing esite's in-flight work and without an outsized accuracy/support liability.

**Non-negotiable from the pre-mortem (Top-5):** the calc is proven numerically equal to nexus (golden-master), the entitlement model is unambiguous, demand is validated by pre-sell, and the input data actually exists in the org.

---

## 2. Scope

**In (MVP):**
- Per-project generator settings, zones, generator costs, and tenant→zone assignment + category + **generator participation** (`shared`/`own`/`none`) — opt-out tenants excluded from load, apportionment, and board-mod capex.
- The full nexus calculation engine, ported as pure functions in `packages/shared`.
- A new **report "kind"** on the existing `apps/web/src/lib/reports/` engine, persisted to `projects.reports` (migration 00117), branded.
- **Per-seat** entitlement: a new `billing.org_feature_seats` mechanism + `has_feature_seat` guard + Paystack seat-purchase route + paywall.
- Web-only, **manual download/generate** from the project.
- A **readiness check** (missing area/category/cost) before report generation.

**Out (deferred fast-follow — needs infra esite lacks today):**
- Emailed tenant statements + scheduled/auto reports (esite has **no email or cron** infra).
- React Native mobile UI (the report is a back-office desk task).
- Per-zone diesel overrides beyond the single-settings model, unless nexus parity requires it.
- Charts in the PDF (see D4).

---

## 3. Decisions (LOCKED 2026-06-08)

| # | Decision | **Locked value** | Alternative (not taken) | Rationale |
|---|----------|--------------|-------------|-----------|
| **D1** | Pricing & feature key | `generator_cost_recovery`, **R2 000 = 200 000 kobo**, model `seat` | — | Per Arno 2026-06-08. |
| **D2** | Who buys a seat | **Owner/admin buys & assigns** a seat to a specific user (atomic buy→assign) | Self-serve: each user buys their own | esite convention: "only an organisation owner or admin can unlock paid features" (`/api/paystack/feature-unlock`). Keeps R2 000×seats spend under admin control. |
| **D3** | Seat lifecycle on staff turnover | **Seat pool** — a paid seat is an org-owned slot, **reassignable** to another user; freed (not forfeited) when a user is removed | Simple `(org,user)` unique row, forfeit on removal | At R2 000/seat, forfeiting on staff churn is the obvious customer grievance; reassignable seats avoid it for ~marginal extra complexity. |
| **D4** | PDF charts | **Drop charts for MVP**; ship the tables that carry the money (Appendix A/B/C) | Pre-render charts to static SVG/PNG server-side | nexus uses Recharts; `@react-pdf/renderer` can't render it. Tables are the billable substance. |
| **D5** | Platform | **Web-only** | + mobile | Configuration + generation is a desk task; keeps `@react-pdf` out of the mobile bundle (CLAUDE.md rule). |
| **D6** | Calc fidelity | **Exact port** of every nexus formula, golden-master tested | Simplify | The numbers bill real tenants; equality to the trusted source is the product. |
| **D7** | Tenant category | **Add `shop_category` to `structure.nodes`** (`standard` \| `fast_food` \| `restaurant` \| `national` \| `other`) + parser + backfill + UI + `packages/db` types in ONE PR | Keep category local to this feature | Category drives the kW/m² rate; nodes is the natural home and it's broadly useful. |
| **D8** | Generator capacity & cost source | **New `gcr_zone_generators` table** (size + cost per generator), zones own generators; tenants reference a zone | Reuse `structure.nodes kind='generator'` | nexus models zones→generators independently of the structure tree; the cost-recovery capex (cost per unit) has no home on `nodes`. Keep the structure tree and the recovery model decoupled (containment ≠ costing), mirroring esite's own "containment ≠ feed" principle. |
| **D9** | Schema namespace | New tables under a **`gcr` schema** (generator cost recovery), entitlement under **`billing`** | Put everything in `billing` or `projects` | Keeps a self-contained, droppable domain; `billing` already owns entitlements. |
| **D10** | Tenant generator participation | **3-state `participation`** (`shared`/`own`/`none`) on `gcr.tenant_assignments`, replacing binary `own_generator` | Keep binary `own_generator` | A tenant who *didn't sign up* (`none`) is distinct from one with their *own* generator (`own`); both excluded, but the model must say which. `own`+`none` → 0 load, 0 apportionment, **not** counted in board-mod capex. See `-flows.md` Flow P. |
| **D11** | Opt-out absorption rule | **PROPOSED: remaining `shared` tenants absorb** the opted-out portion (natural pro-rata — excluded from the denominator) | Landlord / common-area absorbs | Pending WM. Applies to opex **and** capex recovery; the alternative changes the apportionment formula. |

---

## 4. Architecture — where each piece lives

| Layer | Location | Notes |
|-------|----------|-------|
| **Calc engine** (pure) | `packages/shared/src/services/generator-cost-recovery/` | Pure TS, no IO. Unit + golden-master tested. Reusable by web now, mobile later. |
| **Generator sizing table** (fuel l/h per size) | `packages/shared/src/services/generator-cost-recovery/sizing-table.ts` | Ported verbatim from nexus `generatorSizing.ts` (24 sizes, interpolated by load %). |
| **DB schema** | `apps/edge-functions/supabase/migrations/00122_…`, `00123_…` | Next number is **00122** (live = 00121). Auto-applies on merge to `main` via `deploy-migrations.yml`. |
| **Server actions** | `apps/web/src/app/(admin)/projects/[id]/generator-report/*.actions.ts` | `'use server'` → async-only. Service-role writes gated by `requireEffectiveRole`. |
| **Report (react-pdf)** | `apps/web/src/lib/reports/generator/` | New "kind" reusing `Cover`/interior primitives/`resolveBranding`; Node-only render; persist to `projects.reports`. |
| **Entitlement guard** | `apps/web/src/lib/features.ts` (extend) | Add `hasFeatureSeat` / `requireFeatureSeat`. |
| **Paystack** | `apps/web/src/app/api/paystack/feature-seat/route.ts` + webhook branch | Copy `feature-unlock/route.ts`; new `metadata.type='feature_seat'`. |
| **UI** | `apps/web/src/app/(admin)/projects/[id]/generator-report/` + `…/unlock` paywall + a seat-management panel in settings/billing | shadcn/ui, react-hook-form + zod, `StickySaveBar` patterns. |

**Hard implementation rules (from esite CLAUDE.md — do not relitigate):**
- react-pdf engine stays in `apps/web/src/lib/reports/`, **never** `packages/shared` (mobile bundle).
- `renderToBuffer` is Node-only → vitest files use `// @vitest-environment node`; pass image bytes as `data:` URIs, not signed URLs; `apps/web` is on **React 19**.
- `'use server'` files export **only** async functions.
- Any service-role (RLS-bypassing) write to `gcr.*` / `billing.*` / `structure.*` must call `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` after the access guard.
- Management-API applies don't write the migration ledger — prefer the deploy workflow, or record the version.

---

## 5. Data model (migrations 00122–00123)

### 5.1 `structure.nodes` — add category (00122, the D7 PR)
```sql
ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS shop_category TEXT
  CHECK (shop_category IN ('standard','fast_food','restaurant','national','other'));
```
Paired in the SAME PR: tenant-import-parser accepts a category column; backfill existing tenants to `'standard'` (or NULL → treated as `standard` in calc, but prefer explicit backfill to avoid the F4 silent-default trap); tenant UI category picker; `pnpm db:gen-types`.

### 5.2 `gcr` domain (00123)
```sql
CREATE SCHEMA IF NOT EXISTS gcr;

-- One settings row per project (mirrors nexus generator_settings)
CREATE TABLE gcr.settings (
  project_id           UUID PRIMARY KEY REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id      UUID NOT NULL REFERENCES public.organisations(id),
  -- loading rates (kW/m²)
  standard_kw_per_sqm   NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  fast_food_kw_per_sqm  NUMERIC(10,4) NOT NULL DEFAULT 0.045,
  restaurant_kw_per_sqm NUMERIC(10,4) NOT NULL DEFAULT 0.045,
  national_kw_per_sqm   NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  -- capital recovery
  capital_recovery_period_years   INTEGER NOT NULL DEFAULT 10,
  capital_recovery_rate_percent   NUMERIC(5,2) NOT NULL DEFAULT 12.00,
  -- board & cabling capex
  rate_per_tenant_db    NUMERIC NOT NULL DEFAULT 0,
  num_main_boards       INTEGER NOT NULL DEFAULT 0,
  rate_per_main_board   NUMERIC NOT NULL DEFAULT 0,
  additional_cabling_cost NUMERIC NOT NULL DEFAULT 0,
  control_wiring_cost   NUMERIC NOT NULL DEFAULT 0,
  -- operational
  diesel_cost_per_litre NUMERIC NOT NULL DEFAULT 23.00,
  running_hours_per_month NUMERIC NOT NULL DEFAULT 100,
  maintenance_cost_annual NUMERIC NOT NULL DEFAULT 18800,
  power_factor          NUMERIC NOT NULL DEFAULT 0.95,
  running_load_percentage NUMERIC NOT NULL DEFAULT 75,
  maintenance_contingency_percent NUMERIC NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gcr.zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  zone_name       TEXT NOT NULL,
  zone_number     INTEGER NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, zone_number)
);

CREATE TABLE gcr.zone_generators (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id          UUID NOT NULL REFERENCES gcr.zones(id) ON DELETE CASCADE,
  generator_number INTEGER NOT NULL,
  generator_size   TEXT,            -- e.g. '250 kVA' (keys into the sizing table)
  generator_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
  UNIQUE (zone_id, generator_number)
);

-- tenant→zone assignment + generator participation (shared/own/none) + manual override.
-- Tenants are structure.nodes (kind='tenant_db'); keep gcr decoupled via a join row.
CREATE TABLE gcr.tenant_assignments (
  node_id          UUID PRIMARY KEY REFERENCES structure.nodes(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  zone_id          UUID REFERENCES gcr.zones(id) ON DELETE SET NULL,
  participation    TEXT NOT NULL DEFAULT 'shared'
                     CHECK (participation IN ('shared','own','none')),  -- shared=on building genset · own=own generator · none=opted out / not connected
  manual_kw_override NUMERIC,        -- overrides area×rate when set (shared only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
RLS on all `gcr.*`: `organisation_id = ANY(get_user_org_ids())` for read; writes additionally gated app-side by `requireEffectiveRole(... ORG_WRITE_ROLES)`. Report **viewing** (cost) gated by `COST_VIEW_ROLES` (owner/admin/PM).

**Report persistence:** reuse `projects.reports` (00117) with a new `kind = 'generator_cost_recovery'`; PDF bytes to the existing `reports` storage bucket. No new reports table.

### 5.3 Per-seat entitlement (00123, `billing` schema)
```sql
CREATE TABLE billing.org_feature_seats (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  feature_key        TEXT NOT NULL,
  assigned_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = free slot (D3 pool)
  paystack_reference TEXT UNIQUE,            -- webhook idempotency; NULL for manual grants
  amount_paid_kobo   BIGINT,
  purchased_by       UUID REFERENCES auth.users(id),
  purchased_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at        TIMESTAMPTZ,
  notes              TEXT
);
-- a user holds at most one seat per feature per org
CREATE UNIQUE INDEX uq_org_feature_seats_assignment
  ON billing.org_feature_seats (organisation_id, feature_key, assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.has_feature_seat(p_org_id UUID, p_user_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid   -- WM-Consulting platform-owner bypass
    OR EXISTS (
      SELECT 1 FROM billing.org_feature_seats
      WHERE organisation_id = p_org_id
        AND feature_key = p_feature_key
        AND assigned_user_id = p_user_id
    );
$$;
REVOKE EXECUTE ON FUNCTION public.has_feature_seat(UUID,UUID,TEXT) FROM PUBLIC;  -- per esite RBAC-helper lesson
```
Mirrors the existing per-org `has_feature` exactly, adding the user axis. The WM-Consulting bypass is preserved so the platform owner never pays.

---

## 6. Calculation engine (the IP — exact port)

> **Reconciliation 2026-06-09 — engine BUILT + golden-master-verified** against nexus's *billed PDF* path (`packages/shared/src/services/generator-cost-recovery/`, `__fixtures__/nexus-golden/`, 27/27). This caught & fixed real divergences vs an earlier hand-transcription: annual→**monthly** PMT (R14 748.68→**R14 347.09**), diesel no longer ×runningHours, nexus's real maintenance formula, the fuel interpolation, and the rate mapping. **⚠ WM to confirm:** (1) nexus `main` is canonical; (2) the maintenance **no-`max(0,…)`** quirk (billed PDF vs nexus's clamped interactive calculator); (3) honour 4 distinct category rates or keep nexus's 2-tier behaviour; (4) whether opt-out (`none`) tenants incur a tenant-DB capital line (nexus counts `!ownGenerator`, so it would).

Pure functions in `packages/shared/src/services/generator-cost-recovery/`. Inputs: settings + zones/generators + tenants (area, category, own_generator, manual_kw_override). Ported verbatim from nexus:

- **Tenant loading:** `loadKw = participation === 'shared' ? (manual_kw_override ?? area_m2 × rate[category]) : 0` (`own`/`none` → 0). **Rate mapping (nexus billed path): `restaurant`/`fast_food` → `restaurantKwPerSqm` (0.045); `standard`/`national`/`other` → `standardKwPerSqm` (0.03)** — only two effective tiers (see WM item 3 above).
- **Total capex:** `Σ generator_cost + additional_cabling_cost + boardModCost + control_wiring_cost`, where `boardModCost = numTenantDBs × rate_per_tenant_db + num_main_boards × rate_per_main_board`, `numTenantDBs = count(tenants with participation === 'shared')` (own + opted-out boards excluded).
- **Capital recovery (PMT — MONTHLY compounding, per nexus):** `i = (rate%/100)/12`, `N = years×12`; `monthlyCapitalRepayment = capex × i(1+i)^N / ((1+i)^N − 1)`. *Not* annual-compounding÷12 — e.g. R1 000 000 @12%/10y → **R14 347.09/mo** (not R14 748.68).
- **Operational tariff (R/kWh — reconciled to nexus billed path):** `largestGen` = max by `parseInt(size)` kVA across all zones; `netKva = largestGenKva × runningLoad%/100`; `netKwh = netKva × powerFactor`; **`dieselR/kWh = (fuelConsumption × dieselPrice) / netKwh`** (cost *per hour* ÷ netKwh — running hours are **not** a factor); **`maintR/kWh = additional / (netKwh × runningHours)`** where `additional = (runningHours/250)×maintenanceCostAnnual − maintenanceCostAnnual/12` (**no `max(0,…)` clamp** — can go negative below ~20.8 h/mo; WM item 2); `finalTariff = (dieselR/kWh + maintR/kWh) × (1 + contingency%/100)`.
- **Apportionment:** `totalActiveLoad = Σ loadKw (participation === 'shared')`; per tenant `portion% = loadKw/totalActiveLoad×100`, `monthlyRental = loadKw/totalActiveLoad × monthlyCapitalRepayment`, `ratePerSqm = monthlyRental / area`. `own`/`none` tenants → 0, listed in the report as "Not on generator — R0" (D11 default: remaining `shared` tenants absorb the opted-out portion).

**Golden-master gate (pre-mortem F1, mandatory):** before merging the engine, extract fixtures from **3–5 real nexus projects** — inputs + every intermediate + the final Appendix A/B/C tables — and assert exact numeric equality in CI. Pin rounding rules. No engine merges with a failing or absent fixture.

---

## 7. Report (new react-pdf "kind") — fully branded

`apps/web/src/lib/reports/generator/`: `gatherGeneratorReportData` (RBAC gate, service-client name resolution, logos fetched as `data:` URIs) → `GeneratorReportDocument` → `renderGeneratorReport(): Buffer` (Node only). **Reuses esite's branding engine verbatim — do not invent a parallel look.**

- **Branding resolve:** `resolveBranding` / `resolveAccent` (`apps/web/src/lib/reports/branding.ts`, `theme.ts`) → `ResolvedBranding { accent, issuer{logoSrc|wordmark}, parties[], title, kicker, projectLine, footerStamp }`. Accent precedence `project.report_accent_color ?? org.report_accent_color ?? '#E69500'`. **Four logo roles:** ① issuer = org (`organisations.logo_url`, wordmark fallback in accent) · ② client (`projects.client_logo_url`, label "Prepared for") · ③ project mark (`projects.project_logo_url`, "Project") · ④ contractor = sub-org ("Contractor"). Missing slots are omitted, not placeheld.
- **Cover** (`components.tsx`): 3px accent rule → issuer logo/wordmark → kicker/title/`projectLine` → "Prepared with" parties strip (②③④) → fixed footer (`footerStamp` + page x/y).
- **Interior** (`interior.tsx`): `RunningHeader` (issuer + page x/y) fixed on every page; each section a 2px accent rule + 13px heading; `Table` primitive for appendices; optional `RunningFooter` (contractor logo + accent hairline). **`Watermark`** ("PREVIEW", 72px, −45°, ~25%) only when `status='draft'`.
- **Document structure** (nexus content, esite branding): Cover → Glossary → ToC → **Narrative** (Executive summary · Methodology & load provision · Cost structure · Tenant allocation approach · Recommendations) → **Appendix A** (capital cost breakdown) → **Appendix B** (capital recovery schedule + operational tariff) → **Appendix C** (tenant load allocation; opt-outs shown as "Not on generator — R0"; reconciliation line Σ = monthly repayment).
- **Persist** via `projects.reports` (kind `generator_cost_recovery`) with the **`branding_snapshot` JSONB frozen per issue** (mirrors `ResolvedBranding`); PDF bytes → `reports` bucket. The report is a white-paper Helvetica artifact (distinct from the dark app chrome). Charts dropped (D4). Deploy-verify the render (React-19 react-pdf trap).

---

## 8. Per-seat entitlement flow

1. **Paywall** — a user without a seat hitting `/projects/[id]/generator-report` is redirected by `requireFeatureSeat(orgId, userId, 'generator_cost_recovery', supabase, '/generator-report/unlock')`. The unlock page explains: "R2 000 once-off per user. Your admin assigns seats." (D2)
2. **Purchase** — `POST /api/paystack/feature-seat` (copied from `feature-unlock/route.ts`): auth → resolve caller's org, **owner/admin only** (D2); body carries the **target `user_id`**; 409 if that user already holds a seat; initialise Paystack `transaction/initialize` with `metadata: { type:'feature_seat', feature_key, org_id, target_user_id, amount_kobo }`.
3. **Webhook** — in `/api/paystack/webhook` add a branch `metadata.type === 'feature_seat'`: idempotent upsert into `billing.org_feature_seats` on `paystack_reference` (`assigned_user_id = target_user_id`); record a `billing.invoices` row (existing `recordInvoice`, already idempotent).
4. **Manage** — a seats panel (settings/billing): see purchased seats, assign/reassign `assigned_user_id` (admin, D3), freed automatically when a user is removed (FK `ON DELETE SET NULL`).
5. **Pricing source** — extend `FEATURE_PRICES` in `billing.service.ts` with `generator_cost_recovery` and a `model: 'seat'` discriminator (existing entries get `model: 'org'`); the guard + route choose per-seat vs per-org off `model`.

---

## 9. Input capture + readiness (pre-mortem F8)

First-class, not an afterthought: a category picker on tenants; a generator-report **setup** screen (zones, generators+costs, settings form for diesel/run-hours/recovery/rates); tenant zone-assignment + own-generator toggle. Before "Generate report" is enabled, a **readiness check** lists gaps ("12 of 40 tenants missing area, category, or generator participation; no generator costs entered") so the failure is visible and self-serviceable rather than a silent wrong number.

---

## 10. RBAC

- **Configure** generator settings/zones/costs, **buy/assign** seats → **owner/admin** (purchase) and **ORG_WRITE_ROLES** owner/admin/PM (configuration).
- **Generate/view** the report (it shows cost) → **COST_VIEW_ROLES** = owner/admin/PM, AND the acting user must hold a **seat**.
- All `gcr.*` RLS org-scoped; service-role writes additionally `requireEffectiveRole`-gated.

---

## 11. Testing

- **Golden-master** numeric equality vs nexus fixtures (§6) — the gate.
- Unit tests for each pure calc function + the sizing-table interpolation edge cases (load between table rows, smallest/largest sizes, zero active load, all-own-generator).
- RLS tests: cross-org isolation on `gcr.*` and `org_feature_seats`.
- Entitlement tests: `has_feature_seat` truth table (no seat / assigned / reassigned / WM bypass); webhook idempotency on duplicate delivery; 409 on double-buy.
- Report render is **deploy-verified** (Node runtime, React 19 react-pdf trap) on a seeded throwaway project, per the esite "deploy-verify the render" lesson.

---

## 12. Phasing

- **P0 — pre-build gate (no code):** pre-sell ≥2 orgs at R2 000/seat; lock D1–D9; WM confirms nexus `main` is canonical; capture golden-master fixtures.
- **P1 — engine:** port calc + sizing table to `packages/shared`; golden-master CI green.
- **P2 — data + capture:** migrations 00122 (`shop_category` PR) + 00123 (`gcr.*` + `org_feature_seats`); setup/zone/settings/assignment UI + readiness check.
- **P3 — report:** new react-pdf kind; persist to `projects.reports`; deploy-verify render.
- **P4 — entitlement:** `FEATURE_PRICES` + `has_feature_seat` + guard + `/api/paystack/feature-seat` + webhook branch + paywall + seats panel.
- **P5 — launch:** gated behind Paystack live-mode go-live; validate on-billing methodology on one real lease.

---

## 13. Risks → see the pre-mortem
Top-5 build-time mitigations are folded into this design: golden-master (F1, §6/§11), per-seat model made explicit (F6, §5.3/§8), pre-sell gate (F7, §12 P0), readiness check (F8, §9), report-kind reuse (F2, §7). Most-overlooked assumption to validate before customers bill tenants: **on-billing legality** (§12 P5).

---

## 14. Resolved decisions (2026-06-08 — "all, in order recommended")
1. **D2** — **admin buys & assigns** seats (matches esite billing authority). Self-serve deferred.
2. **D3** — **reassignable seat pool** — a freed seat returns to the org, not forfeited on staff turnover.
3. **D8** — **new `gcr.zone_generators`** table; the structure tree stays decoupled from the costing model.
4. **R2 000 stacks literally per seat**, **no org-wide cap in MVP** (10 users = R20 000). Commercial watch-item (pre-mortem F7) — revisit only if a large org balks.
5. **On-billing legality** — a **P5 pre-launch validation owned by WM** (one real lease + municipal/NERSA check) before any customer bills tenants off the report. Not a blocker to building.
6. **D10 — tenant participation** — `shared`/`own`/`none`; `own`+`none` excluded from load, apportionment, and board-mod capex; opt-outs shown in the report as "Not on generator — R0". Replaces binary `own_generator`. (See `-flows.md` Flow P; `-connections.md` §1.)
7. **D11 — opt-out absorption rule** — PROPOSED: remaining `shared` tenants absorb the opted-out portion (natural pro-rata). Alternative (landlord/common-area absorbs) **pending WM**; applies to opex + capex.

_All overridable during implementation-plan review._
