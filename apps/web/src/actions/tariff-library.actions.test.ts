// @vitest-environment node
// Server actions run in Node; jsdom's Blob has no arrayBuffer().
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
  const bucket = {
    createSignedUploadUrl: vi.fn(async (path: string, _o?: unknown) => ({ data: { path, token: 'tok', signedUrl: 'https://x' }, error: null })),
    download: vi.fn(async () => ({ data: new Blob([bytes]), error: null })),
    remove: vi.fn(async (paths: string[]) => { removed.push(paths); return { data: [], error: null } }),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed' }, error: null })),
  }
  const storage = { from: () => bucket }
  return { storage, removed, bucket }
}

/** The service client: storage plus table reads (who else references a storage path). */
function service(s: ReturnType<typeof storageFake>, tables: Record<string, Array<Record<string, unknown>>> = {}) {
  const f = fakeSupabase({ userId: null, tables })
  return { storage: s.storage, schema: f.client.schema }
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
    h.svc.mockReturnValue(service(s))
    expect(await createSourceUploadAction(meta)).toEqual({ ok: true, path: `2026-27/${SHA_OF_ABC}.pdf`, token: 'tok' })
    // Never upsert: an object already stored cannot be silently replaced under a registered checksum.
    expect(s.bucket.createSignedUploadUrl).toHaveBeenCalledWith(`2026-27/${SHA_OF_ABC}.pdf`, { upsert: false })
    // A leftover unregistered object at this path (an upload whose register never ran) is cleared first.
    expect(s.removed).toEqual([[`2026-27/${SHA_OF_ABC}.pdf`]])
  })

  it('upload URL: never clears an object a registered document points at', async () => {
    admin()
    const s = storageFake()
    h.svc.mockReturnValue(service(s, { 'tariffs.source_document': [{ id: 'd9', storage_path: `2026-27/${SHA_OF_ABC}.pdf` }] }))
    expect(await createSourceUploadAction(meta)).toEqual({ error: 'This file is already in the library.' })
    expect(s.removed).toEqual([])
    expect(s.bucket.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('register: recomputes the checksum server-side; a mismatch deletes the object and inserts nothing', async () => {
    const fake = admin()
    const bad = storageFake(new TextEncoder().encode('not abc'))
    h.svc.mockReturnValue(service(bad))
    expect(await registerSourceDocumentAction(meta)).toEqual({ error: 'The uploaded file does not match its checksum. Upload it again.' })
    expect(bad.removed).toEqual([[`2026-27/${SHA_OF_ABC}.pdf`]])
    expect(callsTo(fake.calls, 'tariffs.source_document', 'insert')).toHaveLength(0)
  })

  it('register: a mismatch never deletes an object that an already-registered document points at', async () => {
    admin()
    const bad = storageFake(new TextEncoder().encode('not abc'))
    h.svc.mockReturnValue(service(bad, { 'tariffs.source_document': [{ id: 'd9', storage_path: `2026-27/${SHA_OF_ABC}.pdf` }] }))
    expect(await registerSourceDocumentAction(meta)).toEqual({ error: 'The uploaded file does not match its checksum. Upload it again.' })
    expect(bad.removed).toEqual([])
  })

  it('register: inserts the document through the admin session', async () => {
    const fake = admin({ writes: { 'tariffs.source_document:insert': { data: [{ id: 'd1' }] } } })
    h.svc.mockReturnValue(service(storageFake()))
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
