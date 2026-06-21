# Saved Reports Panel — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved tenant-schedule reports visible, previewable, downloadable, and deletable via a reusable panel over `projects.reports`.

**Architecture:** Three generic server actions (`list` / signed-URL / `delete`) over the existing `projects.reports` table → a reusable `SavedReportsPanel` client component + shared `ReportViewerModal` → a "Saved reports" card on the tenant-schedule page that refreshes after Save. No schema change; GCR untouched. Mirrors the proven GCR `gcr-reports.actions.ts` / `ReportsPanel.tsx` patterns.

**Tech Stack:** Next.js App Router (server components + `'use server'` actions), Supabase (`projects.reports` + `reports` storage bucket, RLS), React 19, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-21-saved-reports-panel-design.md`

**Run tests with:** `pnpm --filter web exec vitest run <path>` (web) — all commands below assume repo root.

---

### Task 1: `listProjectReportsAction` + `ProjectReportRow`

**Files:**
- Create: `apps/web/src/actions/project-reports.actions.ts`
- Test: `apps/web/src/actions/project-reports.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/actions/project-reports.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const requireRoleMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const ORG_ID     = '00000000-0000-0000-0000-000000000001'
const REPORT_ID  = '00000000-0000-0000-0000-000000000055'
const USER_ID    = '00000000-0000-0000-0000-000000000077'

const REPORT_ROW = {
  id: REPORT_ID,
  project_id: PROJECT_ID,
  organisation_id: ORG_ID,
  kind: 'tenant_schedule',
  title: 'Tenant Schedule Report',
  storage_path: `${ORG_ID}/${PROJECT_ID}/tenant-schedule-v3.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1234,
  status: 'issued',
  version: 3,
  generated_by: USER_ID,
  generated_at: '2026-06-20T08:00:00Z',
  created_at: '2026-06-20T08:00:00Z',
}

// Routes schema('projects').from('projects') → org resolve, and
// schema('projects').from('reports') → list / single / delete chains.
function makeSupabase(opts: {
  orgId?: string | null
  listRows?: unknown[] | null
  listError?: { message: string } | null
  reportRow?: unknown | null
  deleteError?: { message: string } | null
} = {}) {
  const { orgId = ORG_ID, listRows = [], listError = null, reportRow = null, deleteError = null } = opts

  const projMaybeSingle = vi.fn().mockResolvedValue({ data: orgId ? { organisation_id: orgId } : null, error: null })
  const projEq = vi.fn().mockReturnValue({ maybeSingle: projMaybeSingle })
  const projSelect = vi.fn().mockReturnValue({ eq: projEq })
  const fromProjects = vi.fn().mockReturnValue({ select: projSelect })

  // list:   select → eq(project) → eq(kind) → in(status) → order
  const order = vi.fn().mockResolvedValue({ data: listRows, error: listError })
  const inFn = vi.fn().mockReturnValue({ order })
  // single: select → eq(id) → eq(project) → maybeSingle
  const repMaybeSingle = vi.fn().mockResolvedValue({ data: reportRow, error: null })
  const eq2 = vi.fn().mockReturnValue({ in: inFn, maybeSingle: repMaybeSingle })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const reportsSelect = vi.fn().mockReturnValue({ eq: eq1 })
  // delete: delete → eq(id) → eq(project)
  const delEq2 = vi.fn().mockResolvedValue({ error: deleteError })
  const delEq1 = vi.fn().mockReturnValue({ eq: delEq2 })
  const del = vi.fn().mockReturnValue({ eq: delEq1 })
  const fromReports = vi.fn().mockReturnValue({ select: reportsSelect, delete: del })

  const schema = vi.fn(() => ({
    from: (table: string) => (table === 'projects' ? fromProjects() : fromReports()),
  }))

  return {
    client: { schema, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) } },
    del, order,
  }
}

function makeServiceClient(opts: { signedUrl?: string | null } = {}) {
  const createSignedUrl = vi.fn().mockResolvedValue(
    opts.signedUrl === null
      ? { data: null, error: { message: 'sign failed' } }
      : { data: { signedUrl: opts.signedUrl ?? 'https://signed.example/x.pdf' }, error: null },
  )
  const remove = vi.fn().mockResolvedValue({ data: null, error: null })
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl, remove })
  return { client: { storage: { from: storageFrom } }, createSignedUrl, remove }
}

describe('listProjectReportsAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('returns rows on success, newest-version-first as queried', async () => {
    const { client } = makeSupabase({ listRows: [REPORT_ROW] })
    createClientMock.mockResolvedValue(client)

    const { listProjectReportsAction } = await import('./project-reports.actions')
    const result = await listProjectReportsAction(PROJECT_ID, 'tenant_schedule')

    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1)
      expect(result[0].version).toBe(3)
      expect(result[0].kind).toBe('tenant_schedule')
    }
  })

  it('returns { error } when the query errors', async () => {
    const { client } = makeSupabase({ listRows: null, listError: { message: 'boom' } })
    createClientMock.mockResolvedValue(client)

    const { listProjectReportsAction } = await import('./project-reports.actions')
    const result = await listProjectReportsAction(PROJECT_ID, 'tenant_schedule')

    expect('error' in result).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.actions.test.ts`
Expected: FAIL — `Cannot find module './project-reports.actions'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/actions/project-reports.actions.ts`:

```ts
'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'

const REPORTS_BUCKET = 'reports'
const SIGNED_URL_TTL_SECONDS = 600 // 10 minutes

type ErrResult = { error: string }

/** A saved report artifact row (projects.reports) as listed in the UI. */
export interface ProjectReportRow {
  id: string
  project_id: string
  organisation_id: string
  kind: string
  title: string
  storage_path: string
  mime_type: string
  size_bytes: number | null
  status: 'issued' | 'superseded' | 'draft' | 'revoked'
  version: number
  generated_by: string | null
  generated_at: string
  created_at: string
}

const SELECT_COLS =
  'id, project_id, organisation_id, kind, title, storage_path, mime_type, size_bytes, status, version, generated_by, generated_at, created_at'

/** Download-disposition filename, derived from kind + version. */
function downloadFileName(kind: string, version: number): string {
  return `${kind.replace(/_/g, '-')}-report-v${version}.pdf`
}

/** Resolve organisation_id from projects.projects. */
async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .schema('projects').from('projects')
    .select('organisation_id').eq('id', projectId).maybeSingle()
  return (data as { organisation_id: string } | null)?.organisation_id ?? null
}

/**
 * Saved reports of a kind for a project, newest version first. Read access is
 * enforced by the reports_select RLS policy (user_has_project_access) on the
 * cookie client — no project access ⇒ no rows. Drafts/revoked excluded.
 */
export async function listProjectReportsAction(
  projectId: string,
  kind: string,
): Promise<ProjectReportRow[] | ErrResult> {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .schema('projects').from('reports')
    .select(SELECT_COLS)
    .eq('project_id', projectId)
    .eq('kind', kind)
    .in('status', ['issued', 'superseded'])
    .order('version', { ascending: false })

  if (error) return { error: error.message ?? 'Failed to load saved reports' }
  return (data ?? []) as ProjectReportRow[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.actions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/project-reports.actions.ts apps/web/src/actions/project-reports.actions.test.ts
git commit -m "feat(reports): listProjectReportsAction over projects.reports"
```

---

### Task 2: `getProjectReportUrlAction` (signed URL, inline + download)

**Files:**
- Modify: `apps/web/src/actions/project-reports.actions.ts`
- Test: `apps/web/src/actions/project-reports.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `project-reports.actions.test.ts`:

```ts
describe('getProjectReportUrlAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('returns { error: Not found } for a report id outside the project', async () => {
    const { client } = makeSupabase({ reportRow: null })
    createClientMock.mockResolvedValue(client)

    const { getProjectReportUrlAction } = await import('./project-reports.actions')
    const result = await getProjectReportUrlAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
  })

  it('returns an inline signed URL (no download disposition)', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    const service = makeServiceClient({ signedUrl: 'https://signed.example/inline.pdf' })
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getProjectReportUrlAction } = await import('./project-reports.actions')
    const result = await getProjectReportUrlAction(PROJECT_ID, REPORT_ID)

    expect(result).toEqual({ url: 'https://signed.example/inline.pdf' })
    expect(service.createSignedUrl).toHaveBeenCalledWith(REPORT_ROW.storage_path, expect.any(Number), undefined)
  })

  it('passes a derived download filename when download=true', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)

    const { getProjectReportUrlAction } = await import('./project-reports.actions')
    await getProjectReportUrlAction(PROJECT_ID, REPORT_ID, { download: true })

    expect(service.createSignedUrl).toHaveBeenCalledWith(
      REPORT_ROW.storage_path,
      expect.any(Number),
      { download: 'tenant-schedule-report-v3.pdf' },
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.actions.test.ts -t getProjectReportUrlAction`
Expected: FAIL — `getProjectReportUrlAction is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `project-reports.actions.ts`:

```ts
/**
 * Short-lived signed URL for a saved report PDF. `download: true` adds an
 * attachment disposition with a derived filename; otherwise serves inline (for
 * the in-app viewer iframe). Read is project-access gated by RLS; the lookup is
 * project-scoped so a foreign report id is a miss.
 */
export async function getProjectReportUrlAction(
  projectId: string,
  reportId: string,
  opts: { download?: boolean } = {},
): Promise<{ url: string } | ErrResult> {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .schema('projects').from('reports')
    .select('storage_path, kind, version')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  const report = row as { storage_path: string; kind: string; version: number } | null
  if (!report) return { error: 'Not found' }

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: signed, error: signErr } = await (service as any).storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(
      report.storage_path,
      SIGNED_URL_TTL_SECONDS,
      opts.download ? { download: downloadFileName(report.kind, report.version) } : undefined,
    )

  if (signErr || !signed?.signedUrl) return { error: 'Failed to create report link' }
  return { url: signed.signedUrl as string }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.actions.test.ts -t getProjectReportUrlAction`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/project-reports.actions.ts apps/web/src/actions/project-reports.actions.test.ts
git commit -m "feat(reports): getProjectReportUrlAction signed inline+download"
```

---

### Task 3: `deleteProjectReportAction` (ORG_WRITE_ROLES)

**Files:**
- Modify: `apps/web/src/actions/project-reports.actions.ts`
- Test: `apps/web/src/actions/project-reports.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `project-reports.actions.test.ts`:

```ts
describe('deleteProjectReportAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('returns { error } when caller lacks ORG_WRITE_ROLES', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (viewer) is not allowed' })

    const { deleteProjectReportAction } = await import('./project-reports.actions')
    const result = await deleteProjectReportAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
  })

  it('returns { error: Not found } for a report outside the project', async () => {
    const { client } = makeSupabase({ reportRow: null })
    createClientMock.mockResolvedValue(client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteProjectReportAction } = await import('./project-reports.actions')
    const result = await deleteProjectReportAction(PROJECT_ID, REPORT_ID)

    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toMatch(/not found/i)
  })

  it('deletes the row and best-effort removes the storage object', async () => {
    const { client } = makeSupabase({ reportRow: REPORT_ROW })
    const service = makeServiceClient({})
    createClientMock.mockResolvedValue(client)
    createServiceClientMock.mockReturnValue(service.client)
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })

    const { deleteProjectReportAction } = await import('./project-reports.actions')
    const result = await deleteProjectReportAction(PROJECT_ID, REPORT_ID)

    expect(result).toEqual({ ok: true })
    expect(service.remove).toHaveBeenCalledWith([REPORT_ROW.storage_path])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.actions.test.ts -t deleteProjectReportAction`
Expected: FAIL — `deleteProjectReportAction is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `project-reports.actions.ts`:

```ts
/** Delete a saved report (row + best-effort storage object). Gate: ORG_WRITE_ROLES. */
export async function deleteProjectReportAction(
  projectId: string,
  reportId: string,
): Promise<{ ok: true } | ErrResult> {
  const supabase = await createClient()

  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .schema('projects').from('reports')
    .select('storage_path')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  const report = row as { storage_path: string } | null
  if (!report) return { error: 'Not found' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteErr } = await (supabase as any)
    .schema('projects').from('reports')
    .delete()
    .eq('id', reportId)
    .eq('project_id', projectId)

  if (deleteErr) return { error: deleteErr.message ?? 'Failed to delete report' }

  // Best-effort object removal — an orphaned private object is harmless.
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).storage.from(REPORTS_BUCKET).remove([report.storage_path]).catch(() => {})

  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/actions/project-reports.actions.test.ts`
Expected: PASS (all 8 tests across the three describes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/project-reports.actions.ts apps/web/src/actions/project-reports.actions.test.ts
git commit -m "feat(reports): deleteProjectReportAction (ORG_WRITE_ROLES + storage cleanup)"
```

---

### Task 4: Shared `ReportViewerModal` component

**Files:**
- Create: `apps/web/src/components/reports/ReportViewerModal.tsx`

(No standalone test — presentational; exercised by the panel test in Task 5.)

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/reports/ReportViewerModal.tsx` (generalised from the GCR module-local viewer — `label` instead of `revLabel`):

```tsx
'use client'

/**
 * ReportViewerModal — contained in-app viewer for a saved report PDF. Centered
 * overlay with an <iframe> of the inline signed URL (cross-origin Supabase, so
 * X-Frame-Options does not apply — it frames cleanly).
 */
import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

interface Props {
  title: string
  label: string
  /** Inline (non-attachment) signed URL for the PDF. */
  url: string
  onDownload: () => void
  isDownloading: boolean
  onClose: () => void
}

export function ReportViewerModal({ title, label, url, onDownload, isDownloading, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — ${label}`}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(90vw, 880px)', height: '90vh', background: 'var(--c-bg)', border: '1px solid var(--c-border)', borderRadius: 10, boxShadow: '0 14px 48px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <Button variant="secondary" size="sm" onClick={onDownload} isLoading={isDownloading} style={{ fontSize: 12 }}>Download</Button>
          <button onClick={onClose} aria-label="Close report viewer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 20, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>
        <iframe src={url} title={`${title} — ${label}`} style={{ flex: 1, width: '100%', border: 'none', background: '#525659' }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it type-checks (compiled via the panel test in Task 5)**

Run: `pnpm --filter web exec tsc --noEmit` — Expected: no new errors from this file. (Project sets `typescript.ignoreBuildErrors`; this step is a sanity check, not a gate.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/reports/ReportViewerModal.tsx
git commit -m "feat(reports): shared ReportViewerModal"
```

---

### Task 5: Reusable `SavedReportsPanel` component

**Files:**
- Create: `apps/web/src/components/reports/SavedReportsPanel.tsx`
- Test: `apps/web/src/components/reports/SavedReportsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/reports/SavedReportsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectReportRow } from '@/actions/project-reports.actions'

const getUrlMock = vi.fn()
const deleteMock = vi.fn()
vi.mock('@/actions/project-reports.actions', () => ({
  getProjectReportUrlAction: (...a: unknown[]) => getUrlMock(...a),
  deleteProjectReportAction: (...a: unknown[]) => deleteMock(...a),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

const ROW: ProjectReportRow = {
  id: 'rep-3', project_id: PROJECT_ID, organisation_id: 'org-1',
  kind: 'tenant_schedule', title: 'Tenant Schedule Report',
  storage_path: 'org-1/proj/tenant-schedule-v3.pdf', mime_type: 'application/pdf',
  size_bytes: 1000, status: 'issued', version: 3, generated_by: 'u1',
  generated_at: '2026-06-20T08:00:00Z', created_at: '2026-06-20T08:00:00Z',
}

function renderPanel(overrides: Partial<Parameters<typeof import('./SavedReportsPanel').SavedReportsPanel>[0]> = {}) {
  return import('./SavedReportsPanel').then(({ SavedReportsPanel }) =>
    render(<SavedReportsPanel projectId={PROJECT_ID} kind="tenant_schedule" reports={[ROW]} canManage {...overrides} />),
  )
}

describe('SavedReportsPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows the empty state when there are no reports', async () => {
    await renderPanel({ reports: [] })
    expect(screen.getByText(/no saved reports yet/i)).toBeDefined()
  })

  it('renders a row with version label and status', async () => {
    await renderPanel()
    expect(screen.getByText('v3')).toBeDefined()
    expect(screen.getByText(/issued/i)).toBeDefined()
  })

  it('Preview opens the viewer with an inline signed URL', async () => {
    getUrlMock.mockResolvedValue({ url: 'https://signed.example/inline.pdf' })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /preview/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    expect(getUrlMock).toHaveBeenCalledWith(PROJECT_ID, 'rep-3')
    const iframe = screen.getByTitle(/v3/) as HTMLIFrameElement
    expect(iframe.tagName).toBe('IFRAME')
    expect(iframe.src).toBe('https://signed.example/inline.pdf')
  })

  it('Download requests the attachment disposition', async () => {
    getUrlMock.mockResolvedValue({ url: 'https://signed.example/dl.pdf' })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => expect(getUrlMock).toHaveBeenCalledWith(PROJECT_ID, 'rep-3', { download: true }))
  })

  it('Delete requires confirmation then calls the action and refreshes', async () => {
    deleteMock.mockResolvedValue({ ok: true })
    await renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteMock).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith(PROJECT_ID, 'rep-3')
      expect(refreshMock).toHaveBeenCalled()
    })
  })

  it('hides Delete when canManage is false', async () => {
    await renderPanel({ canManage: false })
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/reports/SavedReportsPanel.test.tsx`
Expected: FAIL — `Cannot find module './SavedReportsPanel'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/reports/SavedReportsPanel.tsx`:

```tsx
'use client'

/**
 * SavedReportsPanel — lists a project's saved reports of one kind, with in-app
 * Preview, Download, and (manager-only) Delete. Generic over projects.reports;
 * the same panel serves every section and the Reports hub.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  getProjectReportUrlAction,
  deleteProjectReportAction,
  type ProjectReportRow,
} from '@/actions/project-reports.actions'
import { ReportViewerModal } from './ReportViewerModal'

interface Props {
  projectId: string
  kind: string
  reports: ProjectReportRow[]
  canManage: boolean
  /** Modal/card title; defaults to "Saved reports". */
  title?: string
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function SavedReportsPanel({ projectId, kind, reports, canManage, title = 'Saved reports' }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [viewer, setViewer] = useState<{ label: string; url: string; reportId: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function handlePreview(rep: ProjectReportRow) {
    setBusyId(rep.id)
    setRowError(null)
    try {
      const res = await getProjectReportUrlAction(projectId, rep.id)
      if ('error' in res) { setRowError(res.error); return }
      setViewer({ label: `v${rep.version}`, url: res.url, reportId: rep.id })
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDownload(rep: ProjectReportRow) {
    setBusyId(rep.id)
    setRowError(null)
    try {
      const res = await getProjectReportUrlAction(projectId, rep.id, { download: true })
      if ('error' in res) { setRowError(res.error); return }
      const a = document.createElement('a')
      a.href = res.url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(rep: ProjectReportRow) {
    setBusyId(rep.id)
    setRowError(null)
    try {
      const res = await deleteProjectReportAction(projectId, rep.id)
      if ('error' in res) { setRowError(res.error); return }
      startTransition(() => router.refresh())
    } catch {
      setRowError('Request failed — check your connection and try again.')
    } finally {
      setBusyId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>{title}</span>
      </CardHeader>
      <CardBody>
        {rowError && (
          <div role="alert" style={{ marginBottom: 10, padding: '8px 12px', border: '1px solid var(--c-red)', borderRadius: 6, fontSize: 13, color: 'var(--c-red)' }}>
            {rowError}
          </div>
        )}

        {reports.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
            No saved reports yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reports.map((rep) => {
              const busy = busyId === rep.id
              const confirming = confirmDeleteId === rep.id
              return (
                <div key={rep.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 4px', borderBottom: '1px solid var(--c-border)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>v{rep.version}</span>
                  <span style={{ fontSize: 12, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>{formatDate(rep.generated_at)}</span>
                  <span style={{ fontSize: 11, color: rep.status === 'issued' ? 'var(--c-green)' : 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{rep.status}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Button variant="secondary" size="sm" onClick={() => handlePreview(rep)} disabled={busy} style={{ fontSize: 11 }}>Preview</Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(rep)} disabled={busy} style={{ fontSize: 11 }}>Download</Button>
                    {canManage && (confirming ? (
                      <>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(rep)} disabled={busy} style={{ fontSize: 11 }}>Confirm delete</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)} disabled={busy} style={{ fontSize: 11 }}>Cancel</Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(rep.id)} disabled={busy} style={{ fontSize: 11, color: 'var(--c-red)' }}>Delete</Button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardBody>

      {viewer && (
        <ReportViewerModal
          title="Report"
          label={viewer.label}
          url={viewer.url}
          onDownload={() => {
            const rep = reports.find((r) => r.id === viewer.reportId)
            if (rep) handleDownload(rep)
          }}
          isDownloading={busyId === viewer.reportId}
          onClose={() => setViewer(null)}
        />
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/reports/SavedReportsPanel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/reports/SavedReportsPanel.tsx apps/web/src/components/reports/SavedReportsPanel.test.tsx
git commit -m "feat(reports): reusable SavedReportsPanel (preview/download/delete)"
```

---

### Task 6: Wire the panel into the tenant-schedule page + refresh after save

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx`

- [ ] **Step 1: Write the failing test (button refreshes after a successful save)**

Create `TenantScheduleReportButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

describe('TenantScheduleReportButton', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('refreshes the page after a successful Save to project', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/x')
    URL.revokeObjectURL = vi.fn()
    const fetchMock = vi.fn()
      // openPreview → blob
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })) })
      // save → 201
      .mockResolvedValueOnce({ status: 201, json: () => Promise.resolve({ reportId: 'r1', version: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /save to project/i })).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: /save to project/i }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"`
Expected: FAIL — `refreshMock` not called (the button doesn't refresh yet).

- [ ] **Step 3: Add `router.refresh()` after a successful save**

In `TenantScheduleReportButton.tsx`:

Add the import near the top (after the `'use client'` block, with the other imports):
```tsx
import { useRouter } from 'next/navigation'
```

Inside the component, add the hook as the first line of the body:
```tsx
  const router = useRouter()
```

In `save()`, change the success branch from:
```tsx
      if (res.status === 201) { setSaved(true); return }
```
to:
```tsx
      if (res.status === 201) { setSaved(true); router.refresh(); return }
```

- [ ] **Step 4: Run the button test to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"`
Expected: PASS (1 test).

- [ ] **Step 5: Render the Saved reports card on the page**

In `tenant-schedule/page.tsx`:

Add imports (with the other component imports near the top):
```tsx
import { listProjectReportsAction } from '@/actions/project-reports.actions'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { requireRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
```

After `const activeCount = …` / `const totalCount = …` (just before the `return (`), load the reports and the manage flag:
```tsx
  // Saved tenant-schedule reports (best-effort; failure just hides the card).
  const reportsRes = await listProjectReportsAction(projectId, 'tenant_schedule')
  const savedReports = Array.isArray(reportsRes) ? reportsRes : []
  const manageGuard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  const canManageReports = manageGuard.ok
```

Then, immediately after the closing `</Card>` of the schedule-table card (the last element before the outer `</div>`), add:
```tsx
      {/* Saved reports */}
      <div style={{ marginTop: 16 }}>
        <SavedReportsPanel
          projectId={projectId}
          kind="tenant_schedule"
          reports={savedReports}
          canManage={canManageReports}
        />
      </div>
```

- [ ] **Step 6: Type-check + full web suite**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no new errors from the touched files.

Run: `pnpm --filter web test`
Expected: PASS (existing suite + the new action/panel/button tests).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/page.tsx" \
        "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.tsx" \
        "apps/web/src/app/(admin)/projects/[id]/tenant-schedule/_components/TenantScheduleReportButton.test.tsx"
git commit -m "feat(tenant-schedule): Saved reports card + refresh after save"
```

---

## Manual verification (after Task 6)

On a deployed preview, logged in, for a project with at least one saved tenant-schedule report:
1. Tenant Schedule page shows a **Saved reports** card below the table listing each saved version (newest first) with status.
2. **Preview** opens the in-app viewer and renders the PDF (not blank).
3. **Download** saves the PDF with a `tenant-schedule-report-vN.pdf` name.
4. **Delete** (as owner/admin/PM) asks to confirm, removes the row, and the list updates. A viewer-only role sees no Delete.
5. Generate a new report → **Save to project** → the card shows the new version without a manual reload.

## Self-review notes (author)

- **Spec coverage:** shared actions (Tasks 1–3) ✓; reusable panel + viewer (Tasks 4–5) ✓; tenant-schedule "Saved reports" card + refresh-after-save (Task 6) ✓; preview via cross-origin signed URL ✓; delete = ORG_WRITE_ROLES ✓; tests for actions + panel ✓.
- **Out of scope (per spec):** Phase 2 (other sections), Phase 3 (hub), GCR changes, schema changes, pagination.
- **Type consistency:** `ProjectReportRow` defined in Task 1 is imported unchanged in Tasks 5; `getProjectReportUrlAction(projectId, reportId, {download})` and `deleteProjectReportAction(projectId, reportId)` signatures match between actions, panel, and tests.
