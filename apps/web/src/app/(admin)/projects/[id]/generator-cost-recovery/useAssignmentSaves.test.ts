import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ─── Module mocks (same shape as TenantsPanel.test.tsx) ──────────────────────

const bulkSaveMock = vi.fn()
vi.mock('./gcr.actions', () => ({
  bulkSaveTenantAssignmentsAction: (...args: unknown[]) => bulkSaveMock(...args),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}))

import { useAssignmentSaves } from './useAssignmentSaves'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function renderSaves() {
  return renderHook(() => useAssignmentSaves(PROJECT_ID))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useAssignmentSaves — per-node serialization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('C1: a save committed while a failing save is in flight inherits the failed fields and ends saved', async () => {
    const saveA = deferred<{ error: string }>()
    bulkSaveMock
      .mockReturnValueOnce(saveA.promise)
      .mockResolvedValueOnce({ ok: true, updated: 1 })
    const { result } = renderSaves()

    // Save A in flight on X
    act(() => result.current.commit(['X'], { zone_id: 'z1' }))
    expect(bulkSaveMock).toHaveBeenCalledTimes(1)

    // Commit B while A is in flight — B must wait on A
    act(() => result.current.commit(['X'], { shop_category: 'standard' }))
    expect(bulkSaveMock).toHaveBeenCalledTimes(1)

    // A fails — B then fires carrying A's fields (last-write-wins per field)
    await act(async () => saveA.resolve({ error: 'boom' }))
    await waitFor(() => expect(bulkSaveMock).toHaveBeenCalledTimes(2))
    expect(bulkSaveMock.mock.calls[1]).toEqual([
      PROJECT_ID,
      ['X'],
      { zone_id: 'z1', shop_category: 'standard' },
    ])

    // B succeeds → A's intent reached the DB via B; status ends 'saved' (flash)
    await waitFor(() => expect(result.current.status['X']?.state).toBe('saved'))
  })

  it('I1: a commit on an in-flight node enters the pending overlay immediately', async () => {
    const saveA = deferred<{ ok: true; updated: number }>()
    bulkSaveMock
      .mockReturnValueOnce(saveA.promise)
      .mockResolvedValueOnce({ ok: true, updated: 1 })
    const { result } = renderSaves()

    act(() => result.current.commit(['X'], { zone_id: 'z1' }))
    act(() => result.current.commit(['X'], { shop_category: 'standard' }))

    // Overlay shows the user's full intent while B waits on A
    expect(result.current.pending['X']).toEqual({ zone_id: 'z1', shop_category: 'standard' })

    await act(async () => saveA.resolve({ ok: true, updated: 1 }))
    await waitFor(() => expect(bulkSaveMock).toHaveBeenCalledTimes(2))
  })

  it('I2: reconcile drops a settled overlay even when the server does not match, but keeps in-flight overlays', async () => {
    const saveY = deferred<{ ok: true; updated: number }>()
    bulkSaveMock
      .mockResolvedValueOnce({ ok: true, updated: 1 }) // X
      .mockReturnValueOnce(saveY.promise)              // Y stays in flight
    const { result } = renderSaves()

    act(() => result.current.commit(['X'], { zone_id: 'z1' }))
    await waitFor(() => expect(result.current.status['X']?.state).toBe('saved'))

    act(() => result.current.commit(['Y'], { zone_id: 'z2' }))

    // Server "disagrees" (another user overwrote X meanwhile) — the settled
    // overlay still drops on the next props delivery; in-flight Y survives.
    act(() => result.current.reconcile(() => false))
    expect(result.current.pending['X']).toBeUndefined()
    expect(result.current.pending['Y']).toEqual({ zone_id: 'z2' })

    await act(async () => saveY.resolve({ ok: true, updated: 1 }))
  })

  it('M8: a failed save drops only its own keys — fields from an earlier unreconciled success survive', async () => {
    bulkSaveMock
      .mockResolvedValueOnce({ ok: true, updated: 1 }) // commit1 succeeds
      .mockResolvedValueOnce({ error: 'Forbidden' })   // commit2 fails
    const { result } = renderSaves()

    act(() => result.current.commit(['X'], { zone_id: 'z1' }))
    await waitFor(() => expect(result.current.status['X']?.state).toBe('saved'))
    expect(result.current.pending['X']).toEqual({ zone_id: 'z1' }) // retained until reconcile

    act(() => result.current.commit(['X'], { shop_category: 'standard' }))
    await waitFor(() => expect(result.current.status['X']?.state).toBe('error'))

    // Only the failed patch's keys left the overlay
    expect(result.current.pending['X']).toEqual({ zone_id: 'z1' })
    const st = result.current.status['X']
    expect(st?.state === 'error' && st.patch).toEqual({ shop_category: 'standard' })
  })

  it('I3: a bulk commit waits for in-flight rows to drain, then sends ONE call with all ids', async () => {
    const saveA = deferred<{ ok: true; updated: number }>()
    bulkSaveMock
      .mockReturnValueOnce(saveA.promise)
      .mockResolvedValueOnce({ ok: true, updated: 2 })
    const { result } = renderSaves()

    act(() => result.current.commit(['X'], { zone_id: 'z1' }))

    let bulkResult: Awaited<ReturnType<typeof result.current.commitWithResult>> | undefined
    let bulkPromise!: Promise<unknown>
    act(() => {
      bulkPromise = result.current
        .commitWithResult(['X', 'Y'], { shop_category: 'standard' })
        .then((r) => { bulkResult = r })
    })

    // Bulk is queued behind X's in-flight save — no second action call yet
    expect(bulkSaveMock).toHaveBeenCalledTimes(1)

    await act(async () => { saveA.resolve({ ok: true, updated: 1 }); await bulkPromise })

    expect(bulkSaveMock).toHaveBeenCalledTimes(2)
    expect(bulkSaveMock.mock.calls[1]).toEqual([
      PROJECT_ID,
      ['X', 'Y'],
      { shop_category: 'standard' },
    ])
    expect(bulkResult).toEqual({ ok: true, updated: 2 })
  })
})
