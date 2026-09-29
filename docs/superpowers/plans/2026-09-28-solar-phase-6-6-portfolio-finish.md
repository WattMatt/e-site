# Solar Phase 6 — Part 6: Solar portfolio page, RBAC matrix, verification, review, PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-6-0-index.md` first.

---

### Task 32: Solar portfolio page `/solar` (spec §15) + sidebar link

**Map: NOT built.** Task 0 Step 4(b) confirmed `apps/web` has no map component (no mapbox/leaflet/maplibre); §15's map is replaced by province and supply-authority filters, and the page says so. Adding a map library is a separate decision (open question for the owner).

**Files:**
- Create: `apps/web/src/lib/solar/portfolio-model.ts`, `portfolio-model.test.ts` (pure; usable by the client table)
- Create: `apps/web/src/lib/solar/portfolio.ts` (loader)
- Create: `apps/web/src/app/(admin)/solar/page.tsx`
- Create: `apps/web/src/app/(admin)/solar/PortfolioTable.tsx`, `PortfolioTable.test.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (`GLOBAL_NAV`)

- [ ] **Step 1: Failing test** `portfolio-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterPortfolio, portfolioKpis, portfolioFilterOptions, STAGE_LABELS, type PortfolioRow } from './portfolio-model'

const row = (o: Partial<PortfolioRow>): PortfolioRow => ({
  projectId: 'p', projectName: 'P', province: 'Gauteng', city: null, licenseeName: 'City Power', stage: 'study',
  selectedCaseName: 'Base', selectedKwp: 100, proposedKwp: null, year1SavingZar: null, lastActivity: '2026-09-01T00:00:00Z', canSeeMoney: false, ...o,
})
const rows = [
  row({ projectId: 'a', stage: 'study', selectedKwp: 100, canSeeMoney: true, year1SavingZar: 50_000 }),
  row({ projectId: 'b', stage: 'proposal_issued', selectedKwp: 200, proposedKwp: 200, province: 'Western Cape', licenseeName: 'City of Cape Town' }),
  row({ projectId: 'c', stage: 'accepted', selectedKwp: 300, proposedKwp: 280, canSeeMoney: true, year1SavingZar: 150_000 }),
]

describe('portfolio model (§15)', () => {
  it('KPIs: kWp designed / proposed / accepted; saving only over rows the caller may see money on', () => {
    expect(portfolioKpis(rows)).toEqual({ projects: 3, kwpDesigned: 600, kwpProposed: 480, kwpAccepted: 280, year1SavingZar: 200_000, savingRows: 2 })
    expect(portfolioKpis(rows.map((r) => ({ ...r, canSeeMoney: false, year1SavingZar: null }))).year1SavingZar).toBeNull()
  })
  it('filters by status, province and supply authority', () => {
    expect(filterPortfolio(rows, { stage: 'accepted', province: '', licensee: '' }).map((r) => r.projectId)).toEqual(['c'])
    expect(filterPortfolio(rows, { stage: '', province: 'Western Cape', licensee: '' }).map((r) => r.projectId)).toEqual(['b'])
    expect(filterPortfolio(rows, { stage: '', province: '', licensee: 'City Power' }).map((r) => r.projectId)).toEqual(['a', 'c'])
  })
  it('offers only the values present', () => {
    expect(portfolioFilterOptions(rows)).toEqual({ provinces: ['Gauteng', 'Western Cape'], licensees: ['City Power', 'City of Cape Town'] })
  })
  it('labels every stage (operating arrives with Phase 7)', () => {
    expect(STAGE_LABELS).toEqual({ study: 'Study', proposal_issued: 'Proposal issued', accepted: 'Accepted', operating: 'Operating' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/lib/solar/portfolio-model.ts`:

```ts
/** Solar portfolio (spec §15) — pure model shared by the page and the client table. */
export type PortfolioStage = 'study' | 'proposal_issued' | 'accepted' | 'operating'
export const STAGE_LABELS: Record<PortfolioStage, string> = { study: 'Study', proposal_issued: 'Proposal issued', accepted: 'Accepted', operating: 'Operating' }

export interface PortfolioRow {
  projectId: string; projectName: string; province: string | null; city: string | null; licenseeName: string | null
  stage: PortfolioStage; selectedCaseName: string | null; selectedKwp: number | null; proposedKwp: number | null
  year1SavingZar: number | null; lastActivity: string | null; canSeeMoney: boolean
}
export interface PortfolioFilter { stage: string; province: string; licensee: string }

export function filterPortfolio(rows: PortfolioRow[], f: PortfolioFilter): PortfolioRow[] {
  return rows.filter((r) =>
    (!f.stage || r.stage === f.stage) && (!f.province || r.province === f.province) && (!f.licensee || r.licenseeName === f.licensee))
}

export function portfolioFilterOptions(rows: PortfolioRow[]): { provinces: string[]; licensees: string[] } {
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b))
  return { provinces: uniq(rows.map((r) => r.province)), licensees: uniq(rows.map((r) => r.licenseeName)) }
}

export function portfolioKpis(rows: PortfolioRow[]) {
  const sum = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0)
  const money = rows.filter((r) => r.canSeeMoney && r.year1SavingZar !== null)
  return {
    projects: rows.length,
    kwpDesigned: sum(rows.map((r) => r.selectedKwp)),
    kwpProposed: sum(rows.filter((r) => r.stage === 'proposal_issued' || r.stage === 'accepted').map((r) => r.proposedKwp)),
    kwpAccepted: sum(rows.filter((r) => r.stage === 'accepted').map((r) => r.proposedKwp)),
    year1SavingZar: money.length ? sum(money.map((r) => r.year1SavingZar)) : null,
    savingRows: money.length,
  }
}
```

`apps/web/src/lib/solar/portfolio.ts`:
```ts
import 'server-only'
/** Rows from public.solar_portfolio (00217): only projects the CALLER may view; saving only with money. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortfolioRow, PortfolioStage } from './portfolio-model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function loadPortfolio(user: AnyClient, orgId: string): Promise<PortfolioRow[]> {
  const { data, error } = await user.rpc('solar_portfolio', { p_org_id: orgId })
  if (error) { console.error('[solar-portfolio] failed', { code: error.code }); return [] }
  return ((data ?? []) as Row[]).map((r) => ({
    projectId: String(r.project_id), projectName: String(r.project_name ?? ''),
    province: (r.province as string | null) ?? null, city: (r.city as string | null) ?? null,
    licenseeName: (r.licensee_name as string | null) ?? null, stage: r.stage as PortfolioStage,
    selectedCaseName: (r.selected_case_name as string | null) ?? null,
    selectedKwp: num(r.selected_kwp), proposedKwp: num(r.proposed_kwp),
    year1SavingZar: r.can_see_money === true ? num(r.year1_saving_zar) : null,
    lastActivity: (r.last_activity as string | null) ?? null, canSeeMoney: r.can_see_money === true,
  }))
}
```

- [ ] **Step 3: Failing test** `PortfolioTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortfolioTable } from './PortfolioTable'
import type { PortfolioRow } from '@/lib/solar/portfolio-model'

const rows: PortfolioRow[] = [
  { projectId: 'a', projectName: 'Acme Mall', province: 'Gauteng', city: 'Pretoria', licenseeName: 'City of Tshwane', stage: 'accepted', selectedCaseName: 'Base', selectedKwp: 500, proposedKwp: 480, year1SavingZar: 400_000, lastActivity: '2026-09-28T10:00:00Z', canSeeMoney: true },
  { projectId: 'b', projectName: 'Beta Park', province: 'Western Cape', city: null, licenseeName: 'City of Cape Town', stage: 'study', selectedCaseName: null, selectedKwp: null, proposedKwp: null, year1SavingZar: null, lastActivity: null, canSeeMoney: false },
]

describe('PortfolioTable (§15)', () => {
  it('rows, Open link to Overview, money only where allowed, text nodes only', () => {
    render(<PortfolioTable rows={rows} isAdmin={false} />)
    expect(screen.getByRole('link', { name: 'Open Acme Mall' }).getAttribute('href')).toBe('/projects/a/solar/overview')
    expect(screen.getByText('R 400 000')).toBeTruthy()
    expect(screen.getByText('500.0 kWp')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Manage access/ })).toBeNull()
  })
  it('Manage access row action for owners/admins only', () => {
    render(<PortfolioTable rows={rows} isAdmin />)
    expect(screen.getByRole('link', { name: 'Manage access for Acme Mall' }).getAttribute('href')).toBe('/projects/a/solar/access')
  })
  it('filters and KPIs', () => {
    render(<PortfolioTable rows={rows} isAdmin={false} />)
    expect(screen.getByText('Projects: 2')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'study' } })
    expect(screen.queryByText('Acme Mall')).toBeNull()
    expect(screen.getByText('Beta Park')).toBeTruthy()
    expect(screen.getByText('kWp operating: available with Operations (Phase 7)')).toBeTruthy()
  })
  it('empty state', () => {
    render(<PortfolioTable rows={[]} isAdmin={false} />)
    expect(screen.getByText('No Solar projects you can see yet — open a project’s Solar tab to start a study.')).toBeTruthy()
  })
})
```

- [ ] **Step 4: Run — FAIL. Implement** `PortfolioTable.tsx`:

```tsx
'use client'
/**
 * Portfolio table + filters + KPIs (spec §15). Every cell is a React text node (WM built map popups
 * from injected HTML — stored XSS); no dangerouslySetInnerHTML anywhere here.
 */
import { useState } from 'react'
import Link from 'next/link'
import { kwp, zar } from '@esite/shared/solar-reports'
import { filterPortfolio, portfolioFilterOptions, portfolioKpis, STAGE_LABELS, type PortfolioRow } from '@/lib/solar/portfolio-model'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

export function PortfolioTable({ rows, isAdmin }: { rows: PortfolioRow[]; isAdmin: boolean }) {
  const [f, setF] = useState({ stage: '', province: '', licensee: '' })
  const shown = filterPortfolio(rows, f)
  const k = portfolioKpis(shown)
  const opts = portfolioFilterOptions(rows)
  if (rows.length === 0) return <p style={{ fontSize: 13 }}>No Solar projects you can see yet — open a project’s Solar tab to start a study.</p>
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">Portfolio</span></CardHeader>
        <CardBody>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <span>{`Projects: ${k.projects}`}</span>
            <span>{`kWp designed: ${kwp(k.kwpDesigned)}`}</span>
            <span>{`kWp proposed: ${kwp(k.kwpProposed)}`}</span>
            <span>{`kWp accepted: ${kwp(k.kwpAccepted)}`}</span>
            {k.year1SavingZar !== null && <span>{`Year-1 saving (${k.savingRows} project${k.savingRows === 1 ? '' : 's'} you may see): ${zar(k.year1SavingZar)}`}</span>}
            <span>kWp operating: available with Operations (Phase 7)</span>
            <span>Generation YTD vs guarantee: available with Operations (Phase 7)</span>
          </div>
        </CardBody>
      </Card>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <label>Status{' '}
          <select aria-label="Status" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
            <option value="">All</option>
            {Object.entries(STAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Province{' '}
          <select aria-label="Province" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })}>
            <option value="">All</option>
            {opts.provinces.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>Supply authority{' '}
          <select aria-label="Supply authority" value={f.licensee} onChange={(e) => setF({ ...f, licensee: e.target.value })}>
            <option value="">All</option>
            {opts.licensees.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>{['Project', 'Location', 'Supply authority', 'Status', 'Selected case', 'kWp', 'Year-1 saving', 'Last activity', ''].map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--c-border)', padding: 6 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.projectId}>
                <td style={{ padding: 6 }}>{r.projectName}</td>
                <td style={{ padding: 6 }}>{[r.city, r.province].filter(Boolean).join(', ')}</td>
                <td style={{ padding: 6 }}>{r.licenseeName ?? ''}</td>
                <td style={{ padding: 6 }}>{STAGE_LABELS[r.stage]}</td>
                <td style={{ padding: 6 }}>{r.selectedCaseName ?? 'None selected'}</td>
                <td style={{ padding: 6 }}>{r.selectedKwp === null ? '' : kwp(r.selectedKwp)}</td>
                <td style={{ padding: 6 }}>{r.canSeeMoney && r.year1SavingZar !== null ? zar(r.year1SavingZar) : ''}</td>
                <td style={{ padding: 6 }}>{r.lastActivity ? r.lastActivity.slice(0, 10) : ''}</td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                  <Link href={`/projects/${r.projectId}/solar/overview`} aria-label={`Open ${r.projectName}`}>Open</Link>
                  {isAdmin && <>{' · '}<Link href={`/projects/${r.projectId}/solar/access`} aria-label={`Manage access for ${r.projectName}`}>Manage access</Link></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```
(`kwp`/`zar` come from the shared formatter, so the table matches every other Solar figure.)

- [ ] **Step 5: Implement the page** `apps/web/src/app/(admin)/solar/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { orgHasSolar } from '@/lib/solar/access'
import { solarPriceLine } from '@/lib/solar/price'
import { loadPortfolio } from '@/lib/solar/portfolio'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FeatureSummary } from '@/app/(admin)/projects/[id]/solar/_components/FeatureSummary'
import { SubscribeButton } from '@/app/(admin)/projects/[id]/solar/_components/SubscribeButton'
import { PortfolioTable } from './PortfolioTable'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar portfolio' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Solar portfolio (spec §15): every Solar project of the active org the caller may see. */
export default async function SolarPortfolioPage() {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login?next=/solar')
  const supabase = (await createClient()) as unknown as AnyClient
  const isAdmin = OWNER_ADMIN.includes(ctx.role)

  if (!(await orgHasSolar(ctx.organisationId, supabase))) {
    const [{ data: org }, { data: firstProject }] = await Promise.all([
      supabase.from('organisations').select('name').eq('id', ctx.organisationId).maybeSingle(),
      supabase.schema('projects').from('projects').select('id').eq('organisation_id', ctx.organisationId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ])
    const orgName = (org as { name?: string } | null)?.name ?? 'your organisation'
    const projectId = (firstProject as { id?: string } | null)?.id ?? null
    return (
      <div style={{ display: 'grid', gap: 16, maxWidth: 960 }}>
        <h1 className="page-title">Solar portfolio</h1>
        <FeatureSummary />
        <Card>
          <CardHeader><span className="data-panel-title">{`Solar is not active for ${orgName}`}</span></CardHeader>
          <CardBody>
            {isAdmin
              ? (projectId
                ? <><p style={{ fontSize: 13 }}>{solarPriceLine()}</p><SubscribeButton projectId={projectId} /></>
                : <p style={{ fontSize: 13 }}>Create a project first — Solar is subscribed from a project’s Solar tab.</p>)
              : <p style={{ fontSize: 13 }}>Ask an organisation owner or admin to subscribe (from any project’s Solar tab).</p>}
          </CardBody>
        </Card>
      </div>
    )
  }

  const rows = await loadPortfolio(supabase, ctx.organisationId)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar portfolio</h1>
          <p className="page-subtitle">Every Solar study you have access to in this organisation. A map view is not available — E-Site has no map component yet; filter by province or supply authority instead.</p>
        </div>
      </div>
      <PortfolioTable rows={rows} isAdmin={isAdmin} />
    </div>
  )
}
```
(Clients are bounced from `(admin)` by its layout; suppliers see an empty table because `solar_portfolio` returns only projects where `solar_can_view` is true. `SubscribeButton` takes any project of the org — the subscribe route derives the org from the project.)

- [ ] **Step 6: Sidebar.** In `Sidebar.tsx` add to `GLOBAL_NAV` after Projects:
```ts
  { href: '/solar',       label: 'Solar portfolio', Icon: Sun },
```
(`Sun` is already imported.) If a Sidebar test pins the global nav labels, add `'Solar portfolio'` to its expectation.

- [ ] **Step 7: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/portfolio-model 'src/app/(admin)/solar' src/components/layout 2>&1 | tail -5
git add apps/web/src/lib/solar/portfolio-model.ts apps/web/src/lib/solar/portfolio-model.test.ts apps/web/src/lib/solar/portfolio.ts 'apps/web/src/app/(admin)/solar' apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(solar): Solar portfolio page (table, filters, KPIs; no map component exists)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 33: RBAC matrix rows (same PR as the routes — CLAUDE.md rule)

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Route rows** — in the Solar route table (after the `/solar/financials` row 4b added; same columns: Grantor | Edit + financials | Edit | View | Own-org member, no grant | External member, no grant | supplier / client_viewer):

```markdown
| `/projects/[id]/solar/reports` | W (all; delete saved reports) | W (technical + feasibility + proposals) | W (technical only) | R (technical list only) | → locked | → locked | → locked |
| `/solar` (portfolio, org level) | R + **Manage access** | R (rand values) | R (no rand values) | R (no rand values) | R (empty) | R (their View projects) | supplier: R (empty) / client_viewer: → `/portal` |
| `/proposal/[token]` (public, no login) | — | — | — | — | — | — | anyone holding a live link: R + Accept / Decline / Download |
| `/portal/[projectId]/proposals`, `…/proposals/[proposalId]` | — | — | — | — | — | — | client_viewer project member: R + Accept / Decline / Download |
```
And add a note under the table: "Reports & Proposal is live (Phase 6). Feasibility reports, proposals and the acceptance record need Edit + financials; technical reports need View. Report reads follow the Solar level in `public.user_can_read_report_kind()` (00217), not an E-Site role; `solar_proposal` PDFs are never deletable."

- [ ] **Step 2: Action rows** in "Solar server actions":

```markdown
| `generateSolarReportAction` (`solar-reports.actions.ts`) | feasibility: `requireSolarLevel(project, 'edit_financials')`; technical: `'edit'` — FIRST; `rateLimit('solar-report:<user>', 6, 60 s)`; refused while the selected case is Stale/running/failed | Reads the stored run (`case_runs`) and, for feasibility, `case_run_financials` for THAT run under money RLS; writes `projects.reports` (kind `solar_feasibility` / `solar_technical`, source = the run) and the `reports` bucket with the service client after the gate |
| `createSolarProposalAction` / `saveSolarProposalDraftAction` / `deleteSolarProposalDraftAction` / `reviseSolarProposalAction` (`solar-proposals.actions.ts`) | `requireSolarLevel(project, 'edit_financials')` FIRST; save stale-guarded | `proposals_*` (00217): permissive membership + RESTRICTIVE `solar_can_see_money` per verb; `proposals_guard` forces drafts, versions revisions, refuses revising an accepted family and any user change once issued |
| `issueSolarProposalAction` / `withdrawSolarProposalAction` / `newSolarProposalLinkAction` | `requireSolarLevel(project, 'edit_financials')` FIRST; the proposal is read through the caller's session (RLS) before any service call; `rateLimit('solar-issue:<user>', 5, 60 s)` | Service-only `solar_issue_proposal` / `solar_withdraw_proposal` / `solar_rotate_proposal_link` (EXECUTE: `service_role` only). Issue stores PDF + SHA-256 + snapshot and the token's SHA-256 (the raw 32-byte token is returned once); client email only when ticked AND `notify_solar_email` is on, and only to the project's client viewers |
| `draftSolarProposalNarrativeAction` | `requireSolarLevel(project, 'edit_financials')` FIRST; disabled without `ANTHROPIC_API_KEY`; `rateLimit('solar-narrative:<org>', 10, 10 min)` | Anthropic called server-side with the proposal's figures only; text saved into the draft (stale-guarded) |
| `saveSolarProposalTemplatesAction` (`solar-proposal-templates.actions.ts`) | `requireRole(active org, OWNER_ADMIN)` (`.ok`); stale-guarded | `solar.proposal_templates` RESTRICTIVE writes on `solar.library_orgs('admin')`; reads on `library_orgs('edit_financials')` |
| `respondToPortalProposalAction` / `getPortalProposalPdfUrlAction` (`solar-portal-proposals.actions.ts`) | `requirePortalAccess(project)` (client viewer, active member); `rateLimit('solar-portal-respond:<user>', 5, 10 min)`; IP/UA from request headers | Service-only `solar_portal_respond` / `solar_portal_proposal` re-check portal membership in SQL; 7-day signed URL |
```

- [ ] **Step 3: API section** after "Solar cases, runs and financials API (Phase 4b)":

```markdown
### Solar reports and proposals API (Phase 6)

| Route | Needs | Notes |
|---|---|---|
| `GET /api/projects/[id]/solar/proposals/[proposalId]/preview` | Solar Edit + financials (`requireSolarLevelAPI`, JSON 401/403) | Drafts only (409 once issued); watermarked PDF; nothing stored; `rateLimit('solar-preview:<user>', 20, 60 s)` |
| `POST /api/solar/proposal-response` | **Public** (exact path in `PUBLIC_API_PATHS`) — the 43-char token in the BODY is the bearer | `rateLimit` per IP (10/10 min) and per token hash (5/10 min); IP/UA stamped from headers; `solar_proposal_respond_by_token` hashes the token in SQL and refuses expired/withdrawn/answered; notifies the issuer |
| `POST /api/solar/proposal-download` | **Public**, token in the body | `rateLimit` per IP (20/min); 7-day signed URL only for viewed/accepted/declined; 410 otherwise |

`/proposal/[token]` is in `PUBLIC_PATHS` and `PUBLIC_CONTENT_PREFIXES` (`'/proposal/'`, trailing slash — `/proposals` stays protected). Nothing is granted to `anon` anywhere: every public path uses the service client to call a service-only definer function.
```

- [ ] **Step 4: Settings row** — next to `/settings/solar`: note "Proposal and report templates card (terms, disclaimer, default validity) — owner/admin, Phase 6". Next to the notifications section (where project email toggles are listed), add `notify_solar_email` — "Solar proposal emails (client link at Issue; issuer on accept/decline). Default ON; bell never gated."

- [ ] **Step 5: Commit** ("docs(rbac): Solar Phase 6 reports, proposals, public link, portal, portfolio").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git add docs/rbac-matrix.md && git commit -m "docs(rbac): Solar Phase 6 reports, proposals, public link, portal, portfolio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 34: Full verification (before anyone reviews)

**Files:** none new.

- [ ] **Step 1: Three suites, type-check, lint, build.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter @esite/shared type-check 2>&1 | tail -3
pnpm --filter web type-check 2>&1 | tail -3
pnpm --filter @esite/shared lint 2>&1 | tail -3
pnpm --filter web lint 2>&1 | tail -3
pnpm --filter web build 2>&1 | tail -20
```
Expected: every suite green with counts above the Task 0 baseline; 0 type errors; 0 lint errors; `next build` exit 0 with `/projects/[id]/solar/reports`, `/solar`, `/proposal/[token]`, `/portal/[projectId]/proposals`, `/portal/[projectId]/proposals/[proposalId]` and the three new API routes in the route list. Any failure: fix at its source, re-run the whole step.

- [ ] **Step 2: Re-prove the database on the FINAL migration text.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
S=/private/tmp/claude-501/solar-6; M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql \
    $(ls $M/00214_*.sql 2>/dev/null) $M/00216_solar_cases.sql $M/00217_solar_proposals.sql > $S/green.sql
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-proposals-roles.sql 2>&1 | grep -cE '\| *t *$|true'
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-cases-roles.sql scripts/db/assert-solar-foundation-roles.sql \
  scripts/db/assert-solar-org-settings-roles.sql scripts/db/assert-solar-meter-data-roles.sql 2>&1 | grep -iE 'false|error' || echo "earlier Solar assertions still green"
```
Expected: `67`; `earlier Solar assertions still green`. If Phase 5 (`00212`) is on the base by now, insert it in number order and also run `scripts/db/assert-solar-layouts-roles.sql`.

- [ ] **Step 3: Teeth check** — confirm each of these was seen RED during its task (re-run the mutation if not recorded):
  - SQL: the seven Task 3 mutations.
  - `render-report.render.test.ts` glyph test (Task 13 Step 4) and `render-proposal.render.test.ts` figure test (Task 14 Step 4).
  - `report-kind-access.contract.test.ts`: temporarily delete the `solar_feasibility` line from `00217`'s `user_can_read_report_kind()` → the "FINAL definition" test fails naming it; revert.
  - `notification-toggles.contract.test.ts`: temporarily remove `solarEmail: s.notifySolarEmail,` from `getNotificationConfig` → "every toggle drives a column something actually reads" still passes but the email-toggle test fails; remove the `TOGGLES` entry instead → "every notify_* boolean column either has a toggle or a reason" fails. Revert both.
  - `tamper.render.test.ts`: temporarily make `loadProposalByToken` return a snapshot rebuilt from `proposalSnapshotInput({ price: offerPrice(2_000_000, 15) })` → red. Revert.

- [ ] **Step 4: No-send check.** `git grep -n "functions/v1/send-email" -- apps/web/src/lib/solar apps/web/src/actions` lists only `lib/solar/notify.ts` and `lib/solar/proposals/notify.ts`; every test touching them stubs `fetch`. `git grep -n "ANTHROPIC_API_KEY" -- apps/web/src ':!*.test.*'` lists only `lib/solar/proposals/narrative.ts`.

- [ ] **Step 5: Commit any fixes** ("fix(solar): verification fixes").

---

### Task 35: Two foreground reviewers

- [ ] **Step 1: Dispatch two reviewers in ONE message, foreground** (`run_in_background: false`), `subagent_type: superpowers:code-reviewer`, base `origin/feat/solar-phase-4b`, head `feat/solar-phase-6`, worktree `/Users/spud/.config/superpowers/worktrees/esite/solar-phase-6`.

Reviewer A — security and evidence integrity:
```
Review branch feat/solar-phase-6 against origin/feat/solar-phase-4b in /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6.
Focus: apps/edge-functions/supabase/migrations/00217_solar_proposals.sql; apps/web/src/{actions/solar-*.actions.ts,actions/project-reports.actions.ts,lib/solar/proposals,lib/solar/reports,app/api/solar,app/api/projects/[id]/solar/proposals,app/(proposal),app/(portal)/portal/[projectId]/proposals,middleware.ts}.
Check: (1) anon holds NO table or function privilege; every client-facing/state-changing definer function is service_role-only and re-checks what it needs (token shape+hash, expiry, status, portal membership); (2) only the SHA-256 of the token is stored, the raw token leaves the server once, and a stored hash cannot be replayed as a token; (3) the snapshot served to a client contains nothing beyond the client price and client-facing text (no capex, no margin, no internal ids beyond what is necessary); (4) an issued proposal, its PDF path/hash and its events cannot be changed or deleted by any user path, and events are append-only for everyone; (5) IP/UA/time/PDF hash are stamped server-side and cannot come from a request body; (6) every action/route gates BEFORE any service-client call; public routes are rate-limited; the middleware opens exactly the intended paths; (7) per-verb RLS, no RESTRICTIVE FOR ALL, FORCE RLS, money on solar_can_see_money; (8) no email or LLM call can happen in tests or without the toggle/key; (9) @verify directives are predicates this migration alone satisfies, no em dash in sql payloads; (10) no raw Postgres error reaches a user.
Report confirmed defects only, each with file:line, the failing scenario and a proposed fix. Do not edit files.
```

Reviewer B — spec conformance and correctness:
```
Review branch feat/solar-phase-6 against origin/feat/solar-phase-4b in /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6.
Spec: docs/solar/01-functional-spec.md §9 (excluding solar_monthly and "Ask a question"), §15, §2.2 (Generate feasibility report shortcut), §0.4; docs/solar/03-data-model-and-security.md §3 (proposals, proposal_events), §5 items 5-7; decisions D-15, D-17, D-18 (docs/solar/06-open-decisions.md); plan decisions in docs/superpowers/plans/2026-09-28-solar-phase-6-0-index.md.
Check: reports and proposals are generated ONLY from the selected case's stored run and refused while Stale; the technical report has no rand value; feasibility needs financials for that exact run; offer price = capex (minus margin capex lines) + margin %, VAT once; finance options are the engine's (runStoredFinancials at the offer price, client/owner view, never investor); every §9.2/§9.3/§9.4 control exists with the stated behaviour or is disabled with a stated reason (bill check, layout sheet for manual cases, narrative without key, email with the toggle off); the portal and token page print EXACTLY keyFigures/financeOptionTable of the snapshot, as the PDF does; statuses (incl. derived expired), Withdraw, Revise v(n+1), New link and the acceptance record behave as specified; the portfolio shows only permitted projects and money; org branding falls back to a neutral template with no Watson Mattheus anything; every PDF string passes pdfText.
Report confirmed defects only, each with file:line, the spec clause and a proposed fix. Do not edit files.
```

- [ ] **Step 2: Fix every confirmed defect** (failing test first where behavioural), re-run Task 34 Step 1 (and Step 2 if the migration changed, plus the relevant Task 3 mutation), commit ("fix(solar): review findings — …"). A rejected finding gets one line of reasoning in the PR body.

---

### Task 36: Push and open the DRAFT PR

- [ ] **Step 1: Push over SSH.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git push git@github.com:WattMatt/e-site.git feat/solar-phase-6
```

- [ ] **Step 2: Write the body, replace every `<…>` with the real numbers, then open the draft PR onto `feat/solar-phase-4b`.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
cat > /private/tmp/claude-501/solar-6/pr-body.md <<'EOF'
## Solar Phase 6 — Reports & Proposal, client acceptance, Solar portfolio

Spec: docs/solar/01 §9 (not solar_monthly, not "Ask a question"), §15, §2.2; docs/solar/03 §3, §5 items 5-7; D-15, D-17, D-18.
Plan: docs/superpowers/plans/2026-09-28-solar-phase-6-*.md

### What
- Migration `00217_solar_proposals.sql` (claim the number at APPLY time — ledger, origin/main and open-PR filenames): `solar.proposals` (money; frozen once issued), append-only `solar.proposal_events`, `solar.proposal_templates`, SERVICE-ONLY definer functions for token/portal access and for issue/withdraw/new link (the raw token is hashed in SQL; only its SHA-256 is stored), `solar_portfolio()`, Solar report kinds in `user_can_read_report_kind()`, `notify_solar_email`, 2 notification types, 6 product events.
- `@esite/shared/solar-reports`: locale-free formatting, offer price, draft schema, engine finance options at the offer price, the frozen snapshot + key figures (one source for PDF and page), report model, proposal status.
- Feasibility (money) and technical (no money) PDFs from the selected case's stored run, with revision note, layout-sheet and 8760 options; neutral branding fallback; every string through winAnsiSafe.
- Proposals: draft editor, optional server-side AI narrative, preview, issue (snapshot + PDF + SHA-256 + 30-day hashed link), withdraw, revise, new link, acceptance record; public token page and portal tab with evidential accept/decline and 7-day download.
- `/solar` portfolio (table, filters, KPIs — no map component exists in apps/web), Overview shortcut live.

### Proof
- DB: `scripts/db/assert-solar-proposals-roles.sql` — RED without 00217, GREEN <67/67> with it; earlier Solar assertion files still green. Mutations: <paste the Task 3 ledger>.
- PDFs: real renders decoded as WinAnsi; glyph and figure tests shown red by mutation; tamper test (case changed after issue → client served the frozen snapshot, whose figures are those in the issued PDF, hash unchanged).
- Suites: shared <n> / web <n> / db <n>; type-check 0; lint 0; `next build` exit 0.
- Reviews: <findings and fixes>.

### Not verified (needs a signed-in human on a subscribed org, with project email toggles OFF)
Generate a technical and a feasibility report; draft → preview → issue a proposal; open the link in a private window; accept with a typed name; see the bell and the acceptance record; withdraw; revise. The narrative button needs `ANTHROPIC_API_KEY` on the deployment.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
grep -n '<[^>]*>' /private/tmp/claude-501/solar-6/pr-body.md | grep -v 'Claude Code' && echo "FILL THE PLACEHOLDERS FIRST" || \
gh pr create --draft --base feat/solar-phase-4b --head feat/solar-phase-6 \
  --title "Solar Phase 6: reports, client proposals with evidential acceptance, portfolio" \
  --body-file /private/tmp/claude-501/solar-6/pr-body.md
```
Expected: the guard prints the unfilled `<…>` lines until they are replaced, then `gh` prints the draft PR URL. Report the URL.
