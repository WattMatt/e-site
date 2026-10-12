// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { fakeClient, queued, type FakeCall, type FakeResponse, type FakeStorageCall } from '@/lib/status-plans/__fixtures__/fake-client'

/**
 * What a mocked test CAN see and must pin:
 *  - the gate is consulted with ORG_WRITE_ROLES on the plan's own project, and
 *    a refusal signs nothing and writes nothing;
 *  - paths are built by the server, under the plan's folder, and registration
 *    refuses any other path;
 *  - page counts come from the uploaded bytes, never from the client;
 *  - edits to an existing sheet are conditional on updated_at in the same
 *    statement, and zero rows back is a conflict;
 *  - organisation_id, created_by, revision and replaced_* are never sent.
 * The role helper is mocked with the OBJECT it really returns.
 */
const { createClientMock, requireEffectiveRoleMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))

import {
  prepareTenantPlanUploadAction,
  registerTenantPlanSheetsAction,
  prepareTenantPlanSheetReplaceAction,
  replaceTenantPlanSheetAction,
  reanchorTenantPlanSheetAction,
  renameTenantPlanSheetAction,
  deleteTenantPlanSheetAction,
  calibrateTenantPlanSheetAction,
} from './tenant-plan-sheets.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const PL = '33333333-3333-4333-8333-333333333333'
const SH = '44444444-4444-4444-8444-444444444444'
const O = '66666666-6666-4666-8666-666666666666'
const F1 = '77777777-7777-4777-8777-777777777777'
const F2 = '88888888-8888-4888-8888-888888888888'
const OTHER = '99999999-9999-4999-8999-999999999999'
const TS = '2026-10-12T09:00:00.000001+00:00'
const TS2 = '2026-10-12T09:05:00.000001+00:00'
const PLAN = { id: PL, project_id: P, organisation_id: O, purpose: 'tenant_layout' }
const path = (folder: string, rev = 1, ext = 'pdf') => `${O}/${P}/${PL}/${folder}/${rev}.${ext}`

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([200, 100])
  return d.save()
}

function sheetRow(over: Record<string, unknown> = {}) {
  return {
    id: SH, status_plan_id: PL, organisation_id: O, sort_order: 0, label: 'E-100', file_path: path(SH), page_index: 1,
    file_name: 'E-100.pdf', mime: 'application/pdf', revision: 1, replaced_at: null, replaced_from_path: null,
    pixels_per_meter: null, calibration_points: null, calibration_metres: null, created_by: 'u', created_at: TS, updated_at: TS,
    ...over,
  }
}

/** Inserts into status_plan_sheets answer with the rows they were given, as the database would. */
const echoSheetInsert = (c: FakeCall): FakeResponse => ({
  data: (c.payload as Array<Record<string, unknown>>).map((r) => sheetRow({ ...r, created_at: TS, updated_at: TS })),
})

let calls: FakeCall[]
let storageCalls: FakeStorageCall[]
function setup(
  map: Record<string, FakeResponse[]>,
  opts: { files?: Record<string, Uint8Array>; userId?: string | null; echoInsert?: boolean; storageErrors?: Partial<Record<FakeStorageCall['op'], string>> } = {},
) {
  const q = queued(map)
  const respond = (c: FakeCall) => (opts.echoInsert && c.table === 'tenants.status_plan_sheets' && c.op === 'insert' ? echoSheetInsert(c) : q(c))
  const f = fakeClient(respond, { files: opts.files, userId: opts.userId, storageErrors: opts.storageErrors })
  calls = f.calls
  storageCalls = f.storageCalls
  createClientMock.mockResolvedValue(f.client)
}
const writes = () => calls.filter((c) => c.op !== 'select')
const ops = (op: FakeStorageCall['op']) => storageCalls.filter((c) => c.op === op)

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

describe('prepareTenantPlanUploadAction', () => {
  const files = [
    { name: 'E-100.pdf', size: 1000, type: 'application/pdf' },
    { name: 'E-101.PNG', size: 10, type: '' },
  ]

  it('creates the plan on first upload and signs one path per file under its folder', async () => {
    setup({ 'tenants.status_plans:select': [{ data: null }], 'tenants.status_plans:insert': [{ data: PLAN }] })
    const res = await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(writes()[0]!.payload).toEqual({ project_id: P, purpose: 'tenant_layout', name: 'Floor plan' })
    expect(res.data.planId).toBe(PL)
    expect(res.data.uploads.map((u) => u.mime)).toEqual(['application/pdf', 'image/png'])
    res.data.uploads.forEach((u, i) => {
      expect(u.path).toMatch(new RegExp(`^${O}/${P}/${PL}/[0-9a-f-]{36}/1\\.${i === 0 ? 'pdf' : 'png'}$`))
      expect(u.token).toBe(`tok:${u.path}`)
    })
    expect(ops('createSignedUploadUrl').map((c) => [c.bucket, c.args[1]])).toEqual([
      ['tenant-plan-files', { upsert: false }],
      ['tenant-plan-files', { upsert: false }],
    ])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
  })

  it('reuses the plan that already exists', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }] })
    expect((await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files })).ok).toBe(true)
    expect(writes()).toEqual([])
  })

  it('a plan created by someone else a moment ago is picked up, not reported', async () => {
    setup({
      'tenants.status_plans:select': [{ data: null }, { data: PLAN }],
      'tenants.status_plans:insert': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plans_project_purpose_key"' } }],
    })
    expect((await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files })).ok).toBe(true)
  })

  it('refuses a non-writer before anything is created or signed', async () => {
    setup({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files }))
      .toEqual({ ok: false, error: expect.stringMatching(/owner, admin or project manager/) })
    expect(writes()).toEqual([])
    expect(storageCalls).toEqual([])
  })

  it('names a file it cannot take, before any database call', async () => {
    setup({})
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files: [{ name: 'E-100.dwg', size: 10, type: '' }] }))
      .toEqual({ ok: false, error: 'E-100.dwg is not a PDF, PNG or JPEG.' })
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files: [{ name: 'big.pdf', size: 61 * 1024 * 1024, type: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'big.pdf is larger than 60 MB.' })
    expect(calls).toEqual([])
  })

  it('a storage refusal is a sentence, not a stack', async () => {
    const f = fakeClient(queued({ 'tenants.status_plans:select': [{ data: PLAN }] }), { storageErrors: { createSignedUploadUrl: 'new row violates row-level security policy' } })
    createClientMock.mockResolvedValue(f.client)
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files }))
      .toEqual({ ok: false, error: 'Could not prepare the upload. Try again.' })
  })
})

describe('registerTenantPlanSheetsAction', () => {
  it('a 3-page PDF becomes three sheets and an image one more, appended after the existing sheets', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:select': [{ data: [{ id: 'old', sort_order: 4 }] }],
    }, { files: { [path(F1)]: await pdf(3), [path(F2, 1, 'png')]: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, echoInsert: true })

    const res = await registerTenantPlanSheetsAction({
      planId: PL,
      files: [
        { path: path(F1), fileName: 'E-300.pdf', mime: 'application/pdf' },
        { path: path(F2, 1, 'png'), fileName: 'Mall GF.png', mime: 'image/png' },
      ],
    })
    expect(res.ok).toBe(true)
    const rows = writes()[0]!.payload as Array<Record<string, unknown>>
    expect(rows.map((r) => [r.sort_order, r.label, r.page_index, r.file_path, r.mime])).toEqual([
      [5, 'Sheet 1 of 3 (E-300)', 1, path(F1), 'application/pdf'],
      [6, 'Sheet 2 of 3 (E-300)', 2, path(F1), 'application/pdf'],
      [7, 'Sheet 3 of 3 (E-300)', 3, path(F1), 'application/pdf'],
      [8, 'Mall GF', 1, path(F2, 1, 'png'), 'image/png'],
    ])
    expect(rows[0]!.id).toBe(F1) // the first sheet of a file is the file's folder
    expect(rows[3]!.id).toBe(F2)
    for (const r of rows) {
      expect(r.status_plan_id).toBe(PL)
      for (const k of ['organisation_id', 'created_by', 'revision', 'replaced_at', 'replaced_from_path']) expect(r).not.toHaveProperty(k)
    }
    if (res.ok) expect(res.data.sheets.map((s) => s.sortOrder)).toEqual([5, 6, 7, 8])
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${P}/tenant-schedule`)
  })

  it('refuses a path outside this plan\'s folder, or not a first revision', async () => {
    for (const bad of [
      `${O}/${P}/${OTHER}/${F1}/1.pdf`,
      `${O}/${OTHER}/${PL}/${F1}/1.pdf`,
      `${OTHER}/${P}/${PL}/${F1}/1.pdf`,
      path(F1, 2),
      path(F1, 1, 'png'),
    ]) {
      setup({ 'tenants.status_plans:select': [{ data: PLAN }] })
      expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: bad, fileName: 'x.pdf', mime: 'application/pdf' }] }), bad)
        .toEqual({ ok: false, error: 'That upload does not belong to this plan. Upload the file again.' })
      expect(writes()).toEqual([])
    }
  })

  it('an object that never arrived, and a PDF that cannot be read, are named', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plan_sheets:select': [{ data: [] }] })
    expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'E-100.pdf', mime: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'E-100.pdf did not finish uploading. Try again.' })
    setup({ 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plan_sheets:select': [{ data: [] }] },
      { files: { [path(F1)]: new TextEncoder().encode('not a pdf') } })
    expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'E-100.pdf', mime: 'application/pdf' }] }))
      .toEqual({ ok: false, error: expect.stringMatching(/^E-100\.pdf could not be read as a PDF/) })
    expect(writes()).toEqual([])
  })

  it('refuses a non-writer', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }] })
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'no' })
    expect((await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'a.pdf', mime: 'application/pdf' }] })).ok).toBe(false)
    expect(writes()).toEqual([])
  })

  it('maps a database refusal to a sentence', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:select': [{ data: [] }],
      'tenants.status_plan_sheets:insert': [{ error: { code: '23514', message: 'status_plan_sheets: the file must be stored under this plan' } }],
    }, { files: { [path(F1)]: await pdf(1) } })
    expect(await registerTenantPlanSheetsAction({ planId: PL, files: [{ path: path(F1), fileName: 'a.pdf', mime: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'That file does not belong to this plan. Upload it again.' })
  })
})

describe('replace', () => {
  const ctx = { 'tenants.status_plan_sheets:select': [{ data: sheetRow() }], 'tenants.status_plans:select': [{ data: PLAN }] }

  it('prepare clears an abandoned object at the next revision and signs that path', async () => {
    setup(ctx)
    const res = await prepareTenantPlanSheetReplaceAction({ sheetId: SH, file: { name: 'E-100 rev C.jpg', size: 10, type: 'image/jpeg' } })
    expect(res).toEqual({ ok: true, data: { path: path(SH, 2, 'jpg'), token: `tok:${path(SH, 2, 'jpg')}`, mime: 'image/jpeg' } })
    expect(ops('remove')[0]!.args[0]).toEqual([path(SH, 2, 'jpg')])
  })

  it('swaps the file conditionally on updated_at and returns the bumped sheet', async () => {
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ file_path: path(SH, 2), page_index: 2, revision: 2, replaced_at: TS2, updated_at: TS2 }) }] },
      { files: { [path(SH, 2)]: await pdf(2) } })
    const res = await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 2), fileName: 'E-100 rev C.pdf', mime: 'application/pdf', pageIndex: 2 })
    expect(res).toMatchObject({ ok: true, data: { revision: 2, pageIndex: 2, replacedAt: TS2, updatedAt: TS2 } })
    const upd = calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ file_path: path(SH, 2), page_index: 2, file_name: 'E-100 rev C.pdf', mime: 'application/pdf' })
    expect(upd.ops).toContainEqual(['eq', ['id', SH]])
    expect(upd.ops).toContainEqual(['eq', ['updated_at', TS]])
  })

  it('a path for another revision means someone replaced it first', async () => {
    setup(ctx)
    expect(await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 3), fileName: 'a.pdf', mime: 'application/pdf', pageIndex: 1 }))
      .toEqual({ ok: false, error: 'This sheet was changed by someone else — reload to see it.', conflict: true })
  })

  it('a page the new file does not have is refused by name', async () => {
    setup(ctx, { files: { [path(SH, 2)]: await pdf(2) } })
    expect(await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 2), fileName: 'E-100 rev C.pdf', mime: 'application/pdf', pageIndex: 3 }))
      .toEqual({ ok: false, error: 'E-100 rev C.pdf has 2 pages; pick a page from 1 to 2.' })
    expect(writes()).toEqual([])
  })

  it('zero rows with the sheet still there is a conflict', async () => {
    setup({ 'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: { id: SH } }], 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plan_sheets:update': [{ data: null }] },
      { files: { [path(SH, 2)]: await pdf(1) } })
    expect(await replaceTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, path: path(SH, 2), fileName: 'a.pdf', mime: 'application/pdf', pageIndex: 1 }))
      .toEqual({ ok: false, error: 'This sheet was changed by someone else — reload to see it.', conflict: true })
  })
})

describe('re-anchor, rename, scale', () => {
  const ctx = { 'tenants.status_plan_sheets:select': [{ data: sheetRow({ replaced_at: TS2, revision: 2 }) }], 'tenants.status_plans:select': [{ data: PLAN }] }

  it('re-anchor clears the replaced flag, conditionally', async () => {
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ revision: 2, updated_at: TS2 }) }] })
    expect(await reanchorTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).toMatchObject({ ok: true, data: { replacedAt: null, revision: 2 } })
    const upd = calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ replaced_at: null })
    expect(upd.ops).toContainEqual(['eq', ['updated_at', TS]])
  })

  it('rename trims, refuses blank before any call', async () => {
    setup({})
    expect(await renameTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, label: '   ' })).toEqual({ ok: false, error: 'Give the sheet a name.' })
    expect(calls).toEqual([])
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ label: 'Level 1', updated_at: TS2 }) }] })
    expect(await renameTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, label: '  Level 1 ' })).toMatchObject({ ok: true, data: { label: 'Level 1' } })
    expect(writes()[0]!.payload).toEqual({ label: 'Level 1' })
  })

  it('scale writes the three columns together and returns the sheet', async () => {
    setup({ ...ctx, 'tenants.status_plan_sheets:update': [{ data: sheetRow({ pixels_per_meter: 20, calibration_points: [0, 0, 100, 0], calibration_metres: 5, updated_at: TS2 }) }] })
    expect(await calibrateTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, points: [0, 0, 100, 0], realMetres: 5 }))
      .toMatchObject({ ok: true, data: { pixelsPerMeter: 20, updatedAt: TS2 } })
    expect(writes()[0]!.payload).toEqual({ pixels_per_meter: 20, calibration_points: [0, 0, 100, 0], calibration_metres: 5 })
  })

  it('a bad distance is refused before any call', async () => {
    setup({})
    expect((await calibrateTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, points: [0, 0, 100, 0], realMetres: 0 })).ok).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('deleteTenantPlanSheetAction', () => {
  it('deletes conditionally and removes a file no other sheet uses', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: [] }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:delete': [{ data: { id: SH, file_path: path(SH), replaced_from_path: null } }],
    })
    expect(await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).toEqual({ ok: true, data: { id: SH } })
    expect(calls.find((c) => c.op === 'delete')!.ops).toContainEqual(['eq', ['updated_at', TS]])
    expect(ops('remove').map((c) => c.args[0])).toEqual([[path(SH)]])
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${P}/tenant-schedule`)
  })

  it('keeps a file another sheet still shows (page 2 of the same PDF)', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: [{ id: 'sheet-2' }] }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:delete': [{ data: { id: SH, file_path: path(SH), replaced_from_path: null } }],
    })
    expect((await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).ok).toBe(true)
    expect(ops('remove')).toEqual([])
  })

  it('removes the file BEFORE it deletes the row, and never the other sheets\' files', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow({ replaced_from_path: path(SH, 0) }) }, { data: [] }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:delete': [{ data: { id: SH } }],
    })
    expect((await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })).ok).toBe(true)
    expect(ops('remove').map((c) => c.args[0])).toEqual([[path(SH), path(SH, 0)]])
    expect(calls.filter((c) => c.op === 'select' && c.ops.some((o) => o[0] === 'neq' && (o[1] as unknown[])[1] === SH)).length).toBeGreaterThan(0)
  })

  it('a failed file removal keeps the row and says so', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: [] }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_sheets:delete': [{ data: { id: SH } }],
    }, { storageErrors: { remove: 'boom' } })
    const res = await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS })
    expect(res.ok).toBe(false)
    expect(calls.some((c) => c.op === 'delete')).toBe(false)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('a stale timestamp removes nothing and deletes nothing', async () => {
    setup({
      'tenants.status_plan_sheets:select': [{ data: sheetRow() }, { data: [] }],
      'tenants.status_plans:select': [{ data: PLAN }],
    })
    expect(await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS2 })).toMatchObject({ ok: false, conflict: true })
    expect(ops('remove')).toEqual([])
    expect(calls.some((c) => c.op === 'delete')).toBe(false)
  })

  it('a sheet already gone says so', async () => {
    setup({ 'tenants.status_plan_sheets:select': [{ data: null }] })
    expect(await deleteTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS }))
      .toEqual({ ok: false, error: 'This sheet has been deleted by someone else — reload the page.', conflict: true })
  })
})

describe('signed out', () => {
  it('every action says so', async () => {
    setup({}, { userId: null })
    expect(await renameTenantPlanSheetAction({ sheetId: SH, expectedUpdatedAt: TS, label: 'x' })).toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
    expect(await prepareTenantPlanUploadAction({ projectId: P, purpose: 'tenant_layout', files: [{ name: 'a.pdf', size: 1, type: 'application/pdf' }] }))
      .toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
  })
})
