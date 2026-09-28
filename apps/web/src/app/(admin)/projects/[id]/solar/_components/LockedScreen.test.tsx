import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  ask: vi.fn(async () => ({ ok: true })),
  request: vi.fn(async () => ({ ok: true })),
  withdraw: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/actions/solar-requests.actions', () => ({
  askAdminToSubscribeAction: h.ask,
  requestSolarAccessAction: h.request,
  withdrawSolarRequestAction: h.withdraw,
  getSolarSubscriptionStateAction: vi.fn(async () => ({ active: false })),
}))

import { LockedScreen, type LockedScreenProps } from './LockedScreen'

const PRICE = 'R1,999 per year excl. VAT for your whole organisation — every project'
const base: Omit<LockedScreenProps, 'state'> = {
  projectId: 'p1', projectName: 'Kings Mall', orgName: 'WM Org', priceLine: PRICE, grantorNames: [], paymentReturn: false,
}

beforeEach(() => { vi.clearAllMocks() })

describe('LockedScreen — the §0.2 rows', () => {
  it('row 1 (owner/admin, not subscribed): price + Subscribe, no request buttons', () => {
    render(<LockedScreen {...base} state={{ kind: 'subscribe' }} />)
    expect(screen.getByText('Solar is not active for WM Org')).toBeDefined()
    expect(screen.getByText(PRICE)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask an admin to subscribe' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull()
  })

  it('row 2 (member, not subscribed): Ask an admin sends the request and refreshes', async () => {
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: null }} />)
    expect(screen.getByText('Solar is not active for WM Org')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask an admin to subscribe' }))
    expect(h.ask).toHaveBeenCalledWith('p1')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('row 2, already asked: "Requested on <date>" and no button', () => {
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: '2026-09-28T08:00:00Z' }} />)
    expect(screen.getByText('Requested on 28 Sep 2026')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask an admin to subscribe' })).toBeNull()
  })

  it('row 3 (subscribed, no grant): Request access with level + note; externals see View only', async () => {
    const user = userEvent.setup()
    render(<LockedScreen {...base} state={{ kind: 'request_access', maxLevel: 'view' }} />)
    expect(screen.queryByText(PRICE)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Request access' }))
    const select = screen.getByLabelText('Level') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['View'])
    await user.type(screen.getByLabelText('Note (optional)'), 'Doing the PV design')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(h.request).toHaveBeenCalledWith({ projectId: 'p1', level: 'view', note: 'Doing the PV design' })
    expect(h.refresh).toHaveBeenCalled()
  })

  it('row 3, own-org member: all three levels offered', async () => {
    render(<LockedScreen {...base} state={{ kind: 'request_access', maxLevel: 'edit_financials' }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request access' }))
    const select = screen.getByLabelText('Level') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['View', 'Edit', 'Edit + financials'])
  })

  it('row 4 (pending): names the admins and the date, and offers Withdraw', async () => {
    render(<LockedScreen {...base} grantorNames={['Ann', 'Ben']} state={{ kind: 'pending', requestedAt: '2026-09-28T08:00:00Z' }} />)
    expect(screen.getByText('Request sent to Ann and Ben on 28 Sep 2026')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Withdraw request' }))
    expect(h.withdraw).toHaveBeenCalledWith('p1')
  })

  it('shows an action error as a sentence', async () => {
    h.ask.mockResolvedValueOnce({ error: 'You have already asked — the admins have been told.' } as never)
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: null }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask an admin to subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You have already asked — the admins have been told.')
  })

  it('always shows the feature summary', () => {
    render(<LockedScreen {...base} state={{ kind: 'subscribe' }} />)
    expect(screen.getByText('What Solar does')).toBeDefined()
  })

  // Owner default 1 extended: a grantor of an unsubscribed org can already set
  // grants (00207 does not gate project_access on the subscription), so the
  // locked screen links to the Access panel too. Row 1 is grantors only.
  it('row 1 links a grantor to Manage access; other rows do not', () => {
    const { unmount } = render(<LockedScreen {...base} state={{ kind: 'subscribe' }} />)
    expect(screen.getByRole('link', { name: 'Manage access' }).getAttribute('href')).toBe('/projects/p1/solar/access')
    unmount()
    render(<LockedScreen {...base} state={{ kind: 'ask_admin', requestedAt: null }} />)
    expect(screen.queryByRole('link', { name: 'Manage access' })).toBeNull()
  })
})
