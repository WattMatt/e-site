import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, it, expect, beforeEach } from 'vitest'

// No jest-dom in this workspace: getBy* throws when absent, so a plain
// not-null / textContent assertion is the matcher.
const details = {
  authorization_id: 'a1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c1', name: 'Claude Desktop', uri: 'https://claude.ai', logo_uri: '' },
  user: { id: 'u1', email: 'a@example.com' },
  scope: 'openid email',
}
const oauth = {
  getAuthorizationDetails: vi.fn(async () => ({ data: details, error: null })),
  approveAuthorization: vi.fn(async () => ({ data: { redirect_url: 'https://claude.ai/cb?code=1' }, error: null })),
  denyAuthorization: vi.fn(async () => ({ data: { redirect_url: 'https://claude.ai/cb?error=access_denied' }, error: null })),
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { oauth } }) }))
import ConsentClient from './ConsentClient'

beforeEach(() => {
  vi.clearAllMocks()
})

it('shows the client and approves to the redirect url', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText('Claude Desktop')).not.toBeNull())
  expect(screen.getByText(/read your E-Site projects and run imports you preview and confirm/)).not.toBeNull()
  expect(screen.getByText('https://claude.ai/api/mcp/auth_callback')).not.toBeNull()
  expect(screen.getByText('openid')).not.toBeNull()
  expect(oauth.approveAuthorization).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /approve/i }))
  await waitFor(() => expect(oauth.approveAuthorization).toHaveBeenCalledWith('a1', { skipBrowserRedirect: true }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=1'))
})

it('denies to the redirect url the API returns', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText('Claude Desktop')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /deny/i }))
  await waitFor(() => expect(oauth.denyAuthorization).toHaveBeenCalledWith('a1', { skipBrowserRedirect: true }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?error=access_denied'))
})

it('renders the API message when approval fails and does not redirect', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  oauth.approveAuthorization.mockResolvedValueOnce({ data: null as never, error: { message: 'authorization expired' } as never })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText('Claude Desktop')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /approve/i }))
  await waitFor(() => expect(screen.getByText('authorization expired')).not.toBeNull())
  expect(assign).not.toHaveBeenCalled()
})

it('refuses a javascript: redirect from approve and does not navigate', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  oauth.approveAuthorization.mockResolvedValueOnce({ data: { redirect_url: 'javascript:alert(1)' }, error: null })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText('Claude Desktop')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /approve/i }))
  await waitFor(() => expect(screen.getByText("The client's redirect address was refused.")).not.toBeNull())
  expect(assign).not.toHaveBeenCalled()
})

it('refuses an unsafe redirect on deny and on the already-consented path', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  oauth.denyAuthorization.mockResolvedValueOnce({ data: { redirect_url: 'data:text/html,x' }, error: null })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText('Claude Desktop')).not.toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /deny/i }))
  await waitFor(() => expect(screen.getByText("The client's redirect address was refused.")).not.toBeNull())
  expect(assign).not.toHaveBeenCalled()
})

it('refuses an unsafe redirect when the user already consented', async () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  oauth.getAuthorizationDetails.mockResolvedValueOnce({ data: { redirect_url: 'javascript:alert(1)' } as never, error: null })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText("The client's redirect address was refused.")).not.toBeNull())
  expect(assign).not.toHaveBeenCalled()
})
