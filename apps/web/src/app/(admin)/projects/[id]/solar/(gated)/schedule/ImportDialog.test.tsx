import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ commit: vi.fn() }))
vi.mock('@/actions/solar-schedule-import.actions', () => ({ commitScheduleImportAction: h.commit }))

import { ImportDialog } from './ImportDialog'
import { makeWorkCalendar } from '@esite/shared'

const P = 'p1'
const table = {
  kind: 'table',
  rows: [['Task', 'Start', 'End', 'Owner'], ['Design', '2026-10-01', '2026-10-05', 'Zed'], ['Install', '06/10/2026', '2026-10-08', '']],
  mapping: { name: 0, category: null, zone: null, start: 1, end: 2, duration: null, owner: 3, progress: null, status: null, milestone: null, predecessors: null, notes: null, colour: null },
  unrecognisedColumns: [],
}
function mockFetch(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as never
}
const pick = () => fireEvent.change(screen.getByLabelText('Programme file'), { target: { files: [new File(['x'], 'p.csv')] } })
const base = () => ({ projectId: P, cal: makeWorkCalendar('calendar'), onClose: vi.fn(), onImported: vi.fn() })

const realFetch = globalThis.fetch
beforeEach(() => {
  vi.clearAllMocks()
  h.commit.mockResolvedValue({ ok: true, created: 2, unmatchedOwners: [], unmatchedRows: [] })
})
afterEach(() => { globalThis.fetch = realFetch })

describe('ImportDialog', () => {
  it('uploads, previews the mapped tasks, and commits the plan', async () => {
    mockFetch(table)
    const b = base()
    render(<ImportDialog {...b} existingCount={0} />)
    pick()
    expect(await screen.findByText('2 tasks ready to import')).toBeTruthy()
    expect(screen.getByRole('cell', { name: '6 Oct 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 tasks' }))
    await waitFor(() => expect(h.commit).toHaveBeenCalledWith({ projectId: P, mode: 'append', plan: expect.objectContaining({ tasks: expect.any(Array) }) }))
    expect(h.commit.mock.calls[0][0].plan.tasks).toHaveLength(2)
    await waitFor(() => expect(b.onImported).toHaveBeenCalledWith('2 tasks imported.'))
    expect(b.onClose).toHaveBeenCalled()
  })
  it('remapping a column updates the preview; problems block the import', async () => {
    mockFetch(table)
    render(<ImportDialog {...base()} existingCount={0} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.change(screen.getByLabelText('Start date column'), { target: { value: '3' } })
    expect(await screen.findByText('Row 2: "Zed" is not a date. Use 2026-10-01 or 01/10/2026.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Import/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('replace asks twice and says how many tasks go', async () => {
    mockFetch(table)
    render(<ImportDialog {...base()} existingCount={3} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.click(screen.getByRole('radio', { name: 'Replace the whole programme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace: remove 3 tasks and import 2' }))
    expect(h.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm replace' }))
    await waitFor(() => expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'replace' })))
  })
  it('lists every row whose owner could not be matched, and stays open until closed (Q5)', async () => {
    mockFetch(table)
    h.commit.mockResolvedValue({ ok: true, created: 2, unmatchedOwners: ['Zed'], unmatchedRows: [{ row: 2, task: 'Design', owner: 'Zed' }] })
    const b = base()
    render(<ImportDialog {...b} existingCount={0} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 tasks' }))
    await waitFor(() => expect(b.onImported).toHaveBeenCalledWith(
      '2 tasks imported. 1 owner in the file could not be matched to anyone who can own solar tasks on this project, so those tasks went to the default owner.',
    ))
    const list = await screen.findByRole('table', { name: 'Owners not matched' })
    expect(list.textContent).toContain('Design')
    expect(list.textContent).toContain('Zed')
    expect(screen.getByRole('cell', { name: '2' })).toBeTruthy()
    expect(b.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(b.onClose).toHaveBeenCalled()
  })
  it('shows the server’s sentence when the commit is refused', async () => {
    mockFetch(table)
    h.commit.mockResolvedValue({ error: 'You need Edit access to Solar on this project to change the schedule.' })
    const b = base()
    render(<ImportDialog {...b} existingCount={0} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 tasks' }))
    expect(await screen.findByText('You need Edit access to Solar on this project to change the schedule.')).toBeTruthy()
    expect(b.onImported).not.toHaveBeenCalled()
  })
  it('shows the server’s sentence when the file is refused', async () => {
    mockFetch({ error: 'Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.' }, 400)
    render(<ImportDialog {...base()} existingCount={0} />)
    pick()
    expect(await screen.findByText('Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.')).toBeTruthy()
  })
})
