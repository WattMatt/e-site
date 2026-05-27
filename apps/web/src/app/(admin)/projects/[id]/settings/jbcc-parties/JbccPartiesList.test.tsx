import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/actions/jbcc-parties.actions', () => ({
  createJbccParty: (...args: unknown[]) => mockCreate(...args),
  updateJbccParty: (...args: unknown[]) => mockUpdate(...args),
  deleteJbccParty: (...args: unknown[]) => mockDelete(...args),
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const parties = [
  {
    id: 'p-1',
    project_id: 'proj-1',
    organisation_id: 'org-1',
    party_role: 'Employer',
    name: 'ACME Corp',
    company: 'ACME Holdings',
    address: '1 Main Street',
    email: 'acme@example.com',
    phone: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'p-2',
    project_id: 'proj-1',
    organisation_id: 'org-1',
    party_role: 'Contractor',
    name: 'BuildCo',
    company: null,
    address: null,
    email: null,
    phone: '+27 11 000 0000',
    created_by: null,
    created_at: '',
    updated_at: '',
  },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('JbccPartiesList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders parties in the list', async () => {
    const { JbccPartiesList } = await import('./JbccPartiesList')
    render(
      <JbccPartiesList projectId="proj-1" initialParties={parties} canEdit={false} />,
    )

    expect(screen.getByText('ACME Corp')).toBeTruthy()
    expect(screen.getByText('BuildCo')).toBeTruthy()
    expect(screen.getByText('Employer')).toBeTruthy()
    expect(screen.getByText('Contractor')).toBeTruthy()
  })

  it('hides Edit and Delete buttons when canEdit=false', async () => {
    const { JbccPartiesList } = await import('./JbccPartiesList')
    render(
      <JbccPartiesList projectId="proj-1" initialParties={parties} canEdit={false} />,
    )

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add party/ })).toBeNull()
  })

  it('calls createJbccParty when the Add form is submitted', async () => {
    mockCreate.mockResolvedValue({
      party: {
        id: 'p-new',
        project_id: 'proj-1',
        organisation_id: 'org-1',
        party_role: 'Principal Agent',
        name: 'Design Studio',
        company: null,
        address: null,
        email: null,
        phone: null,
        created_by: null,
        created_at: '',
        updated_at: '',
      },
    })

    const { JbccPartiesList } = await import('./JbccPartiesList')
    render(
      <JbccPartiesList projectId="proj-1" initialParties={[]} canEdit={true} />,
    )

    // Empty state shows "+ Add party" button (may also appear in header)
    await userEvent.click(screen.getAllByRole('button', { name: /Add party/ })[0])

    // Fill in party_role
    const roleInput = screen.getByPlaceholderText(/e.g. Employer/)
    await userEvent.clear(roleInput)
    await userEvent.type(roleInput, 'Principal Agent')

    // Fill in name
    const nameInput = screen.getByPlaceholderText('Full name or entity name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Design Studio')

    // Submit
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          party_role: 'Principal Agent',
          name: 'Design Studio',
        }),
      )
    })
  })
})
