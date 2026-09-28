import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { rebuildMessage, useRebuild } from './use-rebuild'

describe('rebuildMessage', () => {
  it('describes each stage', () => {
    expect(rebuildMessage({ type: 'progress', stage: 'reading', done: 3, total: 7 })).toBe('Reading meter data… 3 of 7 channels')
    expect(rebuildMessage({ type: 'progress', stage: 'building', done: 0, total: 1 })).toBe('Building the site profile…')
    expect(rebuildMessage({ type: 'progress', stage: 'saving', done: 0, total: 1 })).toBe('Saving…')
    expect(rebuildMessage({ type: 'done', siteLoadId: 'x', basis: 'S2', referenceYear: 2025, checks: 4 })).toBe('Site profile rebuilt — basis S2, reference year 2025, 4 checks to review.')
  })
})

describe('useRebuild', () => {
  it('refreshes the page after a FAILED rebuild too — a partial save may have moved the study version', async () => {
    const refresh = h.refresh
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, body: null })))
    const { result } = renderHook(() => useRebuild('p1'))
    await act(async () => { await result.current.run() })
    expect(result.current.state.error).toBe('The site profile could not be built — try again.')
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await act(async () => { await result.current.run() })
    expect(refresh).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})
