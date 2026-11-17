import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ProgrammeState } from '@esite/shared/programme'
import type { ProgrammeSummary, ProgrammeViewData } from '@/lib/programme/view-types'
import { programmeTables, VERSION } from '@/lib/programme/test-fixtures'
import { scheduleFor, type ProgrammeStoreApi } from './use-programme-store'

const h = vi.hoisted(() => ({ api: null as unknown as Record<string, unknown> }))
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/programme.actions', () => ({
  saveProgrammeChangesAction: vi.fn(), programmeVersionAction: vi.fn(), recalculateProgrammeAction: vi.fn(),
  saveBaselineAction: vi.fn(), setActiveBaselineAction: vi.fn(), deleteBaselineAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: nav.push }) }))
vi.mock('./use-programme-store', async (orig) => {
  const real = await orig<typeof import('./use-programme-store')>()
  return { ...real, useProgrammeStore: () => h.api }
})

import { ProgrammeClient } from './ProgrammeClient'
import { saveBaselineAction } from '@/actions/programme.actions'
import { STRUCTURE_LOCKED } from './bridge'

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
    newKey: vi.fn(() => 'n1-x'), keyIds: {}, recalculate: vi.fn(() => true), apply: vi.fn(() => true), undo: vi.fn(), redo: vi.fn(), reload: vi.fn(), clearError: vi.fn(), ...over,
  }
}
const renderClient = (a: ProgrammeStoreApi, canEdit = true, over: Partial<{ view: ProgrammeViewData; programmes: ProgrammeSummary[] }> = {}) => {
  h.api = a as unknown as Record<string, unknown>
  return render(<ProgrammeClient projectId="p" view={over.view ?? view()} canEdit={canEdit} programmes={over.programmes ?? []} />)
}

// This jsdom build has no PointerEvent.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('PointerEvent', TestPointerEvent) })
afterEach(() => { vi.unstubAllGlobals() })

describe('ProgrammeClient', () => {
  it('shows the outline rows, their bars and the project finish', () => {
    const a = api()
    renderClient(a)
    expect(screen.getByRole('grid', { name: 'Activities' }).querySelector('[data-row-id="A"]')).not.toBeNull()
    expect(screen.getByTestId('programme-finish').textContent).toBe(a.schedule.projectFinish)
    expect(document.querySelector('[data-bar-id="A"]')).not.toBeNull()
    expect(document.querySelector('[data-bar-id="B"]')).not.toBeNull()
  })

  it('a click on a bar selects its row in the grid', () => {
    renderClient(api())
    const body = screen.getByTestId('programme-timeline-body')
    const bar = document.querySelector('[data-bar-id="B"] [data-part="bar"]') as Element
    const x = Number(bar.getAttribute('x')) + 4
    const y = Number(bar.getAttribute('y')) + 4
    fireEvent.pointerDown(body, { clientX: x, clientY: y, pointerId: 1, button: 0 })
    fireEvent.pointerUp(body, { clientX: x, clientY: y, pointerId: 1 })
    const grid = screen.getByRole('grid', { name: 'Activities' })
    expect(grid.querySelector('[data-row-id="B"]')!.getAttribute('aria-selected')).toBe('true')
    expect(grid.querySelector('[data-row-id="A"]')!.getAttribute('aria-selected')).toBe('false')
  })

  it('neither pane has a footer: every button lives in the toolbar, and the panes are as tall as each other', () => {
    renderClient(api())
    expect(screen.queryByTestId('programme-grid-footer')).toBeNull()
    expect(screen.queryByTestId('programme-timeline-footer')).toBeNull()
    expect(screen.getByTestId('programme-grid').style.height).toBe('100%')
    expect(screen.getByTestId('programme-timeline').style.height).toBe('100%')
    const bar = screen.getByRole('toolbar', { name: 'Programme' })
    for (const name of ['Add task', 'Add milestone', 'Indent', 'Outdent', 'Delete', 'Columns', 'Scroll to today', 'Fit programme', 'Recalculate']) {
      expect(within(bar).getByRole('button', { name })).toBeTruthy()
    }
    expect(within(bar).getByRole('combobox', { name: 'Zoom' })).toBeTruthy()
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
    expect(b.textContent).toContain('Your unsaved changes are still shown here')
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

  it('the grid and the timeline share one scroll position', () => {
    renderClient(api())
    fireEvent.scroll(screen.getByTestId('programme-grid-scroll'), { target: { scrollTop: 56 } })
    expect(screen.getByTestId('programme-timeline-scroll').scrollTop).toBe(56)
    fireEvent.scroll(screen.getByTestId('programme-timeline-scroll'), { target: { scrollTop: 28 } })
    expect(screen.getByTestId('programme-grid-scroll').scrollTop).toBe(28)
  })

  it('collapsing a summary in the grid hides its children in the timeline too', () => {
    const v = view()
    const state = { ...v.state, dependencies: [], activities: [
      { ...v.state.activities[0], id: 'P', name: 'P', type: 'summary', original_duration: 0 },
      { ...v.state.activities[1], id: 'K', name: 'K', parent_id: 'P' },
    ] } as ProgrammeState
    renderClient(api({ state, schedule: scheduleFor(state) }))
    expect(document.querySelectorAll('[data-bar-id]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse P' }))
    expect(document.querySelectorAll('[data-bar-id]')).toHaveLength(1)
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

const rowIds = () => [...screen.getByRole('grid', { name: 'Activities' }).querySelectorAll('[data-row-id]')].map((r) => r.getAttribute('data-row-id'))
const toolbar = () => screen.getByRole('toolbar', { name: 'Programme' })
const selectRow = (id: string) => fireEvent.click(screen.getByRole('grid', { name: 'Activities' }).querySelector(`[data-row-id="${id}"] [data-col="name"]`)!)

describe('ProgrammeClient: toolbar editing', () => {
  it('Add task and Add milestone make one gesture each, with a key from the store', () => {
    const a = api()
    renderClient(a)
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Add task' }))
    expect((a.apply as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('Add task')
    expect((a.apply as ReturnType<typeof vi.fn>).mock.calls[0][0][0]).toMatchObject({ op: 'upsert_activity', key: 'n1-x' })
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Add milestone' }))
    expect((a.apply as ReturnType<typeof vi.fn>).mock.calls[1][1]).toBe('Add milestone')
  })

  it('Indent and Outdent act on the selected row; with nothing selected they are disabled', () => {
    const a = api()
    renderClient(a)
    const indent = within(toolbar()).getByRole('button', { name: 'Indent' }) as HTMLButtonElement
    expect(indent.disabled).toBe(true)
    selectRow('B')
    expect(indent.disabled).toBe(false)
    fireEvent.click(indent)
    expect((a.apply as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('Indent')
  })

  it('Delete asks inline first; only Confirm sends the delete op; Cancel disarms', () => {
    const a = api()
    renderClient(a)
    selectRow('B')
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    expect(a.apply).not.toHaveBeenCalled()
    const confirm = within(toolbar()).getByTestId('programme-grid-confirm')
    expect(confirm.textContent).toContain('Delete 1 activity?')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(within(toolbar()).queryByTestId('programme-grid-confirm')).toBeNull()
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Confirm delete' }))
    expect(a.apply).toHaveBeenCalledWith([{ op: 'delete_activity', id: 'B' }], 'Delete')
  })

  it('a refused indent shows its sentence in the toolbar and sends nothing', () => {
    const v = view()
    const state = { ...v.state, dependencies: [], activities: [
      { ...v.state.activities[0], id: 'M', name: 'M', type: 'finish_milestone', original_duration: 0, sort_order: 1 },
      { ...v.state.activities[1], id: 'B', sort_order: 2 },
    ] } as ProgrammeState
    const a = api({ state, schedule: scheduleFor(state) })
    renderClient(a)
    selectRow('B')
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Indent' }))
    expect(a.apply).not.toHaveBeenCalled()
    expect(within(toolbar()).getByTestId('programme-grid-notice').textContent).toBe("A milestone can't have sub-activities.")
  })

  it('the data date is applied as one set_programme op on blur, and a bad draft is put back', () => {
    const a = api()
    renderClient(a)
    const input = within(toolbar()).getByLabelText('Data date') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-03-04' } })
    expect(a.apply).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(a.apply).toHaveBeenCalledWith([{ op: 'set_programme', fields: { data_date: '2026-03-04' } }], 'Set data date')
  })

  it('Enter applies the data date too; clearing it sends null', () => {
    const base = api()
    const state = { ...base.state, programme: { ...base.state.programme, data_date: '2026-03-04' } } as ProgrammeState
    const a = api({ state, schedule: scheduleFor(state) })
    renderClient(a)
    const input = within(toolbar()).getByLabelText('Data date') as HTMLInputElement
    expect(input.value).toBe('2026-03-04')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(a.apply).toHaveBeenCalledWith([{ op: 'set_programme', fields: { data_date: null } }], 'Set data date')
  })

  it('a data date the store refuses goes back to the saved one', () => {
    const a = api({ apply: vi.fn(() => false) })
    renderClient(a)
    const input = within(toolbar()).getByLabelText('Data date') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-03-04' } })
    fireEvent.blur(input)
    expect(input.value).toBe('')
  })

  it('Recalculate goes through the store (its serial pipeline), not a separate call', () => {
    const a = api()
    renderClient(a)
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Recalculate' }))
    expect(a.recalculate).toHaveBeenCalledTimes(1)
  })

  it('Recalculate is not offered while the screen is stale', () => {
    renderClient(api({ stale: true }))
    expect((within(toolbar()).getByRole('button', { name: 'Recalculate' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ProgrammeClient: structure is locked in a filtered or grouped view', () => {
  const buttons = ['Add task', 'Add milestone', 'Indent', 'Outdent']
  const lockedChecks = (a: ProgrammeStoreApi) => {
    for (const name of buttons) {
      const b = within(toolbar()).getByRole('button', { name }) as HTMLButtonElement
      expect(b.disabled).toBe(true)
      expect(b.title).toBe(STRUCTURE_LOCKED)
    }
    selectRow('B')
    for (const k of [
      { key: 'ArrowRight', altKey: true, shiftKey: true }, { key: 'ArrowLeft', altKey: true, shiftKey: true },
      { key: 'ArrowUp', altKey: true }, { key: 'ArrowDown', altKey: true },
    ]) fireEvent.keyDown(screen.getByRole('grid', { name: 'Activities' }), k)
    expect(a.apply).not.toHaveBeenCalled()
  }

  it('with a filter on: Add, Indent, Outdent and the structural keys do nothing', () => {
    const a = api()
    renderClient(a)
    fireEvent.click(within(toolbar()).getByRole('checkbox', { name: 'Critical only' }))
    lockedChecks(a)
  })

  it('with a code group on: the same', () => {
    const v = view()
    const state = { ...v.state, codeTypes: [{ id: 'T1', name: 'Trade', programme_id: 'P', sort_order: 1 }], codeValues: [], activityCodes: [] } as unknown as ProgrammeState
    const a = api({ state, schedule: scheduleFor(state) })
    renderClient(a)
    fireEvent.change(within(toolbar()).getByRole('combobox', { name: 'Group by' }), { target: { value: 'T1' } })
    lockedChecks(a)
  })

  it('delete, drags and inline edits stay allowed, and clearing the filters unlocks structure', () => {
    const a = api()
    renderClient(a)
    fireEvent.click(within(toolbar()).getByRole('checkbox', { name: 'Critical only' }))
    selectRow('B')
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Confirm delete' }))
    expect(a.apply).toHaveBeenCalledWith([{ op: 'delete_activity', id: 'B' }], 'Delete')
    fireEvent.doubleClick(screen.getByRole('grid', { name: 'Activities' }).querySelector('[data-row-id="A"] [data-col="name"]')!)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clear filters' }))
    expect((within(toolbar()).getByRole('button', { name: 'Add task' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('ProgrammeClient: read-only', () => {
  it('shows the view controls and no edit controls', () => {
    renderClient(api(), false)
    const bar = toolbar()
    for (const name of ['Add task', 'Add milestone', 'Indent', 'Outdent', 'Delete', 'Undo', 'Redo', 'Recalculate']) {
      expect(within(bar).queryByRole('button', { name })).toBeNull()
    }
    expect(within(bar).queryByLabelText('Data date')).toBeNull()
    for (const name of ['Columns', 'Scroll to today', 'Fit programme']) expect(within(bar).getByRole('button', { name })).toBeTruthy()
    expect(within(bar).getByRole('combobox', { name: 'Zoom' })).toBeTruthy()
    expect(within(bar).getByRole('combobox', { name: 'Group by' })).toBeTruthy()
    expect(within(bar).getByRole('searchbox', { name: 'Search activities' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: /^Baselines/ })).toBeTruthy()
  })
})

describe('ProgrammeClient: filters, grouping, summary', () => {
  it('the search filters both panes together, and a cleared search brings the rows back', () => {
    renderClient(api())
    const box = within(toolbar()).getByRole('searchbox', { name: 'Search activities' })
    fireEvent.change(box, { target: { value: 'B' } })
    expect(rowIds()).toEqual(['B'])
    expect(document.querySelector('[data-bar-id="A"]')).toBeNull()
    expect(document.querySelector('[data-bar-id="B"]')).not.toBeNull()
    fireEvent.change(box, { target: { value: '' } })
    expect(rowIds()).toEqual(['A', 'B'])
  })

  it('"Clear filters" appears with a filter on and resets them all', () => {
    renderClient(api())
    fireEvent.click(within(toolbar()).getByRole('checkbox', { name: 'Milestones only' }))
    expect(rowIds()).toEqual([])
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Clear filters' }))
    expect(rowIds()).toEqual(['A', 'B'])
    expect(within(toolbar()).queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('a summary keeps its place when only a child matches', () => {
    const v = view()
    const state = { ...v.state, dependencies: [], activities: [
      { ...v.state.activities[0], id: 'P', name: 'P', type: 'summary', original_duration: 0 },
      { ...v.state.activities[1], id: 'K', name: 'Kerb', parent_id: 'P' },
    ] } as ProgrammeState
    renderClient(api({ state, schedule: scheduleFor(state) }))
    fireEvent.change(within(toolbar()).getByRole('searchbox', { name: 'Search activities' }), { target: { value: 'kerb' } })
    expect(rowIds()).toEqual(['P', 'K'])
  })

  const coded = () => {
    const v = view()
    const state = {
      ...v.state,
      codeTypes: [{ id: 'T1', name: 'Trade', programme_id: 'P', sort_order: 1 }],
      codeValues: [{ id: 'V1', code_type_id: 'T1', value: 'Civil' }],
      activityCodes: [{ activity_id: 'A', code_type_id: 'T1', code_value_id: 'V1' }],
    } as unknown as ProgrammeState
    return api({ state, schedule: scheduleFor(state) })
  }

  it('Group by offers WBS and every code type; a code type shows headers with count and dates', () => {
    renderClient(coded())
    const select = within(toolbar()).getByRole('combobox', { name: 'Group by' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['WBS', 'Trade'])
    fireEvent.change(select, { target: { value: 'T1' } })
    const grid = screen.getByRole('grid', { name: 'Activities' })
    const headers = [...grid.querySelectorAll('[data-group-id]')]
    expect(headers.map((h) => h.getAttribute('data-group-id'))).toEqual(['group:V1', 'group:none'])
    expect(headers[0].textContent).toContain('Civil')
    expect(headers[0].textContent).toContain('1 activity')
    expect(headers[0].textContent).toMatch(/2026-03-02 – 2026-03-03/)
    expect(rowIds()).toEqual(['A', 'B'])
    // The timeline draws the group's bracket, and a header collapses its members in both panes.
    expect(document.querySelector('[data-group-id="group:V1"] [data-part="group"]')).not.toBeNull()
    fireEvent.click(within(headers[0] as HTMLElement).getByRole('button', { name: 'Collapse Civil' }))
    expect(rowIds()).toEqual(['B'])
    fireEvent.change(select, { target: { value: 'wbs' } })
    expect(rowIds()).toEqual(['A', 'B'])
  })

  it('the summary chip gives the project finish and the critical and negative-float counts', () => {
    const a = api()
    renderClient(a)
    const chip = screen.getByTestId('programme-summary').textContent ?? ''
    expect(chip).toContain(a.schedule.projectFinish as string)
    expect(chip).toMatch(/2 critical/)
    expect(chip).toMatch(/0 negative float/)
  })
})

describe('ProgrammeClient: programme switcher', () => {
  const two: ProgrammeSummary[] = [
    { id: '22222222-2222-4222-8222-222222222222', kind: 'project', name: 'Main programme', module_key: null, contractor_label: null },
    { id: 'other', kind: 'contractor', name: 'Contractor X', module_key: null, contractor_label: 'X' },
  ]
  it('is offered with more than one programme, and goes to the chosen one', () => {
    renderClient(api(), true, { programmes: two })
    fireEvent.change(within(toolbar()).getByRole('combobox', { name: 'Programme' }), { target: { value: 'other' } })
    expect(nav.push).toHaveBeenCalledWith('/projects/p/programme?programme=other')
  })
  it('is not offered with one', () => {
    renderClient(api(), true, { programmes: two.slice(0, 1) })
    expect(within(toolbar()).queryByRole('combobox', { name: 'Programme' })).toBeNull()
  })
})

describe('ProgrammeClient: baselines', () => {
  it('lists the baselines for a read-only user, with the active one marked and no edit buttons', () => {
    const v = { ...view(), baselines: [
      { id: 'b1', name: 'Tender', is_active: false, created_at: '2026-03-01T08:00:00Z' },
      { id: 'b2', name: 'Rev 1', is_active: true, created_at: '2026-03-10T08:00:00Z' },
    ] }
    renderClient(api(), false, { view: v })
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Baselines (2)' }))
    const menu = screen.getByTestId('programme-baselines')
    expect(within(menu).getAllByTestId('baseline-active')).toHaveLength(1)
    expect(menu.querySelector('[data-baseline-id="b2"]')!.textContent).toContain('Active')
    expect(within(menu).queryByRole('button', { name: /Set .* active|Delete|Save baseline/ })).toBeNull()
  })
})

describe('ProgrammeClient: a baseline change refreshes the view, not the store', () => {
  it('saving a baseline calls router.refresh and never the store reload (undo survives)', async () => {
    vi.mocked(saveBaselineAction).mockResolvedValue({ ok: true, baselineId: 'b9' })
    const a = api()
    renderClient(a)
    fireEvent.click(within(toolbar()).getByRole('button', { name: /^Baselines/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save baseline…' }))
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: 'Rev 1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(nav.refresh).toHaveBeenCalledTimes(1)
    expect(a.reload).not.toHaveBeenCalled()
  })

  it('the list follows the view prop without anything resetting', () => {
    const a = api()
    const { rerender } = renderClient(a)
    expect(within(toolbar()).getByRole('button', { name: 'Baselines (0)' })).toBeTruthy()
    rerender(<ProgrammeClient projectId="p" canEdit programmes={[]}
      view={{ ...view(), baselines: [{ id: 'b1', name: 'Tender', is_active: true, created_at: '2026-03-01T08:00:00Z' }] }} />)
    expect(within(toolbar()).getByRole('button', { name: 'Baselines (1)' })).toBeTruthy()
  })

  describe('on a phone (390 px)', () => {
    const phoneMedia = () => vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width: 767.98px'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }))

    it('grid shows Name, Start and Finish only, and the timeline is behind a Timeline toggle', () => {
      phoneMedia()
      renderClient(api())
      const headers = within(screen.getByRole('grid', { name: 'Activities' })).getAllByRole('columnheader').map((c) => c.getAttribute('aria-label'))
      expect(headers).toEqual(['Name', 'Start', 'Finish'])
      expect(screen.queryByTestId('programme-timeline')).toBeNull()
      const toggle = screen.getByRole('button', { name: 'Timeline' })
      expect(toggle.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(toggle)
      expect(screen.getByTestId('programme-timeline')).not.toBeNull()
      expect(screen.queryByRole('grid', { name: 'Activities' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Timeline' }))
      expect(screen.getByRole('grid', { name: 'Activities' })).not.toBeNull()
    })

    it('on a wide screen there is no toggle and both panes show all columns', () => {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
      renderClient(api())
      expect(screen.queryByRole('button', { name: 'Timeline' })).toBeNull()
      expect(screen.getByTestId('programme-timeline')).not.toBeNull()
      expect(within(screen.getByRole('grid', { name: 'Activities' })).getAllByRole('columnheader').length).toBe(7)
    })
  })
})
