import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/actions/project-contacts.actions', () => ({
  createProjectContact: (...args: unknown[]) => mockCreate(...args),
  updateProjectContact: (...args: unknown[]) => mockUpdate(...args),
  deleteProjectContact: (...args: unknown[]) => mockDelete(...args),
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const contacts = [
  {
    id: 'c-1',
    project_id: 'p-1',
    organisation_id: 'org-1',
    name: 'Alice',
    role: 'Site Manager',
    company: 'BuildCo',
    email: 'alice@example.com',
    phone: null,
    created_at: '',
  },
  {
    id: 'c-2',
    project_id: 'p-1',
    organisation_id: 'org-1',
    name: 'Bob',
    role: null,
    company: null,
    email: null,
    phone: '+27 82 000 0000',
    created_at: '',
  },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContactsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders contacts in the list', async () => {
    const { ContactsList } = await import('./ContactsList')
    render(
      <ContactsList projectId="p-1" initialContacts={contacts} canEdit={false} />,
    )

    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText(/Site Manager/)).toBeTruthy()
    expect(screen.getByText(/BuildCo/)).toBeTruthy()
  })

  it('hides Edit and Delete buttons when canEdit=false', async () => {
    const { ContactsList } = await import('./ContactsList')
    render(
      <ContactsList projectId="p-1" initialContacts={contacts} canEdit={false} />,
    )

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    // No "Add contact" button either
    expect(screen.queryByRole('button', { name: /Add contact/ })).toBeNull()
  })

  it('calls createProjectContact when the Add form is submitted', async () => {
    mockCreate.mockResolvedValue({ contact: { id: 'c-new', name: 'Carol', project_id: 'p-1', organisation_id: 'org-1', role: null, company: null, email: null, phone: null, created_at: '' } })

    const { ContactsList } = await import('./ContactsList')
    render(
      <ContactsList projectId="p-1" initialContacts={[]} canEdit={true} />,
    )

    // Empty state shows "+ Add contact" button (may also appear in header)
    await userEvent.click(screen.getAllByRole('button', { name: /Add contact/ })[0])

    // Fill in the name field
    const nameInput = screen.getByPlaceholderText('Jane Smith')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Carol')

    // Submit
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ name: 'Carol' }),
      )
    })
  })
})
