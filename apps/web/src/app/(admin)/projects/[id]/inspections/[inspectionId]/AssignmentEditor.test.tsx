import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import AssignmentEditor from './AssignmentEditor'

// vi.hoisted so the mock fns exist before the hoisted vi.mock factories run.
const { updateMock, refreshMock } = vi.hoisted(() => ({ updateMock: vi.fn(), refreshMock: vi.fn() }))
vi.mock('@/actions/inspections.actions', () => ({
  updateInspectionAssignmentAction: (...args: unknown[]) => updateMock(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

const MEMBERS = [
  { user_id: 'u-alice', full_name: 'Alice Smith', email: 'alice@example.com', role: 'project_manager' },
  { user_id: 'u-bob', full_name: 'Bob Jones', email: 'bob@example.com', role: 'inspector' },
]

const baseProps = {
  inspectionId: 'insp-1',
  projectId: 'p-1',
  organisationId: 'org-1',
  assignedToId: 'u-bob',
  verifierId: 'u-alice',
  assigneeName: 'Bob Jones',
  verifierName: 'Alice Smith',
  members: MEMBERS,
}

beforeEach(() => vi.clearAllMocks())

describe('AssignmentEditor', () => {
  it('renders read-only names when canEdit is false', () => {
    render(<AssignmentEditor {...baseProps} canEdit={false} />)
    expect(screen.getByText(/Bob Jones/)).toBeDefined()
    expect(screen.getByText(/Alice Smith/)).toBeDefined()
    expect(screen.queryByText('Save')).toBeNull()
  })

  it('renders editable dropdowns pre-selected when canEdit is true', () => {
    render(<AssignmentEditor {...baseProps} canEdit={true} />)
    const inspectorSelect = screen.getByLabelText(/INSPECTOR/i) as HTMLSelectElement
    const verifierSelect = screen.getByLabelText(/VERIFIER/i) as HTMLSelectElement
    expect(inspectorSelect.value).toBe('u-bob')
    expect(verifierSelect.value).toBe('u-alice')
    expect(screen.getByText('Save')).toBeDefined()
  })

  it('only lists verifier-eligible roles in the verifier dropdown', () => {
    render(<AssignmentEditor {...baseProps} canEdit={true} />)
    const verifierSelect = screen.getByLabelText(/VERIFIER/i) as HTMLSelectElement
    const optionValues = Array.from(verifierSelect.options).map((o) => o.value)
    expect(optionValues).toContain('u-alice')
    expect(optionValues).not.toContain('u-bob')
  })

  it('calls updateInspectionAssignmentAction on Save', async () => {
    updateMock.mockResolvedValue({ ok: true, value: undefined })
    render(<AssignmentEditor {...baseProps} canEdit={true} />)
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })
    expect(updateMock).toHaveBeenCalledWith({
      inspectionId: 'insp-1',
      projectId: 'p-1',
      organisationId: 'org-1',
      assignedToId: 'u-bob',
      verifierId: 'u-alice',
    })
  })

  it('does not crash when canEdit toggles (hook-order guard, React #310)', () => {
    const { rerender } = render(<AssignmentEditor {...baseProps} canEdit={false} />)
    expect(() => {
      rerender(<AssignmentEditor {...baseProps} canEdit={true} />)
      rerender(<AssignmentEditor {...baseProps} canEdit={false} />)
    }).not.toThrow()
  })

  it('shows the database refusal as a sentence', async () => {
    updateMock.mockResolvedValue({ ok: false, error: 'Alice has already filled in answers on this inspection, so they cannot verify it.' })
    render(<AssignmentEditor {...baseProps} canEdit />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }))
    })
    expect(screen.getByText(/already filled in answers/)).toBeTruthy()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('on a separate-verifier template, will not offer someone who entered answers as verifier', () => {
    render(<AssignmentEditor {...baseProps} verifierId="u-carol" canEdit separateVerifier contributorIds={['u-alice']}
      members={[...MEMBERS, { user_id: 'u-carol', full_name: 'Carol', email: null, role: 'admin' }]} />)
    const verifierSelect = screen.getByLabelText(/VERIFIER/) as HTMLSelectElement
    const opt = (re: RegExp) => [...verifierSelect.options].find((o) => re.test(o.textContent ?? ''))!
    const alice = opt(/Alice Smith/)
    expect(alice.disabled).toBe(true)
    expect(alice.textContent).toMatch(/cannot verify: has entered answers/)
    expect(opt(/Carol/).disabled).toBe(false)
  })
})

