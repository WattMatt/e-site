import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/sub-organisations.actions', () => ({
  updateSubOrganisation: vi.fn(),
}))

const fixture = {
  id: 's1', name: "Bob's Building", parent_organisation_id: 'p',
  is_shadow: true, address: 'Cape Town', phone: '+27 21 555 0100',
  registration_number: '2024/123456/07', vat_number: '4123456789',
  signatory_name: 'Bob Smith', signatory_title: 'Owner',
  created_at: '2026-05-29',
}

describe('ContactDetailsPanel', () => {
  it('renders all current values', async () => {
    const { ContactDetailsPanel } = await import('./ContactDetailsPanel')
    render(<ContactDetailsPanel subOrg={fixture} />)
    expect(screen.getByDisplayValue("Bob's Building")).toBeTruthy()
    expect(screen.getByDisplayValue('Cape Town')).toBeTruthy()
    expect(screen.getByDisplayValue('+27 21 555 0100')).toBeTruthy()
    expect(screen.getByDisplayValue('2024/123456/07')).toBeTruthy()
    expect(screen.getByDisplayValue('4123456789')).toBeTruthy()
    expect(screen.getByDisplayValue('Bob Smith')).toBeTruthy()
    expect(screen.getByDisplayValue('Owner')).toBeTruthy()
  })

  it('save button is disabled until a field changes', async () => {
    const { ContactDetailsPanel } = await import('./ContactDetailsPanel')
    render(<ContactDetailsPanel subOrg={fixture} />)
    const btn = screen.getByRole('button', { name: /Save/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
