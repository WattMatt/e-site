import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ProgrammeState } from '@esite/shared/programme'
import type { ProgrammeViewData } from '@/lib/programme/view-types'
import { programmeTables, VERSION } from '@/lib/programme/test-fixtures'
import { scheduleFor, type ProgrammeStoreApi } from './use-programme-store'

const h = vi.hoisted(() => ({ api: null as unknown as Record<string, unknown> }))
vi.mock('@/actions/programme.actions', () => ({ saveProgrammeChangesAction: vi.fn(), programmeVersionAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./use-programme-store', async (orig) => {
  const real = await orig<typeof import('./use-programme-store')>()
  return { ...real, useProgrammeStore: () => h.api }
})

import { ProgrammeClient } from './ProgrammeClient'

function view(): ProgrammeViewData {
  const t = programmeTables()
  const state = {
    programme: t['programme.programmes'][0], calendars: t['programme.calendars'], exceptions: [],
    activities: t['programme.activities'], dependencies: t['programme.dependencies'],
    codeTypes: [], codeValues: [], activityCodes: [], fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
  } as unknown as ProgrammeState
  return { state, version: VERSION, activeBaseline: null, baselines: [] }
}

function api(over: Partial<ProgrammeStoreApi> = {}): ProgrammeStoreApi {
  const v = view()
  return {
    state: v.state, version: VERSION, pending: false, stale: false, unsaved: false, error: null, offerReload: false,
    canUndo: true, canRedo: true, undoLabel: 'Add', redoLabel: null, schedule: scheduleFor(v.state),
    apply: vi.fn(() => true), undo: vi.fn(), redo: vi.fn(), reload: vi.fn(), clearError: vi.fn(), ...over,
  }
}
const renderClient = (a: ProgrammeStoreApi, canEdit = true) => {
  h.api = a as unknown as Record<string, unknown>
  return render(<ProgrammeClient projectId="p" view={view()} canEdit={canEdit} programmes={[]} />)
}

beforeEach(() => { vi.clearAllMocks() })

describe('ProgrammeClient', () => {
  it('shows the outline rows, their dates and the project finish', () => {
    const a = api()
    renderClient(a)
    expect(screen.getByRole('list', { name: 'Activities' }).textContent).toContain('A')
    expect(screen.getByTestId('programme-finish').textContent).toBe(a.schedule.projectFinish)
    expect(screen.getByRole('list', { name: 'Timeline' }).textContent).toMatch(/\d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}/)
  })

  it('⌘Z undoes, ⇧⌘Z and Ctrl+Shift+Z redo; ignored while a field has focus', () => {
    const a = api()
    renderClient(a)
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(a.undo).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Z', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(a.redo).toHaveBeenCalledTimes(2)

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'z', metaKey: true })
    expect(a.undo).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('read-only: no undo/redo controls and the shortcut does nothing', () => {
    const a = api()
    renderClient(a, false)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
    expect(a.undo).not.toHaveBeenCalled()
  })

  it('stale: the banner says so, marks the preview unsaved and offers Reload', () => {
    const a = api({ stale: true, unsaved: true })
    renderClient(a)
    const b = screen.getByTestId('programme-stale')
    expect(b.textContent).toContain('Someone else changed this programme. Reload to see their version.')
    expect(b.textContent).toContain('not saved')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(a.reload).toHaveBeenCalled()
  })

  it('an error the store can only clear by reloading offers Reload; others offer Dismiss', () => {
    const a = api({ error: 'This change can no longer be undone. Reload to see the current programme.', offerReload: true })
    const { unmount } = renderClient(a)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(a.reload).toHaveBeenCalled()
    unmount()
    const b = api({ error: 'No.' })
    renderClient(b)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(b.clearError).toHaveBeenCalled()
  })

  it('the splitter resizes the grid between 30 and 70 per cent', () => {
    renderClient(api())
    const sep = screen.getByRole('separator', { name: 'Resize the grid' })
    for (let i = 0; i < 20; i++) fireEvent.keyDown(sep, { key: 'ArrowRight' })
    expect(sep.getAttribute('aria-valuenow')).toBe('70')
    for (let i = 0; i < 40; i++) fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(sep.getAttribute('aria-valuenow')).toBe('30')
  })
})
