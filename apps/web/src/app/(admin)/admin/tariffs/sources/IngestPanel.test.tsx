import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ queue: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-library.actions', () => ({ queueIngestJobAction: h.queue }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { IngestPanel } from './IngestPanel'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ report: { status: 'dry_run', runId: null, years: [
    { licensee: 'City Power', action: 'create', tariffs: 12, charges: 80, blocking: 0, review: 3, unresolved: 1, yoy: null, issues: [] },
  ] } }), { status: 200 })) as unknown as typeof fetch
})

function dryRunReturns(years: Array<{ licensee: string; action: string }>) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ report: { status: 'dry_run', runId: null, years: years.map((y) => (
    { ...y, tariffs: 12, charges: 80, blocking: 0, review: 3, unresolved: 1, yoy: null, issues: [] })) } }), { status: 200 })) as unknown as typeof fetch
}

describe('IngestPanel', () => {
  it('a workbook: Dry run shows the plan in words, then Apply posts apply=true', async () => {
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd1', fileKind: 'xlsx', financialYear: '2025/26', licenseeName: null }} />)
    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText('City Power')).toBeDefined()
    expect(screen.getByText('Creates a new draft')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Apply (lands in review)' }))
    const last = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
    expect(JSON.parse((last[1] as RequestInit).body as string)).toMatchObject({ sourceDocumentId: 'd1', parser: 'province_xlsx', apply: true })
  })
  it('a workbook whose plan replaces draft years: Apply is two-step and says how many', async () => {
    dryRunReturns([{ licensee: 'City Power', action: 'replace_draft' }, { licensee: 'Tshwane', action: 'replace_draft' }, { licensee: 'Emfuleni', action: 'create' }])
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd1', fileKind: 'xlsx', financialYear: '2025/26', licenseeName: null }} />)
    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    await screen.findByText('City Power')
    const calls = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Apply (lands in review)' }))
    expect(calls()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Replace 2 draft years?' }))
    expect(calls()).toBe(2)
  })
  it('a PDF: Queue ingest is two-step, warns it may replace a draft, and sends the licensee', async () => {
    h.queue.mockResolvedValue({ ok: true, id: 'j1' })
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd2', fileKind: 'pdf', financialYear: '2026/27', licenseeName: 'City Power' }} />)
    expect(screen.queryByRole('button', { name: 'Dry run' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Queue ingest' }))
    expect(h.queue).not.toHaveBeenCalled()
    expect(screen.getByText(/replaces any draft 2026\/27 year City Power already has/)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Confirm queue ingest' }))
    expect(h.queue).toHaveBeenCalledWith({ sourceDocumentId: 'd2', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'City Power', createLicensees: false })
    expect(await screen.findByText('Queued. The staff ingest worker will pick it up.')).toBeDefined()
  })
  it('a PDF with no licensee name: says so and queues nothing', async () => {
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd2', fileKind: 'pdf', financialYear: '2026/27', licenseeName: null }} />)
    await user.click(screen.getByRole('button', { name: 'Queue ingest' }))
    expect(screen.getByText('An RfD covers one licensee: enter its name as the registry spells it.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Confirm queue ingest' })).toBeNull()
    expect(h.queue).not.toHaveBeenCalled()
  })
})
