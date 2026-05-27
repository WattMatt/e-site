import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ProjectMembersList } from './ProjectMembersList'
import type { ProjectMember, OrgMemberOption } from '@/actions/project-members.actions'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/actions/project-members.actions', async () => {
  const actual = await vi.importActual<any>('@/actions/project-members.actions')
  return {
    ...actual,
    addProjectMember: vi.fn(),
    updateProjectMemberRole: vi.fn(),
    removeProjectMember: vi.fn(),
  }
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALICE: ProjectMember = {
  id: 'm-1',
  project_id: 'p-1',
  organisation_id: 'org-1',
  user_id: 'u-alice',
  role: 'contractor',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  full_name: 'Alice Smith',
  email: 'alice@example.com',
  org_role: 'contractor',
}

const BOB: ProjectMember = {
  id: 'm-2',
  project_id: 'p-1',
  organisation_id: 'org-1',
  user_id: 'u-bob',
  role: 'inspector',
  is_active: true,
  created_at: '2024-01-02T00:00:00Z',
  full_name: 'Bob Jones',
  email: 'bob@example.com',
  org_role: 'contractor', // org role differs from project role — override marker
}

const CAROL: OrgMemberOption = {
  user_id: 'u-carol',
  full_name: 'Carol White',
  email: 'carol@example.com',
  org_role: 'contractor',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProjectMembersList', () => {
  it('renders all project members', () => {
    render(
      <ProjectMembersList
        projectId="p-1"
        orgOwnerId={null}
        initialMembers={[ALICE, BOB]}
        availableOrgMembers={[CAROL]}
        canEdit={true}
      />,
    )

    expect(screen.getByText('Alice Smith')).toBeDefined()
    expect(screen.getByText('alice@example.com')).toBeDefined()
    expect(screen.getByText('Bob Jones')).toBeDefined()
    expect(screen.getByText('bob@example.com')).toBeDefined()
  })

  it('shows the add-member picker with available org members', async () => {
    render(
      <ProjectMembersList
        projectId="p-1"
        orgOwnerId={null}
        initialMembers={[ALICE]}
        availableOrgMembers={[CAROL]}
        canEdit={true}
      />,
    )

    // The "+ Add member" button should be present
    const addButton = screen.getByText('+ Add member')
    expect(addButton).toBeDefined()

    // Click to open the picker — wrap in act to flush state update
    await act(async () => { fireEvent.click(addButton) })

    // Carol should appear in the select
    expect(screen.getByText(/Carol White/)).toBeDefined()
  })

  it('renders empty state when no members', () => {
    render(
      <ProjectMembersList
        projectId="p-1"
        orgOwnerId={null}
        initialMembers={[]}
        availableOrgMembers={[CAROL]}
        canEdit={true}
      />,
    )

    expect(screen.getByText('No explicit members yet')).toBeDefined()
  })

  it('shows role override marker when org_role differs from project role', () => {
    render(
      <ProjectMembersList
        projectId="p-1"
        orgOwnerId={null}
        initialMembers={[BOB]}
        availableOrgMembers={[]}
        canEdit={true}
      />,
    )

    // BOB has project role=inspector but org_role=contractor — should show override label
    expect(screen.getByText(/org: Contractor/)).toBeDefined()
  })

  it('hides Edit/Remove for the org owner', () => {
    const owner: ProjectMember = { ...ALICE, user_id: 'u-owner', id: 'm-owner' }
    render(
      <ProjectMembersList
        projectId="p-1"
        orgOwnerId="u-owner"
        initialMembers={[owner, BOB]}
        availableOrgMembers={[]}
        canEdit={true}
      />,
    )

    // For owner row: no Edit or Remove buttons
    // For BOB row: Edit + Remove should be present
    const editButtons = screen.getAllByText('Edit')
    expect(editButtons).toHaveLength(1) // Only BOB's row

    const removeButtons = screen.getAllByText('Remove')
    expect(removeButtons).toHaveLength(1) // Only BOB's row
  })
})
