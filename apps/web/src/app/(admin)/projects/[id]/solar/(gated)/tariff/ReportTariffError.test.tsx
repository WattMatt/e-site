import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ report: vi.fn(async () => ({ ok: true })) }))
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
})
