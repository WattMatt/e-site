import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SCHEDULE_SHORTCUTS } from '@/lib/solar/schedule/shortcuts'
import { BulkBar } from './BulkBar'
import { StatsPanel } from './StatsPanel'
import { WorkloadView } from './WorkloadView'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { TemplateStart } from './TemplateStart'

const owners = [{ id: 'u1', name: 'Ann Smith', email: 'a@x' }]
const handlers = () => ({ onSetStatus: vi.fn(), onSetColour: vi.fn(), onSetProgress: vi.fn(), onSetOwner: vi.fn(), onDelete: vi.fn(), onClear: vi.fn() })

describe('BulkBar', () => {
  it('applies status, colour, progress and owner to the selection', () => {
    const h = handlers()
    render(<BulkBar count={3} owners={owners} colours={['#3b82f6', '#ef4444']} {...h} />)
    expect(screen.getByText('3 selected')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Set status'), { target: { value: 'done' } })
    expect(h.onSetStatus).toHaveBeenCalledWith('done')
    fireEvent.change(screen.getByLabelText('Set colour'), { target: { value: '#ef4444' } })
    expect(h.onSetColour).toHaveBeenCalledWith('#ef4444')
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(h.onSetProgress).toHaveBeenCalledWith(50)
    fireEvent.change(screen.getByLabelText('Set owner'), { target: { value: 'u1' } })
    expect(h.onSetOwner).toHaveBeenCalledWith('u1')
  })
  it('reassigns only to Solar-eligible owners (Q4)', () => {
    render(<BulkBar count={2} owners={owners} colours={[]} {...handlers()} />)
    const values = within(screen.getByLabelText('Set owner')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(values).toEqual(['', 'u1'])
  })
  it('delete is two-step and names the count', () => {
    const h = handlers()
    render(<BulkBar count={3} owners={owners} colours={[]} {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 tasks' }))
    expect(h.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: delete 3 tasks' }))
    expect(h.onDelete).toHaveBeenCalled()
  })
})

describe('StatsPanel', () => {
  it('shows the roll-up and warns about broken links', () => {
    render(<StatsPanel mode="working" violations={2} cycle={null} stats={{
      taskCount: 4, milestoneCount: 1, byStatus: { not_started: 1, in_progress: 2, done: 1 }, completionPct: 25,
      weightedProgressPct: 61, programmeDays: 42, criticalPathDays: 40,
    }} />)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('61%')).toBeTruthy()
    expect(screen.getByText('42 working days')).toBeTruthy()
    expect(screen.getByText('40 working days')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('2 links are broken by the planned dates (their tasks are on the critical path with negative float).')
  })
  it('a loop is named instead of a critical path', () => {
    render(<StatsPanel mode="calendar" violations={0} cycle={['a', 'b']} stats={{
      taskCount: 2, milestoneCount: 0, byStatus: { not_started: 2, in_progress: 0, done: 0 }, completionPct: 0,
      weightedProgressPct: 0, programmeDays: 5, criticalPathDays: null,
    }} />)
    expect(screen.getByRole('alert').textContent).toBe('Some tasks depend on each other in a loop, so no critical path can be worked out.')
  })
  it('an empty schedule shows dashes, not NaN', () => {
    render(<StatsPanel mode="calendar" violations={0} cycle={null} stats={{
      taskCount: 0, milestoneCount: 0, byStatus: { not_started: 0, in_progress: 0, done: 0 }, completionPct: null,
      weightedProgressPct: null, programmeDays: 0, criticalPathDays: null,
    }} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText(/NaN/)).toBeNull()
  })
})

describe('WorkloadView', () => {
  it('flags weeks above the limit', () => {
    render(<WorkloadView threshold={2} ownerNames={new Map([['u1', 'Ann Smith']])} workload={[
      { ownerId: 'u1', weeks: [{ weekStart: '2026-09-28', maxConcurrent: 3, taskIds: ['a', 'b', 'c'], overloaded: true },
        { weekStart: '2026-10-05', maxConcurrent: 1, taskIds: ['a'], overloaded: false }] },
    ]} />)
    expect(screen.getByText('Ann Smith')).toBeTruthy()
    expect(screen.getByLabelText('Ann Smith, week of 28 Sep 2026: 3 at once — more than 2')).toBeTruthy()
    expect(screen.getByLabelText('Ann Smith, week of 5 Oct 2026: 1 at once')).toBeTruthy()
  })
  it('names the limit and says when there is nothing to show', () => {
    const { unmount } = render(<WorkloadView threshold={2} ownerNames={new Map()} workload={[]} />)
    expect(screen.getByText('No open tasks to show.')).toBeTruthy()
    unmount()
    render(<WorkloadView threshold={2} ownerNames={new Map()} workload={[
      { ownerId: 'gone', weeks: [{ weekStart: '2026-09-28', maxConcurrent: 1, taskIds: ['a'], overloaded: false }] },
    ]} />)
    expect(screen.getByText('Former project member')).toBeTruthy()
    expect(screen.getByText('Weeks where someone has more than 2 tasks at once are marked.')).toBeTruthy()
  })
})

describe('ShortcutsOverlay', () => {
  it('lists every shortcut at Edit, and hides edit-only ones at View', () => {
    const { unmount } = render(<ShortcutsOverlay canEdit onClose={vi.fn()} />)
    for (const s of SCHEDULE_SHORTCUTS) expect(screen.getByText(s.label)).toBeTruthy()
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Delete selected (asks you to confirm)')).toBeTruthy()
    unmount()
    render(<ShortcutsOverlay canEdit={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Undo')).toBeNull()
    expect(screen.getByText('Search tasks')).toBeTruthy()
  })
})

describe('TemplateStart', () => {
  it('Edit: pick a start date and use the template (the primary action)', () => {
    const onUseTemplate = vi.fn()
    render(<TemplateStart canEdit defaultStart="2026-10-01" onUseTemplate={onUseTemplate} onAddTask={vi.fn()} onImport={vi.fn()} busy={false} />)
    fireEvent.change(screen.getByLabelText('Programme starts'), { target: { value: '2026-11-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    expect(onUseTemplate).toHaveBeenCalledWith('2026-11-02')
  })
  it('View: says who can add one', () => {
    render(<TemplateStart canEdit={false} defaultStart="2026-10-01" onUseTemplate={vi.fn()} onAddTask={vi.fn()} onImport={vi.fn()} busy={false} />)
    expect(screen.getByText('No programme yet. Someone with Edit access to Solar can add one.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use template' })).toBeNull()
  })
})
