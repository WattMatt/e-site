import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/sub-organisations.actions', () => ({
  createSubOrganisation: vi.fn(),
}))

describe('AddSubOrgForm', () => {
  it('renders the name field and create button', async () => {
    const { AddSubOrgForm } = await import('./AddSubOrgForm')
    render(<AddSubOrgForm />)
    expect(screen.getByText(/Name \*/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create sub-organisation/i })).toBeTruthy()
  })

  it('disables the create button when name is empty', async () => {
    const { AddSubOrgForm } = await import('./AddSubOrgForm')
    render(<AddSubOrgForm />)
    const btn = screen.getByRole('button', { name: /Create sub-organisation/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
