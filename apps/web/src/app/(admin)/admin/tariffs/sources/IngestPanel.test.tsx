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

describe('IngestPanel', () => {
  it('a workbook: Dry run shows the plan, then Apply posts apply=true', async () => {
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd1', fileKind: 'xlsx', financialYear: '2025/26', licenseeName: null }} />)
    await user.click(screen.getByRole('button', { name: 'Dry run' }))
    expect(await screen.findByText('City Power')).toBeDefined()
    expect(screen.getByText('create')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Apply (lands in review)' }))
    const last = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
    expect(JSON.parse((last[1] as RequestInit).body as string)).toMatchObject({ sourceDocumentId: 'd1', parser: 'province_xlsx', apply: true })
  })
  it('a PDF: only Queue ingest, and the licensee name is required', async () => {
    h.queue.mockResolvedValue({ ok: true, id: 'j1' })
    const user = userEvent.setup()
    render(<IngestPanel source={{ id: 'd2', fileKind: 'pdf', financialYear: '2026/27', licenseeName: 'City Power' }} />)
    expect(screen.queryByRole('button', { name: 'Dry run' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Queue ingest' }))
    expect(h.queue).toHaveBeenCalledWith({ sourceDocumentId: 'd2', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'City Power', createLicensees: false })
    expect(await screen.findByText('Queued. The staff ingest worker will pick it up.')).toBeDefined()
  })
})
