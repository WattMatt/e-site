import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createClientMock, createServiceClientMock, requireEffectiveRoleMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: createServiceClientMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

import { ORG_WRITE_ROLES } from '@esite/shared'
import {
  createTenderAction,
  importTenderAction,
  listTendersAction,
  setRateCellTypeAction,
  deleteTenderAction,
  getTenderUploadUrlAction,
} from './tender.actions'
import { buildWmWorkbook } from '@/lib/tender/__fixtures__/workbooks'

const ORG = 'org-1'
const PROJECT = 'proj-1'
const TENDER = 'tender-1'
const PREFIX = `${ORG}/${PROJECT}/${TENDER}/`

/** A fake client that records every write and answers reads from `tables`. */
function fakeClient(opts: { status?: string; files?: Record<string, Uint8Array> } = {}) {
  const writes: { table: string; op: string; payload?: unknown }[] = []
  const storageCalls: string[] = []
  let nextId = 0
  const tables: Record<string, unknown> = {
    tenders: { id: TENDER, project_id: PROJECT, organisation_id: ORG, status: opts.status ?? 'draft' },
    projects: { organisation_id: ORG },
  }
  const builder = (table: string) => {
    let op = 'select'
    let payload: unknown
    const q: Record<string, unknown> = {}
    const result = () => {
      if (op === 'insert' && Array.isArray(payload)) {
        return { data: (payload as { sort_order?: number }[]).map((r) => ({ id: `row-${nextId++}`, sort_order: r.sort_order })), error: null }
      }
      if (op === 'insert') return { data: { id: 'new-tender' }, error: null }
      if (op === 'update' || op === 'delete') return { data: [{ id: 'x' }], error: null }
      return { data: tables[table] ?? null, error: null }
    }
    for (const m of ['select', 'eq', 'order', 'range']) q[m] = () => q
    for (const m of ['insert', 'update', 'delete']) {
      q[m] = (p?: unknown) => {
        op = m
        payload = p
        writes.push({ table, op: m, payload: p })
        return q
      }
    }
    q.single = () => Promise.resolve(result())
    q.maybeSingle = () => Promise.resolve(result())
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej)
    return q
  }
  const client = {
    schema: () => ({ from: builder }),
    from: builder,
    storage: {
      from: () => ({
        createSignedUploadUrl: (p: string) => {
          storageCalls.push(`sign:${p}`)
          return Promise.resolve({ data: { token: 'tok' }, error: null })
        },
        download: (p: string) => {
          storageCalls.push(`download:${p}`)
          const bytes = opts.files?.[p]
          return Promise.resolve(bytes ? { data: { arrayBuffer: async () => bytes.slice().buffer }, error: null } : { data: null, error: { message: 'nf' } })
        },
        list: () => Promise.resolve({ data: [], error: null }),
        remove: (p: string[]) => {
          storageCalls.push(`remove:${p.join(',')}`)
          return Promise.resolve({ data: null, error: null })
        },
      }),
    },
  }
  return { client, writes, storageCalls }
}

let fake: ReturnType<typeof fakeClient>
function use(f: ReturnType<typeof fakeClient>) {
  fake = f
  createClientMock.mockResolvedValue(f.client)
  createServiceClientMock.mockReturnValue(f.client)
}

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
  use(fakeClient())
})

const refuse = () => requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })

describe('role gate comes first', () => {
  it('list gates on ORG_WRITE_ROLES for the project', async () => {
    await listTendersAction(PROJECT)
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), PROJECT, ORG_WRITE_ROLES)
  })

  it('create writes nothing when refused', async () => {
    refuse()
    expect(await createTenderAction(PROJECT, { package: 'Electrical', title: 'Main contract' })).toEqual({ error: 'Your role (contractor) is not allowed' })
    expect(fake.writes).toEqual([])
  })

  it('import neither downloads nor writes when refused', async () => {
    refuse()
    const r = await importTenderAction(TENDER, { sourcePath: `${PREFIX}source.xlsx`, sourceFilename: 's.xlsx' })
    expect(r).toHaveProperty('error')
    expect(fake.storageCalls).toEqual([])
    expect(fake.writes).toEqual([])
  })

  it('upload URL is not minted when refused', async () => {
    refuse()
    await getTenderUploadUrlAction(TENDER, 'source', 'R9.xlsx')
    expect(fake.storageCalls).toEqual([])
  })

  it('delete removes nothing when refused', async () => {
    refuse()
    await deleteTenderAction(TENDER)
    expect(fake.writes).toEqual([])
    expect(fake.storageCalls).toEqual([])
  })
})

describe('importTenderAction', () => {
  it('refuses a path outside this tender’s folder', async () => {
    const r = await importTenderAction(TENDER, { sourcePath: `${ORG}/${PROJECT}/other-tender/source.xlsx`, sourceFilename: 's.xlsx' })
    expect(r).toEqual({ error: 'That file does not belong to this tender' })
    expect(fake.storageCalls).toEqual([])
  })

  it('refuses a path that climbs out with ..', async () => {
    const r = await importTenderAction(TENDER, { sourcePath: `${PREFIX}../x/source.xlsx`, sourceFilename: 's.xlsx' })
    expect(r).toHaveProperty('error')
    expect(fake.storageCalls).toEqual([])
  })

  it('refuses a tender that is no longer a draft', async () => {
    use(fakeClient({ status: 'issued' }))
    const r = await importTenderAction(TENDER, { sourcePath: `${PREFIX}source.xlsx`, sourceFilename: 's.xlsx' })
    expect(r).toEqual({ error: 'Only a draft tender can be re-imported' })
    expect(fake.writes).toEqual([])
  })

  it('replaces the BOQ, saves the estimate and stores a matched reconciliation', async () => {
    const source = new Uint8Array(await buildWmWorkbook())
    const estimate = new Uint8Array(await buildWmWorkbook({ priced: true }))
    use(fakeClient({ files: { [`${PREFIX}source.xlsx`]: source, [`${PREFIX}estimate.xlsx`]: estimate } }))
    const r = await importTenderAction(TENDER, {
      sourcePath: `${PREFIX}source.xlsx`,
      sourceFilename: 'SUNBIRD CENTRAL.R9.xlsx',
      estimatePath: `${PREFIX}estimate.xlsx`,
      estimateFilename: 'SUNBIRD CENTRAL.R9 - PRE-PRICED INTERNAL.xlsx',
    })
    expect(r).toEqual({ data: { items: 6, matched: true } })
    const ops = fake.writes.map((w) => `${w.op}:${w.table}`)
    expect(ops).toEqual(['delete:tender_boq_items', 'insert:tender_boq_items', 'insert:tender_estimate_lines', 'update:tenders'])
    const upd = fake.writes.find((w) => w.op === 'update')!.payload as Record<string, unknown>
    expect(upd.source_filename).toBe('SUNBIRD CENTRAL.R9.xlsx')
    expect((upd.structure_diff as { identical: boolean }).identical).toBe(true)
  })
})

describe('setRateCellTypeAction', () => {
  it('rejects an unknown type before touching anything', async () => {
    const r = await setRateCellTypeAction(TENDER, 'item-1', 'free' as never)
    expect(r).toEqual({ error: 'Unknown rate type' })
    expect(requireEffectiveRoleMock).not.toHaveBeenCalled()
  })

  it('refuses once the tender is issued', async () => {
    use(fakeClient({ status: 'issued' }))
    expect(await setRateCellTypeAction(TENDER, 'item-1', 'not_priced')).toEqual({ error: 'The BOQ of an issued tender cannot change' })
    expect(fake.writes).toEqual([])
  })

  it('clears the fixed amount when a row stops being fixed', async () => {
    await setRateCellTypeAction(TENDER, 'item-1', 'priced')
    expect(fake.writes).toEqual([{ table: 'tender_boq_items', op: 'update', payload: { rate_cell_type: 'priced', fixed_amount: null } }])
  })
})
