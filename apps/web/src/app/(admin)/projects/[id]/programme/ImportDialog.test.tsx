import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { parseMspdiText, planImport, type MspdiProgramme, type ProgrammeState } from '@esite/shared/programme'
import { activityRow, PROG, programmeTables } from '@/lib/programme/test-fixtures'

const h = vi.hoisted(() => ({ record: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/programme.actions', () => ({ recordImportAction: h.record }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
import { groupWarnings, ImportDialog, LABEL_REQUIRED, MPP_REFUSED, type ImportStore } from './ImportDialog'

const SMALL = readFileSync(resolve(process.cwd(), '../../packages/shared/src/programme/exchange/fixtures/small.xml'), 'utf8')

function state(activities: Record<string, unknown>[] = []): ProgrammeState {
  const t = programmeTables({ 'programme.activities': activities, 'programme.dependencies': [] })
  return {
    programme: t['programme.programmes'][0], calendars: t['programme.calendars'], exceptions: [],
    activities: t['programme.activities'], dependencies: t['programme.dependencies'],
    codeTypes: [], codeValues: [], activityCodes: [], fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
  } as unknown as ProgrammeState
}
const keys = () => { let n = 0; return () => `imp${++n}` }
function fakeStore(over: Partial<ImportStore> = {}): ImportStore {
  return {
    state: state(), stale: false, newKey: keys(),
    apply: vi.fn(() => true), settle: vi.fn(async () => ({ ok: true, error: null })), ...over,
  }
}
const xmlFile = (text = SMALL, name = 'Saxby rev A.xml') => new File([text], name, { type: 'text/xml' })
async function choose(file: File) {
  fireEvent.change(screen.getByLabelText('MS Project XML file'), { target: { files: [file] } })
}

beforeEach(() => vi.clearAllMocks())

describe('ImportDialog', () => {
  it('refuses an .mpp file with the export sentence and plans nothing', async () => {
    const store = fakeStore()
    render(<ImportDialog store={store} onClose={vi.fn()} />)
    await choose(new File(['binary'], 'Saxby.mpp'))
    expect((await screen.findByRole('alert')).textContent).toBe(MPP_REFUSED)
    expect(screen.queryByTestId('import-preview')).toBeNull()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('shows a parse refusal and applies nothing', async () => {
    const store = fakeStore()
    render(<ImportDialog store={store} onClose={vi.fn()} />)
    await choose(xmlFile('<Workbook/>', 'book.xml'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not an MS Project XML file/)
    expect(screen.queryByTestId('import-preview')).toBeNull()
  })

  it('previews small.xml with the planner\'s counts, the file dates and the E-Site finish', async () => {
    const store = fakeStore()
    render(<ImportDialog store={store} onClose={vi.fn()} />)
    await choose(xmlFile())
    await screen.findByTestId('import-preview')
    const m = parseMspdiText(SMALL) as MspdiProgramme
    const plan = planImport(store.state, m, keys())
    expect(plan.diff.added.length).toBeGreaterThan(0)
    expect(screen.getByTestId('import-count-Added').textContent).toContain(`Added: ${plan.diff.added.length}`)
    expect(screen.getByTestId('import-count-Changed').textContent).toBe('Changed: 0')
    expect(screen.getByTestId('import-count-Removed').textContent).toBe('Removed: 0')
    expect(screen.getByTestId('import-count-Links added').textContent).toBe(`Links added: ${plan.diff.linksAdded}`)
    // The added list is expandable and names the tasks as text.
    const added = within(screen.getByTestId('import-count-Added'))
    expect(added.getByText(plan.diff.added[0].name, { exact: false })).toBeTruthy()
    expect(screen.getByTestId('import-dates').textContent).toMatch(/^File: 2026-10-05 to \d{4}-\d{2}-\d{2} · E-Site finish after import: \d{4}-\d{2}-\d{2}$/)
    expect((screen.getByLabelText('Revision label') as HTMLInputElement).value).toBe('Saxby rev A')
  })

  it('imports as ONE gesture, waits for the save, then records the revision and refreshes', async () => {
    const order: string[] = []
    const onClose = vi.fn()
    const store = fakeStore({
      apply: vi.fn(() => { order.push('apply'); return true }),
      settle: vi.fn(async () => { order.push('settle'); return { ok: true, error: null } }),
    })
    h.record.mockImplementation(async () => { order.push('record'); return { ok: true, importId: 'i', baselineId: 'b' } })
    render(<ImportDialog store={store} onClose={onClose} />)
    await choose(xmlFile())
    await screen.findByTestId('import-preview')
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(order).toEqual(['apply', 'settle', 'record'])
    expect(store.apply).toHaveBeenCalledTimes(1)
    const [ops, label] = (store.apply as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(label).toBe('Import Saxby rev A')
    expect(ops.length).toBeGreaterThan(0)
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ programmeId: PROG, fileName: 'Saxby rev A.xml', revisionLabel: 'Saxby rev A' }))
    expect(h.record.mock.calls[0][0].diff.added.length).toBeGreaterThan(0)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the save refusal, and records nothing', async () => {
    const store = fakeStore({ settle: vi.fn(async () => ({ ok: false, error: 'You do not have permission to edit programmes on this project.' })) })
    render(<ImportDialog store={store} onClose={vi.fn()} />)
    await choose(xmlFile())
    await screen.findByTestId('import-preview')
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to edit programmes on this project.')
    expect(h.record).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('shows the record refusal: the import itself stood', async () => {
    h.record.mockResolvedValue({ ok: false, error: 'The programme was imported, but the revision record was not saved.' })
    const onClose = vi.fn()
    render(<ImportDialog store={fakeStore()} onClose={onClose} />)
    await choose(xmlFile())
    await screen.findByTestId('import-preview')
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The programme was imported, but the revision record was not saved.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('requires a revision label on a re-import', async () => {
    const store = fakeStore({ state: state([activityRow('X', { external_uid: '1', name: 'Old' })]) })
    render(<ImportDialog store={store} onClose={vi.fn()} />)
    await choose(xmlFile())
    await screen.findByTestId('import-preview')
    fireEvent.change(screen.getByLabelText('Revision label'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect((await screen.findByRole('alert')).textContent).toBe(LABEL_REQUIRED)
    expect(store.apply).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
  })

  it('allows a blank label on a first import (sent as null)', async () => {
    h.record.mockResolvedValue({ ok: true, importId: 'i', baselineId: 'b' })
    render(<ImportDialog store={fakeStore()} onClose={vi.fn()} />)
    await choose(xmlFile())
    await screen.findByTestId('import-preview')
    fireEvent.change(screen.getByLabelText('Revision label'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(h.record).toHaveBeenCalled())
    expect(h.record.mock.calls[0][0].revisionLabel).toBeNull()
  })
})

describe('groupWarnings', () => {
  it('groups by kind in a fixed order, unknowns under Other', () => {
    const g = groupWarnings([
      'Task "A" (UID 2): the FS link from UID 9, which is not in the file, was dropped.',
      'Calendar "X" has no working weekdays; Monday to Friday was used.',
      'Task "B" (UID 3) is manually scheduled in MS Project; it is pinned to start on 2026-10-05.',
      'Something new.',
      'Task "C" (UID 4): the duration "P?" could not be read and was set to 0.',
    ])
    expect(g.map((x) => x.kind)).toEqual(['Links', 'Calendars', 'Manually scheduled tasks', 'Durations and milestones', 'Other'])
  })
})
