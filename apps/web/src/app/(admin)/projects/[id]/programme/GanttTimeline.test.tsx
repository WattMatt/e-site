import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  applyOps, barX, rowsToProgrammeInput, scheduleProgramme, timescale,
  type ProgrammeOp, type ProgrammeState, type ScheduleResult, type Zoom,
} from '@esite/shared/programme'
import { activityRow, calendarRow, dependencyRow, programmeRow } from '@/lib/programme/test-fixtures'
import type { ActiveBaselineView } from '@/lib/programme/view-types'
import { GanttTimeline, type GanttTimelineStore } from './GanttTimeline'

vi.mock('@/actions/programme.actions', () => ({ saveProgrammeChangesAction: vi.fn(), programmeVersionAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

type Row = Record<string, unknown>

function stateOf(activities: Row[], dependencies: Row[] = [], programme: Row = {}, exceptions: Row[] = []): ProgrammeState {
  return {
    programme: programmeRow(programme), calendars: [calendarRow('SITE')], exceptions,
    activities, dependencies, codeTypes: [], codeValues: [], activityCodes: [],
    fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
  } as unknown as ProgrammeState
}

function storeOf(activities: Row[], dependencies: Row[] = [], opts: { schedule?: ScheduleResult; programme?: Row; apply?: boolean; exceptions?: Row[] } = {}) {
  const state = stateOf(activities, dependencies, opts.programme, opts.exceptions)
  let n = 0
  return {
    state,
    schedule: opts.schedule ?? scheduleProgramme(rowsToProgrammeInput(state)),
    apply: vi.fn((_ops: ProgrammeOp[], _label: string) => opts.apply ?? true),
    newKey: vi.fn(() => `n${++n}-x`),
    keyIds: {},
  } satisfies GanttTimelineStore
}

function Harness({ store, canEdit = true, baseline = null, today = null, onSelect = () => {}, onZoom, initialZoom = 'day' }: {
  store: GanttTimelineStore; canEdit?: boolean; baseline?: ActiveBaselineView | null; today?: string | null
  onSelect?: (id: string, mode: 'only' | 'toggle') => void; onZoom?: (z: Zoom) => void; initialZoom?: Zoom
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const [zoom, setZoom] = useState<Zoom>(initialZoom)
  return (
    <GanttTimeline store={store} canEdit={canEdit} scrollTop={scrollTop} onScrollTop={setScrollTop} collapsed={new Set()}
      selected={new Set()} onSelect={onSelect} activeBaseline={baseline} today={today}
      zoom={zoom} onZoom={(z) => { onZoom?.(z); setZoom(z) }} />
  )
}

// Fixture A (2d) then B (2d) from Mon 2026-03-02. Day zoom: origin 2026-02-23, 36 px a day.
// A: x 252..324 in row 0 (centre y 14); B: x 324..396 in row 1 (centre y 42) when linked FS.
const two = () => [activityRow('A', { sort_order: 1 }), activityRow('B', { sort_order: 2 })]
const linked = () => [dependencyRow('D1', 'A', 'B')]

const body = () => screen.getByTestId('programme-timeline-body')
const bar = (id: string) => document.querySelector(`[data-bar-id="${id}"]`) as SVGGElement | null
const opsOf = (store: ReturnType<typeof storeOf>, call = 0) => store.apply.mock.calls[call][0]

function drag(from: [number, number], to: [number, number], opts: { cancel?: boolean } = {}) {
  const el = body()
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], pointerId: 1, button: 0 })
  fireEvent.pointerMove(el, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 1 })
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1 })
  if (opts.cancel) fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 })
}

let clientHeight: PropertyDescriptor | undefined
let clientWidth: PropertyDescriptor | undefined
beforeAll(() => {
  clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
})
afterAll(() => {
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})
// This jsdom build has no PointerEvent.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
}
beforeEach(() => { vi.stubGlobal('PointerEvent', TestPointerEvent) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('GanttTimeline: drawing', () => {
  it('renders at most 60 bar groups for 5,000 activities, and only links touching visible rows', () => {
    const acts = Array.from({ length: 5000 }, (_, i) => activityRow(`a${i}`, { sort_order: i + 1, original_duration: 1 }))
    const deps = Array.from({ length: 4999 }, (_, i) => dependencyRow(`d${i}`, `a${i}`, `a${i + 1}`))
    const store = storeOf(acts, deps)
    render(<Harness store={store} initialZoom="year" />)
    const bars = document.querySelectorAll('[data-bar-id]')
    expect(bars.length).toBeGreaterThan(0)
    expect(bars.length).toBeLessThanOrEqual(60)
    expect(document.querySelectorAll('[data-link-id]').length).toBeLessThanOrEqual(61)
    expect(bar('a0')).not.toBeNull()

    fireEvent.scroll(screen.getByTestId('programme-timeline-scroll'), { target: { scrollTop: 28 * 2000 } })
    expect(bar('a0')).toBeNull()
    expect(bar('a2005')).not.toBeNull()
    expect(document.querySelectorAll('[data-bar-id]').length).toBeLessThanOrEqual(60)
    expect(screen.getByTestId('programme-timeline-spacer').style.height).toBe(`${28 * 5000}px`)
  })

  it('task bars at their dates, critical in red; % complete is an inner fill; a milestone is a diamond; a summary a bracket', () => {
    const store = storeOf([
      activityRow('S', { type: 'summary', sort_order: 1, original_duration: 0 }),
      activityRow('A', { parent_id: 'S', sort_order: 1, percent_complete: 50 }),
      activityRow('M', { type: 'finish_milestone', original_duration: 0, sort_order: 2 }),
    ], [dependencyRow('D1', 'A', 'M')])
    render(<Harness store={store} />)
    const a = bar('A')!.querySelector('[data-part="bar"]')!
    expect(a.getAttribute('x')).toBe('252')
    expect(a.getAttribute('width')).toBe('72')
    expect(a.getAttribute('fill')).toBe('var(--c-red)')
    expect(bar('A')!.querySelector('[data-part="progress"]')!.getAttribute('width')).toBe('36')
    expect(bar('M')!.querySelector('[data-part="milestone"]')).not.toBeNull()
    expect(bar('S')!.querySelector('[data-part="summary"]')!.getAttribute('fill')).toBe('var(--c-text)')
    expect(document.querySelector('[data-link-id="D1"]')).not.toBeNull()
  })

  it('a non-critical bar is amber with a float tail; the baseline sits under the bar', () => {
    const store = storeOf([
      activityRow('A', { sort_order: 1, original_duration: 5 }),
      activityRow('B', { sort_order: 2, original_duration: 1 }),
    ])
    render(<Harness store={store} baseline={{ id: 'BL', name: 'Baseline 1', activities: { B: { early_start: '2026-03-02', early_finish: '2026-03-06' } } }} />)
    const b = bar('B')!
    expect(b.querySelector('[data-part="bar"]')!.getAttribute('fill')).toBe('var(--c-amber)')
    expect(b.querySelector('[data-part="float"]')).not.toBeNull()
    const base = b.querySelector('[data-part="baseline"]')!
    expect(base.getAttribute('width')).toBe(String(5 * 36))
    expect(base.getAttribute('fill')).toBe('var(--c-text-dim)')
    expect(bar('A')!.querySelector('[data-part="baseline"]')).toBeNull()
  })

  it('the data date is a dashed line and today a solid, labelled one; the header draws both bands', () => {
    const store = storeOf(two(), linked(), { programme: { data_date: '2026-03-03' } })
    render(<Harness store={store} today="2026-03-04" />)
    const dd = screen.getByTestId('timeline-data-date')
    expect(dd.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(dd.getAttribute('x1')).toBe(String(8 * 36))
    const today = screen.getByTestId('timeline-today')
    expect(today.getAttribute('stroke-dasharray')).toBeNull()
    expect(today.getAttribute('x1')).toBe(String(9 * 36))
    const header = screen.getByTestId('programme-timeline-header')
    expect(within(header).getByText('Today')).toBeTruthy()
    expect(within(header).getByText('Mar 2026')).toBeTruthy()
    expect(within(header).getAllByText('2').length).toBeGreaterThan(0)
  })
})

describe('GanttTimeline: drag', () => {
  it('dragging a task body moves it: one SNET op at the snapped working day', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    // Three days right of Mon 2 is Thu 5.
    drag([280, 14], [280 + 3 * 36, 14])
    expect(store.apply).toHaveBeenCalledTimes(1)
    expect(opsOf(store)).toEqual([{ op: 'upsert_activity', id: 'A', fields: { constraint_type: 'snet', constraint_date: '2026-03-05' } }])
    expect(store.apply.mock.calls[0][1]).toBe('Move')
  })

  it('a drop on a weekend snaps forward to Monday', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    drag([280, 14], [280 + 5 * 36, 14])
    expect(opsOf(store)).toEqual([{ op: 'upsert_activity', id: 'A', fields: { constraint_type: 'snet', constraint_date: '2026-03-09' } }])
  })

  it('shows the preview while dragging and commits nothing until the pointer is released', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    fireEvent.pointerDown(body(), { clientX: 280, clientY: 14, pointerId: 1, button: 0 })
    fireEvent.pointerMove(body(), { clientX: 280 + 36, clientY: 14, pointerId: 1 })
    expect(screen.getByTestId('timeline-preview').getAttribute('x')).toBe(String(252 + 36))
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('dragging the right edge resizes: original_duration in working days', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    // A ends at x 324 (end of Tue 3). Two days right: finish Thu 5, so 4 working days.
    drag([321, 14], [321 + 2 * 36, 14])
    expect(store.apply).toHaveBeenCalledTimes(1)
    expect(opsOf(store)).toEqual([{ op: 'upsert_activity', id: 'A', fields: { original_duration: 4 } }])
    expect(store.apply.mock.calls[0][1]).toBe('Change duration')
  })

  it('dragging from the end handle to another bar creates one FS link with lag 0 and a new key', () => {
    const store = storeOf(two())
    render(<Harness store={store} />)
    // Unlinked, both start Mon 2: A and B are x 252..324; A's handle is at x 332.
    drag([332, 14], [290, 42])
    expect(store.apply).toHaveBeenCalledTimes(1)
    expect(opsOf(store)).toEqual([{ op: 'upsert_dependency', key: 'n1-x', pred: 'A', succ: 'B', type: 'FS', lag: 0 }])
    expect(store.apply.mock.calls[0][1]).toBe('Link')
  })

  it('a link dropped on nothing, or back on its own bar, does nothing', () => {
    const store = storeOf(two())
    render(<Harness store={store} />)
    drag([332, 14], [900, 300])
    drag([332, 14], [290, 14])
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('Escape cancels a drag', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    drag([280, 14], [280 + 3 * 36, 14], { cancel: true })
    expect(store.apply).not.toHaveBeenCalled()
    expect(screen.queryByTestId('timeline-preview')).toBeNull()
  })

  it('summaries are not dragged; a milestone moves but has no resize edge', () => {
    const store = storeOf([
      activityRow('S', { type: 'summary', sort_order: 1, original_duration: 0 }),
      activityRow('A', { parent_id: 'S', sort_order: 1 }),
      activityRow('M', { type: 'start_milestone', sort_order: 2, original_duration: 0 }),
    ])
    render(<Harness store={store} />)
    drag([280, 14], [280 + 3 * 36, 14])
    expect(store.apply).not.toHaveBeenCalled()
    // M (row 2, centre y 70) is a diamond at the start of Mon 2, x 252: a drag just right of its centre moves it.
    drag([254, 70], [254 + 2 * 36, 70])
    expect(store.apply).toHaveBeenCalledTimes(1)
    expect(opsOf(store)).toEqual([{ op: 'upsert_activity', id: 'M', fields: { constraint_type: 'snet', constraint_date: '2026-03-04' } }])
  })

  it('read-only: no handles, and a drag produces no op', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} canEdit={false} />)
    expect(document.querySelector('[data-part="handle"]')).toBeNull()
    drag([280, 14], [280 + 3 * 36, 14])
    drag([321, 14], [321 + 2 * 36, 14])
    drag([332, 14], [350, 42])
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('a click on a bar (no movement) selects its row', () => {
    const onSelect = vi.fn()
    const store = storeOf(two(), linked())
    render(<Harness store={store} onSelect={onSelect} />)
    drag([280, 14], [280, 14])
    expect(store.apply).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith('A', 'only')
  })

  it('the move preview spans the working days the engine will schedule (weekend and holiday inside)', () => {
    const holiday = [{ id: 'E1', calendar_id: 'SITE', day: '2026-03-09', kind: 'non_work', label: 'Holiday' }]
    const store = storeOf([activityRow('A', { sort_order: 1, original_duration: 5 })], [], { exceptions: holiday })
    render(<Harness store={store} />)
    // A: Mon 2 – Fri 6. Two days right: starts Wed 4, so Wed 4, Thu 5, Fri 6, Tue 10, Wed 11.
    fireEvent.pointerDown(body(), { clientX: 280, clientY: 14, pointerId: 1, button: 0 })
    fireEvent.pointerMove(body(), { clientX: 280 + 2 * 36, clientY: 14, pointerId: 1 })
    const pv = screen.getByTestId('timeline-preview')
    const shown = { x: Number(pv.getAttribute('x')), width: Number(pv.getAttribute('width')) }
    fireEvent.pointerUp(body(), { clientX: 280 + 2 * 36, clientY: 14, pointerId: 1 })
    expect(store.apply).toHaveBeenCalledTimes(1)
    const after = scheduleProgramme(rowsToProgrammeInput(applyOps(store.state, opsOf(store)))).activities.get('A')!
    expect(after.earlyFinish).toBe('2026-03-11')
    expect(shown).toEqual(barX(timescale('2026-03-02', '2026-03-06', 'day'), after.earlyStart, after.earlyFinish))
  })

  it('the resize preview ends where the engine will finish: a drop on a weekend previews the Friday', () => {
    const holiday = [{ id: 'E1', calendar_id: 'SITE', day: '2026-03-09', kind: 'non_work', label: 'Holiday' }]
    const store = storeOf([activityRow('A', { sort_order: 1, original_duration: 5 })], [], { exceptions: holiday })
    render(<Harness store={store} />)
    const scale = timescale('2026-03-02', '2026-03-06', 'day')
    // A ends at x 432 (end of Fri 6). One day right lands on Sat 7: still Fri 6.
    fireEvent.pointerDown(body(), { clientX: 429, clientY: 14, pointerId: 1, button: 0 })
    fireEvent.pointerMove(body(), { clientX: 429 + 36, clientY: 14, pointerId: 1 })
    expect(Number(screen.getByTestId('timeline-preview').getAttribute('width'))).toBe(barX(scale, '2026-03-02', '2026-03-06').width)
    // Four days right lands on Tue 10 (Mon 9 is a holiday): 6 working days, finishing Tue 10.
    fireEvent.pointerMove(body(), { clientX: 429 + 4 * 36, clientY: 14, pointerId: 1 })
    const width = Number(screen.getByTestId('timeline-preview').getAttribute('width'))
    fireEvent.pointerUp(body(), { clientX: 429 + 4 * 36, clientY: 14, pointerId: 1 })
    expect(opsOf(store)).toEqual([{ op: 'upsert_activity', id: 'A', fields: { original_duration: 6 } }])
    const after = scheduleProgramme(rowsToProgrammeInput(applyOps(store.state, opsOf(store)))).activities.get('A')!
    expect(after.earlyFinish).toBe('2026-03-10')
    expect(width).toBe(barX(scale, after.earlyStart, after.earlyFinish).width)
  })

  it('a click on the first pixels of an FS link (over the handle zone) opens the link, not a drag', () => {
    const onSelect = vi.fn()
    const store = storeOf(two(), linked())
    render(<Harness store={store} onSelect={onSelect} />)
    const hit = document.querySelector('[data-link-id="D1"] [data-part="link-hit"]') as Element
    // A ends at x 324; its handle zone is centred at 332 on y 14, where the link's first stub runs.
    fireEvent.pointerDown(hit, { clientX: 330, clientY: 14, pointerId: 1, button: 0 })
    fireEvent.pointerUp(hit, { clientX: 330, clientY: 14, pointerId: 1 })
    fireEvent.click(hit)
    expect(onSelect).not.toHaveBeenCalled()
    expect(store.apply).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Link A → B' })).toBeTruthy()
  })

  it('a refused move leaves nothing pending: the next drag still works', () => {
    const store = storeOf(two(), linked(), { apply: false })
    render(<Harness store={store} />)
    drag([280, 14], [280 + 3 * 36, 14])
    drag([280, 14], [280 + 36, 14])
    expect(store.apply).toHaveBeenCalledTimes(2)
  })
})

describe('GanttTimeline: link dialog', () => {
  const linkHit = (id: string) => document.querySelector(`[data-link-id="${id}"] [data-part="link-hit"]`) as Element

  it('a click on a link opens the dialog; Save sends one op with the changed type, lag and unit', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    fireEvent.click(linkHit('D1'))
    const dialog = screen.getByRole('dialog', { name: 'Link A → B' })
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'SS' } })
    fireEvent.change(within(dialog).getByLabelText('Lag'), { target: { value: '2' } })
    fireEvent.change(within(dialog).getByLabelText('Lag unit'), { target: { value: 'elapsed_days' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(opsOf(store)).toEqual([{ op: 'upsert_dependency', id: 'D1', type: 'SS', lag: 2, lag_unit: 'elapsed_days' }])
    expect(store.apply.mock.calls[0][1]).toBe('Edit link')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a lag that is not a number is refused in place', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    fireEvent.click(linkHit('D1'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Lag'), { target: { value: 'soon' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(store.apply).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText('Lag').getAttribute('aria-invalid')).toBe('true')
  })

  it('Delete asks once more, then sends one delete op', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} />)
    fireEvent.click(linkHit('D1'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete link' }))
    expect(store.apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(opsOf(store)).toEqual([{ op: 'delete_dependency', id: 'D1' }])
    expect(store.apply.mock.calls[0][1]).toBe('Delete link')
  })

  it('read-only: the dialog shows the link with no way to change it', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} canEdit={false} />)
    fireEvent.click(linkHit('D1'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Finish to start')
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Delete link' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('GanttTimeline: zoom and navigation', () => {
  it('a mouse wheel notch with ⌘/Ctrl steps one level and stops the page zoom; a plain wheel does nothing', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const onZoom = vi.fn()
    const store = storeOf(two(), linked())
    render(<Harness store={store} onZoom={onZoom} initialZoom="week" />)
    const scroll = screen.getByTestId('programme-timeline-scroll')
    expect(fireEvent.wheel(scroll, { deltaY: 120 })).toBe(true)
    expect(onZoom).not.toHaveBeenCalled()
    expect(fireEvent.wheel(scroll, { deltaY: -120, metaKey: true })).toBe(false)
    expect(onZoom).toHaveBeenCalledTimes(1)
    expect(onZoom).toHaveBeenLastCalledWith('day')
    now += 200
    // One large notch is still one level.
    fireEvent.wheel(scroll, { deltaY: 480, ctrlKey: true })
    expect(onZoom).toHaveBeenCalledTimes(2)
    expect(onZoom).toHaveBeenLastCalledWith('week')
  })

  it('a trackpad pinch (many small ctrl+wheel deltas) steps one level per ~120 units, at most one per 150 ms', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const onZoom = vi.fn()
    const store = storeOf(two(), linked())
    render(<Harness store={store} onZoom={onZoom} initialZoom="week" />)
    const scroll = screen.getByTestId('programme-timeline-scroll')
    // 40 events of 4 units, 5 ms apart: 160 units in 200 ms is one level, not five.
    for (let i = 0; i < 40; i++) { fireEvent.wheel(scroll, { deltaY: 4, ctrlKey: true }); now += 5 }
    expect(onZoom).toHaveBeenCalledTimes(1)
    expect(onZoom).toHaveBeenLastCalledWith('month')
    // A change of direction starts counting again: 60 back is not enough.
    now += 200
    for (let i = 0; i < 15; i++) { fireEvent.wheel(scroll, { deltaY: -4, ctrlKey: true }); now += 5 }
    expect(onZoom).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 20; i++) { fireEvent.wheel(scroll, { deltaY: -4, ctrlKey: true }); now += 5 }
    expect(onZoom).toHaveBeenCalledTimes(2)
    expect(onZoom).toHaveBeenLastCalledWith('week')
  })

  it('the zoom picker, Fit programme and Scroll to today', () => {
    const onZoom = vi.fn()
    const store = storeOf(two(), linked())
    render(<Harness store={store} onZoom={onZoom} today="2026-03-04" initialZoom="year" />)
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: 'month' } })
    expect(onZoom).toHaveBeenLastCalledWith('month')
    // 4 days + 14 days of padding = 18 days fit 1,000 px at day zoom.
    fireEvent.click(screen.getByRole('button', { name: 'Fit programme' }))
    expect(onZoom).toHaveBeenLastCalledWith('day')
  })

  it('Scroll to today centres today, even when today is past the end of the programme', () => {
    const store = storeOf(two(), linked())
    render(<Harness store={store} today="2026-06-01" initialZoom="day" />)
    const scroll = screen.getByTestId('programme-timeline-scroll')
    scroll.scrollLeft = 0
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to today' }))
    // Origin 2026-02-23; 2026-06-01 is 98 days later.
    expect(scroll.scrollLeft).toBe(98 * 36 - 500)
    expect(parseFloat(screen.getByTestId('programme-timeline-spacer').style.width)).toBeGreaterThan(98 * 36)
  })
})
