import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { resendInviteActionMock, updateUserActionMock, removeUserActionMock, refreshMock } = vi.hoisted(() => ({
  resendInviteActionMock: vi.fn(),
  updateUserActionMock: vi.fn(),
  removeUserActionMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))
vi.mock('@/actions/users.actions', () => ({
  resendInviteAction: resendInviteActionMock,
  updateUserAction: updateUserActionMock,
  removeUserAction: removeUserActionMock,
}))

import { UserRowActions } from './UserRowActions'

const USER = 'user-123'

beforeEach(() => {
  vi.clearAllMocks()
  resendInviteActionMock.mockResolvedValue({ ok: true })
  updateUserActionMock.mockResolvedValue({ ok: true })
  removeUserActionMock.mockResolvedValue({ ok: true })
})

describe('UserRowActions resend invite button', () => {
  it('shows "Resend invite" for a pending, active member', () => {
    render(<UserRowActions userId={USER} role="inspector" isActive isPending isSelf={false} callerRole="admin" />)
    expect(screen.getByRole('button', { name: /resend invite/i })).toBeTruthy()
  })

  it('hides "Resend invite" for a member who has accepted', () => {
    render(<UserRowActions userId={USER} role="inspector" isActive isPending={false} isSelf={false} callerRole="admin" />)
    expect(screen.queryByRole('button', { name: /resend invite/i })).toBeNull()
  })

  it('hides "Resend invite" for a pending but INACTIVE member', () => {
    render(<UserRowActions userId={USER} role="inspector" isActive={false} isPending isSelf={false} callerRole="admin" />)
    expect(screen.queryByRole('button', { name: /resend invite/i })).toBeNull()
  })

  it('calls resendInviteAction and shows a confirmation notice on success', async () => {
    render(<UserRowActions userId={USER} role="inspector" isActive isPending isSelf={false} callerRole="admin" />)
    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }))
    await waitFor(() => expect(resendInviteActionMock).toHaveBeenCalledWith({ userId: USER }))
    await waitFor(() => expect(screen.getByText(/invite re-sent/i)).toBeTruthy())
  })

  it('surfaces the error when resend fails', async () => {
    resendInviteActionMock.mockResolvedValueOnce({ ok: false, error: 'Too many invites resent recently.' })
    render(<UserRowActions userId={USER} role="inspector" isActive isPending isSelf={false} callerRole="admin" />)
    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }))
    await waitFor(() => expect(screen.getByText(/too many invites resent/i)).toBeTruthy())
  })

  it('renders nothing for the caller\'s own row (self-lockout)', () => {
    const { container } = render(
      <UserRowActions userId={USER} role="inspector" isActive isPending isSelf callerRole="admin" />,
    )
    expect(screen.queryByRole('button', { name: /resend invite/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    // The locked row renders only a spacer div.
    expect(container.querySelector('select')).toBeNull()
  })
})
