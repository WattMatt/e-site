# Solar Phase 2b — Part 3 of 5: Platform tariff library (`/admin/tariffs`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Read the index first. Parts 1–2 must be done (00214 green; `@esite/shared` tariff helpers and `runIngestJob` exist).

All commands run from `~/.config/superpowers/worktrees/esite/solar-phase-2b`.

**Gate.** E-Site has no platform-level admin pages (checked 2026-09-28: `(admin)` holds only org/project routes; `/metrics` uses `requireRolePage(OWNER_ADMIN)`). The library is gated by the 00210 helper `public.is_platform_tariff_admin()` (the explicit allow-list) and **404s** for everyone else, so a customer cannot even learn the route exists. The page layout, every page, every server action and the API route each ask the database; the layout is never the only gate (`app/api/*` sits outside `(admin)/layout.tsx`).

**Writes.** Everything a platform admin may write under 00210's policies goes through the **admin's own session** (RLS + triggers decide: review stamps, publish stamp, immutability). The service client is used only where 00210/00214 reserve the operation for the service role: Storage in the private `tariff-sources` bucket (no `storage.objects` policy), `ingest_run` + the validation record (`record_year_validation`), the job claim, the due-year monitor — and always AFTER the admin gate.

---

### Task 14: Admin gate, error sentences, year loader, year checks

**Files:**
- Create: `apps/web/src/lib/tariffs/admin-gate.ts`
- Create: `apps/web/src/lib/tariffs/errors.ts`
- Create: `apps/web/src/lib/tariffs/load-year.ts`
- Create: `apps/web/src/lib/tariffs/year-checks.ts`
- Test: `apps/web/src/lib/tariffs/admin-gate.test.ts`
- Test: `apps/web/src/lib/tariffs/errors.test.ts`
- Test: `apps/web/src/lib/tariffs/year-checks.test.ts`

- [ ] **Step 1: Write the failing tests**

`admin-gate.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('next/navigation', () => ({
  notFound: () => { h.notFound(); throw new Error('NOT_FOUND') },
  redirect: (to: string) => { h.redirect(to); throw new Error(`REDIRECT:${to}`) },
}))

import { isPlatformTariffAdmin, requirePlatformTariffAdmin, requirePlatformTariffAdminAPI, requirePlatformTariffAdminPage } from './admin-gate'
import { fakeSupabase } from '@/test/fake-supabase'

beforeEach(() => vi.clearAllMocks())

describe('platform tariff admin gate', () => {
  it('asks the database helper and fails closed on error', async () => {
    expect(await isPlatformTariffAdmin(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: true, error: null } } }).client as never)).toBe(true)
    expect(await isPlatformTariffAdmin(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client as never)).toBe(false)
    expect(await isPlatformTariffAdmin(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: null, error: { message: 'x' } } } }).client as never)).toBe(false)
  })
  it('pages 404 for a signed-in non-admin and send the signed-out to login', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client)
    await expect(requirePlatformTariffAdminPage()).rejects.toThrow('NOT_FOUND')
    h.createClient.mockResolvedValue(fakeSupabase({ userId: null }).client)
    await expect(requirePlatformTariffAdminPage()).rejects.toThrow('REDIRECT:/login')
  })
  it('actions return a sentence, never a redirect', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client)
    expect(await requirePlatformTariffAdmin()).toEqual({ ok: false, error: 'You do not have permission to do that.' })
    h.createClient.mockResolvedValue(fakeSupabase({ userId: 'u1', rpc: { is_platform_tariff_admin: { data: true, error: null } } }).client)
    expect(await requirePlatformTariffAdmin()).toMatchObject({ ok: true, userId: 'u1' })
  })
  it('API: 401 signed out, 404 non-admin', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ userId: null }).client)
    const a = await requirePlatformTariffAdminAPI()
    expect(a.ok === false && a.response.status).toBe(401)
    h.createClient.mockResolvedValue(fakeSupabase({ rpc: { is_platform_tariff_admin: { data: false, error: null } } }).client)
    const b = await requirePlatformTariffAdminAPI()
    expect(b.ok === false && b.response.status).toBe(404)
  })
})
```

`errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { humanTariffError } from './errors'

describe('humanTariffError', () => {
  it('maps the exact 00210/00214 sentences and SQLSTATEs, never the raw message', () => {
    expect(humanTariffError({ message: 'tariffs.tariff_year x: not validated, or 2 blocking issue(s); validate again after any change' }))
      .toBe('Run the checks again: the year changed since it was last checked, or the checks found blocking issues.')
    expect(humanTariffError({ message: 'tariffs.tariff_year x: 3 inferred unit(s) not reviewed' }))
      .toBe('Some charges with an inferred unit are not reviewed yet. Approve them first.')
    expect(humanTariffError({ message: 'tariffs.charge: tariff year y is published; published tariff data is immutable (correct it through a new version)' }))
      .toBe('Published tariff data cannot be changed. Correct it in a new version.')
    expect(humanTariffError({ code: '23505', message: 'duplicate key value violates unique constraint "licensee_name_key"' })).toBe('That already exists.')
    expect(humanTariffError({ code: 'XX000', message: 'secret internals' })).toBe('Something went wrong. Try again.')
  })
})
```

`year-checks.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeCharge, makeTariff } from '@esite/shared'
import { computeYearChecks } from './year-checks'

const t = (amount: number, name = 'Commercial') =>
  makeTariff({ name, structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: amount })] })

describe('computeYearChecks', () => {
  it('runs the validators and counts by severity', () => {
    const c = computeYearChecks([makeTariff({ name: 'Empty', structure: 'flat', charges: [] })], null, null)
    expect(c.blocking).toBe(1)
    expect(c.issues[0].code).toBe('empty_tariff')
    expect(c.yoy).toBeNull()
  })
  it('adds the YoY diff against the previous published year', () => {
    const c = computeYearChecks([t(300)], [t(250)], 10)
    expect(c.yoy?.changed).toHaveLength(1)
    expect(c.yoy?.changed[0].changePct).toBe(20)
    expect(c.issues.map((i) => i.code)).toContain('yoy_out_of_band')
    expect(c.review).toBe(1)
    expect(c.blocking).toBe(0)
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/tariffs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `admin-gate.ts`**

```ts
import 'server-only'
/**
 * Platform tariff library gate (D-03). Asks public.is_platform_tariff_admin()
 * (00210: an explicit allow-list, service-role writes only) — the same
 * question the tariffs.* write policies ask. Fails closed. Pages 404 for
 * non-admins so the route is not advertised; actions return a sentence;
 * API routes return JSON 401/404.
 */
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = SupabaseClient<any, any, any>

export const NOT_PERMITTED = 'You do not have permission to do that.'

export async function isPlatformTariffAdmin(supabase: AnyClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_tariff_admin')
  return !error && data === true
}

export async function requirePlatformTariffAdminPage(): Promise<{ supabase: AnyClient; userId: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await isPlatformTariffAdmin(supabase))) notFound()
  return { supabase, userId: user.id }
}

export type AdminGate = { ok: true; supabase: AnyClient; userId: string } | { ok: false; error: string }

export async function requirePlatformTariffAdmin(): Promise<AdminGate> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await isPlatformTariffAdmin(supabase))) return { ok: false, error: NOT_PERMITTED }
  return { ok: true, supabase, userId: user.id }
}

export async function requirePlatformTariffAdminAPI(): Promise<
  { ok: true; supabase: AnyClient; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (!(await isPlatformTariffAdmin(supabase))) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ok: true, supabase, userId: user.id }
}
```

- [ ] **Step 4: Implement `errors.ts`**

```ts
/**
 * tariffs.* errors -> one human sentence (spec §0.4 rule 5). Keyed on the
 * exact sentences raised by 00210's guards and 00214's functions, then the
 * SQLSTATE. Never returns the raw message.
 */
export const TARIFF_GENERIC_ERROR = 'Something went wrong. Try again.'

export function humanTariffError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (m.includes('nothing to publish')) return 'There is nothing to publish: this year has no tariffs.'
  if (m.includes('have no charges')) return 'Some tariffs have no charges. Add charges or delete those tariffs before publishing.'
  if (m.includes('inferred unit(s) not reviewed')) return 'Some charges with an inferred unit are not reviewed yet. Approve them first.'
  if (m.includes('not validated')) return 'Run the checks again: the year changed since it was last checked, or the checks found blocking issues.'
  if (m.includes('needs a signed-in platform tariff admin')) return 'Publishing needs a signed-in tariff administrator.'
  if (m.includes('is not a legal transition')) return 'That state change is not allowed.'
  if (m.includes('changed while it was being checked')) return 'The year changed while it was being checked. Run the checks again.'
  if (m.includes('immutable')) return 'Published tariff data cannot be changed. Correct it in a new version.'
  if (m.includes('sha256 and storage_path are fixed')) return 'A stored source file cannot be replaced. Upload it as a new document.'
  if (err?.code === '23505') return 'That already exists.'
  if (err?.code === '23503') return 'It is still used elsewhere, so it cannot be removed.'
  if (err?.code === '23514') return 'That value is not allowed.'
  if (err?.code === '42501') return 'You do not have permission to do that.'
  return TARIFF_GENERIC_ERROR
}
```

- [ ] **Step 5: Implement `load-year.ts`**

```ts
import 'server-only'
/**
 * A tariff year's tariffs and charges as the canonical Tariff model (2a's
 * tariffFromRows), with the row ids kept alongside so an issue's chargeIndex
 * can be mapped back to a charge row. Charges are ordered deterministically
 * BEFORE conversion so tariff.charges[i] is chargeRows[i].
 */
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import type { Tariff } from '@esite/shared'
import type { AnyClient } from './admin-gate'

type Row = Record<string, unknown>

export interface LoadedTariff {
  id: string
  row: Row
  tariff: Tariff
  chargeRows: Row[]
}

const CHUNK = 100

function chargeOrder(a: Row, b: Row): number {
  const k = (r: Row) => [r.component, r.season, r.tou, r.day_type, String(r.block_min_kwh ?? ''), r.id].join('|')
  return k(a).localeCompare(k(b))
}

export async function loadYearTariffs(client: AnyClient, yearId: string): Promise<LoadedTariff[]> {
  const t = client.schema('tariffs')
  const { data: tariffs, error } = await t.from('tariff').select('*').eq('tariff_year_id', yearId).order('name')
  if (error) throw new Error(`tariffs: ${error.message}`)
  const rows = (tariffs ?? []) as Row[]
  const ids = rows.map((r) => String(r.id))
  const charges: Row[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error: e } = await t.from('charge').select('*').in('tariff_id', ids.slice(i, i + CHUNK))
    if (e) throw new Error(`charges: ${e.message}`)
    charges.push(...((data ?? []) as Row[]))
  }
  return rows.map((r) => {
    const own = charges.filter((c) => c.tariff_id === r.id).sort(chargeOrder)
    return { id: String(r.id), row: r, tariff: tariffFromRows(r, own), chargeRows: own }
  })
}

/** The licensee's published/superseded year immediately before `financialYear`, or null. */
export async function loadPreviousPublished(
  client: AnyClient, licenseeId: string, previousFy: string,
): Promise<{ yearId: string; tariffs: Tariff[] } | null> {
  const { data } = await client.schema('tariffs').from('tariff_year').select('id, state')
    .eq('licensee_id', licenseeId).eq('financial_year', previousFy).in('state', ['published', 'superseded']).limit(1)
  const y = (data as Row[] | null)?.[0]
  if (!y) return null
  const loaded = await loadYearTariffs(client, String(y.id))
  return { yearId: String(y.id), tariffs: loaded.map((l) => l.tariff) }
}
```

- [ ] **Step 6: Implement `year-checks.ts`**

```ts
/**
 * The automatic checks list (spec §12): 2a's validators (units, VAT pairs,
 * block continuity, TOU completeness, plausible ranges, duplicates) plus the
 * YoY diff against the previous published year (% vs approved increase).
 */
import { diffTariffYears, validateTariffYear, type Tariff, type TariffIssue, type YoyDiff } from '@esite/shared'

export interface YearChecks {
  issues: TariffIssue[]
  blocking: number
  review: number
  warn: number
  yoy: YoyDiff | null
}

export function computeYearChecks(tariffs: Tariff[], previous: Tariff[] | null, approvedIncreasePct: number | null): YearChecks {
  const issues: TariffIssue[] = [...validateTariffYear(tariffs)]
  let yoy: YoyDiff | null = null
  if (previous) {
    yoy = diffTariffYears(previous, tariffs, approvedIncreasePct)
    issues.push(...yoy.issues)
  }
  return {
    issues,
    blocking: issues.filter((i) => i.severity === 'block').length,
    review: issues.filter((i) => i.severity === 'review').length,
    warn: issues.filter((i) => i.severity === 'warn').length,
    yoy,
  }
}
```

- [ ] **Step 7: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/tariffs`
Expected: PASS (4 + 1 + 2 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/tariffs
git commit -m "feat(tariff-admin): platform tariff admin gate, error sentences, year loader and checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Library actions — licensees, sources (upload + register), jobs, source URL, monitor, error reports

**Files:**
- Create: `apps/web/src/lib/tariffs/source-files.ts`
- Create: `apps/web/src/actions/tariff-library.actions.ts`
- Test: `apps/web/src/lib/tariffs/source-files.test.ts`
- Test: `apps/web/src/actions/tariff-library.actions.test.ts`

Upload path: the browser hashes the file (`crypto.subtle`), asks the server for a signed upload URL for the path `storagePathFor(fy, sha256, name)` (2a's own naming), uploads straight to Storage (Vercel's ~4.5 MB request cap rules out posting a 50 MB tariff book through a function), then asks the server to **register** it: the server downloads the object, recomputes the sha256, and only then inserts `tariffs.source_document` through the admin's session. A mismatch deletes the object.

- [ ] **Step 1: Write the failing tests**

`source-files.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { contentTypeFor, sourceStoragePath, validateSourceMeta, MAX_SOURCE_BYTES } from './source-files'

describe('tariff source files', () => {
  it('accepts only the bucket MIME types, by extension', () => {
    expect(contentTypeFor('Eskom 2026-27.xlsm')).toBe('application/vnd.ms-excel.sheet.macroEnabled.12')
    expect(contentTypeFor('GP.XLSX')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(contentTypeFor('rfd.pdf')).toBe('application/pdf')
    expect(contentTypeFor('notes.docx')).toBeNull()
  })
  it('stores by financial year and sha256 (2a naming); a document without a year goes under reference/', () => {
    const sha = 'a'.repeat(64)
    expect(sourceStoragePath({ financialYear: '2026/27', sha256: sha, fileName: 'X.PDF' })).toBe(`2026-27/${sha}.pdf`)
    expect(sourceStoragePath({ financialYear: null, sha256: sha, fileName: 'rules.pdf' })).toBe(`reference/${sha}.pdf`)
  })
  it('validates the metadata a source needs', () => {
    const ok = { fileName: 'a.pdf', sha256: 'b'.repeat(64), size: 10, kind: 'nersa_decision', title: 'City Power RfD', financialYear: '2026/27', status: 'nersa_approved', licenseeId: null, publishedOn: '', url: '' }
    expect(validateSourceMeta(ok)).toEqual({})
    expect(validateSourceMeta({ ...ok, sha256: 'x', size: MAX_SOURCE_BYTES + 1, title: ' ', financialYear: '2026/28', kind: 'memo' })).toEqual({
      file: 'The file is larger than 50 MB', sha256: 'The file checksum is missing', title: 'Give the document a title',
      financialYear: 'Use the form 2026/27', kind: 'Choose the document kind',
    })
  })
})
```

`tariff-library.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  svc: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate, NOT_PERMITTED: 'You do not have permission to do that.' }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import {
  saveLicenseeAction, addLicenseeAliasAction, createSourceUploadAction, registerSourceDocumentAction,
  queueIngestJobAction, resolveErrorReportAction, runDueYearCheckAction,
} from './tariff-library.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const SHA_OF_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'   // sha256("abc")

function storageFake(bytes = new TextEncoder().encode('abc')) {
  const removed: string[][] = []
  const storage = {
    from: () => ({
      createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { path, token: 'tok', signedUrl: 'https://x' }, error: null })),
      download: vi.fn(async () => ({ data: new Blob([bytes]), error: null })),
      remove: vi.fn(async (paths: string[]) => { removed.push(paths); return { data: [], error: null } }),
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed' }, error: null })),
    }),
  }
  return { storage, removed }
}

function admin(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const fake = fakeSupabase({ userId: 'admin-1', ...extra })
  h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'admin-1' })
  return fake
}

beforeEach(() => vi.clearAllMocks())

const meta = { fileName: 'abc.pdf', sha256: SHA_OF_ABC, size: 3, kind: 'nersa_decision', title: 'Probe RfD', financialYear: '2026/27', status: 'nersa_approved', licenseeId: null, publishedOn: '', url: '' }

describe('tariff library actions', () => {
  it('every action refuses a non-admin with a sentence and writes nothing', async () => {
    h.gate.mockResolvedValue({ ok: false, error: 'You do not have permission to do that.' })
    expect(await saveLicenseeAction({ id: null, name: 'X', kind: 'municipal', mdbCode: '', province: 'GP', nersaLicenceNo: '', expectedUpdatedAt: null }))
      .toEqual({ error: 'You do not have permission to do that.' })
    expect(await queueIngestJobAction({ sourceDocumentId: 'd', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'X', createLicensees: false }))
      .toEqual({ error: 'You do not have permission to do that.' })
    expect(h.svc).not.toHaveBeenCalled()
  })

  it('saves a licensee through the admin session and validates first', async () => {
    const { calls } = admin({ writes: { 'tariffs.licensee:insert': { data: [{ id: 'l1', updated_at: 'T1' }] } } })
    expect(await saveLicenseeAction({ id: null, name: '  ', kind: 'municipal', mdbCode: '', province: 'GP', nersaLicenceNo: '', expectedUpdatedAt: null }))
      .toEqual({ fieldErrors: { name: 'Enter the licensee name' } })
    expect(await saveLicenseeAction({ id: null, name: 'City of Probe', kind: 'municipal', mdbCode: 'PRB', province: 'GP', nersaLicenceNo: '', expectedUpdatedAt: null }))
      .toEqual({ ok: true, id: 'l1', updatedAt: 'T1' })
    expect(callsTo(calls, 'tariffs.licensee', 'insert')[0].payload).toEqual({ name: 'City of Probe', kind: 'municipal', mdb_code: 'PRB', province: 'GP', nersa_licence_no: null })
  })

  it('stores aliases normalised (the licensee_alias CHECK)', async () => {
    const { calls } = admin()
    const L = '11111111-1111-1111-1111-111111111111'
    await addLicenseeAliasAction({ licenseeId: L, alias: ' city  of probe ' })
    expect(callsTo(calls, 'tariffs.licensee_alias', 'insert')[0].payload).toEqual({ alias: 'CITY OF PROBE', licensee_id: L })
  })

  it('upload URL: refuses a file already in the library; signs the 2a path otherwise', async () => {
    admin({ tables: { 'tariffs.source_document': [{ id: 'd0', sha256: SHA_OF_ABC, title: 'Old' }] } })
    expect(await createSourceUploadAction(meta)).toEqual({ error: 'This file is already in the library as "Old".' })
    admin()
    const s = storageFake()
    h.svc.mockReturnValue({ storage: s.storage })
    expect(await createSourceUploadAction(meta)).toEqual({ ok: true, path: `2026-27/${SHA_OF_ABC}.pdf`, token: 'tok' })
  })

  it('register: recomputes the checksum server-side; a mismatch deletes the object and inserts nothing', async () => {
    const fake = admin()
    const bad = storageFake(new TextEncoder().encode('not abc'))
    h.svc.mockReturnValue({ storage: bad.storage })
    expect(await registerSourceDocumentAction(meta)).toEqual({ error: 'The uploaded file does not match its checksum. Upload it again.' })
    expect(bad.removed).toEqual([[`2026-27/${SHA_OF_ABC}.pdf`]])
    expect(callsTo(fake.calls, 'tariffs.source_document', 'insert')).toHaveLength(0)
  })

  it('register: inserts the document through the admin session', async () => {
    const fake = admin({ writes: { 'tariffs.source_document:insert': { data: [{ id: 'd1' }] } } })
    h.svc.mockReturnValue({ storage: storageFake().storage })
    expect(await registerSourceDocumentAction(meta)).toEqual({ ok: true, id: 'd1' })
    expect(callsTo(fake.calls, 'tariffs.source_document', 'insert')[0].payload).toMatchObject({
      kind: 'nersa_decision', title: 'Probe RfD', financial_year: '2026/27', status: 'nersa_approved',
      storage_path: `2026-27/${SHA_OF_ABC}.pdf`, sha256: SHA_OF_ABC, licensee_id: null, url: null,
    })
  })

  it('queues a PDF ingest; an RfD needs the licensee name', async () => {
    const { calls } = admin({ writes: { 'tariffs.ingest_job:insert': { data: [{ id: 'j1' }] } } })
    expect(await queueIngestJobAction({ sourceDocumentId: 'd1', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: ' ', createLicensees: false }))
      .toEqual({ error: 'An RfD covers one licensee: enter its name as the registry spells it.' })
    expect(await queueIngestJobAction({ sourceDocumentId: 'd1', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'City Power', createLicensees: false }))
      .toEqual({ ok: true, id: 'j1' })
    expect(callsTo(calls, 'tariffs.ingest_job', 'insert')[0].payload).toEqual({
      source_document_id: 'd1', parser: 'rfd_pdf', financial_year: '2026/27', licensee_name: 'City Power', create_licensees: false,
    })
  })

  it('resolves an error report; rejecting needs a note', async () => {
    const { calls } = admin({ writes: { 'tariffs.error_report:update': { data: [{ id: 'r1' }] } } })
    expect(await resolveErrorReportAction({ id: 'r1', status: 'rejected', resolutionNote: '' }))
      .toEqual({ error: 'Say why the report is rejected.' })
    expect(await resolveErrorReportAction({ id: 'r1', status: 'resolved', resolutionNote: 'Fixed in 2026/27' })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.error_report', 'update')[0].payload).toEqual({ status: 'resolved', resolution_note: 'Fixed in 2026/27' })
  })

  it('runs the due-year monitor through the service role after the gate', async () => {
    admin()
    const rpc = vi.fn(async () => ({ data: 2, error: null }))
    h.svc.mockReturnValue({ schema: () => ({ rpc }) })
    expect(await runDueYearCheckAction({ regime: 'municipal' })).toEqual({ ok: true, inserted: 2 })
    expect(rpc).toHaveBeenCalledWith('record_due_year_alerts', { p_regime: 'municipal' })
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/tariffs/source-files.test.ts src/actions/tariff-library.actions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `source-files.ts`**

```ts
/**
 * Tariff source files: the three MIME types the private tariff-sources bucket
 * accepts (00210), 2a's storage naming (<fy>/<sha256>.<ext>), metadata checks.
 */
import { SOURCE_DOCUMENT_KINDS, SOURCE_DOCUMENT_STATUSES } from '@esite/shared'

export const MAX_SOURCE_BYTES = 52_428_800

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
}

function ext(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

export function contentTypeFor(fileName: string): string | null {
  return TYPES[ext(fileName)] ?? null
}

/** Same as 2a's storagePathFor for a dated source; undated references live under reference/. */
export function sourceStoragePath(s: { financialYear: string | null; sha256: string; fileName: string }): string {
  return s.financialYear ? `${s.financialYear.replace('/', '-')}/${s.sha256}${ext(s.fileName)}` : `reference/${s.sha256}${ext(s.fileName)}`
}

export interface SourceMeta {
  fileName: string
  sha256: string
  size: number
  kind: string
  title: string
  financialYear: string
  status: string
  licenseeId: string | null
  publishedOn: string
  url: string
}

export type SourceMetaField = 'file' | 'sha256' | 'kind' | 'title' | 'financialYear' | 'status' | 'publishedOn' | 'url'

const FY = /^(\d{4})\/(\d{2})$/

export function validateSourceMeta(m: SourceMeta): Partial<Record<SourceMetaField, string>> {
  const e: Partial<Record<SourceMetaField, string>> = {}
  if (!contentTypeFor(m.fileName)) e.file = 'Upload a PDF, XLSX or XLSM file'
  else if (!(m.size > 0)) e.file = 'The file is empty'
  else if (m.size > MAX_SOURCE_BYTES) e.file = 'The file is larger than 50 MB'
  if (!/^[0-9a-f]{64}$/.test(m.sha256)) e.sha256 = 'The file checksum is missing'
  if (!(SOURCE_DOCUMENT_KINDS as readonly string[]).includes(m.kind)) e.kind = 'Choose the document kind'
  if (!m.title.trim()) e.title = 'Give the document a title'
  else if (m.title.trim().length > 300) e.title = 'Keep the title under 300 characters'
  if (m.financialYear.trim()) {
    const f = FY.exec(m.financialYear.trim())
    if (!f || (Number(f[1]) + 1) % 100 !== Number(f[2])) e.financialYear = 'Use the form 2026/27'
  }
  if (!(SOURCE_DOCUMENT_STATUSES as readonly string[]).includes(m.status)) e.status = 'Choose the document status'
  if (m.publishedOn && !/^\d{4}-\d{2}-\d{2}$/.test(m.publishedOn)) e.publishedOn = 'Use a date'
  if (m.url && !/^https:\/\/\S+$/.test(m.url)) e.url = 'Use an https:// link'
  return e
}
```

- [ ] **Step 4: Implement `tariff-library.actions.ts`**

```ts
'use server'
/**
 * Platform tariff library actions (spec §12; D-03). Every action re-checks
 * is_platform_tariff_admin (requirePlatformTariffAdmin) and writes through the
 * admin's session where 00210/00214 give admins a policy. The service client
 * is used only for what 00210/00214 reserve for the service role (Storage in
 * the private tariff-sources bucket, the due-year monitor) and only after the
 * gate. Errors are sentences (spec §0.4 rule 5).
 */
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LICENSEE_KINDS } from '@esite/shared'
import { normaliseAlias, PROVINCES } from '@esite/shared/tariffs/ingest'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError } from '@/lib/tariffs/errors'
import { contentTypeFor, sourceStoragePath, validateSourceMeta, type SourceMeta, type SourceMetaField } from '@/lib/tariffs/source-files'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Ok<T = object> = ({ ok: true } & T) | { error: string }

const BUCKET = 'tariff-sources'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FY = /^\d{4}\/\d{2}$/
const STALE = 'Someone else changed this — reload to see their version.'

// ── Licensees ───────────────────────────────────────────────────────────────
export interface LicenseeForm {
  id: string | null
  name: string
  kind: string
  mdbCode: string
  province: string
  nersaLicenceNo: string
  expectedUpdatedAt: string | null
}

export async function saveLicenseeAction(f: LicenseeForm): Promise<
  { ok: true; id: string; updatedAt: string } | { error: string } | { fieldErrors: Partial<Record<'name' | 'kind' | 'province' | 'mdbCode', string>> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const fieldErrors: Partial<Record<'name' | 'kind' | 'province' | 'mdbCode', string>> = {}
  const name = String(f.name ?? '').trim()
  if (!name) fieldErrors.name = 'Enter the licensee name'
  else if (name.length > 200) fieldErrors.name = 'Keep the name under 200 characters'
  if (!(LICENSEE_KINDS as readonly string[]).includes(f.kind)) fieldErrors.kind = 'Choose the licensee kind'
  if (f.province && !(PROVINCES as readonly string[]).includes(f.province)) fieldErrors.province = 'Choose a province'
  if (String(f.mdbCode ?? '').trim().length > 20) fieldErrors.mdbCode = 'MDB codes are short (e.g. JHB)'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  const row = {
    name, kind: f.kind, mdb_code: f.mdbCode.trim() || null, province: f.province || null,
    nersa_licence_no: f.nersaLicenceNo.trim() || null,
  }
  const t = gate.supabase.schema('tariffs').from('licensee')
  const res = f.id === null
    ? await t.insert(row).select('id, updated_at')
    : await t.update(row).eq('id', f.id).eq('updated_at', f.expectedUpdatedAt ?? '').select('id, updated_at')
  if (res.error) return { error: res.error.code === '23505' ? 'A licensee with that name or MDB code already exists.' : humanTariffError(res.error) }
  const r = (res.data as Array<{ id: string; updated_at: string }> | null)?.[0]
  if (!r) return { error: STALE }
  revalidatePath('/admin/tariffs/licensees')
  return { ok: true, id: r.id, updatedAt: r.updated_at }
}

export async function addLicenseeAliasAction(input: { licenseeId: string; alias: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const alias = normaliseAlias(String(input.alias ?? ''))
  if (!alias) return { error: 'Enter the alias as it appears in the source' }
  if (!UUID.test(input.licenseeId)) return { error: 'Choose a licensee' }
  const { error } = await gate.supabase.schema('tariffs').from('licensee_alias').insert({ alias, licensee_id: input.licenseeId })
  if (error) return { error: error.code === '23505' ? 'That alias already points at a licensee.' : humanTariffError(error) }
  revalidatePath('/admin/tariffs/licensees')
  return { ok: true }
}

export async function removeLicenseeAliasAction(input: { alias: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { error } = await gate.supabase.schema('tariffs').from('licensee_alias').delete().eq('alias', String(input.alias ?? ''))
  if (error) return { error: humanTariffError(error) }
  revalidatePath('/admin/tariffs/licensees')
  return { ok: true }
}

// ── Source documents ────────────────────────────────────────────────────────
function firstError(e: Partial<Record<SourceMetaField, string>>): string | null {
  const v = Object.values(e)[0]
  return v ?? null
}

export async function createSourceUploadAction(m: SourceMeta): Promise<{ ok: true; path: string; token: string } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const bad = firstError(validateSourceMeta(m))
  if (bad) return { error: bad }
  const { data: existing } = await gate.supabase.schema('tariffs').from('source_document')
    .select('id, title').eq('sha256', m.sha256).limit(1)
  const dup = (existing as Array<{ title: string }> | null)?.[0]
  if (dup) return { error: `This file is already in the library as "${dup.title}".` }
  const path = sourceStoragePath({ financialYear: m.financialYear.trim() || null, sha256: m.sha256, fileName: m.fileName })
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) return { error: 'Could not prepare the upload. Try again.' }
  return { ok: true, path, token: data.token }
}

export async function registerSourceDocumentAction(m: SourceMeta): Promise<{ ok: true; id: string } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const bad = firstError(validateSourceMeta(m))
  if (bad) return { error: bad }
  const path = sourceStoragePath({ financialYear: m.financialYear.trim() || null, sha256: m.sha256, fileName: m.fileName })
  const svc = createServiceClient() as unknown as AnyClient
  const { data: blob, error: dlError } = await svc.storage.from(BUCKET).download(path)
  if (dlError || !blob) return { error: 'The upload did not arrive. Try again.' }
  const bytes = new Uint8Array(await (blob as Blob).arrayBuffer())
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== m.sha256) {
    await svc.storage.from(BUCKET).remove([path])
    return { error: 'The uploaded file does not match its checksum. Upload it again.' }
  }
  const { data, error } = await gate.supabase.schema('tariffs').from('source_document').insert({
    licensee_id: m.licenseeId && UUID.test(m.licenseeId) ? m.licenseeId : null,
    kind: m.kind, title: m.title.trim(), financial_year: m.financialYear.trim() || null, status: m.status,
    published_on: m.publishedOn || null, storage_path: path, sha256: sha, url: m.url.trim() || null,
    retrieved_at: new Date().toISOString(),
  }).select('id')
  if (error) return { error: error.code === '23505' ? 'This file is already in the library.' : humanTariffError(error) }
  revalidatePath('/admin/tariffs/sources')
  return { ok: true, id: String((data as Array<{ id: string }>)[0]?.id ?? '') }
}

/** A short-lived signed URL (10 min) for the review queue's source viewer. */
export async function getTariffSourceUrlAdminAction(input: { sourceDocumentId: string }): Promise<
  { url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { data } = await gate.supabase.schema('tariffs').from('source_document')
    .select('storage_path, url').eq('id', input.sourceDocumentId).maybeSingle()
  const doc = data as { storage_path: string | null; url: string | null } | null
  if (!doc) return { error: 'That source document no longer exists.' }
  if (doc.storage_path) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: s, error } = await svc.storage.from(BUCKET).createSignedUrl(doc.storage_path, 600)
    if (error || !s) return { error: 'Could not open the source document. Try again.' }
    return { url: s.signedUrl, kind: contentTypeFor(doc.storage_path) === 'application/pdf' ? 'pdf' : 'xlsx' }
  }
  if (doc.url) return { url: doc.url, kind: 'link' }
  return { error: 'This source has no stored file or link.' }
}

// ── Ingest jobs (PDF: the staff worker runs them) ───────────────────────────
export interface QueueJobInput {
  sourceDocumentId: string
  parser: 'province_xlsx' | 'eskom_xlsm' | 'rfd_pdf'
  financialYear: string
  licenseeName: string
  createLicensees: boolean
}

export async function queueIngestJobAction(i: QueueJobInput): Promise<{ ok: true; id: string } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  if (!['province_xlsx', 'eskom_xlsm', 'rfd_pdf'].includes(i.parser)) return { error: 'Choose a parser' }
  if (!FY.test(String(i.financialYear ?? ''))) return { error: 'Use the form 2026/27' }
  const licenseeName = String(i.licenseeName ?? '').trim()
  if (i.parser === 'rfd_pdf' && !licenseeName) return { error: 'An RfD covers one licensee: enter its name as the registry spells it.' }
  const { data, error } = await gate.supabase.schema('tariffs').from('ingest_job').insert({
    source_document_id: i.sourceDocumentId, parser: i.parser, financial_year: i.financialYear,
    licensee_name: licenseeName || null, create_licensees: Boolean(i.createLicensees),
  }).select('id')
  if (error) return { error: humanTariffError(error) }
  revalidatePath('/admin/tariffs/sources')
  return { ok: true, id: String((data as Array<{ id: string }>)[0]?.id ?? '') }
}

// ── Due-year monitor (the cron job's function, runnable on demand) ──────────
export async function runDueYearCheckAction(input: { regime: 'eskom' | 'municipal' }): Promise<{ ok: true; inserted: number } | { error: string }> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  if (input.regime !== 'eskom' && input.regime !== 'municipal') return { error: 'Choose Eskom or municipal' }
  const svc = createServiceClient() as unknown as AnyClient
  const { data, error } = await svc.schema('tariffs').rpc('record_due_year_alerts', { p_regime: input.regime })
  if (error) return { error: humanTariffError(error) }
  revalidatePath('/admin/tariffs')
  return { ok: true, inserted: Number(data ?? 0) }
}

// ── Error reports ───────────────────────────────────────────────────────────
export async function resolveErrorReportAction(input: { id: string; status: 'open' | 'resolved' | 'rejected'; resolutionNote: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  if (!['open', 'resolved', 'rejected'].includes(input.status)) return { error: 'Choose a status' }
  const note = String(input.resolutionNote ?? '').trim()
  if (input.status === 'rejected' && !note) return { error: 'Say why the report is rejected.' }
  if (note.length > 1000) return { error: 'Keep the note under 1000 characters.' }
  const { data, error } = await gate.supabase.schema('tariffs').from('error_report')
    .update({ status: input.status, resolution_note: note || null }).eq('id', input.id).select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'That report no longer exists.' }
  revalidatePath('/admin/tariffs/reports')
  return { ok: true }
}
```

⚠ `PROVINCES` is exported by 2a's `ingest/registry.ts` (`packages/shared/src/tariffs/ingest/registry.ts:11`). If the base renamed it, import the base's name — do not re-declare the province list.

- [ ] **Step 5: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/tariffs/source-files.test.ts src/actions/tariff-library.actions.test.ts`
Expected: PASS (3 + 8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tariffs/source-files.ts apps/web/src/lib/tariffs/source-files.test.ts \
        apps/web/src/actions/tariff-library.actions.ts apps/web/src/actions/tariff-library.actions.test.ts
git commit -m "feat(tariff-admin): licensee registry, verified source upload, ingest jobs, monitor, error reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Review actions — approve / edit / reject, validate, publish, SSEG rule

**Files:**
- Create: `apps/web/src/lib/tariffs/sseg-form.ts`
- Create: `apps/web/src/actions/tariff-review.actions.ts`
- Test: `apps/web/src/lib/tariffs/sseg-form.test.ts`
- Test: `apps/web/src/actions/tariff-review.actions.test.ts`

**Validate** records the verdict only on the content it checked: it reads `tariffs.year_content_fingerprint(year)` FIRST, loads and checks the year, then calls `tariffs.record_year_validation(year, blocking, fingerprint)`, which refuses (`40001`) if the content moved in between (00214). **Publish** is an ordinary `UPDATE … SET state = 'published'` through the admin's session: 00210's guard enforces every rule (charges on every tariff, inferred units reviewed, validated with 0 blocking, signed-in admin) and stamps `published_by`.

- [ ] **Step 1: Write the failing tests**

`sseg-form.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateSsegForm, ssegFormFromRow, EMPTY_SSEG_FORM } from './sseg-form'

describe('SSEG rule form', () => {
  it('defaults to the Net-Billing Rules shape', () => {
    expect(EMPTY_SSEG_FORM).toMatchObject({ crediting: 'net_billing_tou', carryForward: 'within_financial_year', capRule: 'kwh_per_tou_period', maxKva: '1000' })
  })
  it('validates and converts to a row', () => {
    const r = validateSsegForm({ ...EMPTY_SSEG_FORM, fyEndMonth: '6', sourceDocumentId: '', pages: 'pp7-12' })
    expect(r).toEqual({ row: {
      crediting: 'net_billing_tou', carry_forward: 'within_financial_year', fy_end_month: 6, cap_rule: 'kwh_per_tou_period',
      forfeit_on_ownership_change: true, max_kva: 1000, requires_tou: true, requires_bidirectional_meter: true,
      source_document_id: null, locator: { pages: 'pp7-12' },
    } })
    expect(validateSsegForm({ ...EMPTY_SSEG_FORM, fyEndMonth: '13', maxKva: '0' })).toEqual({ errors: {
      fyEndMonth: 'Choose the month the financial year ends', maxKva: 'Enter a size above 0 kVA',
    } })
  })
  it('reads a stored row back into the form', () => {
    expect(ssegFormFromRow({ crediting: 'none', carry_forward: 'none', fy_end_month: 3, cap_rule: 'energy_charges',
      forfeit_on_ownership_change: false, max_kva: '500.00', requires_tou: false, requires_bidirectional_meter: true,
      source_document_id: 'd1', locator: { pages: 'p8' } })).toEqual({
      crediting: 'none', carryForward: 'none', fyEndMonth: '3', capRule: 'energy_charges', forfeit: false, maxKva: '500',
      requiresTou: false, requiresBidirectional: true, sourceDocumentId: 'd1', pages: 'p8',
    })
  })
})
```

`tariff-review.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: vi.fn(), revalidate: vi.fn(), loadYear: vi.fn(), loadPrev: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/tariffs/load-year', () => ({ loadYearTariffs: h.loadYear, loadPreviousPublished: h.loadPrev }))

import {
  approveChargeAction, editChargeAction, rejectChargeAction, validateTariffYearAction, publishTariffYearAction, saveSsegRuleAction,
} from './tariff-review.actions'
import { EMPTY_SSEG_FORM } from '@/lib/tariffs/sseg-form'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { makeCharge, makeTariff } from '@esite/shared'

function admin(extra: Parameters<typeof fakeSupabase>[0] = {}) {
  const fake = fakeSupabase({ userId: 'a1', ...extra })
  h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
  return fake
}

beforeEach(() => vi.clearAllMocks())

describe('tariff review actions', () => {
  it('approve sets a review stamp through the admin session (the trigger binds who/when)', async () => {
    const { calls } = admin({ writes: { 'tariffs.charge:update': { data: [{ id: 'c1' }] } } })
    expect(await approveChargeAction({ chargeId: 'c1' })).toEqual({ ok: true })
    expect(Object.keys(callsTo(calls, 'tariffs.charge', 'update')[0].payload as object)).toEqual(['reviewed_at'])
  })

  it('edit validates amount and unit against the component, and confirming the unit clears the inference', async () => {
    const { calls } = admin({
      tables: { 'tariffs.charge': [{ id: 'c1', component: 'energy', season: 'all', unit: 'R_per_kWh', unit_inferred: true, inference_reason: 'magnitude' }] },
      writes: { 'tariffs.charge:update': { data: [{ id: 'c1' }] } },
    })
    expect(await editChargeAction({ chargeId: 'c1', amount: '5', unit: 'R_per_month', unitConfirmed: true }))
      .toEqual({ fieldErrors: { unit: 'Not a valid unit for Energy: R/month' } })
    expect(await editChargeAction({ chargeId: 'c1', amount: '247,76', unit: 'c_per_kWh', unitConfirmed: true })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.charge', 'update')[0].payload).toEqual({
      amount_excl_vat: 247.76, unit: 'c_per_kWh', unit_inferred: false, inference_reason: null, extraction_method: 'manual',
    })
  })

  it('reject deletes the charge row', async () => {
    const { calls } = admin({ writes: { 'tariffs.charge:delete': { data: [{ id: 'c1' }] } } })
    expect(await rejectChargeAction({ chargeId: 'c1' })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.charge', 'delete')).toHaveLength(1)
  })

  it('validate: fingerprint first, then checks, then records the verdict with that fingerprint', async () => {
    admin()
    const order: string[] = []
    const rpc = vi.fn(async (name: string) => {
      order.push(name)
      return name === 'year_content_fingerprint' ? { data: 'fp-1', error: null } : { data: null, error: null }
    })
    const svc = fakeSupabase({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', financial_year: '2026/27', approved_increase_pct: 10, state: 'in_review' }] } }).client
    h.svc.mockReturnValue({ ...svc, schema: (s: string) => ({ ...svc.schema(s), rpc }) })
    h.loadYear.mockImplementation(async () => { order.push('load'); return [{ id: 't1', row: {}, chargeRows: [], tariff: makeTariff({ name: 'Empty', structure: 'flat', charges: [] }) }] })
    h.loadPrev.mockResolvedValue(null)
    expect(await validateTariffYearAction({ yearId: 'y1' })).toEqual({ ok: true, blocking: 1, review: 0, warn: 0 })
    expect(order).toEqual(['year_content_fingerprint', 'load', 'record_year_validation'])
    expect(rpc).toHaveBeenLastCalledWith('record_year_validation', { p_year_id: 'y1', p_blocking: 1, p_fingerprint: 'fp-1' })
  })

  it('validate: a content change mid-check is reported as a sentence', async () => {
    admin()
    const rpc = vi.fn(async (name: string) => name === 'year_content_fingerprint'
      ? { data: 'fp-1', error: null }
      : { data: null, error: { code: '40001', message: 'tariffs.record_year_validation: the year changed while it was being checked' } })
    const svc = fakeSupabase({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', financial_year: '2026/27', approved_increase_pct: null, state: 'in_review' }] } }).client
    h.svc.mockReturnValue({ ...svc, schema: (s: string) => ({ ...svc.schema(s), rpc }) })
    h.loadYear.mockResolvedValue([{ id: 't1', row: {}, chargeRows: [], tariff: makeTariff({ name: 'Ok', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 })] }) }])
    h.loadPrev.mockResolvedValue(null)
    expect(await validateTariffYearAction({ yearId: 'y1' })).toEqual({ error: 'The year changed while it was being checked. Run the checks again.' })
  })

  it('publish: the database decides; its refusal becomes a sentence', async () => {
    admin({ writes: { 'tariffs.tariff_year:update': { error: { code: '23514', message: 'tariffs.tariff_year y1: 2 inferred unit(s) not reviewed' } } } })
    expect(await publishTariffYearAction({ yearId: 'y1' })).toEqual({ error: 'Some charges with an inferred unit are not reviewed yet. Approve them first.' })
    const { calls } = admin({ writes: { 'tariffs.tariff_year:update': { data: [{ id: 'y1' }] } } })
    expect(await publishTariffYearAction({ yearId: 'y1' })).toEqual({ ok: true })
    expect(callsTo(calls, 'tariffs.tariff_year', 'update')[0]).toMatchObject({ payload: { state: 'published' }, filters: [['eq', 'id', 'y1'], ['eq', 'state', 'in_review']] })
  })

  it('SSEG rule: inserts when none exists, updates otherwise', async () => {
    const f = admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }] } })
    expect(await saveSsegRuleAction({ yearId: 'y1', form: EMPTY_SSEG_FORM })).toEqual({ ok: true })
    expect(callsTo(f.calls, 'tariffs.sseg_rule', 'insert')[0].payload).toMatchObject({ tariff_year_id: 'y1', licensee_id: 'l1', crediting: 'net_billing_tou' })
    const g = admin({ tables: { 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'l1', state: 'in_review' }], 'tariffs.sseg_rule': [{ id: 's1', tariff_year_id: 'y1' }] } })
    expect(await saveSsegRuleAction({ yearId: 'y1', form: EMPTY_SSEG_FORM })).toEqual({ ok: true })
    expect(callsTo(g.calls, 'tariffs.sseg_rule', 'update')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/tariffs/sseg-form.test.ts src/actions/tariff-review.actions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `sseg-form.ts`**

```ts
/** SSEG rule editor (spec §12 "SSEG rules"): tariffs.sseg_rule, one per tariff year. */
import { CAP_RULES, CARRY_FORWARD, CREDITING } from '@esite/shared'

export interface SsegForm {
  crediting: string
  carryForward: string
  fyEndMonth: string
  capRule: string
  forfeit: boolean
  maxKva: string
  requiresTou: boolean
  requiresBidirectional: boolean
  sourceDocumentId: string
  pages: string
}

export const EMPTY_SSEG_FORM: SsegForm = {
  crediting: 'net_billing_tou', carryForward: 'within_financial_year', fyEndMonth: '6', capRule: 'kwh_per_tou_period',
  forfeit: true, maxKva: '1000', requiresTou: true, requiresBidirectional: true, sourceDocumentId: '', pages: '',
}

export type SsegField = keyof SsegForm

export function validateSsegForm(f: SsegForm): { row: Record<string, unknown> } | { errors: Partial<Record<SsegField, string>> } {
  const errors: Partial<Record<SsegField, string>> = {}
  if (!(CREDITING as readonly string[]).includes(f.crediting)) errors.crediting = 'Choose the crediting method'
  if (!(CARRY_FORWARD as readonly string[]).includes(f.carryForward)) errors.carryForward = 'Choose the carry-forward rule'
  const month = Number(f.fyEndMonth)
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.fyEndMonth = 'Choose the month the financial year ends'
  if (!(CAP_RULES as readonly string[]).includes(f.capRule)) errors.capRule = 'Choose the cap rule'
  const kva = Number(String(f.maxKva).replace(',', '.'))
  if (!Number.isFinite(kva) || kva <= 0) errors.maxKva = 'Enter a size above 0 kVA'
  if (f.pages.length > 50) errors.pages = 'Keep the page reference short (e.g. pp7-12)'
  if (Object.keys(errors).length > 0) return { errors }
  return {
    row: {
      crediting: f.crediting, carry_forward: f.carryForward, fy_end_month: month, cap_rule: f.capRule,
      forfeit_on_ownership_change: f.forfeit, max_kva: kva, requires_tou: f.requiresTou,
      requires_bidirectional_meter: f.requiresBidirectional, source_document_id: f.sourceDocumentId || null,
      locator: f.pages.trim() ? { pages: f.pages.trim() } : {},
    },
  }
}

export function ssegFormFromRow(r: Record<string, unknown> | null): SsegForm {
  if (!r) return { ...EMPTY_SSEG_FORM }
  const loc = (r.locator ?? {}) as { pages?: string }
  return {
    crediting: String(r.crediting), carryForward: String(r.carry_forward), fyEndMonth: String(r.fy_end_month),
    capRule: String(r.cap_rule), forfeit: Boolean(r.forfeit_on_ownership_change), maxKva: String(Number(r.max_kva)),
    requiresTou: Boolean(r.requires_tou), requiresBidirectional: Boolean(r.requires_bidirectional_meter),
    sourceDocumentId: (r.source_document_id as string | null) ?? '', pages: loc.pages ?? '',
  }
}
```

- [ ] **Step 4: Implement `tariff-review.actions.ts`**

```ts
'use server'
/**
 * Review queue actions (spec §12). Approve / Edit / Reject a charge, delete a
 * tariff, Validate (records the verdict on the content it checked), Publish,
 * and the SSEG rule. Every action re-checks is_platform_tariff_admin; writes go
 * through the admin's session so 00210's guards decide (draft-only edits,
 * review stamps, publish rules, immutability).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { previousFinancialYear, validateRateEdit, type ChargeComponent, type TariffSeason, type TariffUnit } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError, TARIFF_GENERIC_ERROR } from '@/lib/tariffs/errors'
import { loadPreviousPublished, loadYearTariffs } from '@/lib/tariffs/load-year'
import { computeYearChecks } from '@/lib/tariffs/year-checks'
import { validateSsegForm, type SsegField, type SsegForm } from '@/lib/tariffs/sseg-form'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Ok = { ok: true } | { error: string }

const GONE = 'That charge no longer exists. Reload the page.'

function done(yearPath?: string): void {
  revalidatePath('/admin/tariffs', 'layout')
  if (yearPath) revalidatePath(yearPath)
}

export async function approveChargeAction(input: { chargeId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  // Any non-null stamp: tariffs.charge_review_bind rewrites it to (caller, now).
  const { data, error } = await gate.supabase.schema('tariffs').from('charge')
    .update({ reviewed_at: new Date().toISOString() }).eq('id', input.chargeId).select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: GONE }
  done()
  return { ok: true }
}

export async function editChargeAction(input: { chargeId: string; amount: string; unit: TariffUnit | ''; unitConfirmed: boolean }): Promise<
  { ok: true } | { error: string } | { fieldErrors: Partial<Record<'amount' | 'unit', string>> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const t = gate.supabase.schema('tariffs')
  const { data: row } = await t.from('charge').select('id, component, season, unit, unit_inferred, inference_reason').eq('id', input.chargeId).maybeSingle()
  const c = row as { component: ChargeComponent; season: TariffSeason; unit_inferred: boolean; inference_reason: string | null } | null
  if (!c) return { error: GONE }
  const rate = validateRateEdit({ component: c.component, season: c.season }, { amount: input.amount, unit: input.unit })
  if ('errors' in rate) return { fieldErrors: rate.errors }
  const confirmed = Boolean(input.unitConfirmed)
  const { data, error } = await t.from('charge').update({
    amount_excl_vat: rate.amountExclVat, unit: rate.unit,
    unit_inferred: confirmed ? false : c.unit_inferred, inference_reason: confirmed ? null : c.inference_reason,
    extraction_method: 'manual',
  }).eq('id', input.chargeId).select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: GONE }
  done()
  return { ok: true }
}

export async function rejectChargeAction(input: { chargeId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { error } = await gate.supabase.schema('tariffs').from('charge').delete().eq('id', input.chargeId)
  if (error) return { error: humanTariffError(error) }
  done()
  return { ok: true }
}

export async function deleteTariffAction(input: { tariffId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { error } = await gate.supabase.schema('tariffs').from('tariff').delete().eq('id', input.tariffId)
  if (error) return { error: humanTariffError(error) }
  done()
  return { ok: true }
}

export async function validateTariffYearAction(input: { yearId: string }): Promise<
  { ok: true; blocking: number; review: number; warn: number } | { error: string }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const svc = createServiceClient() as unknown as AnyClient
  const { data: y } = await svc.schema('tariffs').from('tariff_year')
    .select('id, licensee_id, financial_year, approved_increase_pct, state').eq('id', input.yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; financial_year: string; approved_increase_pct: number | string | null; state: string } | null
  if (!year) return { error: 'That tariff year does not exist.' }
  if (year.state !== 'ingesting' && year.state !== 'in_review') return { error: 'Only a draft year can be checked.' }
  // Fingerprint FIRST: the verdict is recorded only on the content read after it.
  const fp = await svc.schema('tariffs').rpc('year_content_fingerprint', { p_year_id: year.id })
  if (fp.error || typeof fp.data !== 'string') return { error: TARIFF_GENERIC_ERROR }
  let checks
  try {
    const loaded = await loadYearTariffs(svc, year.id)
    const prev = await loadPreviousPublished(svc, year.licensee_id, previousFinancialYear(year.financial_year))
    const approved = year.approved_increase_pct === null ? null : Number(year.approved_increase_pct)
    checks = computeYearChecks(loaded.map((l) => l.tariff), prev?.tariffs ?? null, approved)
  } catch (e) {
    console.error('[tariff-validate] load failed', { yearId: year.id, err: String(e) })
    return { error: TARIFF_GENERIC_ERROR }
  }
  const rec = await svc.schema('tariffs').rpc('record_year_validation', {
    p_year_id: year.id, p_blocking: checks.blocking, p_fingerprint: fp.data,
  })
  if (rec.error) return { error: humanTariffError(rec.error) }
  done(`/admin/tariffs/years/${year.id}`)
  return { ok: true, blocking: checks.blocking, review: checks.review, warn: checks.warn }
}

export async function publishTariffYearAction(input: { yearId: string }): Promise<Ok> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const { data, error } = await gate.supabase.schema('tariffs').from('tariff_year')
    .update({ state: 'published' }).eq('id', input.yearId).eq('state', 'in_review').select('id')
  if (error) return { error: humanTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'This year is not waiting for review.' }
  done(`/admin/tariffs/years/${input.yearId}`)
  return { ok: true }
}

export async function saveSsegRuleAction(input: { yearId: string; form: SsegForm }): Promise<
  Ok | { fieldErrors: Partial<Record<SsegField, string>> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const v = validateSsegForm(input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const t = gate.supabase.schema('tariffs')
  const { data: y } = await t.from('tariff_year').select('id, licensee_id, state').eq('id', input.yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; state: string } | null
  if (!year) return { error: 'That tariff year does not exist.' }
  const { data: existing } = await t.from('sseg_rule').select('id').eq('tariff_year_id', year.id).limit(1)
  const id = (existing as Array<{ id: string }> | null)?.[0]?.id
  const res = id
    ? await t.from('sseg_rule').update(v.row).eq('id', id).select('id')
    : await t.from('sseg_rule').insert({ ...v.row, tariff_year_id: year.id, licensee_id: year.licensee_id }).select('id')
  if (res.error) return { error: humanTariffError(res.error) }
  done(`/admin/tariffs/years/${year.id}`)
  return { ok: true }
}
```

⚠ `validateRateEdit` and `previousFinancialYear` come from the `@esite/shared` root barrel (Part 2 Task 12 exports `./solar/tariff`; 2a exports `./tariffs`).

- [ ] **Step 5: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/tariffs/sseg-form.test.ts src/actions/tariff-review.actions.test.ts`
Expected: PASS (3 + 7 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tariffs/sseg-form.ts apps/web/src/lib/tariffs/sseg-form.test.ts \
        apps/web/src/actions/tariff-review.actions.ts apps/web/src/actions/tariff-review.actions.test.ts
git commit -m "feat(tariff-admin): review queue actions, fingerprinted validation, publish, SSEG rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: TOU calendar save (windows + holiday treatment)

**Files:**
- Create: `apps/web/src/lib/tariffs/calendar-form.ts`
- Create: `apps/web/src/actions/tariff-calendar.actions.ts`
- Test: `apps/web/src/lib/tariffs/calendar-form.test.ts`
- Test: `apps/web/src/actions/tariff-calendar.actions.test.ts`

Windows are replaced insert-new-then-delete-old, so a failed insert leaves the old calendar intact (nothing deleted). Public-holiday DATES are read-only here: they come from `projects.public_holidays` (00194, seeded through 2033); the calendar says only how a holiday is treated (Saturday or Sunday).

- [ ] **Step 1: Write the failing tests**

`calendar-form.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validateCalendarForm, type CalendarForm } from './calendar-form'

const base: CalendarForm = {
  licenseeId: '11111111-1111-1111-1111-111111111111', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8],
  source: 'published', holidayTreatedAs: 'sunday',
  windows: [{ season: 'high', dayType: 'weekday', start: '06:00', end: '09:00', period: 'peak' }],
}

describe('calendar form', () => {
  it('converts times to minutes', () => {
    expect(validateCalendarForm(base)).toEqual({ value: {
      licensee_id: base.licenseeId, valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'published',
      holidayTreatedAs: 'sunday',
      windows: [{ season: 'high', day_type: 'weekday', start_minute: 360, end_minute: 540, period: 'peak' }],
    } })
  })
  it('refuses bad dates, empty seasons, reversed and overlapping windows', () => {
    const r = validateCalendarForm({
      ...base, validTo: '2025-01-01', highSeasonMonths: [],
      windows: [
        { season: 'high', dayType: 'weekday', start: '09:00', end: '06:00', period: 'peak' },
        { season: 'low', dayType: 'weekday', start: '07:00', end: '10:00', period: 'peak' },
        { season: 'low', dayType: 'weekday', start: '09:00', end: '12:00', period: 'standard' },
      ],
    })
    expect(r).toEqual({ errors: {
      validTo: 'Must be after the start date', highSeasonMonths: 'Pick the high-demand months',
      'windows.0': 'The end must be after the start',
      windows: 'Low season weekday: 07:00-10:00 overlaps 09:00-12:00',
    } })
  })
})
```

`tariff-calendar.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdmin: h.gate }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { saveTouCalendarAction } from './tariff-calendar.actions'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const form = {
  licenseeId: '11111111-1111-1111-1111-111111111111', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8],
  source: 'published' as const, holidayTreatedAs: 'sunday' as const,
  windows: [{ season: 'high' as const, dayType: 'weekday' as const, start: '06:00', end: '09:00', period: 'peak' as const }],
}

beforeEach(() => vi.clearAllMocks())

describe('saveTouCalendarAction', () => {
  it('new calendar: inserts the calendar, its windows and the holiday rule', async () => {
    const fake = fakeSupabase({ userId: 'a1', writes: { 'tariffs.tou_calendar:insert': { data: [{ id: 'cal1' }] } } })
    h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
    expect(await saveTouCalendarAction({ calendarId: null, form })).toEqual({ ok: true, id: 'cal1' })
    expect(callsTo(fake.calls, 'tariffs.tou_window', 'insert')[0].payload).toEqual([
      { calendar_id: 'cal1', season: 'high', day_type: 'weekday', start_minute: 360, end_minute: 540, period: 'peak' },
    ])
    expect(callsTo(fake.calls, 'tariffs.holiday_rule', 'insert')[0].payload).toEqual({ calendar_id: 'cal1', treated_as: 'sunday' })
  })
  it('existing calendar: new windows are inserted BEFORE the old ones are deleted', async () => {
    const fake = fakeSupabase({
      userId: 'a1',
      tables: { 'tariffs.tou_window': [{ id: 'w-old', calendar_id: 'cal1' }], 'tariffs.holiday_rule': [{ calendar_id: 'cal1', treated_as: 'saturday' }] },
      writes: { 'tariffs.tou_calendar:update': { data: [{ id: 'cal1' }] }, 'tariffs.tou_window:insert': { data: [{ id: 'w-new' }] } },
    })
    h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
    expect(await saveTouCalendarAction({ calendarId: 'cal1', form })).toEqual({ ok: true, id: 'cal1' })
    const ops = fake.calls.filter((c) => c.table === 'tariffs.tou_window' && c.op !== 'select').map((c) => c.op)
    expect(ops).toEqual(['insert', 'delete'])
    expect(callsTo(fake.calls, 'tariffs.tou_window', 'delete')[0].filters).toEqual([['in', 'id', ['w-old']]])
    expect(callsTo(fake.calls, 'tariffs.holiday_rule', 'update')[0].payload).toEqual({ treated_as: 'sunday' })
  })
  it('an invalid form writes nothing', async () => {
    const fake = fakeSupabase({ userId: 'a1' })
    h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
    const r = await saveTouCalendarAction({ calendarId: null, form: { ...form, highSeasonMonths: [] } })
    expect(r).toEqual({ fieldErrors: { highSeasonMonths: 'Pick the high-demand months' } })
    expect(fake.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/tariffs/calendar-form.test.ts src/actions/tariff-calendar.actions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `calendar-form.ts`**

```ts
/** TOU calendar editor form (spec §12 "TOU calendars & holidays"). */
import { parseTimeLabel, validateTouWindows, type TouPeriod } from '@esite/shared'

export interface CalendarWindowForm {
  season: 'high' | 'low'
  dayType: 'weekday' | 'saturday' | 'sunday'
  start: string
  end: string
  period: TouPeriod
}

export interface CalendarForm {
  licenseeId: string
  validFrom: string
  validTo: string
  highSeasonMonths: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | ''
  windows: CalendarWindowForm[]
}

export interface CalendarValue {
  licensee_id: string
  valid_from: string
  valid_to: string | null
  high_season_months: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | null
  windows: Array<{ season: string; day_type: string; start_minute: number; end_minute: number; period: TouPeriod }>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validateCalendarForm(f: CalendarForm): { value: CalendarValue } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  if (!/^[0-9a-f-]{36}$/i.test(f.licenseeId)) errors.licenseeId = 'Choose a licensee'
  if (!DATE.test(f.validFrom)) errors.validFrom = 'Choose the start date'
  if (f.validTo && !DATE.test(f.validTo)) errors.validTo = 'Use a date'
  else if (f.validTo && DATE.test(f.validFrom) && f.validTo <= f.validFrom) errors.validTo = 'Must be after the start date'
  const months = [...new Set(f.highSeasonMonths)].filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b)
  if (months.length === 0) errors.highSeasonMonths = 'Pick the high-demand months'
  if (f.source !== 'published' && f.source !== 'assumed_eskom') errors.source = 'Choose where the hours come from'
  const windows: CalendarValue['windows'] = []
  f.windows.forEach((w, i) => {
    const s = parseTimeLabel(w.start)
    const e = parseTimeLabel(w.end)
    if (s === null || e === null) errors[`windows.${i}`] = 'Use HH:MM (00:00 to 24:00)'
    else if (e <= s) errors[`windows.${i}`] = 'The end must be after the start'
    else windows.push({ season: w.season, day_type: w.dayType, start_minute: s, end_minute: e, period: w.period })
  })
  const overlaps = validateTouWindows(windows.map((w) => ({
    season: w.season as 'high' | 'low', dayType: w.day_type as 'weekday' | 'saturday' | 'sunday',
    startMinute: w.start_minute, endMinute: w.end_minute, period: w.period,
  })))
  if (overlaps.length > 0) errors.windows = overlaps.map((o) => o.message).join('; ')
  if (Object.keys(errors).length > 0) return { errors }
  return {
    value: {
      licensee_id: f.licenseeId, valid_from: f.validFrom, valid_to: f.validTo || null, high_season_months: months,
      source: f.source, holidayTreatedAs: f.holidayTreatedAs || null, windows,
    },
  }
}
```

- [ ] **Step 4: Implement `tariff-calendar.actions.ts`**

```ts
'use server'
/**
 * Save a TOU calendar (spec §12). Admin session writes (00210 admin policies).
 * Windows: insert the new set first, then delete the old ids, so a failed
 * insert never leaves a calendar without windows.
 */
import { revalidatePath } from 'next/cache'
import { requirePlatformTariffAdmin } from '@/lib/tariffs/admin-gate'
import { humanTariffError } from '@/lib/tariffs/errors'
import { validateCalendarForm, type CalendarForm } from '@/lib/tariffs/calendar-form'

export async function saveTouCalendarAction(input: { calendarId: string | null; form: CalendarForm }): Promise<
  { ok: true; id: string } | { error: string } | { fieldErrors: Record<string, string> }
> {
  const gate = await requirePlatformTariffAdmin()
  if (!gate.ok) return { error: gate.error }
  const v = validateCalendarForm(input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const t = gate.supabase.schema('tariffs')
  const cal = {
    licensee_id: v.value.licensee_id, valid_from: v.value.valid_from, valid_to: v.value.valid_to,
    high_season_months: v.value.high_season_months, source: v.value.source,
  }
  let id = input.calendarId
  if (id === null) {
    const { data, error } = await t.from('tou_calendar').insert(cal).select('id')
    if (error) return { error: humanTariffError(error) }
    id = String((data as Array<{ id: string }>)[0]?.id ?? '')
  } else {
    const { data, error } = await t.from('tou_calendar').update(cal).eq('id', id).select('id')
    if (error) return { error: humanTariffError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: 'That calendar no longer exists. Reload the page.' }
  }

  const { data: old } = await t.from('tou_window').select('id').eq('calendar_id', id)
  const oldIds = ((old ?? []) as Array<{ id: string }>).map((w) => w.id)
  if (v.value.windows.length > 0) {
    const { error } = await t.from('tou_window').insert(v.value.windows.map((w) => ({ calendar_id: id, ...w })))
    if (error) return { error: humanTariffError(error) }
  }
  if (oldIds.length > 0) {
    const { error } = await t.from('tou_window').delete().in('id', oldIds)
    if (error) return { error: `The new hours were saved but the old ones could not be removed: ${humanTariffError(error)} Reload and save again.` }
  }

  const { data: rule } = await t.from('holiday_rule').select('calendar_id').eq('calendar_id', id)
  const hasRule = Array.isArray(rule) && rule.length > 0
  if (v.value.holidayTreatedAs === null) {
    if (hasRule) await t.from('holiday_rule').delete().eq('calendar_id', id)
  } else if (hasRule) {
    const { error } = await t.from('holiday_rule').update({ treated_as: v.value.holidayTreatedAs }).eq('calendar_id', id)
    if (error) return { error: humanTariffError(error) }
  } else {
    const { error } = await t.from('holiday_rule').insert({ calendar_id: id, treated_as: v.value.holidayTreatedAs })
    if (error) return { error: humanTariffError(error) }
  }
  revalidatePath('/admin/tariffs/calendars')
  return { ok: true, id }
}
```

- [ ] **Step 5: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/tariffs/calendar-form.test.ts src/actions/tariff-calendar.actions.test.ts`
Expected: PASS (2 + 3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tariffs/calendar-form.ts apps/web/src/lib/tariffs/calendar-form.test.ts \
        apps/web/src/actions/tariff-calendar.actions.ts apps/web/src/actions/tariff-calendar.actions.test.ts
git commit -m "feat(tariff-admin): TOU calendar editor save (windows replaced safely, holiday treatment)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Ingest API route (workbooks inline; PDFs refused toward the job queue)

**Files:**
- Create: `apps/web/src/app/api/admin/tariffs/ingest/route.ts`
- Test: `apps/web/src/app/api/admin/tariffs/ingest/route.test.ts`

A route handler (not a server action) because a province compendium can take tens of seconds and the route sets `maxDuration = 300`. It runs 2a's exact ingestion core (`buildIngestPlan` + `runIngest` + `createSupabaseTariffStore`) — no second implementation. Dry run first, then Apply. An Eskom schedule's apply needs a stored Net-Billing Rules PDF (kind `rules`), exactly like the CLI (owner default 9). AI-assisted extraction is out of scope (index D2b-7).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: vi.fn(), build: vi.fn(), run: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminAPI: h.gate }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: h.svc }))
vi.mock('@esite/shared/tariffs/ingest', () => ({
  buildIngestPlan: h.build, runIngest: h.run, createSupabaseTariffStore: h.store,
  summariseIngestReport: (r: { status: string }) => ({ status: r.status, runId: null, years: [] }),
}))

import { POST } from './route'
import { fakeSupabase } from '@/test/fake-supabase'
import { NextResponse } from 'next/server'

const DOC = { id: 'd1', storage_path: '2026-27/abc.xlsx', sha256: 'a'.repeat(64), url: null, retrieved_at: null }
const req = (body: unknown) => new Request('http://x/api/admin/tariffs/ingest', { method: 'POST', body: JSON.stringify(body) })
const body = { sourceDocumentId: 'd1', parser: 'province_xlsx', financialYear: '2026/27', licenseeName: '', createLicensees: false, apply: false }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})

function admin(tables: Record<string, Array<Record<string, unknown>>> = { 'tariffs.source_document': [DOC] }) {
  const fake = fakeSupabase({ userId: 'a1', tables })
  h.gate.mockResolvedValue({ ok: true, supabase: fake.client, userId: 'a1' })
  h.svc.mockReturnValue({ storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2])]), error: null }) }) } })
  return fake
}

describe('POST /api/admin/tariffs/ingest', () => {
  it('returns the gate response for a non-admin (404) and does nothing', async () => {
    h.gate.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) })
    const res = await POST(req(body))
    expect(res.status).toBe(404)
    expect(h.build).not.toHaveBeenCalled()
  })
  it('refuses a PDF: those run as a job', async () => {
    admin()
    const res = await POST(req({ ...body, parser: 'rfd_pdf' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'PDF ingests run as a job: use Queue ingest.' })
  })
  it('dry run: the 2a core with apply false, started by the admin', async () => {
    admin()
    h.build.mockResolvedValue({ parser: 'province_xlsx', source: {}, years: [] })
    h.run.mockResolvedValue({ status: 'dry_run', years: [] })
    const res = await POST(req(body))
    expect(res.status).toBe(200)
    expect(h.build).toHaveBeenCalledWith(expect.objectContaining({ parser: 'province_xlsx', financialYear: '2026/27', sha256: DOC.sha256, fileName: 'abc.xlsx' }))
    expect(h.run).toHaveBeenCalledWith(expect.anything(), undefined, { apply: false, createMissingLicensees: false, startedBy: 'a1' })
    expect(await res.json()).toEqual({ report: { status: 'dry_run', runId: null, years: [] } })
  })
  it('Eskom apply without the Net-Billing Rules PDF is refused', async () => {
    admin()
    const res = await POST(req({ ...body, parser: 'eskom_xlsm', apply: true }))
    expect(res.status).toBe(409)
  })
  it('a malformed body is a 400', async () => {
    admin()
    expect((await POST(req({ ...body, financialYear: '2026-27' }))).status).toBe(400)
  })
})
```

(`createSupabaseTariffStore` is mocked to return `undefined`, which is why `runIngest`'s second argument is `undefined` in the assertion.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter web exec vitest run src/app/api/admin/tariffs/ingest/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * POST /api/admin/tariffs/ingest — run 2a's ingestion core on a stored
 * workbook (province compendium XLSX, Eskom schedule XLSM). Platform tariff
 * admins only (404 otherwise; this route is outside (admin)/layout.tsx).
 * Dry run (apply=false) writes nothing; apply lands years in_review, never
 * published (D-03). PDFs need poppler and run as tariffs.ingest_job instead.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildIngestPlan, createSupabaseTariffStore, runIngest, summariseIngestReport, type ParserName } from '@esite/shared/tariffs/ingest'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdminAPI } from '@/lib/tariffs/admin-gate'

export const runtime = 'nodejs'
export const maxDuration = 300

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

interface Body {
  sourceDocumentId: string
  parser: ParserName
  financialYear: string
  licenseeName: string
  createLicensees: boolean
  apply: boolean
}

function parseBody(b: unknown): Body | null {
  if (!b || typeof b !== 'object') return null
  const o = b as Record<string, unknown>
  if (typeof o.sourceDocumentId !== 'string' || !o.sourceDocumentId) return null
  if (typeof o.parser !== 'string' || !['province_xlsx', 'eskom_xlsm', 'rfd_pdf'].includes(o.parser)) return null
  if (typeof o.financialYear !== 'string' || !/^\d{4}\/\d{2}$/.test(o.financialYear)) return null
  return {
    sourceDocumentId: o.sourceDocumentId, parser: o.parser as ParserName, financialYear: o.financialYear,
    licenseeName: typeof o.licenseeName === 'string' ? o.licenseeName.trim() : '',
    createLicensees: o.createLicensees === true, apply: o.apply === true,
  }
}

export async function POST(req: Request) {
  const gate = await requirePlatformTariffAdminAPI()
  if (!gate.ok) return gate.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Send a JSON body.' }, { status: 400 })
  }
  const b = parseBody(raw)
  if (!b) return NextResponse.json({ error: 'Choose a source, a parser and a financial year like 2026/27.' }, { status: 400 })
  if (b.parser === 'rfd_pdf') return NextResponse.json({ error: 'PDF ingests run as a job: use Queue ingest.' }, { status: 400 })

  const t = gate.supabase.schema('tariffs')
  const { data: d } = await t.from('source_document').select('id, storage_path, sha256, url, retrieved_at').eq('id', b.sourceDocumentId).maybeSingle()
  const doc = d as { storage_path: string | null; sha256: string | null; url: string | null; retrieved_at: string | null } | null
  if (!doc?.storage_path || !doc.sha256) return NextResponse.json({ error: 'That source has no stored file.' }, { status: 404 })

  let rulesSha: string | null = null
  if (b.parser === 'eskom_xlsm') {
    const { data: rules } = await t.from('source_document').select('sha256').eq('kind', 'rules').order('created_at', { ascending: false }).limit(1)
    rulesSha = ((rules ?? []) as Array<{ sha256: string | null }>)[0]?.sha256 ?? null
    if (b.apply && !rulesSha) {
      return NextResponse.json({ error: 'Upload the NERSA Net-Billing Rules PDF (kind: Rules) first: the Eskom export rule must cite it.' }, { status: 409 })
    }
  }

  const svc = createServiceClient() as unknown as AnyClient
  const dl = await svc.storage.from('tariff-sources').download(doc.storage_path)
  if (dl.error || !dl.data) return NextResponse.json({ error: 'Could not read the stored file. Try again.' }, { status: 502 })
  const bytes = new Uint8Array(await (dl.data as Blob).arrayBuffer())

  try {
    const plan = await buildIngestPlan({
      parser: b.parser, fileName: doc.storage_path.split('/').pop() ?? doc.storage_path, bytes, sha256: doc.sha256,
      financialYear: b.financialYear, licenseeName: b.licenseeName || undefined, url: doc.url, retrievedAt: doc.retrieved_at,
      netBillingRulesSha256: rulesSha,
    })
    const store = createSupabaseTariffStore(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const report = await runIngest(plan, store, { apply: b.apply, createMissingLicensees: b.createLicensees, startedBy: gate.userId })
    return NextResponse.json({ report: summariseIngestReport(report) })
  } catch (e) {
    console.error('[tariff-ingest] failed', { sourceDocumentId: b.sourceDocumentId, parser: b.parser, err: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'The file could not be ingested. Check the parser and the financial year, then try again.' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter web exec vitest run src/app/api/admin/tariffs/ingest/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Confirm exceljs stays out of client bundles**

```bash
grep -rn "@esite/shared/tariffs/\(ingest\|parsers\)'" apps/web/src --include=*.tsx | grep -v "import type" | grep -v "\.test\." || echo "no-client-import-ok"
```
Expected: `no-client-import-ok` (only `route.ts`, server actions and `lib/tariffs/*.ts` import the ingest/parsers sub-paths at runtime; a `.tsx` may import TYPES from them, which are erased). Re-run this in Part 5.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/admin/tariffs/ingest
git commit -m "feat(tariff-admin): ingest route running the 2a core on stored workbooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: The PDF ingest worker (staff machine)

**Files:**
- Create: `packages/shared/src/tariffs/ingest/supabase-jobs.ts`
- Modify: `packages/shared/src/tariffs/ingest/index.ts` (one export line)
- Create: `scripts/tariffs/ingest-worker.ts`
- Test: `packages/shared/src/tariffs/ingest/supabase-jobs.test.ts`

The Supabase calls live in the shared package (next to 2a's `supabase-store.ts`, which already depends on `@supabase/supabase-js`), so the script under `scripts/` only needs `node:*` for `pdftotext`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { jobFromRow, jobFinishPatch } from './supabase-jobs'

describe('ingest job rows', () => {
  it('maps a claimed row', () => {
    expect(jobFromRow({ id: 'j', source_document_id: 'd', parser: 'rfd_pdf', financial_year: '2026/27', licensee_name: 'City Power', create_licensees: false, requested_by: 'u' }))
      .toEqual({ id: 'j', sourceDocumentId: 'd', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'City Power', createLicensees: false, requestedBy: 'u' })
  })
  it('the finish patch stores the summary, never the raw bytes', () => {
    const p = jobFinishPatch({ status: 'failed', report: null, runId: null, error: 'x' }, '2026-09-28T00:00:00Z')
    expect(p).toEqual({ status: 'failed', finished_at: '2026-09-28T00:00:00Z', ingest_run_id: null, report: null, error: 'x' })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/supabase-jobs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `supabase-jobs.ts`**

```ts
/**
 * Service-role access to tariffs.ingest_job for the staff worker. NEVER import
 * into a client bundle (built from a service key).
 */
import { createClient } from '@supabase/supabase-js'
import { summariseIngestReport, type IngestJob, type IngestJobOutcome, type IngestJobSource } from './job-runner'
import type { ParserName } from './ingest-core'

type Row = Record<string, unknown>

export function jobFromRow(r: Row): IngestJob {
  return {
    id: String(r.id), sourceDocumentId: String(r.source_document_id), parser: r.parser as ParserName,
    financialYear: String(r.financial_year), licenseeName: (r.licensee_name ?? null) as string | null,
    createLicensees: Boolean(r.create_licensees), requestedBy: (r.requested_by ?? null) as string | null,
  }
}

export function jobFinishPatch(o: IngestJobOutcome, nowIso: string): Row {
  return {
    status: o.status, finished_at: nowIso, ingest_run_id: o.runId,
    report: o.report ? summariseIngestReport(o.report) : null, error: o.error,
  }
}

export function createSupabaseJobQueue(url: string, serviceKey: string) {
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const t = () => db.schema('tariffs')
  return {
    async claim(): Promise<IngestJob | null> {
      const { data, error } = await t().rpc('claim_ingest_job')
      if (error) throw new Error(`claim_ingest_job: ${error.message}`)
      const row = (Array.isArray(data) ? data[0] : data) as Row | undefined
      return row ? jobFromRow(row) : null
    },
    async finish(id: string, outcome: IngestJobOutcome): Promise<void> {
      const { error } = await t().from('ingest_job').update(jobFinishPatch(outcome, new Date().toISOString())).eq('id', id)
      if (error) throw new Error(`finish ${id}: ${error.message}`)
    },
    async loadSource(id: string): Promise<IngestJobSource | null> {
      const { data } = await t().from('source_document').select('storage_path, sha256, url, retrieved_at').eq('id', id).maybeSingle()
      const d = data as Row | null
      if (!d?.storage_path || !d.sha256) return null
      const path = String(d.storage_path)
      return { storagePath: path, fileName: path.split('/').pop() ?? path, sha256: String(d.sha256), url: (d.url ?? null) as string | null, retrievedAt: (d.retrieved_at ?? null) as string | null }
    },
    async download(path: string): Promise<Uint8Array> {
      const { data, error } = await db.storage.from('tariff-sources').download(path)
      if (error || !data) throw new Error(error?.message ?? 'empty download')
      return new Uint8Array(await data.arrayBuffer())
    },
    async rulesSha256(): Promise<string | null> {
      const { data } = await t().from('source_document').select('sha256').eq('kind', 'rules').order('created_at', { ascending: false }).limit(1)
      return ((data ?? []) as Row[])[0]?.sha256 as string | null ?? null
    },
  }
}
```

Append to `packages/shared/src/tariffs/ingest/index.ts`:
```ts
export * from './supabase-jobs'
```

- [ ] **Step 4: Write the worker script**

`scripts/tariffs/ingest-worker.ts`:
```ts
/**
 * Runs queued tariffs.ingest_job rows (D-03: staff run ingestion; nothing is
 * published). PDF ingests need poppler's `pdftotext -layout`, which the web
 * server does not have, so the admin UI queues them and this worker, on the
 * staff Mac, executes them with the same core as scripts/tariffs/ingest.ts.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest-worker.ts [--once] [--interval 60]
 *
 * --once: drain the queue and exit. Otherwise polls every --interval seconds.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupabaseJobQueue } from '../../packages/shared/src/tariffs/ingest/supabase-jobs.ts'
import { createSupabaseTariffStore } from '../../packages/shared/src/tariffs/ingest/supabase-store.ts'
import { runIngestJob } from '../../packages/shared/src/tariffs/ingest/job-runner.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function pdfToText(bytes: Uint8Array): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tariff-pdf-'))
  try {
    const file = join(dir, 'source.pdf')
    writeFileSync(file, bytes)
    return Promise.resolve(execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('usage: ingest-worker.ts [--once] [--interval 60]  (needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, pdftotext)')
    return
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
  } catch {
    console.error('pdftotext is missing: brew install poppler')
    process.exit(2)
  }
  const queue = createSupabaseJobQueue(url, key)
  const store = createSupabaseTariffStore(url, key)
  const once = process.argv.includes('--once')
  const interval = Math.max(10, Number(arg('interval') ?? 60)) * 1000
  for (;;) {
    const job = await queue.claim()
    if (!job) {
      if (once) return
      await new Promise((r) => setTimeout(r, interval))
      continue
    }
    console.log(`job ${job.id}: ${job.parser} ${job.financialYear} ${job.licenseeName ?? ''}`)
    const outcome = await runIngestJob(job, {
      loadSource: (id) => queue.loadSource(id), download: (p) => queue.download(p), pdfToText, store,
      netBillingRulesSha256: job.parser === 'eskom_xlsm' ? await queue.rulesSha256() : null,
    })
    await queue.finish(job.id, outcome)
    console.log(`job ${job.id}: ${outcome.status}${outcome.error ? ` (${outcome.error})` : ''}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
```

- [ ] **Step 5: Run the test and the script's help**

```bash
pnpm --filter @esite/shared exec vitest run src/tariffs/ingest/supabase-jobs.test.ts
pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest-worker.ts --help
pnpm --filter @esite/shared type-check
```
Expected: PASS (2 tests); the usage line; `tsc` exit 0. (A live run against the database is an owner step after 00214 applies — index "After merge".)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/tariffs/ingest/supabase-jobs.ts packages/shared/src/tariffs/ingest/supabase-jobs.test.ts \
        packages/shared/src/tariffs/ingest/index.ts scripts/tariffs/ingest-worker.ts
git commit -m "feat(tariffs): staff ingest worker for queued PDF ingests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Source viewer (PDF page crop / workbook cell snippet)

**Files:**
- Create: `apps/web/src/components/tariffs/PdfPageCrop.tsx`
- Create: `apps/web/src/components/tariffs/SourceViewer.tsx`
- Test: `apps/web/src/components/tariffs/SourceViewer.test.tsx`

Shared by the admin review queue and the project Tariff tab. It receives a `loadUrl` **function** — legal because both callers are client components (the rule from 2026-09-22: a `page.tsx` hands a client component JSON only; the page passes ids, the client component builds the closure over a server action).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./PdfPageCrop', () => ({ PdfPageCrop: (p: { page: number; highlight: string | null }) => <div>PDF page {p.page} — {p.highlight}</div> }))

import { SourceViewer } from './SourceViewer'

describe('SourceViewer', () => {
  it('a PDF locator renders the cited page with the value highlighted', async () => {
    render(<SourceViewer title="Energy" locator={{ page: 12, raw_text: '247.76' }} loadUrl={async () => ({ url: 'https://s', kind: 'pdf' })} onClose={() => {}} />)
    expect(await screen.findByText('PDF page 12 — 247.76')).toBeDefined()
  })
  it('a workbook locator shows the cell snippet and a download link', async () => {
    render(<SourceViewer title="Basic" locator={{ sheet: 'CITY POWER', cell: 'D14', label: 'Basic charge', raw_text: '157.91', raw_unit: 'R/month' }}
      loadUrl={async () => ({ url: 'https://s/x.xlsx', kind: 'xlsx' })} onClose={() => {}} />)
    expect(await screen.findByText('CITY POWER')).toBeDefined()
    expect(screen.getByText('D14')).toBeDefined()
    expect(screen.getByText('157.91')).toBeDefined()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Download the workbook' }).getAttribute('href')).toBe('https://s/x.xlsx'))
  })
  it('a failure is a sentence; Close calls back', async () => {
    const onClose = vi.fn()
    render(<SourceViewer title="X" locator={{}} loadUrl={async () => ({ error: 'That source document no longer exists.' })} onClose={onClose} />)
    expect(await screen.findByText('That source document no longer exists.')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter web exec vitest run src/components/tariffs/SourceViewer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PdfPageCrop.tsx`**

```tsx
'use client'
/**
 * One page of a stored tariff PDF, rendered in the browser with pdfjs from a
 * short-lived signed URL, with the cited text outlined (findTextBox) and
 * scrolled into view. Minimal local pdfjs types, as lib/sheet/use-sheet-image.
 */
import { useEffect, useRef, useState } from 'react'
import { findTextBox, type PdfTextItem } from '@esite/shared'

type Viewport = { width: number; height: number; convertToViewportRectangle: (r: number[]) => number[] }
type PdfPage = {
  getViewport: (o: { scale: number }) => Viewport
  render: (o: unknown) => { promise: Promise<void> }
  getTextContent: () => Promise<{ items: unknown[] }>
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> }

export function PdfPageCrop({ url, page, highlight }: { url: string; page: number; highlight: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMessage(null)
    ;(async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const pdf = (await pdfjsLib.getDocument(url).promise) as unknown as PdfDoc
        if (cancelled) return
        if (page > pdf.numPages) {
          setMessage(`The document has ${pdf.numPages} pages; the cited page ${page} does not exist.`)
          return
        }
        const p = await pdf.getPage(page)
        const viewport = p.getViewport({ scale: 1.5 })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        await p.render({ canvasContext: ctx, viewport, canvas }).promise
        if (highlight) {
          const text = await p.getTextContent()
          const box = findTextBox(text.items as PdfTextItem[], highlight)
          if (box) {
            const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([box.x, box.y, box.x + box.width, box.y + box.height])
            const top = Math.min(y1, y2)
            ctx.save()
            ctx.strokeStyle = '#f59e0b'
            ctx.lineWidth = 3
            ctx.strokeRect(Math.min(x1, x2) - 4, top - 4, Math.abs(x2 - x1) + 8, Math.abs(y2 - y1) + 8)
            ctx.restore()
            boxRef.current?.scrollTo({ top: Math.max(0, top - 120) })
          } else {
            setMessage('The cited text was not found on this page: check the page by eye.')
          }
        }
      } catch {
        if (!cancelled) setMessage('The source document could not be displayed.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [url, page, highlight])

  return (
    <div>
      {loading && <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Rendering page {page}…</p>}
      {message && <p role="status" style={{ fontSize: 13, color: 'var(--c-amber)' }}>{message}</p>}
      <div ref={boxRef} style={{ maxHeight: '65vh', overflow: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
        <canvas ref={canvasRef} aria-label={`Page ${page} of the source document`} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Implement `SourceViewer.tsx`**

```tsx
'use client'
/** "View source" (spec §5, §12): the cited PDF page, or the workbook cell snippet. */
import { useEffect, useState, type CSSProperties } from 'react'
import { describeLocator, type SourceLocator } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { PdfPageCrop } from './PdfPageCrop'

export type SourceUrlResult = { url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)' }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', fontFamily: 'var(--font-mono)' }

export function SourceViewer({
  title, locator, loadUrl, onClose,
}: {
  title: string
  locator: SourceLocator
  loadUrl: () => Promise<SourceUrlResult>
  onClose: () => void
}) {
  const view = describeLocator(locator)
  const [res, setRes] = useState<SourceUrlResult | null>(null)
  useEffect(() => {
    let live = true
    loadUrl().then((r) => { if (live) setRes(r) }, () => { if (live) setRes({ error: 'Could not open the source document. Try again.' }) })
    return () => { live = false }
    // loadUrl is a fresh closure per render; the viewer loads once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div role="dialog" aria-label={`Source of ${title}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--c-panel)', borderRadius: 8, padding: 16, width: 'min(920px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>Source: {title}</strong>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
        {res === null && <p style={{ fontSize: 13 }}>Opening the source…</p>}
        {res && 'error' in res && <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)' }}>{res.error}</p>}
        {res && !('error' in res) && view.kind === 'pdf_page' && res.kind === 'pdf' && (
          <PdfPageCrop url={res.url} page={view.page} highlight={view.rawText} />
        )}
        {res && !('error' in res) && view.kind === 'cell' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={TH}>Sheet</th><th style={TH}>Cell</th><th style={TH}>Label</th><th style={TH}>Value as printed</th><th style={TH}>Unit as printed</th></tr></thead>
              <tbody><tr>
                <td style={TD}>{view.sheet ?? '—'}</td><td style={TD}>{view.cell ?? '—'}</td><td style={TD}>{view.label ?? '—'}</td>
                <td style={TD}>{view.rawText ?? '—'}</td><td style={TD}>{view.rawUnit ?? 'none printed'}</td>
              </tr></tbody>
            </table>
            <a href={res.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Download the workbook</a>
          </div>
        )}
        {res && !('error' in res) && (view.kind === 'none' || (view.kind === 'pdf_page' && res.kind !== 'pdf')) && (
          <p style={{ fontSize: 13 }}>
            No page or cell was recorded for this value.{' '}
            <a href={res.url} target="_blank" rel="noreferrer">Open the source document</a>
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm --filter web exec vitest run src/components/tariffs/SourceViewer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/tariffs
git commit -m "feat(tariffs): source viewer (PDF page crop with highlight, workbook cell snippet)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Admin shell, overview, licensees, sources (upload + ingest)

**Files:**
- Create: `apps/web/src/app/(admin)/admin/tariffs/layout.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/_components/AdminTariffNav.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/_components/RunMonitorButton.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/licensees/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/licensees/LicenseeEditor.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/sources/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/sources/SourceUpload.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/sources/IngestPanel.tsx`
- Create: `apps/web/src/lib/tariffs/sha256.ts`
- Test: `apps/web/src/app/(admin)/admin/tariffs/layout.test.tsx`
- Test: `apps/web/src/app/(admin)/admin/tariffs/sources/IngestPanel.test.tsx`
- Test: `apps/web/src/lib/tariffs/sha256.test.ts`

- [ ] **Step 1: Write the failing tests**

`layout.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ gate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminPage: h.gate }))
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/tariffs' }))
import TariffLibraryLayout from './layout'
import { render, screen } from '@testing-library/react'

describe('tariff library layout', () => {
  it('asks the gate before rendering anything (a non-admin gets its 404)', async () => {
    h.gate.mockRejectedValueOnce(new Error('NOT_FOUND'))
    await expect(TariffLibraryLayout({ children: <p>x</p> })).rejects.toThrow('NOT_FOUND')
  })
  it('renders the library chrome for an admin', async () => {
    h.gate.mockResolvedValueOnce({ supabase: {}, userId: 'a1' })
    render(await TariffLibraryLayout({ children: <p>child</p> }))
    expect(screen.getByRole('heading', { name: 'Tariff library' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Tariff years' }).getAttribute('href')).toBe('/admin/tariffs/years')
    expect(screen.getByText('child')).toBeDefined()
  })
})
```

`sha256.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { sha256Hex } from './sha256'

describe('sha256Hex (browser WebCrypto)', () => {
  it('hashes bytes to lowercase hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
```

`IngestPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ queue: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-library.actions', () => ({ queueIngestJobAction: h.queue }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { IngestPanel } from './IngestPanel'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ report: { status: 'dry_run', runId: null, years: [
    { licensee: 'City Power', action: 'create', tariffs: 12, charges: 80, blocking: 0, review: 3, unresolved: 1, yoy: null, issues: [] },
  ] } }), { status: 200 })) as unknown as typeof fetch
})

describe('IngestPanel', () => {
  it('a workbook: Dry run shows the plan, then Apply posts apply=true', async () => {
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd1', fileKind: 'xlsx', financialYear: '2025/26', licenseeName: null }} />)
    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText('City Power')).toBeDefined()
    expect(screen.getByText('create')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Apply (lands in review)' }))
    const last = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
    expect(JSON.parse((last[1] as RequestInit).body as string)).toMatchObject({ sourceDocumentId: 'd1', parser: 'province_xlsx', apply: true })
  })
  it('a PDF: only Queue ingest, and the licensee name is required', async () => {
    h.queue.mockResolvedValue({ ok: true, id: 'j1' })
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd2', fileKind: 'pdf', financialYear: '2026/27', licenseeName: 'City Power' }} />)
    expect(screen.queryByRole('button', { name: 'Dry run' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Queue ingest' }))
    expect(h.queue).toHaveBeenCalledWith({ sourceDocumentId: 'd2', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'City Power', createLicensees: false })
    expect(await screen.findByText('Queued. The staff ingest worker will pick it up.')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/admin/tariffs" src/lib/tariffs/sha256.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `sha256.ts`**

```ts
/** SHA-256 of a file's bytes in the browser (WebCrypto), lowercase hex. */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 4: Implement the shell**

`layout.tsx`:
```tsx
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { AdminTariffNav } from './_components/AdminTariffNav'

export const dynamic = 'force-dynamic'

/**
 * Platform tariff library (spec §12; D-03). 404 for anyone not on the
 * platform_tariff_admins allow-list (00210). Every page and action re-checks.
 */
export default async function TariffLibraryLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformTariffAdminPage()
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tariff library</h1>
          <p className="page-subtitle">The published South African tariffs every Solar study reads</p>
        </div>
      </div>
      <AdminTariffNav />
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}
```

`_components/AdminTariffNav.tsx`:
```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/admin/tariffs', label: 'Overview', exact: true },
  { href: '/admin/tariffs/licensees', label: 'Licensees', exact: false },
  { href: '/admin/tariffs/sources', label: 'Source documents', exact: false },
  { href: '/admin/tariffs/years', label: 'Tariff years', exact: false },
  { href: '/admin/tariffs/calendars', label: 'TOU calendars', exact: false },
  { href: '/admin/tariffs/reports', label: 'Error reports', exact: false },
]

export function AdminTariffNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Tariff library" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '1px solid var(--c-border)' }}>
      {ITEMS.map((i) => {
        const active = i.exact ? pathname === i.href : pathname.startsWith(i.href)
        return (
          <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}
            style={{ padding: '8px 12px', fontSize: 13, textDecoration: 'none', color: active ? 'var(--c-text)' : 'var(--c-text-mid)',
              borderBottom: `2px solid ${active ? 'var(--c-amber)' : 'transparent'}` }}>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

`_components/RunMonitorButton.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { runDueYearCheckAction } from '@/actions/tariff-library.actions'

export function RunMonitorButton({ regime }: { regime: 'eskom' | 'municipal' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <Button variant="secondary" size="sm" isLoading={busy} onClick={async () => {
        setBusy(true); setMsg(null)
        const r = await runDueYearCheckAction({ regime })
        setBusy(false)
        if ('error' in r) setMsg(r.error)
        else { setMsg(r.inserted === 0 ? 'No new alerts.' : `${r.inserted} new alert(s).`); router.refresh() }
      }}>
        Check {regime === 'eskom' ? 'Eskom' : 'municipal'} years now
      </Button>
      {msg && <span role="status" style={{ fontSize: 12 }}>{msg}</span>}
    </span>
  )
}
```

`page.tsx` (overview):
```tsx
import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { formatSolarDate } from '@esite/shared'
import { RunMonitorButton } from './_components/RunMonitorButton'

export const dynamic = 'force-dynamic'

export default async function TariffLibraryOverview() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const [inReview, openReports, jobs, alerts] = await Promise.all([
    t.from('tariff_year').select('id', { count: 'exact', head: true }).eq('state', 'in_review'),
    t.from('error_report').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    t.from('ingest_job').select('id', { count: 'exact', head: true }).in('status', ['queued', 'running']),
    t.from('due_year_alert').select('id, regime, missing_financial_year, latest_published_fy, checked_on, licensee:licensee_id(name)')
      .is('resolved_at', null).order('checked_on', { ascending: false }).limit(50),
  ])
  const alertRows = (alerts.data ?? []) as Array<{ id: string; regime: string; missing_financial_year: string; latest_published_fy: string | null; checked_on: string; licensee: { name: string } | null }>
  const tiles = [
    { label: 'Years waiting for review', value: inReview.count ?? 0, href: '/admin/tariffs/years?state=in_review' },
    { label: 'Open error reports', value: openReports.count ?? 0, href: '/admin/tariffs/reports' },
    { label: 'PDF ingests queued or running', value: jobs.count ?? 0, href: '/admin/tariffs/sources' },
  ]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {tiles.map((x) => (
          <Link key={x.label} href={x.href} style={{ textDecoration: 'none' }}>
            <Card><CardBody><div style={{ fontSize: 24, fontWeight: 700 }}>{x.value}</div><div style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>{x.label}</div></CardBody></Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader><span className="data-panel-title">Due-year alerts</span></CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>
            Checked automatically on 1 April (Eskom) and 1 July (municipal). <RunMonitorButton regime="eskom" /> <RunMonitorButton regime="municipal" />
          </p>
          {alertRows.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Every watched licensee has a published year covering today.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {alertRows.map((a) => (
                  <li key={a.id}>
                    {a.licensee?.name ?? 'Unknown licensee'}: no published {a.missing_financial_year} (latest {a.latest_published_fy ?? 'none'}), found {formatSolarDate(a.checked_on)}.{' '}
                    <Link href="/admin/tariffs/sources">Upload the source</Link>
                  </li>
                ))}
              </ul>}
        </CardBody>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Implement the licensee registry**

`licensees/page.tsx`:
```tsx
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { LicenseeEditor, type LicenseeRow } from './LicenseeEditor'

export const dynamic = 'force-dynamic'

export default async function LicenseesPage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data } = await supabase.schema('tariffs').from('licensee')
    .select('id, name, kind, mdb_code, province, nersa_licence_no, updated_at, licensee_alias(alias)').order('name')
  const rows: LicenseeRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), name: String(r.name), kind: String(r.kind), mdbCode: (r.mdb_code as string | null) ?? '',
    province: (r.province as string | null) ?? '', nersaLicenceNo: (r.nersa_licence_no as string | null) ?? '',
    updatedAt: String(r.updated_at), aliases: ((r.licensee_alias ?? []) as Array<{ alias: string }>).map((a) => a.alias).sort(),
  }))
  return <LicenseeEditor rows={rows} />
}
```

`licensees/LicenseeEditor.tsx`:
```tsx
'use client'
/** Licensee registry (spec §12): add/edit name, kind, MDB code, province, NERSA licence no., aliases. */
import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { LICENSEE_KINDS } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { addLicenseeAliasAction, removeLicenseeAliasAction, saveLicenseeAction } from '@/actions/tariff-library.actions'

export interface LicenseeRow {
  id: string
  name: string
  kind: string
  mdbCode: string
  province: string
  nersaLicenceNo: string
  updatedAt: string
  aliases: string[]
}

const PROVINCE_OPTIONS = ['', 'EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NW', 'NC', 'WC', 'national']
const TH: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const EMPTY: LicenseeRow = { id: '', name: '', kind: 'municipal', mdbCode: '', province: '', nersaLicenceNo: '', updatedAt: '', aliases: [] }

export function LicenseeEditor({ rows }: { rows: LicenseeRow[] }) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<LicenseeRow | null>(null)
  const shown = useMemo(() => {
    const s = q.trim().toUpperCase()
    return s ? rows.filter((r) => r.name.toUpperCase().includes(s) || r.aliases.some((a) => a.includes(s)) || r.mdbCode.toUpperCase() === s) : rows
  }, [q, rows])
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {editing && <LicenseeForm initial={editing} onDone={() => setEditing(null)} />}
      <Card>
        <CardHeader>
          <span className="data-panel-title">Licensees ({rows.length})</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Search licensees" placeholder="Search name, alias or MDB code" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>Add licensee</Button>
          </span>
        </CardHeader>
        <CardBody>
          {rows.length === 0
            ? <p style={{ fontSize: 13 }}>No licensees yet. Seed the registry with <code>scripts/tariffs/seed-licensee-registry.ts</code>, or add one.</p>
            : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Name</th><th style={TH}>Kind</th><th style={TH}>MDB</th><th style={TH}>Province</th><th style={TH}>NERSA licence</th><th style={TH}>Aliases</th><th style={TH} /></tr></thead>
                  <tbody>{shown.map((r) => (
                    <tr key={r.id}>
                      <td style={TD}>{r.name}</td><td style={TD}>{r.kind}</td><td style={TD}>{r.mdbCode || '—'}</td>
                      <td style={TD}>{r.province || '—'}</td><td style={TD}>{r.nersaLicenceNo || '—'}</td>
                      <td style={TD}><Aliases licenseeId={r.id} aliases={r.aliases} /></td>
                      <td style={TD}><Button variant="secondary" size="sm" onClick={() => setEditing(r)}>Edit</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
        </CardBody>
      </Card>
    </div>
  )
}

function LicenseeForm({ initial, onDone }: { initial: LicenseeRow; onDone: () => void }) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof LicenseeRow) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{initial.id ? `Edit ${initial.name}` : 'Add licensee'}</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label>Name<input value={f.name} onChange={set('name')} />{errors.name && <span role="alert"> {errors.name}</span>}</label>
          <label>Kind<select value={f.kind} onChange={set('kind')}>{LICENSEE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>MDB code<input value={f.mdbCode} onChange={set('mdbCode')} />{errors.mdbCode && <span role="alert"> {errors.mdbCode}</span>}</label>
          <label>Province<select value={f.province} onChange={set('province')}>{PROVINCE_OPTIONS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}</select></label>
          <label>NERSA licence no.<input value={f.nersaLicenceNo} onChange={set('nersaLicenceNo')} /></label>
        </div>
        {error && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button isLoading={busy} onClick={async () => {
            setBusy(true); setError(null); setErrors({})
            const r = await saveLicenseeAction({ id: f.id || null, name: f.name, kind: f.kind, mdbCode: f.mdbCode, province: f.province, nersaLicenceNo: f.nersaLicenceNo, expectedUpdatedAt: f.id ? f.updatedAt : null })
            setBusy(false)
            if ('fieldErrors' in r) setErrors(r.fieldErrors as Record<string, string>)
            else if ('error' in r) setError(r.error)
            else { onDone(); router.refresh() }
          }}>Save licensee</Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  )
}

function Aliases({ licenseeId, aliases }: { licenseeId: string; aliases: string[] }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {aliases.map((a) => (
        <span key={a} style={{ fontSize: 12 }}>
          {a} <button type="button" aria-label={`Remove alias ${a}`} onClick={async () => {
            const r = await removeLicenseeAliasAction({ alias: a })
            if ('error' in r) setError(r.error); else router.refresh()
          }}>×</button>
        </span>
      ))}
      <span style={{ display: 'flex', gap: 4 }}>
        <input aria-label="New alias" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Sheet name as printed" style={{ fontSize: 12 }} />
        <button type="button" onClick={async () => {
          setError(null)
          const r = await addLicenseeAliasAction({ licenseeId, alias: value })
          if ('error' in r) setError(r.error); else { setValue(''); router.refresh() }
        }}>Add</button>
      </span>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
```

- [ ] **Step 6: Implement sources (upload + ingest)**

`sources/page.tsx`:
```tsx
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { formatSolarDate } from '@esite/shared'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { contentTypeFor } from '@/lib/tariffs/source-files'
import { SourceUpload } from './SourceUpload'
import { IngestPanel } from './IngestPanel'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>

export default async function SourcesPage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const [docs, licensees, jobs] = await Promise.all([
    t.from('source_document').select('id, kind, title, financial_year, status, storage_path, url, created_at, licensee:licensee_id(name)').order('created_at', { ascending: false }).limit(200),
    t.from('licensee').select('id, name').order('name'),
    t.from('ingest_job').select('id, source_document_id, status, requested_at, finished_at, error').order('requested_at', { ascending: false }).limit(200),
  ])
  const jobRows = (jobs.data ?? []) as Row[]
  const lastJob = new Map<string, Row>()
  for (const j of jobRows) if (!lastJob.has(String(j.source_document_id))) lastJob.set(String(j.source_document_id), j)
  const docRows = (docs.data ?? []) as Row[]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SourceUpload licensees={((licensees.data ?? []) as Array<{ id: string; name: string }>)} />
      <Card>
        <CardHeader><span className="data-panel-title">Source documents</span></CardHeader>
        <CardBody>
          {docRows.length === 0
            ? <p style={{ fontSize: 13 }}>No source documents yet. Upload a tariff book, NERSA decision or Eskom schedule above.</p>
            : <div style={{ display: 'grid', gap: 12 }}>
                {docRows.map((d) => {
                  const path = (d.storage_path as string | null) ?? ''
                  const type = path ? contentTypeFor(path) : null
                  const job = lastJob.get(String(d.id))
                  return (
                    <div key={String(d.id)} style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 13 }}>
                        <strong>{String(d.title)}</strong> · {String(d.kind)} · {(d.financial_year as string | null) ?? 'no year'} · {String(d.status)}
                        {' · '}{(d.licensee as { name: string } | null)?.name ?? 'many licensees'} · added {formatSolarDate(String(d.created_at))}
                      </div>
                      {job && <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Last queued ingest: {String(job.status)}{job.error ? ` — ${String(job.error)}` : ''}</div>}
                      {type && (d.financial_year as string | null) && (
                        <IngestPanel source={{
                          id: String(d.id), fileKind: type === 'application/pdf' ? 'pdf' : 'xlsx',
                          financialYear: String(d.financial_year), licenseeName: (d.licensee as { name: string } | null)?.name ?? null,
                        }} />
                      )}
                    </div>
                  )
                })}
              </div>}
        </CardBody>
      </Card>
    </div>
  )
}
```

`sources/SourceUpload.tsx`:
```tsx
'use client'
/**
 * Upload a tariff source (spec §12): hash in the browser, upload straight to
 * the private bucket through a signed upload URL, then the server re-hashes
 * and registers it. Never posts the file through a server function.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SOURCE_DOCUMENT_KINDS, SOURCE_DOCUMENT_STATUSES } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { sha256Hex } from '@/lib/tariffs/sha256'
import { contentTypeFor } from '@/lib/tariffs/source-files'
import { createSourceUploadAction, registerSourceDocumentAction } from '@/actions/tariff-library.actions'

export function SourceUpload({ licensees }: { licensees: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState('nersa_decision')
  const [title, setTitle] = useState('')
  const [fy, setFy] = useState('')
  const [status, setStatus] = useState('nersa_approved')
  const [licenseeId, setLicenseeId] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function upload() {
    if (!file) return setMsg({ ok: false, text: 'Choose a file' })
    const type = contentTypeFor(file.name)
    if (!type) return setMsg({ ok: false, text: 'Upload a PDF, XLSX or XLSM file' })
    setBusy(true); setMsg(null)
    try {
      const sha256 = await sha256Hex(await file.arrayBuffer())
      const meta = { fileName: file.name, sha256, size: file.size, kind, title, financialYear: fy, status, licenseeId: licenseeId || null, publishedOn: '', url }
      const signed = await createSourceUploadAction(meta)
      if ('error' in signed) return setMsg({ ok: false, text: signed.error })
      const { error } = await createClient().storage.from('tariff-sources').uploadToSignedUrl(signed.path, signed.token, file, { contentType: type })
      if (error) return setMsg({ ok: false, text: 'The upload failed. Try again.' })
      const reg = await registerSourceDocumentAction(meta)
      if ('error' in reg) return setMsg({ ok: false, text: reg.error })
      setMsg({ ok: true, text: 'Uploaded and registered.' })
      setFile(null); setTitle('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Upload source</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label>File (PDF, XLSX, XLSM, up to 50 MB)<input type="file" accept=".pdf,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}>{SOURCE_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="City Power RfD 2026/27" /></label>
          <label>Financial year<input value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2026/27" /></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{SOURCE_DOCUMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Licensee (one-licensee documents)<select value={licenseeId} onChange={(e) => setLicenseeId(e.target.value)}>
            <option value="">Many / not specific</option>{licensees.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
          <label>Source link (optional)<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button isLoading={busy} onClick={upload}>Upload source</Button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
```

`sources/IngestPanel.tsx`:
```tsx
'use client'
/**
 * Ingest one stored source (spec §12). Workbooks: Dry run, then Apply (the
 * 2a core via /api/admin/tariffs/ingest; years land in review, never
 * published). PDFs: Queue ingest (the staff worker runs pdftotext).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IngestReportSummary } from '@esite/shared/tariffs/ingest'
import { Button } from '@/components/ui/Button'
import { queueIngestJobAction } from '@/actions/tariff-library.actions'

export interface IngestSource {
  id: string
  fileKind: 'pdf' | 'xlsx'
  financialYear: string
  licenseeName: string | null
}

export function IngestPanel({ source }: { source: IngestSource }) {
  const router = useRouter()
  const [parser, setParser] = useState(source.fileKind === 'pdf' ? 'rfd_pdf' : 'province_xlsx')
  const [fy, setFy] = useState(source.financialYear)
  const [licensee, setLicensee] = useState(source.licenseeName ?? '')
  const [createLicensees, setCreateLicensees] = useState(false)
  const [busy, setBusy] = useState<'dry' | 'apply' | 'queue' | null>(null)
  const [report, setReport] = useState<IngestReportSummary | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(apply: boolean) {
    setBusy(apply ? 'apply' : 'dry'); setMsg(null)
    const res = await fetch('/api/admin/tariffs/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceDocumentId: source.id, parser, financialYear: fy, licenseeName: licensee, createLicensees, apply }),
    }).catch(() => null)
    setBusy(null)
    const json = res ? await res.json().catch(() => ({})) as { report?: IngestReportSummary; error?: string } : {}
    if (!res || !res.ok || !json.report) return setMsg(json.error ?? 'The ingest failed. Try again.')
    setReport(json.report)
    if (apply) { setMsg('Applied. The years are waiting for review under Tariff years.'); router.refresh() }
  }

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <label>Parser <select value={parser} onChange={(e) => setParser(e.target.value)} disabled={source.fileKind === 'pdf'}>
          {source.fileKind === 'pdf'
            ? <option value="rfd_pdf">NERSA RfD (PDF)</option>
            : <><option value="province_xlsx">NERSA province compendium (XLSX)</option><option value="eskom_xlsm">Eskom schedule (XLSM)</option></>}
        </select></label>
        <label>Year <input value={fy} onChange={(e) => setFy(e.target.value)} style={{ width: 80 }} /></label>
        {parser === 'rfd_pdf' && <label>Licensee <input value={licensee} onChange={(e) => setLicensee(e.target.value)} /></label>}
        <label><input type="checkbox" checked={createLicensees} onChange={(e) => setCreateLicensees(e.target.checked)} /> Create unknown licensees</label>
        {source.fileKind === 'pdf'
          ? <Button size="sm" isLoading={busy === 'queue'} onClick={async () => {
              setBusy('queue'); setMsg(null)
              const r = await queueIngestJobAction({ sourceDocumentId: source.id, parser: 'rfd_pdf', financialYear: fy, licenseeName: licensee, createLicensees })
              setBusy(null)
              if ('error' in r) setMsg(r.error); else { setMsg('Queued. The staff ingest worker will pick it up.'); router.refresh() }
            }}>Queue ingest</Button>
          : <>
              <Button size="sm" variant="secondary" isLoading={busy === 'dry'} onClick={() => run(false)}>Dry run</Button>
              {report?.status === 'dry_run' && <Button size="sm" isLoading={busy === 'apply'} onClick={() => run(true)}>Apply (lands in review)</Button>}
            </>}
      </div>
      {msg && <p role="status" style={{ fontSize: 13, margin: 0 }}>{msg}</p>}
      {report && (
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['Licensee', 'Action', 'Tariffs', 'Charges', 'Blocking', 'Review', 'Unresolved', 'YoY'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '4px 8px' }}>{h}</th>)}</tr></thead>
          <tbody>{report.years.map((y, i) => (
            <tr key={i}>
              <td style={{ padding: '4px 8px' }}>{y.licensee}</td><td style={{ padding: '4px 8px' }}>{y.action}</td>
              <td style={{ padding: '4px 8px' }}>{y.tariffs}</td><td style={{ padding: '4px 8px' }}>{y.charges}</td>
              <td style={{ padding: '4px 8px' }}>{y.blocking}</td><td style={{ padding: '4px 8px' }}>{y.review}</td>
              <td style={{ padding: '4px 8px' }}>{y.unresolved}</td>
              <td style={{ padding: '4px 8px' }}>{y.yoy ? `+${y.yoy.added} −${y.yoy.removed} ~${y.yoy.changed} (${y.yoy.outOfBand} out of band)` : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run the tests — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/admin/tariffs" src/lib/tariffs/sha256.test.ts`
Expected: PASS (layout 2, IngestPanel 2, sha256 1).

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(admin)/admin/tariffs" apps/web/src/lib/tariffs/sha256.ts apps/web/src/lib/tariffs/sha256.test.ts
git commit -m "feat(tariff-admin): library shell, overview with due-year alerts, licensee registry, source upload and ingest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Tariff years — list, review queue, checks, publish, YoY diff, SSEG rule

**Files:**
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/ReviewQueue.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/PublishPanel.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/review-model.ts`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/diff/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/sseg/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/sseg/SsegRuleForm.tsx`
- Test: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/review-model.test.ts`
- Test: `apps/web/src/app/(admin)/admin/tariffs/years/[yearId]/ReviewQueue.test.tsx`

`review-model.ts` turns loaded rows + issues into the JSON the client queue renders (the page hands the client component JSON only) and maps each issue's `(tariff name, chargeIndex)` to the charge row id.

- [ ] **Step 1: Write the failing tests**

`review-model.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeCharge, makeTariff } from '@esite/shared'
import { buildReviewModel } from './review-model'

describe('buildReviewModel', () => {
  it('attaches each issue to its charge row by index, and year-level issues to the tariff', () => {
    const tariff = makeTariff({ name: 'Commercial', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 2500 }),
      makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400, unitInferred: true, inferenceReason: 'no unit' }),
    ] })
    const chargeRows = [
      { id: 'c-energy', source_document_id: 'd1', source_locator: { page: 3 }, reviewed_at: null },
      { id: 'c-basic', source_document_id: 'd1', source_locator: { page: 3 }, reviewed_at: null },
    ]
    const m = buildReviewModel([{ id: 't1', row: { code: 'C1' }, tariff, chargeRows }], [
      { code: 'energy_out_of_range', severity: 'block', message: '2500 c/kWh is outside 50-1500 c/kWh', tariff: 'Commercial', chargeIndex: 0 },
      { code: 'yoy_out_of_band', severity: 'review', message: 'Commercial energy: 30%', tariff: 'Commercial' },
    ])
    expect(m[0].issues).toEqual([{ severity: 'review', message: 'Commercial energy: 30%' }])
    expect(m[0].charges[0]).toMatchObject({ id: 'c-energy', amount: 2500, unit: 'c_per_kWh', issues: [{ severity: 'block', message: '2500 c/kWh is outside 50-1500 c/kWh' }] })
    expect(m[0].charges[1]).toMatchObject({ id: 'c-basic', unitInferred: true, inferenceReason: 'no unit', needsReview: true, sourceDocumentId: 'd1' })
  })
})
```

`ReviewQueue.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn(), edit: vi.fn(), del: vi.fn(), url: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-review.actions', () => ({ approveChargeAction: h.approve, rejectChargeAction: h.reject, editChargeAction: h.edit, deleteTariffAction: h.del }))
vi.mock('@/actions/tariff-library.actions', () => ({ getTariffSourceUrlAdminAction: h.url }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/components/tariffs/SourceViewer', () => ({ SourceViewer: (p: { title: string }) => <div>viewer {p.title}</div> }))

import { ReviewQueue } from './ReviewQueue'
import type { ReviewTariff } from './review-model'

const model: ReviewTariff[] = [{
  id: 't1', name: 'Commercial', code: 'C1', structure: 'flat', issues: [],
  charges: [{
    id: 'c1', component: 'basic', season: 'all', tou: 'all', dayType: 'all', blockMin: null, blockMax: null,
    unit: 'R_per_month', amount: 400, vatBasis: 'assumed_excl', unitInferred: true, inferenceReason: 'no unit printed',
    reviewedAt: null, needsReview: true, sourceDocumentId: 'd1', locator: { page: 3 }, issues: [],
  }],
}]

beforeEach(() => { vi.clearAllMocks(); h.approve.mockResolvedValue({ ok: true }); h.reject.mockResolvedValue({ ok: true }) })

describe('ReviewQueue', () => {
  it('shows every charge with its inferred-unit reason and approves it', async () => {
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    expect(screen.getByText('no unit printed')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(h.approve).toHaveBeenCalledWith({ chargeId: 'c1' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('Reject is two-step', async () => {
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(h.reject).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }))
    expect(h.reject).toHaveBeenCalledWith({ chargeId: 'c1' })
  })
  it('View source opens the viewer beside the charge', async () => {
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    await user.click(screen.getByRole('button', { name: 'View source' }))
    expect(screen.getByText('viewer Commercial — Basic charge')).toBeDefined()
  })
  it('a published year is read-only', () => {
    render(<ReviewQueue tariffs={model} editable={false} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View source' })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/admin/tariffs/years"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `review-model.ts`**

```ts
/** Loaded year rows + checks -> the JSON the client review queue renders. */
import type { ChargeComponent, SourceLocator, TariffIssue, TariffUnit } from '@esite/shared'
import type { LoadedTariff } from '@/lib/tariffs/load-year'

export interface ReviewIssue { severity: 'block' | 'review' | 'warn'; message: string }

export interface ReviewCharge {
  id: string
  component: ChargeComponent
  season: string
  tou: string
  dayType: string
  blockMin: number | null
  blockMax: number | null
  unit: TariffUnit
  amount: number
  vatBasis: string
  unitInferred: boolean
  inferenceReason: string | null
  reviewedAt: string | null
  needsReview: boolean
  sourceDocumentId: string | null
  locator: SourceLocator
  issues: ReviewIssue[]
}

export interface ReviewTariff {
  id: string
  name: string
  code: string | null
  structure: string
  issues: ReviewIssue[]
  charges: ReviewCharge[]
}

export function buildReviewModel(loaded: LoadedTariff[], issues: TariffIssue[]): ReviewTariff[] {
  return loaded.map((l) => {
    const mine = issues.filter((i) => i.tariff === l.tariff.name)
    return {
      id: l.id, name: l.tariff.name, code: (l.row.code as string | null) ?? null, structure: l.tariff.structure,
      issues: mine.filter((i) => i.chargeIndex === undefined).map((i) => ({ severity: i.severity, message: i.message })),
      charges: l.tariff.charges.map((c, k) => {
        const row = l.chargeRows[k] ?? {}
        const reviewedAt = (row.reviewed_at ?? null) as string | null
        return {
          id: String(row.id), component: c.component, season: c.season, tou: c.tou, dayType: c.dayType,
          blockMin: c.blockMinKwh, blockMax: c.blockMaxKwh, unit: c.unit, amount: c.amountExclVat, vatBasis: c.vatBasis,
          unitInferred: c.unitInferred, inferenceReason: c.inferenceReason, reviewedAt,
          needsReview: c.unitInferred && reviewedAt === null,
          sourceDocumentId: (row.source_document_id ?? null) as string | null,
          locator: (row.source_locator ?? {}) as SourceLocator,
          issues: mine.filter((i) => i.chargeIndex === k).map((i) => ({ severity: i.severity, message: i.message })),
        }
      }),
    }
  })
}
```

- [ ] **Step 4: Implement `ReviewQueue.tsx`**

```tsx
'use client'
/**
 * Review queue (spec §12): each charge beside its source (PDF page crop or
 * workbook cell); Approve / Edit / Reject; the automatic checks inline.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  COMPONENT_LABELS, SEASON_LABELS, TARIFF_UNITS, TOU_LABELS, UNIT_LABELS, formatChargeAmount,
  type TariffSeason, type TariffUnit, type TouOrAll,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { SourceViewer } from '@/components/tariffs/SourceViewer'
import { approveChargeAction, deleteTariffAction, editChargeAction, rejectChargeAction } from '@/actions/tariff-review.actions'
import { getTariffSourceUrlAdminAction } from '@/actions/tariff-library.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import type { ReviewCharge, ReviewIssue, ReviewTariff } from './review-model'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const SEV: Record<ReviewIssue['severity'], 'danger' | 'warning' | 'ghost'> = { block: 'danger', review: 'warning', warn: 'ghost' }

export function ReviewQueue({ tariffs, editable }: { tariffs: ReviewTariff[]; editable: boolean }) {
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [viewing, setViewing] = useState<{ title: string; charge: ReviewCharge } | null>(null)
  const shown = onlyOpen
    ? tariffs.filter((t) => t.issues.length > 0 || t.charges.some((c) => c.needsReview || c.issues.length > 0))
    : tariffs
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only tariffs with open checks</label>
      {shown.length === 0 && <p style={{ fontSize: 13 }}>Nothing left to review.</p>}
      {shown.map((t) => (
        <section key={t.id} aria-label={t.name} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{t.name}{t.code ? ` (${t.code})` : ''} · {t.structure}</strong>
            {editable && <DeleteTariff tariffId={t.id} />}
          </div>
          {t.issues.map((i, k) => <p key={k} style={{ margin: '4px 0', fontSize: 12 }}><Badge variant={SEV[i.severity]}>{i.severity}</Badge> <span>{i.message}</span></p>)}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Component</th><th style={TH}>Season</th><th style={TH}>Period</th><th style={TH}>Block (kWh)</th><th style={TH}>Amount</th><th style={TH}>VAT</th><th style={TH}>Checks</th><th style={TH} /></tr></thead>
              <tbody>{t.charges.map((c) => (
                <ChargeRow key={c.id} charge={c} editable={editable} onView={() => setViewing({ title: `${t.name} — ${COMPONENT_LABELS[c.component]}`, charge: c })} />
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
      {viewing && (
        <SourceViewer
          title={viewing.title}
          locator={viewing.charge.locator}
          loadUrl={() => viewing.charge.sourceDocumentId
            ? getTariffSourceUrlAdminAction({ sourceDocumentId: viewing.charge.sourceDocumentId })
            : Promise.resolve({ error: 'No source document is recorded for this charge.' })}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

function ChargeRow({ charge: c, editable, onView }: { charge: ReviewCharge; editable: boolean; onView: () => void }) {
  const router = useRouter()
  const reject = useArmedConfirm()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(c.amount))
  const [unit, setUnit] = useState<TariffUnit | ''>(c.unit)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<{ ok: true } | { error: string } | { fieldErrors: Record<string, string | undefined> }>) => {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if ('error' in r) setError(r.error)
    else if ('fieldErrors' in r) setError(Object.values(r.fieldErrors).filter(Boolean).join(' '))
    else { setEditing(false); router.refresh() }
  }
  return (
    <tr>
      <td style={TD}>{COMPONENT_LABELS[c.component]}</td>
      <td style={TD}>{SEASON_LABELS[c.season as TariffSeason] ?? c.season}</td>
      <td style={TD}>{TOU_LABELS[c.tou as TouOrAll] ?? c.tou}{c.dayType !== 'all' ? ` (${c.dayType})` : ''}</td>
      <td style={TD}>{c.blockMin === null ? '—' : `${c.blockMin}–${c.blockMax ?? '∞'}`}</td>
      <td style={TD}>
        {editing
          ? <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
              <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
              <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as TariffUnit)}>
                {TARIFF_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
              </select>
              {c.unitInferred && <label style={{ fontSize: 12 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Unit confirmed against the source</label>}
            </span>
          : formatChargeAmount(c.amount, c.unit)}
      </td>
      <td style={TD}>{c.vatBasis}</td>
      <td style={TD}>
        {c.unitInferred && <div style={{ fontSize: 12 }}><Badge variant={c.reviewedAt ? 'success' : 'warning'}>{c.reviewedAt ? 'reviewed' : 'inferred unit'}</Badge> <span>{c.inferenceReason}</span></div>}
        {c.issues.map((i, k) => <div key={k} style={{ fontSize: 12 }}><Badge variant={SEV[i.severity]}>{i.severity}</Badge> <span>{i.message}</span></div>)}
        {error && <div role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</div>}
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <Button variant="ghost" size="sm" onClick={onView}>View source</Button>
        {editable && !editing && <>
          {!c.reviewedAt && <Button variant="secondary" size="sm" isLoading={busy} onClick={() => act(() => approveChargeAction({ chargeId: c.id }))}>Approve</Button>}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="danger" size="sm" isLoading={busy}
            onClick={() => {
              if (!reject.armed) return reject.arm()
              reject.disarm()
              void act(() => rejectChargeAction({ chargeId: c.id }))
            }}>
            {reject.armed ? 'Confirm reject' : 'Reject'}
          </Button>
        </>}
        {editable && editing && <>
          <Button size="sm" isLoading={busy} onClick={() => act(() => editChargeAction({ chargeId: c.id, amount, unit, unitConfirmed: confirmed }))}>Save</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </>}
      </td>
    </tr>
  )
}

function DeleteTariff({ tariffId }: { tariffId: string }) {
  const router = useRouter()
  const armed = useArmedConfirm()
  const [error, setError] = useState<string | null>(null)
  return (
    <span>
      <Button variant="danger" size="sm" onClick={async () => {
        if (!armed.armed) return armed.arm()
        armed.disarm()
        const r = await deleteTariffAction({ tariffId })
        if ('error' in r) setError(r.error); else router.refresh()
      }}>{armed.armed ? 'Confirm delete tariff' : 'Delete tariff'}</Button>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}> {error}</span>}
    </span>
  )
}
```

⚠ `useArmedConfirm` lives under the project Solar route (`app/(admin)/projects/[id]/solar/_components/useArmedConfirm.ts`, 1c). Importing it across route groups works; moving it to `components/ui/` is out of scope (would touch 1c files).

- [ ] **Step 5: Implement `PublishPanel.tsx`**

```tsx
'use client'
/** Validate + Publish (spec §12). The database enforces every publish rule (00210). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { publishTariffYearAction, validateTariffYearAction } from '@/actions/tariff-review.actions'

export function PublishPanel({ yearId, state, validatedAt, blocking, unreviewedInferred }: {
  yearId: string; state: string; validatedAt: string | null; blocking: number | null; unreviewedInferred: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'validate' | 'publish' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (state === 'published' || state === 'superseded') {
    return <p style={{ fontSize: 13 }}>This year is {state}: it is read-only. Corrections are a new version through review.</p>
  }
  const ready = validatedAt !== null && blocking === 0 && unreviewedInferred === 0
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ fontSize: 13, margin: 0 }}>
        {validatedAt === null ? 'Not checked since the last change.' : `Checked: ${blocking ?? '?'} blocking issue(s).`}
        {unreviewedInferred > 0 && ` ${unreviewedInferred} inferred unit(s) still need review.`}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" isLoading={busy === 'validate'} onClick={async () => {
          setBusy('validate'); setMsg(null)
          const r = await validateTariffYearAction({ yearId })
          setBusy(null)
          if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: r.blocking === 0, text: `${r.blocking} blocking, ${r.review} to review, ${r.warn} warnings.` }); router.refresh() }
        }}>Run checks</Button>
        <Button disabled={!ready} isLoading={busy === 'publish'} title={ready ? undefined : 'Run the checks with 0 blocking issues and review every inferred unit first'} onClick={async () => {
          setBusy('publish'); setMsg(null)
          const r = await publishTariffYearAction({ yearId })
          setBusy(null)
          if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: true, text: 'Published. The previous year is now superseded.' }); router.refresh() }
        }}>Publish year</Button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)', margin: 0 }}>{msg.text}</p>}
    </div>
  )
}
```

- [ ] **Step 6: Implement the pages**

`years/page.tsx`:
```tsx
import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'

export const dynamic = 'force-dynamic'
const STATES = ['in_review', 'ingesting', 'published', 'superseded'] as const

export default async function YearsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { supabase } = await requirePlatformTariffAdminPage()
  const sp = await searchParams
  const state = (STATES as readonly string[]).includes(sp.state ?? '') ? sp.state! : 'in_review'
  const { data } = await supabase.schema('tariffs').from('tariff_year')
    .select('id, financial_year, state, validated_at, validation_blocking, published_at, licensee:licensee_id(name)')
    .eq('state', state).order('financial_year', { ascending: false }).limit(500)
  const rows = (data ?? []) as Array<{ id: string; financial_year: string; state: string; validated_at: string | null; validation_blocking: number | null; licensee: { name: string } | null }>
  return (
    <Card>
      <CardHeader>
        <span className="data-panel-title">Tariff years</span>
        <span style={{ display: 'flex', gap: 8, fontSize: 13 }}>
          {STATES.map((s) => <Link key={s} href={`/admin/tariffs/years?state=${s}`} aria-current={s === state ? 'page' : undefined}>{s.replace('_', ' ')}</Link>)}
        </span>
      </CardHeader>
      <CardBody>
        {rows.length === 0
          ? <p style={{ fontSize: 13 }}>No {state.replace('_', ' ')} years. Ingest a source to create one.</p>
          : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/tariffs/years/${r.id}`}>{r.licensee?.name ?? 'Unknown'} {r.financial_year}</Link>
                  {r.state === 'in_review' && ` · ${r.validated_at ? `${r.validation_blocking} blocking` : 'not checked'}`}
                </li>
              ))}
            </ul>}
      </CardBody>
    </Card>
  )
}
```

`years/[yearId]/page.tsx`:
```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { previousFinancialYear } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { loadPreviousPublished, loadYearTariffs } from '@/lib/tariffs/load-year'
import { computeYearChecks } from '@/lib/tariffs/year-checks'
import { buildReviewModel } from './review-model'
import { ReviewQueue } from './ReviewQueue'
import { PublishPanel } from './PublishPanel'

export const dynamic = 'force-dynamic'

export default async function YearReviewPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data: y } = await supabase.schema('tariffs').from('tariff_year')
    .select('id, licensee_id, financial_year, state, approved_increase_pct, validated_at, validation_blocking, effective_from, effective_to, licensee:licensee_id(name)')
    .eq('id', yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; financial_year: string; state: string; approved_increase_pct: string | number | null; validated_at: string | null; validation_blocking: number | null; effective_from: string; effective_to: string; licensee: { name: string } | null } | null
  if (!year) notFound()
  const loaded = await loadYearTariffs(supabase, year.id)
  const prev = await loadPreviousPublished(supabase, year.licensee_id, previousFinancialYear(year.financial_year))
  const checks = computeYearChecks(loaded.map((l) => l.tariff), prev?.tariffs ?? null, year.approved_increase_pct === null ? null : Number(year.approved_increase_pct))
  const model = buildReviewModel(loaded, checks.issues)
  const unreviewed = model.reduce((a, t) => a + t.charges.filter((c) => c.needsReview).length, 0)
  const draft = year.state === 'ingesting' || year.state === 'in_review'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader>
          <span className="data-panel-title">{year.licensee?.name ?? 'Unknown'} {year.financial_year} · {year.state.replace('_', ' ')}</span>
          <span style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <Link href={`/admin/tariffs/years/${year.id}/diff`}>Year-on-year diff</Link>
            <Link href={`/admin/tariffs/years/${year.id}/sseg`}>SSEG rule</Link>
          </span>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Effective {year.effective_from} to {year.effective_to}. Approved increase {year.approved_increase_pct ?? 'not recorded'} %. {loaded.length} tariffs.
          </p>
          <PublishPanel yearId={year.id} state={year.state} validatedAt={year.validated_at} blocking={year.validation_blocking} unreviewedInferred={unreviewed} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Automatic checks: {checks.blocking} blocking · {checks.review} to review · {checks.warn} warnings</span></CardHeader>
        <CardBody>
          {checks.issues.length === 0
            ? <p style={{ fontSize: 13 }}>No issues found.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{checks.issues.map((i, k) => <li key={k}><strong>{i.severity}</strong> {i.tariff ? `${i.tariff}: ` : ''}{i.message}</li>)}</ul>}
        </CardBody>
      </Card>
      <ReviewQueue tariffs={model} editable={draft} />
    </div>
  )
}
```

`years/[yearId]/diff/page.tsx`:
```tsx
import { notFound } from 'next/navigation'
import { diffTariffYears, previousFinancialYear } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { loadPreviousPublished, loadYearTariffs } from '@/lib/tariffs/load-year'

export const dynamic = 'force-dynamic'

export default async function YearDiffPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data: y } = await supabase.schema('tariffs').from('tariff_year').select('id, licensee_id, financial_year, approved_increase_pct').eq('id', yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; financial_year: string; approved_increase_pct: string | number | null } | null
  if (!year) notFound()
  const prevFy = previousFinancialYear(year.financial_year)
  const prev = await loadPreviousPublished(supabase, year.licensee_id, prevFy)
  if (!prev) return <Card><CardBody><p style={{ fontSize: 13 }}>No published {prevFy} year to compare with.</p></CardBody></Card>
  const approved = year.approved_increase_pct === null ? null : Number(year.approved_increase_pct)
  const cur = (await loadYearTariffs(supabase, year.id)).map((l) => l.tariff)
  const d = diffTariffYears(prev.tariffs, cur, approved)
  const outlier = (pct: number | null) => pct === null || (approved !== null && Math.abs(pct - approved) > 3)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">{prevFy} → {year.financial_year}: {d.changed.length} changed · {d.added.length} new · {d.removed.length} removed · {d.unchanged} unchanged</span></CardHeader>
        <CardBody>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th align="left">Tariff</th><th align="left">Component</th><th align="right">{prevFy}</th><th align="right">{year.financial_year}</th><th align="left">Unit</th><th align="right">Change</th></tr></thead>
            <tbody>{d.changed.map((c) => (
              <tr key={c.key} style={outlier(c.changePct) ? { background: 'var(--c-amber-dim)' } : undefined}>
                <td>{c.tariff}</td><td>{c.component}</td><td align="right">{c.prev}</td><td align="right">{c.next}</td><td>{c.unit}</td>
                <td align="right">{c.changePct === null ? 'unit changed' : `${c.changePct} %`}{outlier(c.changePct) ? ' ⚑' : ''}</td>
              </tr>
            ))}</tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>⚑ = more than 3 percentage points from the approved increase ({approved ?? 'not recorded'} %), or the unit changed.</p>
        </CardBody>
      </Card>
      <Card><CardHeader><span className="data-panel-title">New charges</span></CardHeader><CardBody>{d.added.length ? <ul style={{ fontSize: 12 }}>{d.added.map((k) => <li key={k}>{k}</li>)}</ul> : <p style={{ fontSize: 13 }}>None.</p>}</CardBody></Card>
      <Card><CardHeader><span className="data-panel-title">Removed charges</span></CardHeader><CardBody>{d.removed.length ? <ul style={{ fontSize: 12 }}>{d.removed.map((k) => <li key={k}>{k}</li>)}</ul> : <p style={{ fontSize: 13 }}>None.</p>}</CardBody></Card>
    </div>
  )
}
```

`years/[yearId]/sseg/page.tsx`:
```tsx
import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { ssegFormFromRow } from '@/lib/tariffs/sseg-form'
import { SsegRuleForm } from './SsegRuleForm'

export const dynamic = 'force-dynamic'

export default async function SsegPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const { data: y } = await t.from('tariff_year').select('id, financial_year, state, licensee:licensee_id(name)').eq('id', yearId).maybeSingle()
  const year = y as { id: string; financial_year: string; state: string; licensee: { name: string } | null } | null
  if (!year) notFound()
  const [{ data: rule }, { data: docs }] = await Promise.all([
    t.from('sseg_rule').select('*').eq('tariff_year_id', year.id).maybeSingle(),
    t.from('source_document').select('id, title').order('created_at', { ascending: false }).limit(200),
  ])
  return (
    <Card>
      <CardHeader><span className="data-panel-title">SSEG rule — {year.licensee?.name ?? ''} {year.financial_year}</span></CardHeader>
      <CardBody>
        <SsegRuleForm yearId={year.id} initial={ssegFormFromRow(rule as Record<string, unknown> | null)}
          editable={year.state === 'ingesting' || year.state === 'in_review'}
          documents={((docs ?? []) as Array<{ id: string; title: string }>)} />
      </CardBody>
    </Card>
  )
}
```

`years/[yearId]/sseg/SsegRuleForm.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAP_RULES, CARRY_FORWARD, CREDITING } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSsegRuleAction } from '@/actions/tariff-review.actions'
import type { SsegForm } from '@/lib/tariffs/sseg-form'

export function SsegRuleForm({ yearId, initial, editable, documents }: {
  yearId: string; initial: SsegForm; editable: boolean; documents: Array<{ id: string; title: string }>
}) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const sel = (k: keyof SsegForm, opts: readonly string[]) => (
    <select value={String(f[k])} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
  )
  const chk = (k: 'forfeit' | 'requiresTou' | 'requiresBidirectional') => (
    <input type="checkbox" checked={f[k]} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
  )
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      {!editable && <p>This year is published: the rule is read-only.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>Crediting {sel('crediting', CREDITING)}</label>
        <label>Carry forward {sel('carryForward', CARRY_FORWARD)}</label>
        <label>Financial year ends (month) {sel('fyEndMonth', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])}</label>
        <label>Cap {sel('capRule', CAP_RULES)}</label>
        <label>Maximum size (kVA) <input value={f.maxKva} disabled={!editable} onChange={(e) => setF({ ...f, maxKva: e.target.value })} /></label>
        <label>{chk('forfeit')} Credit forfeited on change of ownership</label>
        <label>{chk('requiresTou')} Requires a TOU tariff</label>
        <label>{chk('requiresBidirectional')} Requires a bidirectional meter</label>
        <label>Source document <select value={f.sourceDocumentId} disabled={!editable} onChange={(e) => setF({ ...f, sourceDocumentId: e.target.value })}>
          <option value="">None</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select></label>
        <label>Pages <input value={f.pages} disabled={!editable} onChange={(e) => setF({ ...f, pages: e.target.value })} placeholder="pp7-12" /></label>
      </div>
      {editable && <div>
        <Button isLoading={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          const r = await saveSsegRuleAction({ yearId, form: f })
          setBusy(false)
          if ('fieldErrors' in r) setMsg({ ok: false, text: Object.values(r.fieldErrors).join(' ') })
          else if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: true, text: 'Saved.' }); router.refresh() }
        }}>Save SSEG rule</Button>
      </div>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
```

- [ ] **Step 7: Run the tests — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/admin/tariffs/years"`
Expected: PASS (review-model 1, ReviewQueue 4).

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(admin)/admin/tariffs/years"
git commit -m "feat(tariff-admin): tariff years, review queue beside the source, checks, publish, YoY diff, SSEG rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: TOU calendars & holidays; error reports; the sidebar link

**Files:**
- Create: `apps/web/src/app/(admin)/admin/tariffs/calendars/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/calendars/CalendarEditor.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/reports/page.tsx`
- Create: `apps/web/src/app/(admin)/admin/tariffs/reports/ErrorReportList.tsx`
- Create: `apps/web/src/components/tariffs/TouCalendarDiagram.tsx` (shared with the Tariff tab)
- Modify: `apps/web/src/app/(admin)/layout.tsx` (one RPC in the existing `Promise.all`, one prop)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (a `tariffAdmin` prop and one link)
- Test: `apps/web/src/app/(admin)/admin/tariffs/calendars/CalendarEditor.test.tsx`
- Test: `apps/web/src/components/tariffs/TouCalendarDiagram.test.tsx`
- Test: `apps/web/src/components/layout/Sidebar.test.tsx` (create or extend)

- [ ] **Step 1: Write the failing tests**

`TouCalendarDiagram.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TouCalendarDiagram } from './TouCalendarDiagram'

describe('TouCalendarDiagram', () => {
  it('draws six rows of 48 half-hours with the period of each', () => {
    render(<TouCalendarDiagram calendar={{ highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
      windows: [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }] }} />)
    expect(screen.getAllByRole('row')).toHaveLength(7)   // header + 6
    expect(screen.getByTitle('High season weekday 06:00 Peak')).toBeDefined()
    expect(screen.getByTitle('High season weekday 05:30 Off-peak')).toBeDefined()
    expect(screen.getByText('High-demand months: Jun, Jul, Aug. Public holidays are billed as Sunday.')).toBeDefined()
  })
})
```

`CalendarEditor.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-calendar.actions', () => ({ saveTouCalendarAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { CalendarEditor } from './CalendarEditor'

const LIC = '11111111-1111-1111-1111-111111111111'
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, id: 'cal1' }) })

describe('CalendarEditor', () => {
  it('copies Eskom hours into a municipal calendar, flagged assumed_eskom', async () => {
    const user = userEvent.setup()
    render(<CalendarEditor licenseeId={LIC} calendar={null}
      eskomWindows={[{ season: 'high', dayType: 'weekday', start: '06:00', end: '08:00', period: 'peak' }]} />)
    await user.click(screen.getByRole('button', { name: 'Copy Eskom hours' }))
    expect((screen.getByLabelText('Hours come from') as HTMLSelectElement).value).toBe('assumed_eskom')
    fireEvent.change(screen.getByLabelText('Valid from'), { target: { value: '2025-07-01' } })
    await user.click(screen.getByRole('button', { name: 'Save calendar' }))
    expect(h.save).toHaveBeenCalledWith({ calendarId: null, form: expect.objectContaining({
      licenseeId: LIC, source: 'assumed_eskom', validFrom: '2025-07-01',
      windows: [{ season: 'high', dayType: 'weekday', start: '06:00', end: '08:00', period: 'peak' }],
    }) })
  })
  it('shows an overlap before saving, and does not save', async () => {
    const user = userEvent.setup()
    render(<CalendarEditor licenseeId={LIC} calendar={{ id: 'cal1', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8], source: 'published', holidayTreatedAs: 'sunday',
      windows: [
        { season: 'high', dayType: 'weekday', start: '06:00', end: '09:00', period: 'peak' },
        { season: 'high', dayType: 'weekday', start: '08:00', end: '10:00', period: 'standard' },
      ] }} eskomWindows={[]} />)
    await user.click(screen.getByRole('button', { name: 'Save calendar' }))
    expect(screen.getByText('High season weekday: 06:00-09:00 overlaps 08:00-10:00')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run src/components/tariffs/TouCalendarDiagram.test.tsx "src/app/(admin)/admin/tariffs/calendars"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `TouCalendarDiagram.tsx`**

```tsx
/** TOU calendar diagram (spec §5, §12): weekday/Saturday/Sunday x high/low season, 48 half-hours each. */
import { TOU_LABELS, minutesLabel, windowGrid, type TouCalendar, type TouPeriod } from '@esite/shared'

const COLOUR: Record<TouPeriod, string> = { peak: 'var(--c-red)', standard: 'var(--c-amber)', off_peak: 'var(--c-green)' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SEASON = { high: 'High season', low: 'Low season' } as const

export function TouCalendarDiagram({ calendar }: { calendar: TouCalendar }) {
  const grid = windowGrid(calendar)
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} colSpan={2} style={{ fontWeight: 400, padding: '0 1px' }}>{String(h).padStart(2, '0')}</th>)}</tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={`${row.season}-${row.dayType}`}>
                <th style={{ textAlign: 'left', fontWeight: 400, paddingRight: 8, whiteSpace: 'nowrap' }}>{SEASON[row.season]} {row.dayType}</th>
                {row.slots.map((p, k) => (
                  <td key={k} title={`${SEASON[row.season]} ${row.dayType} ${minutesLabel(k * 30)} ${TOU_LABELS[p]}`}
                    style={{ width: 8, height: 16, background: COLOUR[p], opacity: 0.8, border: '1px solid var(--c-panel)' }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, margin: 0 }}>
        High-demand months: {calendar.highSeasonMonths.map((m) => MONTHS[m - 1]).join(', ')}.
        {calendar.holidayTreatedAs ? ` Public holidays are billed as ${calendar.holidayTreatedAs === 'sunday' ? 'Sunday' : 'Saturday'}.` : ' Public holidays follow their weekday.'}
      </p>
      <p style={{ fontSize: 12, margin: 0 }}>
        <span style={{ color: COLOUR.peak }}>■</span> Peak <span style={{ color: COLOUR.standard }}>■</span> Standard <span style={{ color: COLOUR.off_peak }}>■</span> Off-peak
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Implement `CalendarEditor.tsx`**

```tsx
'use client'
/** Edit one TOU calendar (spec §12): seasons, windows per season/day type, holiday treatment. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { saveTouCalendarAction } from '@/actions/tariff-calendar.actions'
import { validateCalendarForm, type CalendarForm, type CalendarWindowForm } from '@/lib/tariffs/calendar-form'

export interface EditableCalendar {
  id: string
  validFrom: string
  validTo: string
  highSeasonMonths: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | ''
  windows: CalendarWindowForm[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NEW_WINDOW: CalendarWindowForm = { season: 'high', dayType: 'weekday', start: '06:00', end: '08:00', period: 'peak' }

export function CalendarEditor({ licenseeId, calendar, eskomWindows }: {
  licenseeId: string; calendar: EditableCalendar | null; eskomWindows: CalendarWindowForm[]
}) {
  const router = useRouter()
  const [f, setF] = useState<CalendarForm>({
    licenseeId, validFrom: calendar?.validFrom ?? '', validTo: calendar?.validTo ?? '',
    highSeasonMonths: calendar?.highSeasonMonths ?? [6, 7, 8], source: calendar?.source ?? 'published',
    holidayTreatedAs: calendar?.holidayTreatedAs ?? 'sunday', windows: calendar?.windows ?? [],
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const setWindow = (i: number, patch: Partial<CalendarWindowForm>) =>
    setF({ ...f, windows: f.windows.map((w, k) => (k === i ? { ...w, ...patch } : w)) })

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label>Valid from <input aria-label="Valid from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></label>
        <label>Valid to (optional) <input aria-label="Valid to" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></label>
        <label>Hours come from <select aria-label="Hours come from" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as CalendarForm['source'] })}>
          <option value="published">Published by the licensee</option><option value="assumed_eskom">Assumed equal to Eskom (municipal)</option>
        </select></label>
        <label>Public holidays billed as <select value={f.holidayTreatedAs} onChange={(e) => setF({ ...f, holidayTreatedAs: e.target.value as CalendarForm['holidayTreatedAs'] })}>
          <option value="sunday">Sunday</option><option value="saturday">Saturday</option><option value="">Their weekday</option>
        </select></label>
      </div>
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend>High-demand months</legend>
        {MONTHS.map((m, k) => (
          <label key={m} style={{ marginRight: 8 }}>
            <input type="checkbox" checked={f.highSeasonMonths.includes(k + 1)} onChange={(e) => setF({
              ...f, highSeasonMonths: e.target.checked ? [...f.highSeasonMonths, k + 1] : f.highSeasonMonths.filter((x) => x !== k + 1),
            })} /> {m}
          </label>
        ))}
        {errors.highSeasonMonths && <span role="alert"> {errors.highSeasonMonths}</span>}
      </fieldset>
      <div>
        <strong>Windows</strong> <span style={{ color: 'var(--c-text-dim)' }}>(minutes not covered are off-peak)</span>
        {f.windows.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <select value={w.season} onChange={(e) => setWindow(i, { season: e.target.value as CalendarWindowForm['season'] })}><option value="high">High</option><option value="low">Low</option></select>
            <select value={w.dayType} onChange={(e) => setWindow(i, { dayType: e.target.value as CalendarWindowForm['dayType'] })}><option value="weekday">Weekday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option></select>
            <input aria-label={`Window ${i + 1} start`} value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} style={{ width: 60 }} />
            <span>to</span>
            <input aria-label={`Window ${i + 1} end`} value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} style={{ width: 60 }} />
            <select value={w.period} onChange={(e) => setWindow(i, { period: e.target.value as CalendarWindowForm['period'] })}><option value="peak">Peak</option><option value="standard">Standard</option><option value="off_peak">Off-peak</option></select>
            <button type="button" aria-label={`Remove window ${i + 1}`} onClick={() => setF({ ...f, windows: f.windows.filter((_, k) => k !== i) })}>×</button>
            {errors[`windows.${i}`] && <span role="alert">{errors[`windows.${i}`]}</span>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Button variant="secondary" size="sm" onClick={() => setF({ ...f, windows: [...f.windows, { ...NEW_WINDOW }] })}>Add window</Button>
          {eskomWindows.length > 0 && <Button variant="secondary" size="sm" onClick={() => setF({ ...f, windows: eskomWindows.map((w) => ({ ...w })), source: 'assumed_eskom' })}>Copy Eskom hours</Button>}
        </div>
        {errors.windows && <p role="alert" style={{ color: 'var(--c-red)' }}>{errors.windows}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={async () => {
          setMsg(null)
          const check = validateCalendarForm(f)
          if ('errors' in check) return setErrors(check.errors)
          setErrors({}); setBusy(true)
          const r = await saveTouCalendarAction({ calendarId: calendar?.id ?? null, form: f })
          setBusy(false)
          if ('fieldErrors' in r) setErrors(r.fieldErrors)
          else if ('error' in r) setMsg(r.error)
          else { setMsg('Saved.'); router.refresh() }
        }}>Save calendar</Button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Implement the calendars page**

`calendars/page.tsx`:
```tsx
import Link from 'next/link'
import { calendarFromRows, minutesLabel } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { TouCalendarDiagram } from '@/components/tariffs/TouCalendarDiagram'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { CalendarEditor, type EditableCalendar } from './CalendarEditor'
import type { CalendarWindowForm } from '@/lib/tariffs/calendar-form'

export const dynamic = 'force-dynamic'
type Row = Record<string, unknown>

function toWindows(rows: Row[]): CalendarWindowForm[] {
  return rows.map((w) => ({
    season: w.season as CalendarWindowForm['season'], dayType: w.day_type as CalendarWindowForm['dayType'],
    start: minutesLabel(Number(w.start_minute)), end: minutesLabel(Number(w.end_minute)), period: w.period as CalendarWindowForm['period'],
  }))
}

export default async function CalendarsPage({ searchParams }: { searchParams: Promise<{ licensee?: string; year?: string }> }) {
  const { supabase } = await requirePlatformTariffAdminPage()
  const sp = await searchParams
  const t = supabase.schema('tariffs')
  const { data: lics } = await t.from('licensee').select('id, name, kind').order('name')
  const licensees = (lics ?? []) as Array<{ id: string; name: string; kind: string }>
  const eskom = licensees.find((l) => l.kind === 'eskom')
  const selected = licensees.find((l) => l.id === sp.licensee) ?? eskom ?? licensees[0]
  const year = Number(sp.year) || new Date().getUTCFullYear()
  if (!selected) return <Card><CardBody><p style={{ fontSize: 13 }}>Add a licensee first.</p></CardBody></Card>

  const calQuery = (licenseeId: string) => t.from('tou_calendar')
    .select('id, valid_from, valid_to, high_season_months, source, tou_window(season, day_type, start_minute, end_minute, period), holiday_rule(treated_as)')
    .eq('licensee_id', licenseeId).order('valid_from', { ascending: false })
  const [{ data: cals }, eskomCals, { data: hols }] = await Promise.all([
    calQuery(selected.id),
    eskom && eskom.id !== selected.id ? calQuery(eskom.id) : Promise.resolve({ data: [] as Row[] }),
    supabase.schema('projects').from('public_holidays').select('d, name').gte('d', `${year}-01-01`).lte('d', `${year}-12-31`).order('d'),
  ])
  const calendars = (cals ?? []) as Row[]
  const eskomWindows = toWindows(((((eskomCals.data ?? []) as Row[])[0]?.tou_window ?? []) as Row[]))
  const holidays = (hols ?? []) as Array<{ d: string; name: string }>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">TOU calendars</span></CardHeader>
        <CardBody>
          <form style={{ display: 'flex', gap: 8, fontSize: 13 }}>
            <select name="licensee" defaultValue={selected.id}>{licensees.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <button type="submit">Show</button>
          </form>
        </CardBody>
      </Card>
      {calendars.map((c) => {
        const holidayRule = (c.holiday_rule as { treated_as: 'saturday' | 'sunday' } | null)
        const editable: EditableCalendar = {
          id: String(c.id), validFrom: String(c.valid_from), validTo: (c.valid_to as string | null) ?? '',
          highSeasonMonths: (c.high_season_months as number[]) ?? [], source: c.source as EditableCalendar['source'],
          holidayTreatedAs: holidayRule?.treated_as ?? '', windows: toWindows((c.tou_window ?? []) as Row[]),
        }
        const cal = calendarFromRows(
          { id: editable.id, licenseeId: selected.id, validFrom: editable.validFrom, validTo: editable.validTo || null,
            highSeasonMonths: editable.highSeasonMonths, source: editable.source, holidayTreatedAs: holidayRule?.treated_as ?? null },
          ((c.tou_window ?? []) as Row[]).map((w) => ({ season: w.season as 'high' | 'low', dayType: w.day_type as 'weekday' | 'saturday' | 'sunday', startMinute: Number(w.start_minute), endMinute: Number(w.end_minute), period: w.period as 'peak' | 'standard' | 'off_peak' })),
        )
        return (
          <Card key={editable.id}>
            <CardHeader><span className="data-panel-title">{selected.name}: from {editable.validFrom}{editable.validTo ? ` to ${editable.validTo}` : ''} ({editable.source === 'assumed_eskom' ? 'hours assumed equal to Eskom' : 'published hours'})</span></CardHeader>
            <CardBody><div style={{ display: 'grid', gap: 12 }}><TouCalendarDiagram calendar={cal} /><CalendarEditor licenseeId={selected.id} calendar={editable} eskomWindows={eskomWindows} /></div></CardBody>
          </Card>
        )
      })}
      <Card>
        <CardHeader><span className="data-panel-title">New calendar for {selected.name}</span></CardHeader>
        <CardBody><CalendarEditor licenseeId={selected.id} calendar={null} eskomWindows={selected.kind === 'eskom' ? [] : eskomWindows} /></CardBody>
      </Card>
      <Card>
        <CardHeader>
          <span className="data-panel-title">Public holidays {year}</span>
          <span style={{ fontSize: 13 }}><Link href={`/admin/tariffs/calendars?licensee=${selected.id}&year=${year - 1}`}>{year - 1}</Link> · <Link href={`/admin/tariffs/calendars?licensee=${selected.id}&year=${year + 1}`}>{year + 1}</Link></span>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 12, marginTop: 0 }}>From the platform holiday table (read-only). Each calendar says whether a holiday bills as Saturday or Sunday.</p>
          {holidays.length === 0 ? <p style={{ fontSize: 13 }}>No holidays seeded for {year}.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{holidays.map((h) => <li key={h.d}>{h.d} {h.name}</li>)}</ul>}
        </CardBody>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Implement the error reports page**

`reports/page.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { ErrorReportList, type ErrorReportRow } from './ErrorReportList'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export default async function ReportsPage() {
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data } = await supabase.schema('tariffs').from('error_report')
    .select('id, note, status, resolution_note, created_at, resolved_at, project_id, tariff:tariff_id(id, name, tariff_year:tariff_year_id(financial_year, licensee:licensee_id(name)))')
    .order('created_at', { ascending: false }).limit(200)
  const rows = (data ?? []) as Row[]
  // Project names: the admin is not a member of these projects, so RLS hides
  // them; read the NAME only, with the service client, after the gate.
  const ids = [...new Set(rows.map((r) => String(r.project_id)))]
  const names = new Map<string, string>()
  if (ids.length) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: ps } = await svc.schema('projects').from('projects').select('id, name').in('id', ids)
    for (const p of (ps ?? []) as Array<{ id: string; name: string }>) names.set(p.id, p.name)
  }
  const list: ErrorReportRow[] = rows.map((r) => {
    const t = r.tariff as { name: string; tariff_year: { financial_year: string; licensee: { name: string } | null } | null } | null
    return {
      id: String(r.id), note: String(r.note), status: String(r.status), resolutionNote: (r.resolution_note as string | null) ?? '',
      createdAt: String(r.created_at), project: names.get(String(r.project_id)) ?? 'Unknown project',
      tariff: t ? `${t.tariff_year?.licensee?.name ?? ''} ${t.tariff_year?.financial_year ?? ''} · ${t.name}` : 'Unknown tariff',
    }
  })
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Reported tariff errors</span></CardHeader>
      <CardBody>{list.length === 0 ? <p style={{ fontSize: 13 }}>No reports. Users report errors from a project's Tariff tab.</p> : <ErrorReportList rows={list} />}</CardBody>
    </Card>
  )
}
```

`reports/ErrorReportList.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatSolarDate } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { resolveErrorReportAction } from '@/actions/tariff-library.actions'

export interface ErrorReportRow {
  id: string
  note: string
  status: string
  resolutionNote: string
  createdAt: string
  project: string
  tariff: string
}

export function ErrorReportList({ rows }: { rows: ErrorReportRow[] }) {
  return <div style={{ display: 'grid', gap: 12 }}>{rows.map((r) => <ReportRow key={r.id} row={r} />)}</div>
}

function ReportRow({ row }: { row: ErrorReportRow }) {
  const router = useRouter()
  const [note, setNote] = useState(row.resolutionNote)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = async (status: 'open' | 'resolved' | 'rejected') => {
    setBusy(true); setError(null)
    const r = await resolveErrorReportAction({ id: row.id, status, resolutionNote: note })
    setBusy(false)
    if ('error' in r) setError(r.error); else router.refresh()
  }
  return (
    <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8, fontSize: 13 }}>
      <div><strong>{row.tariff}</strong> · {row.project} · {formatSolarDate(row.createdAt)} · <em>{row.status}</em></div>
      <p style={{ margin: '4px 0' }}>{row.note}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input aria-label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" style={{ minWidth: 260 }} />
        {row.status !== 'resolved' && <Button size="sm" isLoading={busy} onClick={() => set('resolved')}>Mark resolved</Button>}
        {row.status !== 'rejected' && <Button size="sm" variant="secondary" isLoading={busy} onClick={() => set('rejected')}>Reject</Button>}
        {row.status !== 'open' && <Button size="sm" variant="ghost" isLoading={busy} onClick={() => set('open')}>Reopen</Button>}
      </div>
      {error && <p role="alert" style={{ color: 'var(--c-red)' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 7: The sidebar link (platform admins only)**

In `apps/web/src/app/(admin)/layout.tsx`, extend the existing `Promise.all` destructuring with one entry and pass one prop:
```tsx
  const [inspectionsUnlocked, jbccUnlocked, mvUnlocked, orgsResult, , tariffAdminRes] = await Promise.all([
    primaryOrgId ? hasFeature(primaryOrgId, 'inspections', supabase) : Promise.resolve(false),
    primaryOrgId ? hasFeature(primaryOrgId, 'jbcc', supabase) : Promise.resolve(false),
    hasMvAccess(user.id, supabase),
    listMyOrganisations(),
    touchPresence('web'),
    // Platform tariff admins (00210 allow-list) see the Tariff library link. The pages gate themselves.
    // Cast: the generated Database types predate 00210 (same as the Solar pages' AnyClient casts).
    (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc('is_platform_tariff_admin'),
  ])
  const tariffAdmin = !tariffAdminRes.error && tariffAdminRes.data === true
```
and `<Sidebar … role={primaryRole} tariffAdmin={tariffAdmin} />`.

⚠ The existing array has four awaited values plus `touchPresence('web')` as the fifth element (unnamed in the destructuring). Read the file first; if the base's destructuring differs, keep its names and append `tariffAdminRes` as the last element.

In `apps/web/src/components/layout/Sidebar.tsx` (four edits):

1. `interface SidebarContentProps` gains `tariffAdmin: boolean`; `function SidebarContent({ …, role, tariffAdmin }: SidebarContentProps)`.
2. In the footer, directly after the `footerItems.map(…)` block and before the sign-out `<form>`:
```tsx
        {tariffAdmin && (
          <Link
            href="/admin/tariffs"
            className={`sidebar-nav-item${pathname.startsWith('/admin/tariffs') ? ' active' : ''}`}
          >
            <BookOpen {...IC} />
            Tariff library
          </Link>
        )}
```
(`BookOpen` is already imported from `lucide-react` in that file.)
3. `interface SidebarProps` gains:
```tsx
  /** Platform tariff admins (00210 allow-list) see the Tariff library link. The pages gate themselves. */
  tariffAdmin?: boolean
```
4. `export function Sidebar({ …, role = null, tariffAdmin = false }: SidebarProps = {})` and pass `tariffAdmin={tariffAdmin}` to `<SidebarContent … />`.

Add to `apps/web/src/components/layout/Sidebar.test.tsx` (create the file if the base has none):
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }))
vi.mock('./SolarNavItem', () => ({ SolarNavItem: () => null }))
import { Sidebar } from './Sidebar'

describe('Sidebar — Tariff library link', () => {
  it('only platform tariff admins see it', () => {
    const { unmount } = render(<Sidebar role="owner" />)
    expect(screen.queryByRole('link', { name: 'Tariff library' })).toBeNull()
    unmount()
    render(<Sidebar role="contractor" tariffAdmin />)
    expect(screen.getByRole('link', { name: 'Tariff library' }).getAttribute('href')).toBe('/admin/tariffs')
  })
})
```
(If `Sidebar.test.tsx` already exists with its own `next/navigation` mock, add only the `it(...)` block inside a new `describe`, reusing that mock.)

- [ ] **Step 8: Run the tests — expect PASS**

```bash
pnpm --filter web exec vitest run src/components/tariffs "src/app/(admin)/admin/tariffs" src/components/layout
```
Expected: PASS (diagram 1, CalendarEditor 2, Sidebar link 1, plus the existing SolarNavItem tests unchanged).

- [ ] **Step 9: Commit**

```bash
git add "apps/web/src/app/(admin)/admin/tariffs/calendars" "apps/web/src/app/(admin)/admin/tariffs/reports" \
        apps/web/src/components/tariffs/TouCalendarDiagram.tsx apps/web/src/components/tariffs/TouCalendarDiagram.test.tsx \
        "apps/web/src/app/(admin)/layout.tsx" apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Sidebar.test.tsx
git commit -m "feat(tariff-admin): TOU calendars and holidays, error reports, sidebar link for platform tariff admins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
