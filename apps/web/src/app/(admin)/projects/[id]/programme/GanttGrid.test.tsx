import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState, useSyncExternalStore } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import {
  rowsToProgrammeInput, scheduleProgramme, type ProgrammeOp, type ProgrammeState, type ScheduleResult,
} from '@esite/shared/programme'
import { activityRow, calendarRow, programmeRow, VERSION } from '@/lib/programme/test-fixtures'
import type { ProgrammeViewData } from '@/lib/programme/view-types'
import type { SaveProgrammeChangesInput, SaveProgrammeResult } from '@/lib/programme/action-types'
import { GanttGrid, columnsStorageKey, useHiddenColumns, type GanttGridStore } from './GanttGrid'
import { GridControls } from './GanttToolbar'
import { buildDisplayRows, NO_FILTERS } from './display-rows'
import { NO_GRID_UI, type GridCommands, type GridUi } from './bridge'
import { createProgrammeStore, scheduleFor, type ProgrammeStore } from './use-programme-store'

vi.mock('@/actions/programme.actions', () => ({ saveProgrammeChangesAction: vi.fn(), programmeVersionAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

type Row = Record<string, unknown>

function stateOf(activities: Row[]): ProgrammeState {
  return {
    programme: programmeRow(), calendars: [calendarRow('SITE')], exceptions: [],
    activities, dependencies: [], codeTypes: [], codeValues: [], activityCodes: [],
    fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
  } as unknown as ProgrammeState
}

const emptySchedule = (): ScheduleResult => ({ ok: true, activities: new Map(), drivingLinkIds: new Set(), projectFinish: null, issues: [] })

function storeOf(activities: Row[], schedule?: ScheduleResult) {
  const state = stateOf(activities)
  let n = 0
  return {
    state,
    schedule: schedule ?? scheduleProgramme(rowsToProgrammeInput(state)),
    apply: vi.fn((_ops: ProgrammeOp[], _label: string) => true),
    newKey: vi.fn(() => `n${++n}-x`),
    keyIds: {},
  } satisfies GanttGridStore
}

/** The grid with its toolbar buttons (the toolbar owns Add / Indent / Outdent / Delete / Columns). */
function Workspace({ store, canEdit, userId }: { store: GanttGridStore; canEdit: boolean; userId?: string }) {
  const [scrollTop, setScrollTop] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const columns = useHiddenColumns(userId)
  const commandsRef = useRef<GridCommands | null>(null)
  const [ui, setUi] = useState<GridUi>(NO_GRID_UI)
  return (
    <>
      <GridControls canEdit={canEdit} commandsRef={commandsRef} ui={ui} columns={columns} />
      <GanttGrid store={store} canEdit={canEdit} scrollTop={scrollTop} onScrollTop={setScrollTop}
        collapsed={collapsed} hiddenColumns={columns.hidden} commandsRef={commandsRef} onUi={setUi}
        onToggleCollapsed={(id) => setCollapsed((c) => { const s = new Set(c); if (s.has(id)) s.delete(id); else s.add(id); return s })} />
    </>
  )
}
function Harness({ store, canEdit = true, userId }: { store: GanttGridStore; canEdit?: boolean; userId?: string }) {
  return <Workspace store={store} canEdit={canEdit} userId={userId} />
}

const grid = () => screen.getByRole('grid', { name: 'Activities' })
const row = (id: string) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement
const cell = (id: string, col: string) => row(id).querySelector(`[data-col="${col}"]`) as HTMLElement
const renderedRows = () => document.querySelectorAll('[data-row-id]')
const opsOf = (store: ReturnType<typeof storeOf>, call = 0) => store.apply.mock.calls[call][0]
const upsertFor = (ops: ProgrammeOp[], id: string) =>
  ops.find((o) => o.op === 'upsert_activity' && o.id === id) as Extract<ProgrammeOp, { op: 'upsert_activity' }> | undefined

const abc = () => [activityRow('A', { sort_order: 1 }), activityRow('B', { sort_order: 2 }), activityRow('C', { sort_order: 3 })]

let clientHeight: PropertyDescriptor | undefined
beforeAll(() => {
  clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
})
afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
})
// This jsdom build has neither localStorage nor PointerEvent.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
}
beforeEach(() => {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => mem.clear(),
  })
  vi.stubGlobal('PointerEvent', TestPointerEvent)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('GanttGrid: virtualisation', () => {
  it('renders at most 60 row elements for 5,000 activities, and follows the scroll', () => {
    const acts = Array.from({ length: 5000 }, (_, i) => activityRow(`a${i}`, { name: `Task ${i}`, sort_order: i + 1 }))
    const store = storeOf(acts, emptySchedule())
    render(<Harness store={store} />)
    expect(renderedRows().length).toBeGreaterThan(0)
    expect(renderedRows().length).toBeLessThanOrEqual(60)
    expect(row('a0')).not.toBeNull()

    fireEvent.scroll(screen.getByTestId('programme-grid-scroll'), { target: { scrollTop: 28 * 2000 } })
    expect(row('a0')).toBeNull()
    expect(row('a2005')).not.toBeNull()
    expect(row('a2005').style.top).toBe(`${28 * 2005}px`)
    expect(renderedRows().length).toBeLessThanOrEqual(60)
    expect(screen.getByTestId('programme-grid-spacer').style.height).toBe(`${28 * 5000}px`)
  })
})

const INDENT = { key: 'ArrowRight', altKey: true, shiftKey: true }
const OUTDENT = { key: 'ArrowLeft', altKey: true, shiftKey: true }

describe('GanttGrid: indent and outdent', () => {
  it('⌥⇧→ puts the selected row under its previous sibling, which becomes a summary', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.keyDown(grid(), INDENT)
    expect(store.apply).toHaveBeenCalledTimes(1)
    const ops = opsOf(store)
    expect(upsertFor(ops, 'B')?.fields).toEqual({ parent_id: 'A', sort_order: 1 })
    expect(upsertFor(ops, 'A')?.fields).toEqual({ type: 'summary' })
    expect(upsertFor(ops, 'C')?.fields).toEqual({ sort_order: 2 })
    expect(store.apply.mock.calls[0][1]).toBe('Indent')
  })

  it('the Indent and Outdent buttons do the same, and say their keys', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    const indent = screen.getByRole('button', { name: 'Indent' })
    expect(indent.getAttribute('title')).toContain('⌥⇧→')
    expect(screen.getByRole('button', { name: 'Outdent' }).getAttribute('title')).toContain('⌥⇧←')
    fireEvent.click(indent)
    expect(upsertFor(opsOf(store), 'B')?.fields).toEqual({ parent_id: 'A', sort_order: 1 })
  })

  it('Tab is never taken: it is not prevented and makes no op', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    const notPrevented = fireEvent.keyDown(grid(), { key: 'Tab' })
    expect(notPrevented).toBe(true)
    expect(fireEvent.keyDown(grid(), { key: 'Tab', shiftKey: true })).toBe(true)
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('Escape clears the selection', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    expect(row('B').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(grid(), { key: 'Escape' })
    expect(row('B').getAttribute('aria-selected')).toBe('false')
  })

  it('indent on the first row does nothing', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('A', 'name'))
    fireEvent.keyDown(grid(), INDENT)
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('indenting under a milestone is refused with a sentence and no op', () => {
    const store = storeOf([
      activityRow('M', { sort_order: 1, type: 'finish_milestone', original_duration: 0 }),
      activityRow('B', { sort_order: 2 }),
    ])
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.keyDown(grid(), INDENT)
    expect(store.apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('programme-grid-notice').textContent).toContain("A milestone can't have sub-activities.")
  })

  it('⌥⇧← keeps the row in place: its following siblings become its children (MS Project)', () => {
    const store = storeOf([
      activityRow('A', { sort_order: 1, type: 'summary', original_duration: 0 }),
      activityRow('B', { sort_order: 1, parent_id: 'A' }),
      activityRow('C', { sort_order: 2, parent_id: 'A' }),
      activityRow('D', { sort_order: 3, parent_id: 'A' }),
    ])
    render(<Harness store={store} />)
    fireEvent.click(cell('C', 'name'))
    fireEvent.keyDown(grid(), OUTDENT)
    const ops = opsOf(store)
    expect(upsertFor(ops, 'C')?.fields).toEqual({ parent_id: null, type: 'summary' }) // sort_order 2 is unchanged
    expect(upsertFor(ops, 'D')?.fields).toEqual({ parent_id: 'C', sort_order: 1 })
    expect(upsertFor(ops, 'A')).toBeUndefined()
    expect(store.apply.mock.calls[0][1]).toBe('Outdent')
  })

  it('a ⌘-extended selection indents together, keeping its order', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.click(cell('C', 'name'), { metaKey: true })
    fireEvent.keyDown(grid(), INDENT)
    const ops = opsOf(store)
    expect(upsertFor(ops, 'B')?.fields).toEqual({ parent_id: 'A', sort_order: 1 })
    expect(upsertFor(ops, 'C')?.fields).toEqual({ parent_id: 'A', sort_order: 2 })
  })

  it('⌥↓ moves the row down among its siblings', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('A', 'name'))
    fireEvent.keyDown(grid(), { key: 'ArrowDown', altKey: true })
    const ops = opsOf(store)
    expect(upsertFor(ops, 'A')?.fields).toEqual({ sort_order: 2 })
    expect(upsertFor(ops, 'B')?.fields).toEqual({ sort_order: 1 })
    expect(upsertFor(ops, 'C')).toBeUndefined()
  })

  it('collapsing a parent drops its hidden children from the selection', () => {
    const store = storeOf([
      activityRow('P', { sort_order: 1, type: 'summary', original_duration: 0 }),
      activityRow('K', { sort_order: 1, parent_id: 'P' }),
      activityRow('Z', { sort_order: 2 }),
    ])
    render(<Harness store={store} />)
    fireEvent.click(cell('K', 'name'))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse P' }))
    fireEvent.keyDown(grid(), { key: 'Delete' })
    expect(screen.queryByTestId('programme-grid-confirm')).toBeNull()
  })
})

describe('GanttGrid: a refused gesture', () => {
  it('leaves no scroll-into-view waiting: a later row change does not jump back to the old row', () => {
    const acts = Array.from({ length: 200 }, (_, i) => activityRow(`a${i}`, { sort_order: i + 1 }))
    acts[150] = activityRow('a150', { sort_order: 151, type: 'summary', original_duration: 0 })
    acts.push(activityRow('kid', { parent_id: 'a150', sort_order: 1 }))
    const store = storeOf(acts, emptySchedule())
    store.apply.mockReturnValue(false)
    render(<Harness store={store} />)
    fireEvent.click(cell('a0', 'name'))
    fireEvent.keyDown(grid(), { key: 'ArrowDown', altKey: true })
    expect(store.apply).toHaveBeenCalledTimes(1)
    const scroll = screen.getByTestId('programme-grid-scroll')
    fireEvent.scroll(scroll, { target: { scrollTop: 28 * 140 } })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse a150' }))
    expect(scroll.scrollTop).toBe(28 * 140)
  })
})

describe('GanttGrid: inline editing', () => {
  it('double-click on Name edits it; Enter commits one upsert', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.doubleClick(cell('A', 'name'))
    const input = within(row('A')).getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Pour slab' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.apply).toHaveBeenCalledWith([{ op: 'upsert_activity', id: 'A', fields: { name: 'Pour slab' } }], 'Rename')
    expect(within(row('A')).queryByRole('textbox')).toBeNull()
  })

  it('Escape cancels without an op', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.doubleClick(cell('A', 'name'))
    const input = within(row('A')).getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(within(row('A')).queryByRole('textbox')).toBeNull()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('Enter on the grid edits the selected row; a duration commit writes original_duration', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'duration'))
    fireEvent.keyDown(grid(), { key: 'Enter' })
    const input = within(row('B')).getByRole('textbox', { name: 'Duration' })
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.apply).toHaveBeenCalledWith([{ op: 'upsert_activity', id: 'B', fields: { original_duration: 5 } }], 'Change duration')
  })

  it('a duration of zero or not a number is refused and stays open; two decimals are fine', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.doubleClick(cell('B', 'duration'))
    const input = within(row('B')).getByRole('textbox', { name: 'Duration' })
    for (const bad of ['0', 'two', '1.234', '-1']) {
      fireEvent.change(input, { target: { value: bad } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(store.apply).not.toHaveBeenCalled()
      expect(input.getAttribute('aria-invalid')).toBe('true')
    }
    fireEvent.change(input, { target: { value: '2.5d' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.apply).toHaveBeenCalledWith([{ op: 'upsert_activity', id: 'B', fields: { original_duration: 2.5 } }], 'Change duration')
  })

  it('a Start edit sets a start-no-earlier-than constraint on that date', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.doubleClick(cell('C', 'start'))
    const input = row('C').querySelector('input[aria-label="Start"]') as HTMLInputElement
    expect(input.type).toBe('date')
    fireEvent.change(input, { target: { value: '2026-04-06' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.apply).toHaveBeenCalledWith(
      [{ op: 'upsert_activity', id: 'C', fields: { constraint_type: 'snet', constraint_date: '2026-04-06' } }], 'Change start')
  })
})

describe('GanttGrid: start edit that changes nothing', () => {
  it('Enter on the shown start of an unconstrained row adds no constraint', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.doubleClick(cell('A', 'start'))
    const input = row('A').querySelector('input[aria-label="Start"]') as HTMLInputElement
    expect(input.value).toBe(store.schedule.activities.get('A')!.earlyStart)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.apply).not.toHaveBeenCalled()
  })
})

describe('GanttGrid: add and delete', () => {
  it('Add task inserts a new row with a store key below the selection', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('A', 'name'))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    const ops = opsOf(store)
    const create = ops.find((o) => o.op === 'upsert_activity' && o.key !== undefined) as Extract<ProgrammeOp, { op: 'upsert_activity' }>
    expect(create.key).toBe('n1-x')
    expect(create.fields).toEqual({ name: 'New task', type: 'task', original_duration: 1, parent_id: null, sort_order: 2 })
    expect(upsertFor(ops, 'B')?.fields).toEqual({ sort_order: 3 })
    expect(upsertFor(ops, 'C')?.fields).toEqual({ sort_order: 4 })
    expect(store.newKey).toHaveBeenCalledTimes(1)
  })

  it('Add milestone makes a zero-duration finish milestone', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    const create = opsOf(store).find((o) => o.op === 'upsert_activity' && o.key !== undefined) as Extract<ProgrammeOp, { op: 'upsert_activity' }>
    expect(create.fields).toMatchObject({ type: 'finish_milestone', original_duration: 0, sort_order: 4 })
  })

  it('Delete asks first, inline; only the confirm makes the delete op', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.keyDown(grid(), { key: 'Delete' })
    expect(store.apply).not.toHaveBeenCalled()
    expect(screen.getByTestId('programme-grid-confirm').textContent).toContain('Delete 1 activity?')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(store.apply).toHaveBeenCalledWith([{ op: 'delete_activity', id: 'B' }], 'Delete')
  })

  it('Cancel disarms the delete', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('a ⇧-range deletes every row in it, and a summary takes its sub-activities with it (children first)', () => {
    const store = storeOf([
      activityRow('P', { sort_order: 1, type: 'summary', original_duration: 0 }),
      activityRow('K', { sort_order: 1, parent_id: 'P' }),
      activityRow('Q', { sort_order: 2 }),
      activityRow('R', { sort_order: 3 }),
    ])
    render(<Harness store={store} />)
    fireEvent.click(cell('P', 'name'))
    fireEvent.click(cell('Q', 'name'), { shiftKey: true })
    fireEvent.keyDown(grid(), { key: 'Delete' })
    expect(screen.getByTestId('programme-grid-confirm').textContent).toContain('Delete 3 activities?')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    const ids = opsOf(store).map((o) => (o as { id: string }).id)
    expect(opsOf(store).every((o) => o.op === 'delete_activity')).toBe(true)
    expect(new Set(ids)).toEqual(new Set(['P', 'K', 'Q']))
    expect(ids.indexOf('K')).toBeLessThan(ids.indexOf('P'))
  })
})

describe('GanttGrid: read-only', () => {
  it('shows no inputs, no add or delete controls, and keys make no ops', () => {
    const store = storeOf(abc())
    render(<Harness store={store} canEdit={false} />)
    fireEvent.doubleClick(cell('A', 'name'))
    fireEvent.click(cell('B', 'name'))
    fireEvent.keyDown(grid(), { key: 'Enter' })
    fireEvent.keyDown(grid(), INDENT)
    fireEvent.keyDown(grid(), OUTDENT)
    fireEvent.keyDown(grid(), { key: 'Delete' })
    fireEvent.keyDown(grid(), { key: 'ArrowDown', altKey: true })
    expect(document.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Indent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Outdent' })).toBeNull()
    expect(screen.queryByTestId('programme-grid-confirm')).toBeNull()
    expect(store.apply).not.toHaveBeenCalled()
  })
})

describe('GanttGrid: display', () => {
  it('collapse hides descendants and expand brings them back', () => {
    const store = storeOf([
      activityRow('P', { sort_order: 1, type: 'summary', original_duration: 0 }),
      activityRow('K1', { sort_order: 1, parent_id: 'P' }),
      activityRow('K2', { sort_order: 2, parent_id: 'P' }),
      activityRow('Z', { sort_order: 2 }),
    ])
    render(<Harness store={store} />)
    expect(row('K1')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse P' }))
    expect(row('K1')).toBeNull()
    expect(row('K2')).toBeNull()
    expect(row('Z')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand P' }))
    expect(row('K1')).not.toBeNull()
  })

  it('critical rows carry a red left border; summary rows are bold; dates and float come from the schedule', () => {
    const store = storeOf([
      activityRow('P', { sort_order: 1, type: 'summary', original_duration: 0 }),
      activityRow('K', { sort_order: 1, parent_id: 'P', original_duration: 3 }),
    ])
    render(<Harness store={store} />)
    const k = store.schedule.activities.get('K')!
    expect(k.isCritical).toBe(true)
    expect(row('K').dataset.critical).toBe('true')
    expect(row('P').dataset.critical).toBe('false')
    expect(row('P').style.fontWeight).toBe('600')
    expect(row('K').style.fontWeight).not.toBe('600')
    expect(cell('K', 'start').textContent).toBe(k.earlyStart)
    expect(cell('K', 'finish').textContent).toBe(k.earlyFinish)
    expect(cell('K', 'float').textContent).toBe(`${k.totalFloat}d`)
    expect(cell('K', 'duration').textContent).toBe('3d')
    expect(cell('K', 'wbs').textContent).toBe('1.1')
  })

  it('the column picker hides a column and remembers it per user', () => {
    const store = storeOf(abc())
    const { unmount } = render(<Harness store={store} userId="u1" />)
    expect(screen.getByRole('columnheader', { name: 'Total float' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Total float' }))
    expect(screen.queryByRole('columnheader', { name: 'Total float' })).toBeNull()
    expect(cell('A', 'float')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(columnsStorageKey('u1')) ?? '[]')).toEqual(['float'])
    unmount()
    render(<Harness store={store} userId="u1" />)
    expect(screen.queryByRole('columnheader', { name: 'Total float' })).toBeNull()
  })

  it('a storage that throws only means the choice is not remembered', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    render(<Harness store={storeOf(abc())} userId="u1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'WBS' }))
    expect(screen.queryByRole('columnheader', { name: 'WBS' })).toBeNull()
  })

  it('a header drag resizes its column', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    const handle = screen.getByRole('separator', { name: 'Resize Duration' })
    const before = parseFloat(cell('A', 'duration').style.width)
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 140, pointerId: 1 })
    expect(parseFloat(cell('A', 'duration').style.width)).toBe(before + 40)
  })
})

/** The grid over the REAL store, with saves the test answers by hand. */
function LiveHarness({ store }: { store: ProgrammeStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const api: GanttGridStore = { state: snap.state, schedule: scheduleFor(snap.state), apply: store.apply, newKey: store.newKey, keyIds: snap.keyIds }
  return <Workspace store={api} canEdit />
}

describe('GanttGrid: a new row re-keyed by its save', () => {
  it('keeps the open editor, the typed text, the focus and the selection; the rename lands on the uuid row', async () => {
    const answers: Array<(r: SaveProgrammeResult) => void> = []
    const save = vi.fn((_input: SaveProgrammeChangesInput) => new Promise<SaveProgrammeResult>((res) => { answers.push(res) }))
    const view = { state: stateOf(abc()), version: VERSION, activeBaseline: null, baselines: [] } as unknown as ProgrammeViewData
    const store = createProgrammeStore(view, { canEdit: true, save, newKey: () => 'k1' })
    render(<LiveHarness store={store} />)

    fireEvent.click(cell('A', 'name'))
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    // Add opens the new row's Name for typing.
    const input = within(row('key:k1')).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Pour slab' } })
    expect(save).toHaveBeenCalledTimes(1)

    await act(async () => { answers[0]({ ok: true, version: '2026-11-17T09:00:00Z', ids: { k1: 'U1' }, issues: [] }) })

    expect(row('key:k1')).toBeNull()
    expect(row('U1').getAttribute('aria-selected')).toBe('true')
    const same = within(row('U1')).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(same).toBe(input)
    expect(same.value).toBe('Pour slab')
    expect(document.activeElement).toBe(same)

    fireEvent.keyDown(same, { key: 'Enter' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].ops).toEqual([{ op: 'upsert_activity', id: 'U1', fields: { name: 'Pour slab' } }])
  })
})

describe('GanttGrid: grouped rows', () => {
  function grouped(onToggle = vi.fn()) {
    const base = stateOf(abc())
    const state = {
      ...base,
      codeTypes: [{ id: 'T1', name: 'Trade', programme_id: 'P', sort_order: 1 }],
      codeValues: [{ id: 'V1', code_type_id: 'T1', value: 'Civil' }, { id: 'V2', code_type_id: 'T1', value: 'Electrical' }],
      activityCodes: [
        { activity_id: 'A', code_type_id: 'T1', code_value_id: 'V1' }, { activity_id: 'B', code_type_id: 'T1', code_value_id: 'V2' },
        { activity_id: 'C', code_type_id: 'T1', code_value_id: 'V2' },
      ],
    } as unknown as ProgrammeState
    const store = { ...storeOf([]), state, schedule: scheduleProgramme(rowsToProgrammeInput(state)) }
    const rows = buildDisplayRows(state, store.schedule, { collapsed: new Set(), filters: NO_FILTERS, groupBy: 'T1' })
    const apply = store.apply
    const onUi = vi.fn()
    render(<GanttGrid store={store} canEdit scrollTop={0} onScrollTop={() => {}} collapsed={new Set()} onToggleCollapsed={onToggle} rows={rows} onUi={onUi} />)
    return { apply, rows, onUi }
  }

  it('shows a header row per group, with its count, and the members under it', () => {
    grouped()
    const headers = [...document.querySelectorAll('[data-group-id]')]
    expect(headers.map((h) => h.getAttribute('data-group-id'))).toEqual(['group:V1', 'group:V2'])
    expect(headers[1].textContent).toContain('Electrical')
    expect(headers[1].textContent).toContain('2 activities')
    expect([...renderedRows()].map((r) => r.getAttribute('data-row-id'))).toEqual(['A', 'B', 'C'])
  })

  it('a click on a header toggles its group and selects nothing', () => {
    const onToggle = vi.fn()
    grouped(onToggle)
    fireEvent.click(document.querySelector('[data-group-id="group:V1"]')!)
    expect(onToggle).toHaveBeenCalledWith('group:V1')
    expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(0)
  })

  it('the arrow keys step over a header onto the next activity', () => {
    grouped()
    fireEvent.click(cell('A', 'name'))
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(row('B').getAttribute('aria-selected')).toBe('true')
  })

  it('a shift-range across a header selects activities only', () => {
    const { apply, onUi } = grouped()
    fireEvent.click(cell('A', 'name'))
    fireEvent.click(cell('B', 'name'), { shiftKey: true })
    expect(row('A').getAttribute('aria-selected')).toBe('true')
    expect(row('B').getAttribute('aria-selected')).toBe('true')
    // The header between them (group:V2) must not be in the selection.
    expect(onUi.mock.calls.at(-1)![0].selectedCount).toBe(2)
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('GanttGrid: no footer', () => {
  it('ends in its rows: no footer, no column picker of its own', () => {
    render(<Harness store={storeOf(abc())} />)
    expect(screen.queryByTestId('programme-grid-footer')).toBeNull()
    expect(within(grid().parentElement!).queryByRole('button', { name: 'Columns' })).toBeNull()
  })
})
