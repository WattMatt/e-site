import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockCreateProjectAction = vi.fn()
vi.mock('@/actions/project.actions', () => ({
  createProjectAction: (...args: unknown[]) => mockCreateProjectAction(...args),
}))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))

// Imported after the vi.mock calls above (vitest hoists them); a static import
// keeps the cold module load out of the first test's 5 s budget.
import { NewProjectForm } from './NewProjectForm'

describe('NewProjectForm — optional fields left blank', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits with Province on "Select…" and Contract value empty, sending neither', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({ projectId: 'new-proj' })
    render(<NewProjectForm />)

    await userEvent.type(screen.getByPlaceholderText('Sandton Office Block'), 'Throwaway site')
    await userEvent.type(screen.getByPlaceholderText('Short project description…'), 'Short description')
    await userEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(mockCreateProjectAction).toHaveBeenCalledTimes(1))
    const input = mockCreateProjectAction.mock.calls[0][0]
    expect(input.name).toBe('Throwaway site')
    expect(input.province).toBeUndefined()
    expect(input.contractValue).toBeUndefined()
    // The two errors observed on production must not render.
    expect(screen.queryByText(/Invalid enum value/)).toBeNull()
    expect(screen.queryByText(/Expected number, received nan/i)).toBeNull()
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/projects/new-proj'))
  })

  it('clearing a typed contract value goes back to blank, not NaN', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({ projectId: 'new-proj' })
    render(<NewProjectForm />)

    await userEvent.type(screen.getByPlaceholderText('Sandton Office Block'), 'Throwaway site')
    const value = screen.getByPlaceholderText('1500000')
    await userEvent.type(value, '250')
    await userEvent.clear(value)
    await userEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(mockCreateProjectAction).toHaveBeenCalledTimes(1))
    expect(mockCreateProjectAction.mock.calls[0][0].contractValue).toBeUndefined()
  })

  it('still sends a chosen province and a typed contract value', async () => {
    mockCreateProjectAction.mockResolvedValueOnce({ projectId: 'new-proj' })
    render(<NewProjectForm />)

    await userEvent.type(screen.getByPlaceholderText('Sandton Office Block'), 'Throwaway site')
    await userEvent.selectOptions(screen.getByDisplayValue('Select…'), 'Gauteng')
    await userEvent.type(screen.getByPlaceholderText('1500000'), '1500000')
    await userEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(mockCreateProjectAction).toHaveBeenCalledTimes(1))
    const input = mockCreateProjectAction.mock.calls[0][0]
    expect(input.province).toBe('Gauteng')
    expect(input.contractValue).toBe(1500000)
  })
})
