import { describe, it, expect, vi, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'

const h = vi.hoisted(() => ({ cookie: null as unknown, svc: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.cookie, createServiceClient: () => h.svc }))

import {
  downloadPricingWorkbookAction,
  getPricingAction,
  getDocumentUploadUrlAction,
  importPricedWorkbookAction,
  recordDocumentAction,
  saveRatesAction,
} from './tender-submission.actions'
import { parseTenderWorkbook } from '@/lib/tender/parse-tender-workbook'
import { toItemRows } from '@/lib/tender/to-rows'
import { buildWmWorkbook } from '@/lib/tender/__fixtures__/workbooks'

const T = '11111111-1111-4111-8111-111111111111'
const SUB = 'sub-1'
const REQ = '22222222-2222-4222-8222-222222222222'
const REQ2 = '33333333-3333-4333-8333-333333333333'
const OPEN = { id: T, status: 'issued', closing_at: '2099-01-01T00:00:00Z', package: 'Electrical', title: 'Main' }

interface World { participant: boolean; items?: unknown[]; boqItems?: unknown[]; files?: Record<string, Uint8Array>; summary?: unknown }

/** A PostgREST-ish result that also accepts .order() and .range() (which pages by slicing). */
function paged(rows: unknown[] | null) {
  const b: Record<string, unknown> = {}
  let from = 0
  let to = Number.MAX_SAFE_INTEGER
  b.order = () => b
  b.range = (f: number, t: number) => { from = f; to = t; return b }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    // PostgREST's max_rows: never more than 1 000 rows, whatever the range asks for.
    Promise.resolve({ data: rows == null ? null : rows.slice(from, Math.min(to + 1, from + 1000)), error: null }).then(res, rej)
  return b
}

function world(w: World) {
  const rpcCalls: { name: string; args: unknown }[] = []
  const uploads: { path: string; bytes: Uint8Array }[] = []
  const inserts: { table: string; row: unknown }[] = []
  const table = (name: string) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.order = () => q
    q.range = () => q
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
    q.maybeSingle = () =>
      Promise.resolve({
        data:
          name === 'tender_participants' ? (w.participant ? { id: 'p1', profile_completed_at: '2026-01-01' } : null)
          : name === 'tender_submissions' ? { id: SUB }
          : null,
      })
    q.insert = (row: unknown) => {
      inserts.push({ table: name, row })
      return Object.assign(Promise.resolve({ error: null }), { select: () => ({ single: () => Promise.resolve({ data: { id: SUB }, error: null }) }) })
    }
    return q
  }
  h.cookie = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'b@co.example' } } }) },
    schema: () => ({
      from: table,
      rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args })
        if (name === 'tender_portal_summary') return Promise.resolve({ data: w.participant ? [w.summary ?? OPEN] : [] })
        if (name === 'tender_portal_items') return paged(w.items ?? [])
        if (name === 'tender_save_rates') return Promise.resolve({ data: (args as { p_rows: unknown[] }).p_rows.length, error: null })
        if (name === 'tender_lock_my_submission') return Promise.resolve({ data: SUB, error: null })
        if (name === 'tender_record_document') return Promise.resolve({ data: 'doc-1', error: null })
        if (name === 'tender_portal_requirements') return Promise.resolve({ data: [{ id: REQ, kind: 'document' }, { id: REQ2, kind: 'declaration' }] })
        return Promise.resolve({ data: null })
      },
    }),
  }
  h.svc = {
    schema: () => ({
      from: (name: string) => ({
        select: () => ({
          eq: () =>
            name === 'tender_boq_items'
              ? paged(w.boqItems ?? [])
              : { maybeSingle: () => Promise.resolve({ data: { source_path: 'o/p/t/source.xlsx', source_filename: 'R9.xlsx' } }) },
        }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (p: string) => (w.files?.[p] ? { data: { arrayBuffer: async () => w.files![p].slice().buffer } } : { data: null }),
        remove: async () => ({}),
        upload: async (path: string, bytes: Uint8Array) => {
          uploads.push({ path, bytes })
          return { error: null }
        },
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' } }),
        list: async () => ({ data: [{ metadata: { size: 1234 } }] }),
      }),
    },
  }
  return { rpcCalls, uploads, inserts }
}

beforeEach(() => vi.clearAllMocks())

describe('saveRatesAction', () => {
  it('validates before touching the database', async () => {
    const w = world({ participant: true })
    expect(await saveRatesAction(T, [{ itemId: 'a', rate: -1 }])).toEqual({ error: 'Rates must be positive numbers' })
    expect(await saveRatesAction(T, [{ itemId: 'a', rate: Number.NaN }])).toEqual({ error: 'Rates must be positive numbers' })
    expect(await saveRatesAction(T, [{ itemId: 'a', rate: 5, notPriced: true }])).toHaveProperty('error')
    expect(w.rpcCalls).toEqual([])
  })

  it('refuses a caller who is not a participant, before saving', async () => {
    const w = world({ participant: false })
    expect(await saveRatesAction(T, [{ itemId: 'a', rate: 5 }])).toEqual({ error: 'Tender not found' })
    expect(w.rpcCalls.map((c) => c.name)).toEqual(['tender_portal_summary'])
  })

  it('saves through tender_save_rates in chunks, never writing an amount', async () => {
    const w = world({ participant: true })
    const entries = Array.from({ length: 4500 }, (_, i) => ({ itemId: `i${i}`, rate: 1.23456 }))
    expect(await saveRatesAction(T, entries)).toEqual({ data: { saved: 4500 } })
    const saves = w.rpcCalls.filter((c) => c.name === 'tender_save_rates')
    expect(saves.map((c) => (c.args as { p_rows: unknown[] }).p_rows.length)).toEqual([2000, 2000, 500])
    const row = (saves[0].args as { p_rows: Record<string, unknown>[] }).p_rows[0]
    expect(row).toEqual({ item_id: 'i0', rate: 1.2346, not_priced: false })
  })
})

describe('getPricingAction', () => {
  it('shows the bidder every row of a BOQ longer than PostgREST max_rows', async () => {
    const items = Array.from({ length: 2500 }, (_, i) => ({
      id: `i${i}`, sort_order: i, sheet_name: 'B1', row_number: i + 5, kind: 'item', bill_code: '1', code: `1.${i}`,
      description: `Item ${i}`, unit: 'm', quantity: 1, rate_cell_type: 'priced', fixed_amount: null, heading_path: [],
    }))
    world({ participant: true, items })
    const r = await getPricingAction(T)
    if ('error' in r) throw new Error(r.error)
    expect(r.data.items).toHaveLength(2500)
    expect(r.data.compliance.issues.filter((x) => x.kind === 'unpriced')).toHaveLength(2500)
  })
})

describe('recordDocumentAction', () => {
  it('refuses a path outside this submission’s folder, or a requirement that is not an id', async () => {
    const w = world({ participant: true })
    expect(await recordDocumentAction(T, REQ, `${T}/other-sub/${REQ}-1-x.pdf`, 'x.pdf')).toEqual({ error: 'That upload does not belong to this submission' })
    expect(await recordDocumentAction(T, REQ, `${T}/${SUB}/${REQ2}-1-x.pdf`, 'x.pdf')).toEqual({ error: 'That upload does not belong to this submission' })
    expect(await recordDocumentAction(T, 'req-1', `${T}/${SUB}/req-1-1-x.pdf`, 'x.pdf')).toEqual({ error: 'Unknown requirement' })
    expect(w.rpcCalls.some((c) => c.name === 'tender_record_document')).toBe(false)
    expect(w.inserts).toEqual([])
  })

  it('records through tender_record_document (the database reads the size from storage), never a direct insert', async () => {
    const w = world({ participant: true })
    expect(await recordDocumentAction(T, REQ, `${T}/${SUB}/${REQ}-1-cidb.pdf`, 'cidb.pdf')).toEqual({ data: true })
    expect(w.rpcCalls.find((c) => c.name === 'tender_record_document')?.args).toEqual({
      p_tender_id: T, p_requirement_id: REQ, p_path: `${T}/${SUB}/${REQ}-1-cidb.pdf`, p_file_name: 'cidb.pdf',
    })
    expect(w.inserts).toEqual([])
  })
})

describe('getDocumentUploadUrlAction', () => {
  it('refuses a requirement that is not one of this tender’s document requirements', async () => {
    world({ participant: true })
    expect(await getDocumentUploadUrlAction(T, REQ2, 'x.pdf', 10)).toEqual({ error: 'Unknown requirement' })
    expect(await getDocumentUploadUrlAction(T, '../x', 'x.pdf', 10)).toEqual({ error: 'Unknown requirement' })
  })
})

describe('importPricedWorkbookAction', () => {
  async function storedItems() {
    return toItemRows(await parseTenderWorkbook(await buildWmWorkbook())).map((r, i) => ({ ...r, id: `id-${i}` }))
  }

  it('saves nothing when a locked cell changed', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load((await buildWmWorkbook()) as unknown as ArrayBuffer)
    wb.getWorksheet('C - Reticulation')!.eachRow((row) => { if (row.getCell(1).value === 'C1.2') row.getCell(4).value = 1 })
    const path = `${T}/${SUB}/priced-upload-1.xlsx`
    const w = world({ participant: true, items: await storedItems(), files: { [path]: new Uint8Array(await wb.xlsx.writeBuffer()) } })
    const r = await importPricedWorkbookAction(T, path)
    expect(r).toHaveProperty('data.ok', false)
    expect(r).toHaveProperty('data.saved', 0)
    expect(w.rpcCalls.some((c) => c.name === 'tender_save_rates')).toBe(false)
  })

  it('refuses a path that is not this submission’s priced upload', async () => {
    const w = world({ participant: true })
    expect(await importPricedWorkbookAction(T, `${T}/${SUB}/req-1-1-x.pdf`)).toEqual({ error: 'That upload does not belong to this submission' })
    expect(w.rpcCalls.some((c) => c.name === 'tender_save_rates')).toBe(false)
  })
})

describe('downloadPricingWorkbookAction', () => {
  it('gives the bidder a copy with no hidden sheet and none of WM’s estimate rates', async () => {
    const src = await buildWmWorkbook({ priced: true })
    const boqItems = toItemRows(await parseTenderWorkbook(src))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(src as unknown as ArrayBuffer)
    const hidden = wb.addWorksheet('WM workings')
    hidden.state = 'veryHidden'
    hidden.addRow(['secret margin', 0.18])
    const w = world({ participant: true, boqItems, files: { 'o/p/t/source.xlsx': new Uint8Array(await wb.xlsx.writeBuffer()) } })
    const r = await downloadPricingWorkbookAction(T)
    expect(r).toEqual({ data: { url: 'https://signed.example/x', fileName: 'Electrical - Main - BOQ.xlsx' } })
    const out = new ExcelJS.Workbook()
    await out.xlsx.load(w.uploads[0].bytes as unknown as ArrayBuffer)
    expect(out.worksheets.map((s) => s.name)).not.toContain('WM workings')
    expect(out.worksheets.map((s) => s.name)).toContain('C - Reticulation')
    const values: unknown[] = []
    for (const ws of out.worksheets) ws.eachRow((row) => row.eachCell((c) => values.push(c.value)))
    expect(values).not.toContain(412.5)
    expect(values).not.toContain(85000)
  })
})
