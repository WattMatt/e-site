process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TaskDialog } from './TaskDialog'
import { makeWorkCalendar, saHolidaySet, type ScheduleTaskView } from '@esite/shared'

const owners = [{ id: 'u1', name: 'Ann Smith', email: 'a@x' }, { id: 'u2', name: 'Bob Dube', email: 'b@x' }]
const cal = makeWorkCalendar('calendar')
const existing: ScheduleTaskView = {
  id: 't1', workItemId: 'w1', ref: 'SOLAR-1', name: 'Design', category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-05',
  isMilestone: false, status: 'in_progress', awaitingSignOff: false, gatekeeperId: null, progress: 40, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann Smith',
  sortOrder: 1, description: '', updatedAt: 'U1', segments: [],
}
const base = { owners, cal, canEdit: true, defaultStart: '2026-09-28', onClose: vi.fn() }

const enabledOwnerValues = () => within(screen.getByLabelText('Owner'))
  .getAllByRole('option')
  .filter((o) => !(o as HTMLOptionElement).disabled)
  .map((o) => (o as HTMLOptionElement).value)

describe('TaskDialog', () => {
  it('creates a task; the typed dates reach the payload unchanged in SAST', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={null} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Install mounting' } })
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'u2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ input: {
      key: 'new', name: 'Install mounting', start: '2026-10-01', end: '2026-10-05', isMilestone: false, category: '', zone: '',
      ownerId: 'u2', status: 'not_started', progress: 0, colour: '#3b82f6', description: '',
    } }))
  })
  it('duration mode counts working days over Heritage Day and the weekend', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} cal={makeWorkCalendar('working', saHolidaySet(2026, 2026))} mode="task" initial={null} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-09-23' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Duration' }))
    fireEvent.change(screen.getByLabelText('Duration (days)'), { target: { value: '3' } })
    expect(screen.getByText('Ends 28 Sep 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ input: expect.objectContaining({ start: '2026-09-23', end: '2026-09-28' }) }))
  })
  it('refuses an end before the start and a blank name, without submitting', () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={null} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Give the task a name.')).toBeTruthy()
    expect(screen.getByText('The end date is before the start date.')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('editing sends only what changed, with the concurrency token', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={existing} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Progress %'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ patch: { id: 't1', expectedUpdatedAt: 'U1', progress: 60, status: 'done' } }))
  })
  it('a milestone has one date and stays editable', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="milestone" initial={{ ...existing, isMilestone: true, end: '2026-10-01' }} onSubmit={onSubmit} />)
    expect(screen.queryByLabelText('End')).toBeNull()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ patch: { id: 't1', expectedUpdatedAt: 'U1', start: '2026-10-09', end: '2026-10-09' } }))
  })
  it('splits a task at a date and joins it again', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={existing} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Split at'), { target: { value: '2026-10-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    expect(screen.getAllByLabelText(/Segment \d start/)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Join segments' }))
    expect(screen.queryAllByLabelText(/Segment \d start/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    fireEvent.change(screen.getByLabelText('Segment 2 start'), { target: { value: '2026-10-04' } })
    fireEvent.change(screen.getByLabelText('Segment 2 end'), { target: { value: '2026-10-06' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ patch: { id: 't1', expectedUpdatedAt: 'U1',
      segments: [{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-04', end: '2026-10-06' }] } }))
  })
  it('shows the server sentence when the save is refused, and stays open', async () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn(async () => 'Client viewers and suppliers cannot own solar tasks. Choose someone on the project team.')
    render(<TaskDialog {...base} onClose={onClose} mode="task" initial={existing} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'u2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Client viewers and suppliers cannot own solar tasks. Choose someone on the project team.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
  it('offers only Solar-eligible owners — a client viewer or supplier who is not in owners never appears (Q4)', () => {
    // The current owner has since become a client viewer: their name shows, but they cannot be chosen again.
    const { unmount } = render(<TaskDialog {...base} mode="task" initial={{ ...existing, ownerId: 'cv1', ownerName: 'Cara Viewer' }} onSubmit={vi.fn()} />)
    expect(enabledOwnerValues()).toEqual(['u1', 'u2'])
    expect(screen.getByRole('option', { name: 'Cara Viewer (cannot own solar tasks)' })).toBeTruthy()
    unmount()
    render(<TaskDialog {...base} mode="task" initial={null} onSubmit={vi.fn()} />)
    expect(enabledOwnerValues()).toEqual(['', 'u1', 'u2'])
    expect(screen.queryByRole('option', { name: /Cara Viewer/ })).toBeNull()
  })
  it('says a Done task is awaiting sign-off (Q1)', () => {
    render(<TaskDialog {...base} mode="task" initial={{ ...existing, status: 'done', awaitingSignOff: true }} onSubmit={vi.fn()} />)
    expect(screen.getByText('Done — awaiting sign-off by the person who scheduled it.')).toBeTruthy()
  })
  it('View level: read-only, no Save, no split or delete', () => {
    render(<TaskDialog {...base} canEdit={false} mode="task" initial={existing} onSubmit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Split' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true)
  })
  it('delete needs a second press', () => {
    const onDelete = vi.fn()
    render(<TaskDialog {...base} mode="task" initial={existing} onSubmit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledWith('t1')
  })
})
