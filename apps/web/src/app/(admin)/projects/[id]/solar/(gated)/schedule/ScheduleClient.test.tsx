import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import type { ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from '@/lib/solar/schedule/types'

const h = vi.hoisted(() => ({
  load: vi.fn(), create: vi.fn(), update: vi.fn(), del: vi.fn(), reorder: vi.fn(),
  addLink: vi.fn(), updateLink: vi.fn(), removeLink: vi.fn(), saveBaseline: vi.fn(), deleteBaseline: vi.fn(), loadBaseline: vi.fn(),
  savePreset: vi.fn(), deletePreset: vi.fn(), saveSettings: vi.fn(), applyTemplate: vi.fn(), templateCount: vi.fn(),
}))
vi.mock('@/actions/solar-schedule.actions', () => ({
  loadScheduleAction: h.load, createScheduleTasksAction: h.create, updateScheduleTasksAction: h.update,
  deleteScheduleTasksAction: h.del, reorderScheduleTasksAction: h.reorder,
}))
vi.mock('@/actions/solar-schedule-meta.actions', () => ({
  addScheduleLinkAction: h.addLink, updateScheduleLinkAction: h.updateLink, removeScheduleLinkAction: h.removeLink,
  saveBaselineAction: h.saveBaseline, deleteBaselineAction: h.deleteBaseline, loadBaselineTasksAction: h.loadBaseline,
  saveFilterPresetAction: h.savePreset, deleteFilterPresetAction: h.deletePreset, saveScheduleSettingsAction: h.saveSettings,
}))
vi.mock('@/actions/solar-schedule-template.actions', () => ({ applyScheduleTemplateAction: h.applyTemplate, scheduleTemplateCountAction: h.templateCount }))
vi.mock('@/actions/solar-schedule-import.actions', () => ({ commitScheduleImportAction: vi.fn() }))
// Konva cannot render under jsdom: the real client loads GanttCanvas through next/dynamic({ ssr: false });
// this stub drives the same callbacks the canvas reports.
vi.mock('./GanttCanvas', () => ({
  GanttCanvas: forwardRef(function Stub(p: {
    onBarDrag: (...a: unknown[]) => void; onLinkDraw: (a: string, b: string) => void; onOpenLink: (k: string) => void
  }, ref) {
    useImperativeHandle(ref, () => ({ exportPng: () => 'data:image/png;base64,AA', scrollToX: vi.fn(), scrollBy: vi.fn() }))
    return (
      <div>
        <button type="button" onClick={() => p.onBarDrag('t1', 'move', 2, null)}>stub drag t1</button>
        <button type="button" onClick={() => p.onBarDrag('t4', 'segment', 1, 1)}>stub move segment t4</button>
        <button type="button" onClick={() => p.onLinkDraw('t2', 't1')}>stub link t2 t1</button>
        <button type="button" onClick={() => p.onLinkDraw('t1', 't3')}>stub link t1 t3</button>
        <button type="button" onClick={() => p.onOpenLink('t1>t2')}>stub open link t1 t2</button>
      </div>
    )
  }),
}))

import { ScheduleClient } from './ScheduleClient'

const P = 'p1'
const task = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id.slice(1)}`, name: `Task ${id}`, category: '', zone: '', start: '2026-10-01', end: '2026-10-05',
  isMilestone: false, status: 'not_started', awaitingSignOff: false, gatekeeperId: null, progress: 0, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
  sortOrder: Number(id.slice(1)), description: '', updatedAt: 'U1', segments: [], ...over,
})
const data = (over: Partial<ScheduleData> = {}): ScheduleData => ({
  projectId: P, projectName: 'KINGSWALK', canEdit: true, currentUserId: 'u1', today: '2026-09-28',
  tasks: [task('t1'), task('t2', { start: '2026-10-06', end: '2026-10-08' }), task('t3', { start: '2026-10-09', end: '2026-10-09' })],
  links: [{ id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 0 }],
  owners: [{ id: 'u1', name: 'Ann', email: 'a@x' }], baselines: [], presets: [],
  settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null }, ...over,
})
const key = (k: string, mods: Record<string, boolean> = {}) => fireEvent.keyDown(window, { key: k, ...mods })
/** GanttCanvas arrives through next/dynamic, so the first query waits for it. */
const stub = (name: string) => screen.findByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  h.update.mockResolvedValue({ ok: true, updated: [] })
  h.del.mockResolvedValue({ ok: true, removed: 1 })
  h.create.mockResolvedValue({ ok: true, ids: { t1: 't9' } })
  h.addLink.mockResolvedValue({ ok: true, id: 'd2' })
  h.removeLink.mockResolvedValue({ ok: true })
  h.load.mockResolvedValue({ ok: true, data: data() })
})

describe('ScheduleClient', () => {
  it('a drag is one undo step; undo and redo apply real inverse updates with fresh tokens', async () => {
    const moved = data({ tasks: [task('t1', { start: '2026-10-03', end: '2026-10-07', updatedAt: 'U2' }), ...data().tasks.slice(1)] })
    h.load.mockResolvedValue({ ok: true, data: moved })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(await stub('stub drag t1'))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ projectId: P, patches: [{ id: 't1', start: '2026-10-03', end: '2026-10-07', expectedUpdatedAt: 'U1' }] }))
    await waitFor(() => expect(h.load).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false))
    h.load.mockResolvedValue({ ok: true, data: data({ tasks: [task('t1', { updatedAt: 'U3' }), ...data().tasks.slice(1)] }) })
    await act(async () => { key('z', { ctrlKey: true }) })
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith({ projectId: P, patches: [{ id: 't1', start: '2026-10-01', end: '2026-10-05', expectedUpdatedAt: 'U2' }] }))
    expect(await screen.findByText('Undone: Move task.')).toBeTruthy()
    await act(async () => { key('Z', { metaKey: true, shiftKey: true }) })
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith({ projectId: P, patches: [{ id: 't1', start: '2026-10-03', end: '2026-10-07', expectedUpdatedAt: 'U3' }] }))
  })

  it('never sends an update without a token: if the task has gone, undo says so and clears the history', async () => {
    // Someone else deleted t1 meanwhile: the refresh after the drag no longer has it.
    h.load.mockResolvedValue({ ok: true, data: data({ tasks: data().tasks.slice(1), links: [] }) })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(await stub('stub drag t1'))
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { key('z', { ctrlKey: true }) })
    expect(await screen.findByText('Undo could not be applied: That task is no longer on this schedule. Reload to see the current programme. The undo history was cleared.')).toBeTruthy()
    expect(h.update).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('moving one segment is one undoable update of the segments', async () => {
    const split = task('t4', { start: '2026-10-01', end: '2026-10-10', segments: [{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-06', end: '2026-10-10' }], updatedAt: 'S1' })
    render(<ScheduleClient initial={data({ tasks: [...data().tasks, split] })} />)
    fireEvent.click(await stub('stub move segment t4'))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ projectId: P, patches: [{
      id: 't4', expectedUpdatedAt: 'S1', segments: [{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-07', end: '2026-10-11' }],
    }] }))
  })

  it('Delete arms a confirm; undo of a delete re-creates the task and its links, then redo deletes the NEW id', async () => {
    h.load.mockResolvedValue({ ok: true, data: data({ tasks: data().tasks.slice(1), links: [] }) })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-1' }))
    key('Delete')
    expect(h.del).not.toHaveBeenCalled()
    // The RPC voids the work items: say so, not "closed" (closed means signed off).
    expect(screen.getByText('Delete 1 task? It is removed (voided) from the programme and from My Work, and its links are removed. Undo brings it back as a new work item.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: delete 1 task' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: P, taskIds: ['t1'] }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false))
    // The re-created task comes back as a NEW work item with a new id.
    h.load.mockResolvedValue({ ok: true, data: data({
      tasks: [task('t9', { ref: 'SOLAR-9', updatedAt: 'U9' }), ...data().tasks.slice(1)],
      links: [{ id: 'd5', predecessorId: 't9', successorId: 't2', type: 'FS', lagDays: 0 }],
    }) })
    await act(async () => { key('z', { ctrlKey: true }) })
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({
      projectId: P,
      tasks: [expect.objectContaining({ key: 't1', name: 'Task t1', start: '2026-10-01', end: '2026-10-05' })],
      links: [{ from: 't1', to: 't2', type: 'FS', lagDays: 0 }],
    }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { key('y', { ctrlKey: true }) })
    await waitFor(() => expect(h.del).toHaveBeenLastCalledWith({ projectId: P, taskIds: ['t9'] }))
  })

  it('undoing a delete sends the ORIGINAL gatekeeper', async () => {
    const GK = '44444444-4444-4444-8444-444444444444'
    const start = data({ tasks: [task('t1', { gatekeeperId: GK }), ...data().tasks.slice(1)] })
    h.load.mockResolvedValue({ ok: true, data: data({ tasks: data().tasks.slice(1), links: [] }) })
    render(<ScheduleClient initial={start} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-1' }))
    key('Delete')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: delete 1 task' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { key('z', { ctrlKey: true }) })
    await waitFor(() => expect(h.create).toHaveBeenCalled())
    expect(h.create.mock.calls[0][0].tasks[0].gatekeeperId).toBe(GK)
  })

  it('the gatekeeper signs off an awaiting task from its dialog through the update action, with its token', async () => {
    const start = data({ tasks: [task('t1', { status: 'done', awaitingSignOff: true, gatekeeperId: 'u1', updatedAt: 'U7' }), ...data().tasks.slice(1)] })
    h.load.mockResolvedValue({ ok: true, data: start })
    render(<ScheduleClient initial={start} />)
    fireEvent.click(screen.getByRole('button', { name: 'SOLAR-1 Task t1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign off' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ projectId: P, patches: [{ id: 't1', status: 'done', expectedUpdatedAt: 'U7' }] }))
  })

  it('removing a link resolves its id from the CURRENT links, before and after undo re-creates it', async () => {
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(await stub('stub open link t1 t2'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(h.removeLink).not.toHaveBeenCalled()
    h.load.mockResolvedValue({ ok: true, data: data({ links: [] }) })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    await waitFor(() => expect(h.removeLink).toHaveBeenCalledWith({ projectId: P, linkId: 'd1' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false))
    h.load.mockResolvedValue({ ok: true, data: data({ links: [{ id: 'd7', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 0 }] }) })
    await act(async () => { key('z', { ctrlKey: true }) })
    await waitFor(() => expect(h.addLink).toHaveBeenCalledWith({ projectId: P, predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 0 }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { key('y', { ctrlKey: true }) })
    await waitFor(() => expect(h.removeLink).toHaveBeenLastCalledWith({ projectId: P, linkId: 'd7' }))
  })

  it('refuses a link that would close a loop before calling the server', async () => {
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(await stub('stub link t2 t1'))
    expect(await screen.findByText('That link would make these tasks depend on each other in a loop.')).toBeTruthy()
    expect(h.addLink).not.toHaveBeenCalled()
  })

  it('a drawn link opens the link dialog and is added with its type and lag', async () => {
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(await stub('stub link t1 t3'))
    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'SS' } })
    fireEvent.change(screen.getByLabelText('Lag (days)'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await waitFor(() => expect(h.addLink).toHaveBeenCalledWith({ projectId: P, predecessorId: 't1', successorId: 't3', type: 'SS', lagDays: 1 }))
  })

  it('bulk reassign sends one undoable update with each task’s token', async () => {
    render(<ScheduleClient initial={data({ owners: [{ id: 'u1', name: 'Ann', email: 'a@x' }, { id: 'u2', name: 'Bob', email: 'b@x' }] })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-2' }))
    const values = within(screen.getByLabelText('Set owner')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(values).toEqual(['', 'u1', 'u2'])
    fireEvent.change(screen.getByLabelText('Set owner'), { target: { value: 'u2' } })
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ projectId: P, patches: [
      { id: 't1', ownerId: 'u2', expectedUpdatedAt: 'U1' }, { id: 't2', ownerId: 'u2', expectedUpdatedAt: 'U1' },
    ] }))
  })

  it('View level: no edit controls and edit shortcuts do nothing', () => {
    render(<ScheduleClient initial={data({ canEdit: false })} />)
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Select SOLAR-1' })).toBeNull()
    key('n')
    expect(screen.queryByRole('dialog', { name: 'Add task' })).toBeNull()
    key('?', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
  })

  it('N opens the add-task dialog at Edit', () => {
    render(<ScheduleClient initial={data()} />)
    key('n')
    expect(screen.getByRole('dialog', { name: 'Add task' })).toBeTruthy()
  })

  it('an empty schedule offers the template; using it calls the action with the chosen start and is not undoable', async () => {
    h.applyTemplate.mockResolvedValue({ ok: true, count: 14 })
    render(<ScheduleClient initial={data({ tasks: [], links: [] })} />)
    fireEvent.change(screen.getByLabelText('Programme starts'), { target: { value: '2026-11-02' } })
    // The toolbar has its own "Use template" (it opens the same start-date choice); this is the empty state's.
    fireEvent.click(within(screen.getByRole('region', { name: 'Start the programme' })).getByRole('button', { name: 'Use template' }))
    await waitFor(() => expect(h.applyTemplate).toHaveBeenCalledWith({ projectId: P, start: '2026-11-02' }))
    expect(await screen.findByText('14 tasks added from the template. Undo does not cover a template — delete tasks to remove them.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the toolbar’s Use template asks for a start date and, on a non-empty schedule, a two-step confirm with the count', async () => {
    h.templateCount.mockResolvedValue({ ok: true, count: 14 })
    h.applyTemplate.mockResolvedValue({ ok: true, count: 14 })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Schedule' })).getByRole('button', { name: 'Use template' }))
    const dlg = screen.getByRole('dialog', { name: 'Use template' })
    // Nothing is applied by the click that opened it.
    expect(h.applyTemplate).not.toHaveBeenCalled()
    fireEvent.change(within(dlg).getByLabelText('Programme starts'), { target: { value: '2027-01-11' } })
    const first = await within(dlg).findByRole('button', { name: 'Add 14 template tasks' })
    fireEvent.click(first)
    expect(h.applyTemplate).not.toHaveBeenCalled()
    expect(within(dlg).getByText('Add 14 template tasks to the 3 already in the programme? A template cannot be undone — you would delete its tasks one by one.')).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm: add 14 tasks' }))
    await waitFor(() => expect(h.applyTemplate).toHaveBeenCalledWith({ projectId: P, start: '2027-01-11' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Use template' })).toBeNull())
  })
  it('cancelling the toolbar template dialog applies nothing', async () => {
    h.templateCount.mockResolvedValue({ ok: true, count: 14 })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Schedule' })).getByRole('button', { name: 'Use template' }))
    fireEvent.click(await within(screen.getByRole('dialog', { name: 'Use template' })).findByRole('button', { name: 'Add 14 template tasks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Use template' })).toBeNull()
    expect(h.applyTemplate).not.toHaveBeenCalled()
  })
})
