import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/actions/solar-requests.actions', () => ({ requestSolarAccessAction: h.request }))

import { ViewOnlyBanner } from './ViewOnlyBanner'

beforeEach(() => { h.request.mockReset() })

describe('ViewOnlyBanner', () => {
  it('explains the level and requests Edit', async () => {
    h.request.mockResolvedValue({ ok: true })
    render(<ViewOnlyBanner projectId="p1" />)
    expect(screen.getByText('You have view access — ask an admin for edit access')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request edit access' }))
    expect(h.request).toHaveBeenCalledWith({ projectId: 'p1', level: 'edit' })
    expect(await screen.findByText('Request sent — the organisation admins have been told.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Request edit access' })).toBeNull()
  })

  it('shows the action’s sentence on failure', async () => {
    h.request.mockResolvedValue({ error: 'You already have a request waiting for an answer.' })
    render(<ViewOnlyBanner projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Request edit access' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You already have a request waiting for an answer.')
  })

  // Review: externals can only ever hold View — no button that asks for Edit.
  it('an external member is told View is the most they can hold, with no request button', () => {
    render(<ViewOnlyBanner projectId="p1" canRequestEdit={false} />)
    expect(screen.getByText('You have view access. Members from outside the organisation can have View only.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Request edit access' })).toBeNull()
  })
})
