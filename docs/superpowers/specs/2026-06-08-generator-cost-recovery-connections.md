# Generator Cost-Recovery — Connection / Integration Map

**Date:** 2026-06-08 · **Companions:** `-design.md`, `-flows.md`, `-premortem.md`.

How the feature wires into esite — every existing system it touches, what's reused vs new, and the two end-to-end data paths. "Connection" = an integration point where this feature depends on, extends, or feeds an existing esite subsystem.

---

## 1. Schema & tables

| Object | New / Reuse | Connects to | Notes |
|--------|-------------|-------------|-------|
| `structure.nodes.shop_category` | **new column** | existing tenant nodes (`kind='tenant_db'`) | drives kW/m² rate; parser + backfill + `packages/db` types in the same PR |
| `structure.nodes` (tenants, `shop_area_m2`) | **reuse** | — | floor area is the loading input |
| `structure.nodes` (`kind='generator'`, `rating_kva`) | **reuse (read)** | gcr selects "largest gen" kVA | costing kept separate (see `gcr.zone_generators`) |
| `gcr.settings` | **new** | `projects.projects` (PK FK), `public.organisations` | one row per project; 18 tunables |
| `gcr.zones`, `gcr.zone_generators` | **new** | `projects.projects`, `public.organisations` | generator size + **cost** (capex) — has no home on `structure.nodes` |
| `gcr.tenant_assignments` | **new** | `structure.nodes` (tenant, PK FK ON DELETE CASCADE), `gcr.zones` (ON DELETE SET NULL) | holds `participation` (`shared`/`own`/`none`), `manual_kw_override` |
| `projects.reports` (kind `generator_cost_recovery`) | **reuse** | migration `00117` artifact table | versioned, branded, persisted PDF metadata |
| `billing.org_feature_seats` | **new** | `public.organisations`, `auth.users` (`assigned_user_id`, `purchased_by`) | the per-seat pool; UNIQUE partial index on `(org, feature_key, assigned_user_id)` |
| `billing.org_feature_unlocks` | **reuse (sibling)** | — | per-org unlocks (Inspections/JBCC) — the pattern we mirror, untouched |
| `billing.invoices` | **reuse** | `billingService.recordInvoice` | seat purchase audit row |

## 2. Scoping & RLS (connect to the access model)

- **Org scope:** every `gcr.*` row carries `organisation_id`; RLS read = `organisation_id = ANY(get_user_org_ids())`.
- **Project scope:** `gcr.settings/zones/assignments` carry `project_id`; visibility additionally bounded by `user_has_project_access(project_id)` (00106).
- **Seats:** `billing.org_feature_seats` RLS = org membership; the gate function `public.has_feature_seat(org, user, key)` is `SECURITY DEFINER` with `REVOKE EXECUTE … FROM PUBLIC` (esite RBAC-helper lesson) and the WM-Consulting bypass.
- **Service-role writes** to `gcr.*` / `billing.*` go through server actions that call `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` after the access guard (recurring esite rule: RLS-bypassing writes need an in-app role gate).

## 3. Routes, actions & functions

| Surface | New / Reuse | Connects to |
|---------|-------------|-------------|
| `apps/web/src/app/(admin)/projects/[id]/generator-report/*` (RSC pages) | **new** | `requireFeatureSeat()` guard, `gcr.*`, the report engine |
| `…/generator-report/*.actions.ts` (`'use server'`, async-only) | **new** | `gcr.*` writes (role-gated), report generation |
| `apps/web/src/app/api/paystack/feature-seat/route.ts` | **new (copy of `feature-unlock`)** | Paystack `transaction/initialize`, `FEATURE_PRICES`, `hasFeatureSeat` |
| `apps/web/src/app/api/paystack/webhook/route.ts` | **extend** | add a `metadata.type==='feature_seat'` branch → upsert `org_feature_seats` + `recordInvoice` |
| `apps/web/src/lib/features.ts` | **extend** | add `hasFeatureSeat` / `requireFeatureSeat` beside `hasFeature` |
| `public.has_feature_seat(uuid,uuid,text)` | **new SQL** | `org_feature_seats` |
| `packages/shared/src/services/billing.service.ts` `FEATURE_PRICES` | **extend** | add `generator_cost_recovery` (200 000 kobo, `model:'seat'`) |

## 4. Calculation engine (the shared core)

- `packages/shared/src/services/generator-cost-recovery/` — **pure, isomorphic**, no IO, no react-pdf. Imported by web RSC/actions (P3 report) and the settings UI defaults (P2).
- **Inputs** assembled from: `gcr.settings` + `gcr.zones`/`zone_generators` + tenants (`structure.nodes` area/category + `gcr.tenant_assignments` participation/override).
- **Output** `GeneratorCostRecoveryModel` → consumed by the report gatherer.
- **Verified** by golden-master vs nexus + independent oracle (see `-flows.md` test impact). **Never** import `@react-pdf/renderer` here (mobile bundle rule).

## 5. Report engine (reuse, don't rebuild)

- `apps/web/src/lib/reports/generator/` — **new "kind"** on the existing engine: reuse `resolveBranding`/`resolveAccent` (`branding.ts`, `theme.ts`; accent default `#E69500`), `Cover`/`Watermark` (`components.tsx`), interior primitives `RunningHeader`/`Section`/`Table` (`interior.tsx`); **4 logo roles** ① issuer (org `logo_url`) ② client (`projects.client_logo_url`) ③ project (`projects.project_logo_url`) ④ contractor (sub-org); `renderToBuffer` (Node only; vitest `// @vitest-environment node`); logos as `data:` URIs.
- Persist via the `projects.reports` saved-artifact pattern + `reports` storage bucket (org-scoped RLS, migration `00117`), with the **`branding_snapshot` JSONB frozen per issue** (mirrors `ResolvedBranding`).
- Charts dropped for MVP (Recharts has no react-pdf path); Appendix tables carry the money.

## 6. RBAC connections

- Configure / write → `ORG_WRITE_ROLES`. View cost report → `COST_VIEW_ROLES` **and** a seat. Buy/assign seats → owner/admin. Read-only `client_viewer` excluded from cost.

## 7. Mobile / PowerSync (watch-point)

- `apps/mobile` (Expo + PowerSync) syncs `structure.*`. Adding `shop_category` + (assignment) `participation` may touch **PowerSync sync rules**; verify even though MVP UI is web-only. The calc package is isomorphic and *could* later power a mobile view, but react-pdf stays web-only.

## 8. End-to-end data paths

**Generate a report**
```
Tenants/Settings UI ─▶ server action (requireEffectiveRole)
  ─▶ read gcr.settings + gcr.zones/zone_generators + structure.nodes(+gcr.tenant_assignments)
  ─▶ buildGeneratorCostRecovery()  [@esite/shared, pure]
  ─▶ gatherGeneratorReportData (+ branding, data: URI logos)
  ─▶ renderGeneratorReport() [react-pdf, Node]
  ─▶ upload PDF → `reports` bucket  +  insert projects.reports (kind=generator_cost_recovery)
  ─▶ UI: download / version list / outdated indicator
```

**Buy & grant a seat**
```
Admin (owner/admin) ─▶ POST /api/paystack/feature-seat {target_user_id}
  ─▶ guard already-has-seat (409)  ─▶ Paystack transaction/initialize
      metadata{ type:'feature_seat', feature_key, org_id, target_user_id }
  ─▶ Paystack checkout ─▶ charge.success webhook
  ─▶ /api/paystack/webhook (feature_seat branch): upsert billing.org_feature_seats
      (idempotent on paystack_reference) + billingService.recordInvoice
  ─▶ has_feature_seat(org,user,key) now TRUE ─▶ requireFeatureSeat passes ─▶ access
```

## 9. External dependencies

- **Paystack** — go-live (KYC) **pre-launch blocker** (`docs/paystack-go-live-roadmap.md`); build proceeds in test mode, selling waits for live.
- **engi-ops-nexus** — source-of-truth for the maths (golden-master fixtures); confirm `main` is canonical (WM).
- **No email/cron** in esite — distribution/scheduling deferred.
