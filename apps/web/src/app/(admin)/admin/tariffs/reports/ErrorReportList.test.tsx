import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ resolve: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-library.actions', () => ({ resolveErrorReportAction: h.resolve }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { ErrorReportList, type ErrorReportRow } from './ErrorReportList'

const row: ErrorReportRow = {
  id: 'r1', note: 'Basic charge is R40 not R400', status: 'resolved', resolutionNote: 'Fixed', storedResolutionNote: 'Fixed',
  createdAt: '2026-09-20T08:00:00Z', project: 'KINGSWALK', tariff: 'City Power 2026/27 · Business',
}

beforeEach(() => vi.clearAllMocks())

describe('ErrorReportList', () => {
  it('shows the status in words and sends the status and note the admin saw', async () => {
    h.resolve.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<ErrorReportList rows={[row]} />)
    expect(screen.getByText('Resolved')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(h.resolve).toHaveBeenCalledWith({ id: 'r1', status: 'open', resolutionNote: 'Fixed', expected: { status: 'resolved', resolutionNote: 'Fixed' } })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('a report someone else changed shows the stale sentence', async () => {
    h.resolve.mockResolvedValue({ error: 'Someone else changed this report since you loaded the page. Reload to see their version.' })
    const user = userEvent.setup()
    render(<ErrorReportList rows={[{ ...row, status: 'open', resolutionNote: '', storedResolutionNote: null }]} />)
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }))
    expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ expected: { status: 'open', resolutionNote: null } }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
