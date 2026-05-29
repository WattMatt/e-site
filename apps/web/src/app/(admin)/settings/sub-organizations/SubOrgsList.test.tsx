import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SubOrgsList } from './SubOrgsList'

describe('SubOrgsList', () => {
  it('renders empty state when list is empty', () => {
    render(<SubOrgsList initialSubOrgs={[]} />)
    expect(screen.getByText(/No sub-organisations yet/i)).toBeTruthy()
  })

  it('renders rows for each sub-org', () => {
    render(
      <SubOrgsList
        initialSubOrgs={[
          {
            id: 's1', name: "Bob's Building", parent_organisation_id: 'p',
            is_shadow: true, is_active: true, address: null, phone: '+27 21 555 0100',
            registration_number: null, vat_number: null,
            signatory_name: 'Bob', signatory_title: 'Owner',
            created_at: '2026-05-29',
          },
        ]}
      />,
    )
    expect(screen.getByText("Bob's Building")).toBeTruthy()
    expect(screen.getAllByText(/Bob/).length).toBeGreaterThan(0)
    expect(screen.getByText('shadow')).toBeTruthy()
  })
})
