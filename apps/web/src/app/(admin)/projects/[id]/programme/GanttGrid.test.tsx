import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  rowsToProgrammeInput, scheduleProgramme, type ProgrammeOp, type ProgrammeState, type ScheduleResult,
} from '@esite/shared/programme'
import { activityRow, calendarRow, programmeRow } from '@/lib/programme/test-fixtures'
import { GanttGrid, columnsStorageKey, type GanttGridStore } from './GanttGrid'

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
  } satisfies GanttGridStore
}

function Harness({ store, canEdit = true, userId }: { store: GanttGridStore; canEdit?: boolean; userId?: string }) {
  const [scrollTop, setScrollTop] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  return (
    <GanttGrid store={store} canEdit={canEdit} scrollTop={scrollTop} onScrollTop={setScrollTop} userId={userId}
      collapsed={collapsed}
      onToggleCollapsed={(id) => setCollapsed((c) => { const s = new Set(c); if (s.has(id)) s.delete(id); else s.add(id); return s })} />
  )
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

describe('GanttGrid: indent and outdent', () => {
  it('Tab puts the selected row under its previous sibling, which becomes a summary', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.keyDown(grid(), { key: 'Tab' })
    expect(store.apply).toHaveBeenCalledTimes(1)
    const ops = opsOf(store)
    expect(upsertFor(ops, 'B')?.fields).toEqual({ parent_id: 'A', sort_order: 1 })
    expect(upsertFor(ops, 'A')?.fields).toEqual({ type: 'summary' })
    expect(upsertFor(ops, 'C')?.fields).toEqual({ sort_order: 2 })
    expect(store.apply.mock.calls[0][1]).toBe('Indent')
  })

  it('Tab on the first row does nothing', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('A', 'name'))
    fireEvent.keyDown(grid(), { key: 'Tab' })
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('⇧Tab moves the row to its grandparent, after its old parent; an emptied summary becomes a task', () => {
    const store = storeOf([
      activityRow('A', { sort_order: 1, type: 'summary', original_duration: 0 }),
      activityRow('B', { sort_order: 1, parent_id: 'A' }),
      activityRow('C', { sort_order: 2 }),
    ])
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.keyDown(grid(), { key: 'Tab', shiftKey: true })
    const ops = opsOf(store)
    expect(upsertFor(ops, 'B')?.fields).toEqual({ parent_id: null, sort_order: 2 })
    expect(upsertFor(ops, 'C')?.fields).toEqual({ sort_order: 3 })
    expect(upsertFor(ops, 'A')?.fields).toEqual({ type: 'task', original_duration: 1 })
    expect(store.apply.mock.calls[0][1]).toBe('Outdent')
  })

  it('a ⌘-extended selection indents together, keeping its order', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.click(cell('B', 'name'))
    fireEvent.click(cell('C', 'name'), { metaKey: true })
    fireEvent.keyDown(grid(), { key: 'Tab' })
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

  it('a duration that is not a whole number of days is refused and stays open', () => {
    const store = storeOf(abc())
    render(<Harness store={store} />)
    fireEvent.doubleClick(cell('B', 'duration'))
    const input = within(row('B')).getByRole('textbox', { name: 'Duration' })
    fireEvent.change(input, { target: { value: '2.5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.apply).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
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
    fireEvent.keyDown(grid(), { key: 'Tab' })
    fireEvent.keyDown(grid(), { key: 'Delete' })
    fireEvent.keyDown(grid(), { key: 'ArrowDown', altKey: true })
    expect(document.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
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
