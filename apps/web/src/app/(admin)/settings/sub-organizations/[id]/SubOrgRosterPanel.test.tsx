import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SubOrgRosterPanel } from './SubOrgRosterPanel'
import type { SubOrgMember } from '@/actions/sub-org-members.actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/actions/sub-org-members.actions', () => ({
  addSubOrgMember:                  vi.fn(),
  removeSubOrgMember:               vi.fn(),
  getProjectMembershipsForUser:     vi.fn().mockResolvedValue({ ok: true, count: 0, projectNames: [] }),
}))

const makeMembers = (n: number): SubOrgMember[] =>
  Array.from({ length: n }, (_, i) => ({
    id:              `member-${i}`,
    user_id:         `user-${i}`,
    organisation_id: 'suborg-1',
    role:            'contractor',
    is_active:       true,
    created_at:      '2026-05-29',
    full_name:       `Person ${i + 1}`,
    email:           `person${i + 1}@example.com`,
  }))

describe('SubOrgRosterPanel', () => {
  it('renders empty CTA when roster is empty and form is hidden', () => {
    render(
      <SubOrgRosterPanel
        subOrgId="suborg-1"
        parentOrgId="org-wm"
        initialMembers={[]}
        onOpenBulkInvite={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/No one in the roster yet/i),
    ).toBeTruthy()
  })

  it('renders both member rows and Remove buttons for a 2-member roster', () => {
    const members = makeMembers(2)
    render(
      <SubOrgRosterPanel
        subOrgId="suborg-1"
        parentOrgId="org-wm"
        initialMembers={members}
        onOpenBulkInvite={vi.fn()}
      />,
    )
    expect(screen.getByText('Person 1')).toBeTruthy()
    expect(screen.getByText('Person 2')).toBeTruthy()
    expect(screen.queryByText(/No one in the roster yet/i)).toBeNull()
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBe(2)
  })
})
