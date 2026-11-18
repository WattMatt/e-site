import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock('@/actions/programme.actions', () => ({ createProgrammeAction: h.create }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }) }))
import { CreateProgrammeForm } from './CreateProgrammeForm'

beforeEach(() => vi.clearAllMocks())

describe('CreateProgrammeForm', () => {
  it('submits name and start, then goes to the new programme', async () => {
    h.create.mockResolvedValue({ ok: true, programmeId: 'p' })
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" />)
    fireEvent.click(screen.getByRole('button', { name: /create programme/i }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', kind: 'project', name: 'Project programme', projectStart: '2026-03-02' }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/programme?programme=p'))
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
    expect(h.push).not.toHaveBeenCalled()
  })
  it('a contractor programme sends kind contractor and the contractor name', async () => {
    h.create.mockResolvedValue({ ok: true, programmeId: 'c1' })
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" />)
    fireEvent.click(screen.getByLabelText('Contractor programme'))
    fireEvent.change(screen.getByLabelText('Contractor name'), { target: { value: '  Saxby Electrical ' } })
    fireEvent.click(screen.getByRole('button', { name: /create programme/i }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({
      projectId: 'p1', kind: 'contractor', name: 'Saxby Electrical programme', projectStart: '2026-03-02', contractorLabel: 'Saxby Electrical',
    }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/programme?programme=c1'))
  })
  it('a contractor programme needs the contractor name', async () => {
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" />)
    fireEvent.click(screen.getByLabelText('Contractor programme'))
    fireEvent.click(screen.getByRole('button', { name: /create programme/i }))
    expect((await screen.findByRole('alert')).textContent).toBe('Name the contractor.')
    expect(h.create).not.toHaveBeenCalled()
  })
  it('defaults to a contractor programme when the project already has its own', () => {
    render(<CreateProgrammeForm projectId="p1" defaultStart="2026-03-02" hasProjectProgramme />)
    expect((screen.getByLabelText('Our programme') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Contractor programme') as HTMLInputElement).checked).toBe(true)
  })
})
