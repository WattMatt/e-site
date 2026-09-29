// apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { requestMock, confirmMock } = vi.hoisted(() => ({ requestMock: vi.fn(), confirmMock: vi.fn() }))
vi.mock('@/actions/whatsapp-link.actions', () => ({
  requestWhatsAppCodeAction: requestMock, confirmWhatsAppCodeAction: confirmMock,
  removeWhatsAppLinkAction: vi.fn(), setWhatsAppQuietHoursAction: vi.fn(),
}))
import { WhatsAppLinkPanel } from './WhatsAppLinkPanel'

describe('WhatsAppLinkPanel', () => {
  it('unlinked: asks for a number, then for the code', async () => {
    requestMock.mockResolvedValue({ ok: true, masked: '+27 82 *** 4567' })
    confirmMock.mockResolvedValue({ ok: true })
    render(<WhatsAppLinkPanel link={null} />)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0821234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(screen.getByLabelText('6-digit code')).toBeTruthy())
    expect(screen.getByText(/\+27 82 \*\*\* 4567/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith({ code: '123456' }))
  })
  it('shows the consent wording before the number is sent', () => {
    render(<WhatsAppLinkPanel link={null} />)
    expect(screen.getByText(/By linking, you agree/)).toBeTruthy()
  })
  it('linked: shows the masked number, quiet hours and Remove', () => {
    render(<WhatsAppLinkPanel link={{ status: 'active', phone_e164: '+27821234567', quiet_start: '18:00:00', quiet_end: '06:30:00', undeliverable_reason: null }} />)
    expect(screen.getByText('+27 82 *** 4567')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect((screen.getByLabelText('Quiet from') as HTMLInputElement).value).toBe('18:00')
  })
  it('undeliverable: says why', () => {
    render(<WhatsAppLinkPanel link={{ status: 'undeliverable', phone_e164: '+27821234567', quiet_start: '18:00:00', quiet_end: '06:30:00', undeliverable_reason: '131026 Message undeliverable' }} />)
    expect(screen.getByText(/We couldn't deliver to this number/)).toBeTruthy()
  })
})
