// @vitest-environment node
//
// Cloud-sync trigger actions — visibility gate + leg-looping + freshness
// short-circuit (2026-07-23 sync freshness rework, spec:
// docs/superpowers/specs/2026-07-23-floor-plan-sync-freshness.md).
//
// Regression guards:
//   1. syncProjectCloudFolderAction previously checked only auth.getUser()
//      before invoking the service-role edge function — any signed-in user
//      could sync an arbitrary project id (same class of gap as PR #135).
//      These tests assert the project-visibility gate short-circuits BEFORE
//      any edge-function fetch.
//   2. The engine budgets downloads per invocation and reports `remaining`;
//      the action must loop legs until remaining === 0 and SUM the counts —
//      the old single-shot call is exactly what made "re-click for the rest"
//      false.
//   3. autoSyncCloudFolderAction must NOT hit the provider when the folder
//      was checked within the freshness window (stale-while-revalidate), and
//      must return statuses instead of throwing (the chip needs a status).
//
// Style mirrors rfi-annotation.actions.test.ts: one fake supabase client
// serves auth.getUser + the projects read; the edge function is a stubbed
// global fetch. Only I/O is faked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  getUserMock,
  rpcMock,
  projectResult,
  flaggedResult,
  fpSingleResult,
  verSingleMock,
  fpUpdateMock,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  return {
    getUserMock: vi.fn(),
    rpcMock: vi.fn(),
    projectResult: { value: { data: null as any, error: null as any } },
    flaggedResult: { value: { data: null as any, error: null as any } },
    fpSingleResult: { value: { data: null as any, error: null as any } },
    verSingleMock: vi.fn(),
    fpUpdateMock: vi.fn(),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Neither service is under test; mocking them also keeps their `server-only`
// imports out of the vitest module graph.
vi.mock('@/services/cloud-storage.server', () => ({
  disconnectCloudConnection: vi.fn(),
}))
vi.mock('@/services/cloud-storage-folder.server', () => ({
  clearProjectCloudFolder: vi.fn(),
  listCloudFolder: vi.fn(),
  setProjectCloudFolder: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => {
  const tableBuilder = (table: string) => {
    const b: any = {
      _op: 'read',
      select: () => b,
      eq: () => b,
      update: (...a: any[]) => {
        b._op = 'update'
        if (table === 'floor_plans') fpUpdateMock(...a)
        return b
      },
      maybeSingle: () => {
        if (table === 'projects') return Promise.resolve(projectResult.value)
        return Promise.resolve({ data: null, error: null })
      },
      single: () => {
        if (table === 'floor_plans') return Promise.resolve(fpSingleResult.value)
        if (table === 'floor_plan_versions') return Promise.resolve(verSingleMock())
        return Promise.resolve({ data: null, error: null })
      },
      // PostgrestFilterBuilder is thenable — the flagged-list query and the
      // adopt UPDATE (.update().eq().select('id')) are awaited directly.
      then: (resolve: (v: any) => void) => {
        if (table === 'floor_plans' && b._op === 'read') {
          return Promise.resolve(flaggedResult.value).then(resolve)
        }
        if (table === 'floor_plans' && b._op === 'update') {
          // Row-count check: a successful RLS-passing update returns the row.
          return Promise.resolve({ data: [{ id: 'fp-touched' }], error: null }).then(resolve)
        }
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    }
    return b
  }
  const makeClient = () => ({
    auth: { getUser: getUserMock },
    rpc: (...a: any[]) => rpcMock(...a),
    schema: () => ({ from: (t: string) => tableBuilder(t) }),
    from: (t: string) => tableBuilder(t),
  })
  return { createClient: vi.fn(async () => makeClient()) }
})

import {
  autoSyncCloudFolderAction,
  syncProjectCloudFolderAction,
  updateAllFloorPlansToLatestAction,
} from './cloud-storage.actions'

const PROJECT_ID = '11111111-2222-3333-4444-555555555555'

function legSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sent: 0, updated: 0, newVersions: 0, adopted: 0, renamed: 0, removed: 0,
    skipped: 0, failed: 0, filesSeen: 0, downloads: 0, remaining: 0,
    walkComplete: true, alreadyRunning: false,
    classified: { floor_plans: 0, documents: 0 },
    intent: 'drawings',
    ...overrides,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  rpcMock.mockResolvedValue({ data: 'project_manager', error: null })
  projectResult.value = {
    data: {
      id: PROJECT_ID,
      cloud_storage_connection_id: 'conn-1',
      cloud_storage_folder_id: 'id:abc',
      cloud_storage_last_sync_at: null,
    },
    error: null,
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('syncProjectCloudFolderAction', () => {
  it('rejects an unauthenticated caller before any edge-function call', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    await expect(syncProjectCloudFolderAction(PROJECT_ID, 'drawings')).rejects.toThrow(
      'Not signed in',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a caller who cannot see the project (RLS returns no row)', async () => {
    projectResult.value = { data: null, error: null }
    await expect(syncProjectCloudFolderAction(PROJECT_ID, 'drawings')).rejects.toThrow(
      'Project not found',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects when the project has no cloud folder mapped', async () => {
    projectResult.value = {
      data: { id: PROJECT_ID, cloud_storage_connection_id: null, cloud_storage_folder_id: null },
      error: null,
    }
    await expect(syncProjectCloudFolderAction(PROJECT_ID, 'drawings')).rejects.toThrow(
      'no cloud folder mapped',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loops legs while the engine reports a backlog and sums the counts', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(legSummary({ sent: 20, downloads: 20, remaining: 3 })))
      .mockResolvedValueOnce(jsonResponse(legSummary({ sent: 3, downloads: 3, remaining: 0 })))
    const r = await syncProjectCloudFolderAction(PROJECT_ID, 'drawings')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.sent).toBe(23)
    expect(r.remaining).toBe(0)
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(firstBody).toMatchObject({
      projectId: PROJECT_ID,
      callerUserId: 'user-1',
      intent: 'drawings',
      trigger: 'manual',
    })
  })

  it('stops after one leg when nothing remains', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(legSummary({ skipped: 73 })))
    const r = await syncProjectCloudFolderAction(PROJECT_ID, 'drawings')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.skipped).toBe(73)
  })

  it('surfaces an edge-function failure with status + body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })
    await expect(syncProjectCloudFolderAction(PROJECT_ID)).rejects.toThrow('HTTP 500')
  })

  it('degrades to a single well-formed leg against the OLD engine response shape', async () => {
    // Deploy-gap regression: the previous engine returns no adopted /
    // remaining / alreadyRunning fields. Without normalization this looped
    // all 6 legs and produced NaN counters.
    fetchMock.mockResolvedValue(
      jsonResponse({
        sent: 2, updated: 0, newVersions: 1, skipped: 47, failed: 0,
        classified: { floor_plans: 2, documents: 0 }, intent: 'drawings',
      }),
    )
    const r = await syncProjectCloudFolderAction(PROJECT_ID, 'drawings')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.sent).toBe(2)
    expect(Number.isNaN(r.adopted)).toBe(false)
    expect(r.remaining).toBe(0)
  })

  it('caps the leg loop even when the engine always reports a backlog', async () => {
    fetchMock.mockResolvedValue(jsonResponse(legSummary({ sent: 20, remaining: 99 })))
    await syncProjectCloudFolderAction(PROJECT_ID, 'drawings')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})

describe('autoSyncCloudFolderAction', () => {
  it('short-circuits as fresh when the folder was checked recently', async () => {
    projectResult.value.data.cloud_storage_last_sync_at = new Date().toISOString()
    const r = await autoSyncCloudFolderAction(PROJECT_ID)
    expect(r.status).toBe('fresh')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('triggers a sync when the last check is stale — with NO intent and NO caller attribution', async () => {
    projectResult.value.data.cloud_storage_last_sync_at = new Date(
      Date.now() - 10 * 60_000,
    ).toISOString()
    fetchMock.mockResolvedValueOnce(jsonResponse(legSummary({ adopted: 2 })))
    const r = await autoSyncCloudFolderAction(PROJECT_ID)
    expect(r.status).toBe('synced')
    if (r.status === 'synced') expect(r.summary.adopted).toBe(2)
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
    expect(body.trigger).toBe('auto')
    // Which tab happened to be open must NOT decide where new files are
    // filed, and a tab-open import must not be attributed to the passer-by.
    expect(body.intent).toBeUndefined()
    expect(body.callerUserId).toBeUndefined()
  })

  it('maps the engine needs-reauth fail-fast to a distinct status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () =>
        'sync failed: cloud connection needs re-authentication — reconnect it under Settings → Integrations',
    })
    const r = await autoSyncCloudFolderAction(PROJECT_ID)
    expect(r.status).toBe('reauth_required')
  })

  it('reports unmapped instead of throwing', async () => {
    projectResult.value = {
      data: { id: PROJECT_ID, cloud_storage_connection_id: null, cloud_storage_folder_id: null },
      error: null,
    }
    const r = await autoSyncCloudFolderAction(PROJECT_ID)
    expect(r.status).toBe('unmapped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports already_running when the engine deduped against a live run', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(legSummary({ alreadyRunning: true })))
    const r = await autoSyncCloudFolderAction(PROJECT_ID)
    expect(r.status).toBe('already_running')
  })

  it('returns an error status (not an exception) for invisible projects', async () => {
    projectResult.value = { data: null, error: null }
    const r = await autoSyncCloudFolderAction(PROJECT_ID)
    expect(r.status).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateAllFloorPlansToLatestAction', () => {
  it('refuses a caller whose effective role is read-only', async () => {
    rpcMock.mockResolvedValue({ data: 'client_viewer', error: null })
    await expect(updateAllFloorPlansToLatestAction(PROJECT_ID)).rejects.toThrow(
      /not allowed/,
    )
    expect(fpUpdateMock).not.toHaveBeenCalled()
  })

  it('adopts every flagged drawing and tolerates per-item failures', async () => {
    flaggedResult.value = { data: [{ id: 'fp-1' }, { id: 'fp-2' }], error: null }
    fpSingleResult.value = { data: { id: 'fp-1', latest_revision_id: 'rev9' }, error: null }
    // fp-1's version lookup succeeds; fp-2 has no captured version row → fails.
    verSingleMock
      .mockReturnValueOnce({
        data: { file_path: 'p', file_size_bytes: 1, source_revision_id: 'rev9' },
        error: null,
      })
      .mockReturnValueOnce({ data: null, error: { message: 'no version row' } })

    const r = await updateAllFloorPlansToLatestAction(PROJECT_ID)
    expect(r.updated).toBe(1)
    expect(r.failed).toBe(1)
    expect(fpUpdateMock).toHaveBeenCalledTimes(1)
  })
})
