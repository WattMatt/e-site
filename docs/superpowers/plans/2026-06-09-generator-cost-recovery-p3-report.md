# Generator Cost-Recovery — P3: Branded Report (preview) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Generate a branded, downloadable **Generator Cost-Recovery PDF** (cover → Appendix A capital cost → Appendix B capital recovery + operational tariff → Appendix C tenant allocation) from the P1 engine + P2 data, wired to the Tenants tab's "Generate report" button.

**Architecture:** Mirror esite's existing report engine 1:1 — a `gatherGeneratorReportData(projectId)` (RBAC-gated load + branding), a `GeneratorReportDocument` react-pdf component reusing `Cover`/`RunningHeader`/`Section`/`Table`, a `renderGeneratorReport()` → Buffer, and a Node-runtime route returning the PDF inline. **Preview-only** (no persistence) — consistent with the inspection & snag reports today.

**Tech Stack:** `@react-pdf/renderer` (Node runtime; React 19), `@esite/shared` engine, Next 15 route handler.

**Spec:** `../specs/2026-06-08-generator-cost-recovery-design.md` §7. **Mirror exactly:** `apps/web/src/lib/reports/{inspection-report-data.ts, inspection-report.tsx, render-inspection.ts, branding.ts, theme.ts, components.tsx, interior.tsx}` and the route `apps/web/src/app/api/projects/[id]/inspections/[inspectionId]/report-preview/route.ts`.

**Scope:** the preview report only. **Out (fast-follows):** persistence to `projects.reports` (not built for any kind yet); the expanded content (narrative · plant-sizing · figures · VAT · amortisation schedule · centre grouping). Charts stay out (D4).

## Plan index
P1 engine *(done)* → P2 data + capture *(done)* → **P3 report (preview)** *(this)* → P3b persistence + expanded content → P4 per-seat billing.

## File structure
```
packages/shared/src/services/generator-cost-recovery/capital-breakdown.ts (+ .test.ts)   # pure: capex components
apps/web/src/lib/reports/generator-report-data.ts        # GeneratorReportData type + gatherGeneratorReportData
apps/web/src/lib/reports/generator-report.tsx            # GeneratorReportDocument (Cover + A/B/C)
apps/web/src/lib/reports/render-generator.ts (+ .test.ts // @vitest-environment node)
apps/web/src/app/api/projects/[id]/generator-cost-recovery/report-preview/route.ts
apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/TenantsPanel.tsx  # wire the Generate button
```

---

### Task 1: Capital-cost breakdown (pure) + report-data gatherer

**Files:** Create `packages/shared/src/services/generator-cost-recovery/capital-breakdown.ts` (+ test); Create `apps/web/src/lib/reports/generator-report-data.ts`

- [ ] **Step 1 (TDD):** `capital-breakdown.ts` exports `capitalCostBreakdown(zones, tenants, settings)`:
```typescript
import type { GeneratorSettings, ZoneInput, TenantInput } from './types'
export interface CapitalBreakdown { generators: number; boardMods: number; cabling: number; controlWiring: number; total: number }
export function capitalCostBreakdown(zones: ZoneInput[], tenants: TenantInput[], s: GeneratorSettings): CapitalBreakdown {
  const generators = zones.reduce((sum, z) => sum + z.generators.reduce((g, gen) => g + gen.cost, 0), 0)
  const numTenantDBs = tenants.filter(t => t.participation === 'shared').length
  const boardMods = numTenantDBs * s.ratePerTenantDb + s.numMainBoards * s.ratePerMainBoard
  const cabling = s.additionalCablingCost
  const controlWiring = s.controlWiringCost
  return { generators, boardMods, cabling, controlWiring, total: generators + boardMods + cabling + controlWiring }
}
```
Test: `total` equals `calculateTotalCapitalCost(zones, tenants, s)` for the same inputs (import it and assert equality — keeps them DRY-consistent); components sum to total. Export it from the module `index.ts` and the `@esite/shared` barrel.

- [ ] **Step 2:** `generator-report-data.ts` — define `GeneratorReportData`:
```typescript
import type { GeneratorCostRecoveryModel, GeneratorSettings } from '@esite/shared'
import type { CapitalBreakdown } from '@esite/shared'
export interface GeneratorReportData {
  projectName: string
  model: GeneratorCostRecoveryModel
  breakdown: CapitalBreakdown
  settings: GeneratorSettings
  brandingInput: {
    orgName: string; orgLogoDataUri: string | null; orgAccent: string | null
    projectAccent: string | null; clientLogoDataUri: string | null; projectMarkDataUri: string | null
    projectSubtitle: string
  }
}
```
- [ ] **Step 3:** Implement `gatherGeneratorReportData(projectId): Promise<GeneratorReportData>` **mirroring `gatherInspectionReportData`**: cookie client; gate `requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)` (throw on fail — the route maps to 403); service client; parallel reads of `gcr.settings`, `gcr.zones`, `gcr.zone_generators`, `structure.nodes` (tenant_db) + `gcr.tenant_assignments`, `projects.projects` (name, client_logo_url, project_logo_url, report_accent_color), `organisations` (name, logo_url, report_accent_color); `mapDbToEngineInput(...)` → `buildGeneratorCostRecovery(input)` for `model`; `capitalCostBreakdown(input.zones, input.tenants, input.settings)` for `breakdown`; download the 3 logos via `downloadToDataUri(service, 'report-logos', path)` (reuse the helper from `inspection-report-data.ts` — import or copy); assemble `brandingInput` (projectSubtitle = the project name/centre or ''). Return `GeneratorReportData`.
- [ ] **Step 4: Commit** `feat(gcr): report-data gatherer + capital breakdown`.

---

### Task 2: The PDF document + renderer

**Files:** Create `apps/web/src/lib/reports/generator-report.tsx`, `render-generator.ts`, `render-generator.test.ts`

- [ ] **Step 1:** `generator-report.tsx` — `GeneratorReportDocument({ data, branding }: { data: GeneratorReportData; branding: ResolvedBranding })` mirroring `InspectionReportDocument` (reuse `Cover`, `RunningHeader`, `Section`, `Table` from `./components`/`./interior`). Sections (all amounts formatted `R #,##0.00` via a local `zar()` helper):
  - **Appendix A — Capital cost:** a `Table` cols `['Item','Amount']` rows: Generators (`breakdown.generators`), Board modifications (`breakdown.boardMods`), Supply cabling (`breakdown.cabling`), Control wiring (`breakdown.controlWiring`), **Total capital cost** (`breakdown.total`, bold).
  - **Appendix B — Capital recovery + tariff:** a small key/value block — Capital R{total}, Period {settings.capitalRecoveryPeriodYears} yrs, Rate {settings.capitalRecoveryRatePercent}%, **Monthly repayment** R{model.monthlyCapitalRepayment}; then Diesel R{tariff.dieselPerKwh}/kWh, Maintenance R{tariff.maintenancePerKwh}/kWh, +{settings.maintenanceContingencyPercent}% contingency, **Final tariff R{tariff.finalTariff}/kWh**.
  - **Appendix C — Tenant allocation:** a `Table` cols `['Shop','Tenant','Area m²','Loading kW','% of total','Monthly (excl VAT)','R/m²']`, one row per `model.allocations`. Rows where `participation !== 'shared'` render **greyed** with "Not on generator — R0" (muted style). End with a **Total** row and a reconciliation line: "Σ tenant monthly = R{Σ} = monthly repayment R{model.monthlyCapitalRepayment}".
- [ ] **Step 2:** `render-generator.ts` — `renderGeneratorReport(data, branding): Promise<Buffer>` (verbatim shape of `render-inspection.ts`: `renderToBuffer(React.createElement(GeneratorReportDocument, { data, branding }))`).
- [ ] **Step 3 (test):** `render-generator.test.ts` with `// @vitest-environment node` at the top — build a small `GeneratorReportData` (a 2-zone, 3-tenant model incl. an opt-out) + a minimal `ResolvedBranding`, call `renderGeneratorReport`, assert it returns a non-empty `Buffer` starting with `%PDF`. (Smoke — proves it renders in Node without the React-19 trap.)
- [ ] **Step 4: Commit** `feat(gcr): react-pdf report document + renderer`.

---

### Task 3: Route + wire the Generate button

**Files:** Create `apps/web/src/app/api/projects/[id]/generator-cost-recovery/report-preview/route.ts`; Modify `…/generator-cost-recovery/TenantsPanel.tsx`

- [ ] **Step 1:** `route.ts` — copy `inspections/.../report-preview/route.ts`: `export const runtime = 'nodejs'`; `export const dynamic = 'force-dynamic'`; `GET(_req, { params })`; await `params` for `{ id }`; auth (user present else 401); `gatherGeneratorReportData(id)` in try/catch mapping "not found"→404, access errors→403, else 500; assemble `BrandingInput` (org/project from `data.brandingInput`, `title: 'Generator Cost-Recovery Report'`, `kicker: 'STANDBY GENERATOR · COST RECOVERY'`, `date` = today's `YYYY-MM-DD`); `resolveBranding(input)`; `renderGeneratorReport(data, branding)`; return the PDF `Response` (`Content-Type: application/pdf`, `Content-Disposition: inline; filename="generator-cost-recovery.pdf"`, `Cache-Control: no-store`).
- [ ] **Step 2:** In `TenantsPanel.tsx`, change the "Generate report" button: when `readiness.ready`, it opens `/api/projects/${projectId}/generator-cost-recovery/report-preview` in a new tab (pre-open the tab in the click gesture then set location — the repo's `previewViaSignedUrl`/popup-blocker lesson; or a plain `<a target="_blank" href=…>` styled as a button when ready). Keep it disabled (with a reason) when not ready.
- [ ] **Step 3:** `pnpm --filter web type-check` clean; `pnpm --filter web build` succeeds (the route compiles, Node runtime); `pnpm --filter web test render-generator` green. Commit `feat(gcr): report-preview route + wire Generate button`.

---

## Self-Review (completed)
- **Spec coverage:** §7 cover+branding → reuse `Cover`/`resolveBranding` (Task 2/3); Appendix A/B/C → Task 2; engine→report wiring → Task 1; opt-outs greyed + reconciliation → Task 2; the Generate entry point → Task 3. Persistence + expanded content explicitly deferred (documented). ✅
- **Placeholder scan:** the novel code (breakdown, gatherer shape, document content, route) is specified concretely against named in-repo templates; `zar()`/styles follow `interior.tsx`. No vague placeholders. ✅
- **Type consistency:** `GeneratorReportData` uses the P1 `GeneratorCostRecoveryModel` + `CapitalBreakdown`; `renderGeneratorReport(data, branding)` matches `render-inspection`'s signature; `gatherGeneratorReportData(projectId)` returns `GeneratorReportData`. ✅

## Execution handoff
**superpowers:subagent-driven-development.** Task 2 carries the React-19/`renderToBuffer` risk — the Node-env smoke test is the guard; **deploy-verify the render** before P3 is called done (the repo's hard lesson: the render only truly proves out on a real Node deploy). Persistence + expanded content + P4 billing follow as their own plans.
