import { describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ gate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminPage: h.gate }))
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/tariffs' }))
import TariffLibraryLayout from './layout'
import { render, screen } from '@testing-library/react'

describe('tariff library layout', () => {
  it('asks the gate before rendering anything (a non-admin gets its 404)', async () => {
    h.gate.mockRejectedValueOnce(new Error('NOT_FOUND'))
    await expect(TariffLibraryLayout({ children: <p>x</p> })).rejects.toThrow('NOT_FOUND')
  })
  it('renders the library chrome for an admin', async () => {
    h.gate.mockResolvedValueOnce({ supabase: {}, userId: 'a1' })
    render(await TariffLibraryLayout({ children: <p>child</p> }))
    expect(screen.getByRole('heading', { name: 'Tariff library' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Tariff years' }).getAttribute('href')).toBe('/admin/tariffs/years')
    expect(screen.getByText('child')).toBeDefined()
  })
})
