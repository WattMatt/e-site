import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ProgrammeState } from '@esite/shared/programme'
import type { ProgrammeViewData } from '@/lib/programme/view-types'
import { activityRow, programmeTables, PROG, VERSION } from '@/lib/programme/test-fixtures'

const h = vi.hoisted(() => ({ save: vi.fn(), version: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/programme.actions', () => ({ saveProgrammeChangesAction: h.save, programmeVersionAction: h.version }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { useProgrammeStore } from './use-programme-store'

function view(version = VERSION, activities = programmeTables()['programme.activities']): ProgrammeViewData {
  const t = programmeTables()
  const state = {
    programme: t['programme.programmes'][0], calendars: t['programme.calendars'], exceptions: [],
    activities, dependencies: version === VERSION ? t['programme.dependencies'] : [],
    codeTypes: [], codeValues: [], activityCodes: [], fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
  } as unknown as ProgrammeState
  return { state, version, activeBaseline: null, baselines: [] }
}

const LATER = '2026-11-17T09:00:00.000000+00:00'

let visibility: DocumentVisibilityState = 'visible'
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useProgrammeStore', () => {
  it('polls the version every 30 s while visible and marks the screen stale when it moved', async () => {
    h.version.mockResolvedValue({ ok: true, version: LATER })
    const { result } = renderHook(() => useProgrammeStore(view(), { canEdit: true }))
    expect(result.current.schedule.ok).toBe(true)

    visibility = 'hidden'
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(h.version).not.toHaveBeenCalled()

    visibility = 'visible'
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(h.version).toHaveBeenCalledWith({ programmeId: PROG })
    expect(result.current.stale).toBe(true)
  })

  it('an unchanged version leaves the screen as it is', async () => {
    h.version.mockResolvedValue({ ok: true, version: VERSION })
    const { result } = renderHook(() => useProgrammeStore(view(), { canEdit: true }))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(h.version).toHaveBeenCalledTimes(1)
    expect(result.current.stale).toBe(false)
  })

  it('does not poll while a save is pending', async () => {
    h.save.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useProgrammeStore(view(), { canEdit: true }))
    act(() => { result.current.apply([{ op: 'upsert_activity', id: 'A', fields: { name: 'A2' } }], 'Rename') })
    expect(result.current.pending).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(h.version).not.toHaveBeenCalled()
  })

  it('reload refreshes the route, and a new server version resets the store', async () => {
    h.version.mockResolvedValue({ ok: true, version: LATER })
    const { result, rerender } = renderHook(({ v }) => useProgrammeStore(v, { canEdit: true }), { initialProps: { v: view() } })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(result.current.stale).toBe(true)
    act(() => { result.current.reload() })
    expect(h.refresh).toHaveBeenCalled()

    rerender({ v: view(LATER, [activityRow('Z')]) })
    expect(result.current.stale).toBe(false)
    expect(result.current.version).toBe(LATER)
    expect(result.current.state.activities.map((a) => a.id)).toEqual(['Z'])
  })

  it('reload resets the store even when the refreshed view has the same version', () => {
    const { result, rerender } = renderHook(({ v }) => useProgrammeStore(v, { canEdit: true }), { initialProps: { v: view() } })
    act(() => { result.current.apply([{ op: 'delete_activity', id: 'NOPE' }], 'Delete') })
    expect(result.current.error).not.toBeNull()
    rerender({ v: view() }) // a re-render with an equal version, no reload asked: kept
    expect(result.current.error).not.toBeNull()
    act(() => { result.current.reload() })
    rerender({ v: view() })
    expect(result.current.error).toBeNull()
  })
})
