// apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const { requestMock, statusMock, refreshMock } = vi.hoisted(() => ({ requestMock: vi.fn(), statusMock: vi.fn(), refreshMock: vi.fn() }))
vi.mock('@/actions/whatsapp-link.actions', () => ({
  requestWhatsAppCodeAction: requestMock, getWhatsAppLinkStatusAction: statusMock,
  removeWhatsAppLinkAction: vi.fn(), setWhatsAppQuietHoursAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))
import { WhatsAppLinkPanel } from './WhatsAppLinkPanel'

const waiting = { ok: true, masked: '+27 82 *** 4567', message: 'LINK 482917', waNumber: '15551576223', expiresAt: '2026-10-01T10:10:00Z' }

describe('WhatsAppLinkPanel', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers() })

  it('shows the consent wording before anything is requested', () => {
    render(<WhatsAppLinkPanel link={null} />)
    expect(screen.getByText(/By linking, you agree/)).toBeTruthy()
  })

  it('after requesting, shows the code to SEND and a WhatsApp link pre-filled with it', async () => {
    requestMock.mockResolvedValue(waiting)
    render(<WhatsAppLinkPanel link={null} />)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0821234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my link code' }))
    await waitFor(() => expect(screen.getByText('LINK 482917')).toBeTruthy())
    expect(screen.getByText(/\+27 82 \*\*\* 4567/)).toBeTruthy()
    const a = screen.getByRole('link', { name: 'Open WhatsApp with this message' }) as HTMLAnchorElement
    expect(a.href).toBe('https://wa.me/15551576223?text=LINK%20482917')
  })

  it('without a configured number, tells them where to send it instead of a dead link', async () => {
    requestMock.mockResolvedValue({ ...waiting, waNumber: null })
    render(<WhatsAppLinkPanel link={null} />)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0821234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my link code' }))
    await waitFor(() => expect(screen.getByText('LINK 482917')).toBeTruthy())
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/Send it to the E-Site WhatsApp number/)).toBeTruthy()
  })

  it('switches to Linked by itself once the code has arrived', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    requestMock.mockResolvedValue(waiting)
    statusMock.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValue({ status: 'active' })
    render(<WhatsAppLinkPanel link={null} />)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0821234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my link code' }))
    await waitFor(() => expect(screen.getByText('LINK 482917')).toBeTruthy())
    await act(async () => { await vi.advanceTimersByTimeAsync(8100) })
    await waitFor(() => expect(screen.getByText(/Linked\. Site items will now arrive/)).toBeTruthy())
    expect(refreshMock).toHaveBeenCalled()
  })

  it('shows the error from the action', async () => {
    requestMock.mockResolvedValue({ error: 'That number is already linked to another E-Site account.' })
    render(<WhatsAppLinkPanel link={null} />)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0821234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Get my link code' }))
    await waitFor(() => expect(screen.getByText(/already linked to another/)).toBeTruthy())
  })

  it('linked: shows the masked number, quiet hours and Remove', () => {
    render(<WhatsAppLinkPanel link={{ status: 'active', phone_e164: '+27821234567', quiet_start: '18:00:00', quiet_end: '06:30:00', undeliverable_reason: null }} />)
    expect(screen.getByText('+27 82 *** 4567')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect((screen.getByLabelText('Quiet from') as HTMLInputElement).value).toBe('18:00')
  })
})
