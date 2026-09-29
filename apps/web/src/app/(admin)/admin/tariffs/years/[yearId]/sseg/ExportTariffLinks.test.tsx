import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ set: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-review.actions', () => ({ setExportTariffAction: h.set }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { ExportTariffLinks, type ExportLinkTariff } from './ExportTariffLinks'

const tariffs: ExportLinkTariff[] = [
  { id: 't1', name: 'Homeflex 1', code: 'HF1', category: 'domestic', exportTariffId: null, updatedAt: 'U1' },
  { id: 't2', name: 'Businessrate 1', code: null, category: 'commercial', exportTariffId: 'e1', updatedAt: 'U2' },
  { id: 'e1', name: 'Gen-offset', code: 'GO', category: 'sseg', exportTariffId: null, updatedAt: 'U9' },
]

beforeEach(() => vi.clearAllMocks())

describe('ExportTariffLinks', () => {
  it('lists each import tariff with its export tariff; export tariffs are the choices, not rows', () => {
    render(<ExportTariffLinks tariffs={tariffs} editable />)
    expect(screen.getByRole('row', { name: /Homeflex 1/ })).toBeDefined()
    expect(screen.queryByRole('row', { name: /^Gen-offset/ })).toBeNull()
    const sel = screen.getByLabelText('Export tariff for Businessrate 1') as HTMLSelectElement
    expect(sel.value).toBe('e1')
    expect(within(sel).queryByRole('option', { name: /Businessrate 1/ })).toBeNull()
  })
  it('Save sends the choice with the updated_at the page loaded, and refreshes', async () => {
    h.set.mockResolvedValue({ ok: true, updatedAt: 'U1b' })
    const user = userEvent.setup()
    render(<ExportTariffLinks tariffs={tariffs} editable />)
    await user.selectOptions(screen.getByLabelText('Export tariff for Homeflex 1'), 'e1')
    await user.click(screen.getByRole('button', { name: 'Save link for Homeflex 1' }))
    expect(h.set).toHaveBeenCalledWith({ tariffId: 't1', exportTariffId: 'e1', expectedUpdatedAt: 'U1' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('a stale page shows the sentence and does not refresh', async () => {
    h.set.mockResolvedValue({ error: 'Someone else changed this tariff. Reload to see their version.' })
    const user = userEvent.setup()
    render(<ExportTariffLinks tariffs={tariffs} editable />)
    await user.selectOptions(screen.getByLabelText('Export tariff for Businessrate 1'), '')
    await user.click(screen.getByRole('button', { name: 'Save link for Businessrate 1' }))
    expect(h.set).toHaveBeenCalledWith({ tariffId: 't2', exportTariffId: null, expectedUpdatedAt: 'U2' })
    expect(await screen.findByText('Someone else changed this tariff. Reload to see their version.')).toBeDefined()
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('a published year is read-only; a year with one tariff says there is nothing to link', () => {
    const { unmount } = render(<ExportTariffLinks tariffs={tariffs} editable={false} />)
    expect((screen.getByLabelText('Export tariff for Homeflex 1') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Save link/ })).toBeNull()
    unmount()
    render(<ExportTariffLinks tariffs={[tariffs[0]]} editable />)
    expect(screen.getByText(/only one tariff/)).toBeDefined()
  })
})
