import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/programme.actions', () => ({ createProgrammeAction: h.create }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { CreateProgrammeForm } from './CreateProgrammeForm'

beforeEach(() => vi.clearAllMocks())

describe('CreateProgrammeForm', () => {
  it('submits name and start, then refreshes', async () => {
    h.create.mockResolvedValue({ ok: true, programmeId: 'p' })
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" />)
    fireEvent.click(screen.getByRole('button', { name: /create programme/i }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', kind: 'project', name: 'Project programme', projectStart: '2026-03-02' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })
  it('sends edited values', async () => {
    h.create.mockResolvedValue({ ok: true, programmeId: 'p' })
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fit-out' } })
    fireEvent.change(screen.getByLabelText('Project start'), { target: { value: '2026-04-01' } })
    fireEvent.click(screen.getByRole('button', { name: /create programme/i }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', kind: 'project', name: 'Fit-out', projectStart: '2026-04-01' }))
  })
  it('shows the refusal sentence and does not refresh', async () => {
    h.create.mockResolvedValue({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" />)
    fireEvent.click(screen.getByRole('button', { name: /create programme/i }))
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to edit programmes on this project.')
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
