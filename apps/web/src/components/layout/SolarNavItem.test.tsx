import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ navState: vi.fn() }))
vi.mock('@/actions/solar-requests.actions', () => ({ getSolarNavStateAction: h.navState }))

import { SolarNavItem } from './SolarNavItem'

beforeEach(() => { h.navState.mockReset() })

describe('SolarNavItem', () => {
  it('renders nothing for suppliers / client viewers (hidden)', async () => {
    h.navState.mockResolvedValue('hidden')
    const { container } = render(<SolarNavItem projectId="p1" active={false} />)
    await waitFor(() => expect(h.navState).toHaveBeenCalledWith('p1'))
    expect(container.innerHTML).toBe('')
  })

  it('shows a lock badge when locked', async () => {
    h.navState.mockResolvedValue('locked')
    render(<SolarNavItem projectId="p1" active={false} />)
    expect(await screen.findByLabelText('Solar is locked')).toBeDefined()
    expect(screen.getByRole('link', { name: /Solar/ }).getAttribute('href')).toBe('/projects/p1/solar')
  })

  it('shows a clock badge while a request is pending', async () => {
    h.navState.mockResolvedValue('pending')
    render(<SolarNavItem projectId="p1" active={false} />)
    expect(await screen.findByLabelText('Solar access request pending')).toBeDefined()
  })

  it('shows no badge when granted', async () => {
    h.navState.mockResolvedValue('open')
    render(<SolarNavItem projectId="p1" active />)
    const link = await screen.findByRole('link', { name: 'Solar' })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(screen.queryByLabelText('Solar is locked')).toBeNull()
  })
})
