import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { SubOrgRosterPanel } from './SubOrgRosterPanel'
import type { SubOrgMember } from '@/actions/sub-org-members.actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/actions/sub-org-members.actions', () => ({
  addSubOrgMember:                  vi.fn(),
  removeSubOrgMember:               vi.fn(),
  reactivateSubOrgMember:           vi.fn().mockResolvedValue({ ok: true }),
  getProjectMembershipsForUser:     vi.fn().mockResolvedValue({ ok: true, count: 0, projectNames: [] }),
}))

const makeMembers = (n: number, isActive = true): SubOrgMember[] =>
  Array.from({ length: n }, (_, i) => ({
    id:              `member-${isActive ? '' : 'x'}${i}`,
    user_id:         `user-${isActive ? '' : 'x'}${i}`,
    organisation_id: 'suborg-1',
    role:            'contractor',
    is_active:       isActive,
    created_at:      '2026-05-29',
    full_name:       `${isActive ? 'Person' : 'Dormant'} ${i + 1}`,
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

  it('renders a Deactivated section with a Reactivate button for inactive members', () => {
    const members = [...makeMembers(1, true), ...makeMembers(1, false)]
    render(
      <SubOrgRosterPanel
        subOrgId="suborg-1"
        parentOrgId="org-wm"
        initialMembers={members}
        onOpenBulkInvite={vi.fn()}
      />,
    )
    expect(screen.getByText('Deactivated')).toBeTruthy()
    expect(screen.getByText('Dormant 1')).toBeTruthy()
    // Active member → Remove; inactive member → Reactivate.
    expect(screen.getAllByRole('button', { name: /^remove$/i }).length).toBe(1)
    expect(screen.getAllByRole('button', { name: /reactivate/i }).length).toBe(1)
  })

  it('fires reactivateSubOrgMember when Reactivate is clicked', async () => {
    const { reactivateSubOrgMember } = await import('@/actions/sub-org-members.actions')
    const members = makeMembers(1, false)
    render(
      <SubOrgRosterPanel
        subOrgId="suborg-1"
        parentOrgId="org-wm"
        initialMembers={members}
        onOpenBulkInvite={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reactivate/i }))
    await waitFor(() => expect(reactivateSubOrgMember).toHaveBeenCalledWith('member-x0'))
  })
})
