import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ report: vi.fn(async (): Promise<{ ok: true } | { error: string }> => ({ ok: true })) }))
vi.mock('@/actions/solar-tariff.actions', () => ({ reportTariffErrorAction: h.report }))

import { ReportTariffError } from './ReportTariffError'

describe('ReportTariffError', () => {
  it('opens a note, sends it, and confirms', async () => {
    const user = userEvent.setup()
    render(<ReportTariffError projectId="p1" tariffId="t1" />)
    await user.click(screen.getByRole('button', { name: 'Report a tariff error' }))
    await user.type(screen.getByLabelText('What looks wrong?'), 'Basic charge is last year\'s')
    await user.click(screen.getByRole('button', { name: 'Send to the tariff library' }))
    expect(h.report).toHaveBeenCalledWith({ projectId: 'p1', tariffId: 't1', note: 'Basic charge is last year\'s' })
    expect(await screen.findByText('Sent. The tariff library maintainers will review it.')).toBeDefined()
  })
  it('a refusal is shown as an alert and the note is kept for another try', async () => {
    h.report.mockResolvedValueOnce({ error: 'Describe what looks wrong (up to 2000 characters).' })
    const user = userEvent.setup()
    render(<ReportTariffError projectId="p1" tariffId="t1" />)
    await user.click(screen.getByRole('button', { name: 'Report a tariff error' }))
    await user.type(screen.getByLabelText('What looks wrong?'), 'x')
    await user.click(screen.getByRole('button', { name: 'Send to the tariff library' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Describe what looks wrong (up to 2000 characters).')
    expect(screen.queryByText(/Sent\./)).toBeNull()
    expect((screen.getByLabelText('What looks wrong?') as HTMLTextAreaElement).value).toBe('x')
  })
})
