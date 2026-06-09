import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────
// vi.hoisted so the fns exist before the hoisted vi.mock factories reference
// them (the SUT imports next/cache at module load → TDZ trap otherwise).
const {
  createClientMock,
  createServiceClientMock,
  requireEffectiveRoleMock,
  getCurrentMock,
  getTreeMock,
  persistImportMock,
  updateItemRateMock,
  flattenForPersistMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  getCurrentMock: vi.fn(),
  getTreeMock: vi.fn(),
  persistImportMock: vi.fn(),
  updateItemRateMock: vi.fn(),
  flattenForPersistMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: requireEffectiveRoleMock }))
vi.mock('@esite/shared', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  boqService: {
    getCurrent: getCurrentMock,
    getTree: getTreeMock,
    persistImport: persistImportMock,
    updateItemRate: updateItemRateMock,
  },
  computeRollups: () => new Map(),
}))
vi.mock('@/lib/boq/flatten-for-persist', () => ({ flattenForPersist: flattenForPersistMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

import {
  listBoqAction,
  importBoqAction,
  updateBoqItemRateAction,
  deleteBoqImportAction,
} from './boq.actions'

// ─── Chainable + awaitable query-builder stub ───────────────────────────────
// Returns a Promise (so `await qb(r)` === r) that also exposes the supabase
// chain methods. Terminal single/maybeSingle resolve to the result directly.
function qb(result: any): any {
  const p: any = Promise.resolve(result)
  for (const m of ['schema', 'from', 'select', 'eq', 'in', 'order', 'update', 'insert', 'delete']) {
    p[m] = () => qb(result)
  }
  p.single = () => Promise.resolve(result)
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

// ─── updateBoqItemRateAction — cross-project guard ──────────────────────────

describe('updateBoqItemRateAction — cross-project guard', () => {
  it('REJECTS a rate edit when the item belongs to another project, without writing', async () => {
    createClientMock.mockResolvedValue({}) // gate is mocked; client unused here
    // SERVICE client resolves the item to project 'OTHER'.
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () =>
            qb({
              data: { id: 'item-1', boq_sections: { import_id: 'imp', boq_imports: { project_id: 'OTHER' } } },
              error: null,
            }),
        }),
      }),
    })

    const res = await updateBoqItemRateAction('THIS', 'item-1', { supplyRate: 10 })

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toBe('Not found')
    expect(updateItemRateMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('REJECTS when the item id resolves to nothing, without writing', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: null, error: null }) }) }),
    })

    const res = await updateBoqItemRateAction('THIS', 'ghost', { supplyRate: 10 })

    expect('error' in res && res.error).toBe('Not found')
    expect(updateItemRateMock).not.toHaveBeenCalled()
  })

  it('updates when the item belongs to this project', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () =>
            qb({
              data: { id: 'item-1', boq_sections: { import_id: 'imp', boq_imports: { project_id: 'THIS' } } },
              error: null,
            }),
        }),
      }),
    })
    updateItemRateMock.mockResolvedValue({ id: 'item-1', amount: 150 })

    const res = await updateBoqItemRateAction('THIS', 'item-1', { supplyRate: 10 })

    expect('data' in res).toBe(true)
    if ('data' in res) expect(res.data.item).toMatchObject({ id: 'item-1', amount: 150 })
    expect(updateItemRateMock).toHaveBeenCalledWith(expect.anything(), 'item-1', { supplyRate: 10 })
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('rejects an invalid (empty) patch before any guard query', async () => {
    createClientMock.mockResolvedValue({})

    const res = await updateBoqItemRateAction('THIS', 'item-1', {} as never)

    expect('error' in res).toBe(true)
    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(updateItemRateMock).not.toHaveBeenCalled()
  })

  it('returns the gate error when the role gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await updateBoqItemRateAction('THIS', 'item-1', { supplyRate: 10 })

    expect('error' in res && res.error).toBe('No access to this project')
    expect(createServiceClientMock).not.toHaveBeenCalled()
    expect(updateItemRateMock).not.toHaveBeenCalled()
  })
})

// ─── listBoqAction ──────────────────────────────────────────────────────────

describe('listBoqAction', () => {
  it('returns an empty-state payload when no current import exists', async () => {
    createClientMock.mockResolvedValue({})
    getCurrentMock.mockResolvedValue(null)

    const res = await listBoqAction('p-1')

    expect('data' in res).toBe(true)
    if ('data' in res) {
      expect(res.data.import).toBeNull()
      expect(res.data.sections).toEqual([])
      expect(res.data.items).toEqual([])
    }
    expect(getTreeMock).not.toHaveBeenCalled()
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('resolves the importer name via the SERVICE client', async () => {
    createClientMock.mockResolvedValue({})
    getCurrentMock.mockResolvedValue({ id: 'imp1', importedBy: 'u-1' })
    getTreeMock.mockResolvedValue({ sections: [], items: [] })
    createServiceClientMock.mockReturnValue({
      from: () => ({
        select: () => qb({ data: { full_name: 'Alice Smith', email: 'a@x.com' }, error: null }),
      }),
    })

    const res = await listBoqAction('p-1')

    expect('data' in res && res.data.importedByName).toBe('Alice Smith')
    expect(createServiceClientMock).toHaveBeenCalled()
  })

  it('returns the gate error when the gate fails', async () => {
    createClientMock.mockResolvedValue({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'No access to this project' })

    const res = await listBoqAction('p-1')

    expect('error' in res && res.error).toBe('No access to this project')
    expect(getCurrentMock).not.toHaveBeenCalled()
  })
})

// ─── importBoqAction ────────────────────────────────────────────────────────

describe('importBoqAction', () => {
  const fakeParsed: any = { bills: [], skippedSheets: [], totalExVatExpected: 1, vatExpected: 0, totalInclVatExpected: 1 }

  it('flattens then persists via the service client behind the gate', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: { organisation_id: 'org-1' }, error: null }) }) }),
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    })
    flattenForPersistMock.mockReturnValue({ totals: { exVat: 1, vat: 0, inclVat: 1 }, sections: [], items: [] })
    persistImportMock.mockResolvedValue({ id: 'imp-new' })
    createServiceClientMock.mockReturnValue({})

    const res = await importBoqAction('p-1', fakeParsed, 'boq.xlsx', null)

    expect('data' in res && res.data.import).toMatchObject({ id: 'imp-new' })
    expect(flattenForPersistMock).toHaveBeenCalledWith(fakeParsed)
    expect(persistImportMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ projectId: 'p-1', organisationId: 'org-1', sourceFilename: 'boq.xlsx', importedBy: 'u-1' }),
    )
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('returns Project not found when the project org cannot be resolved', async () => {
    createClientMock.mockResolvedValue({
      schema: () => ({ from: () => ({ select: () => qb({ data: null, error: null }) }) }),
    })

    const res = await importBoqAction('p-x', fakeParsed, 'boq.xlsx', null)

    expect('error' in res && res.error).toBe('Project not found')
    expect(persistImportMock).not.toHaveBeenCalled()
  })
})

// ─── deleteBoqImportAction ──────────────────────────────────────────────────

describe('deleteBoqImportAction', () => {
  it('refuses to delete the current import', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () => qb({ data: { id: 'imp-1', project_id: 'p-1', is_current: true }, error: null }),
        }),
      }),
    })

    const res = await deleteBoqImportAction('p-1', 'imp-1')

    expect('error' in res).toBe(true)
    if ('error' in res) expect(res.error).toMatch(/current BOQ import/)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('refuses an import belonging to another project', async () => {
    createClientMock.mockResolvedValue({})
    createServiceClientMock.mockReturnValue({
      schema: () => ({
        from: () => ({
          select: () => qb({ data: { id: 'imp-1', project_id: 'OTHER', is_current: false }, error: null }),
        }),
      }),
    })

    const res = await deleteBoqImportAction('p-1', 'imp-1')

    expect('error' in res && res.error).toBe('Not found')
  })
})
