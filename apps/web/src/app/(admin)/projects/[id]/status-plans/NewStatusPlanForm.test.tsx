import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }))
const createStatusPlanAction = vi.fn()
vi.mock('@/actions/status-plan.actions', () => ({ createStatusPlanAction: (...a: unknown[]) => createStatusPlanAction(...a) }))

import { NewStatusPlanForm } from './NewStatusPlanForm'

const DRAWINGS = [
  { id: 'fp1', name: 'E-100 Ground', renderable: true },
  { id: 'fp2', name: 'Site DWG', renderable: false },
]

beforeEach(() => vi.clearAllMocks())

describe('NewStatusPlanForm', () => {
  it('walks drawing → page → purpose → name and opens the new plan', async () => {
    createStatusPlanAction.mockResolvedValue({ ok: true, data: { id: 'pl9' } })
    render(<NewStatusPlanForm projectId="p1" drawings={DRAWINGS} />)
    fireEvent.click(screen.getByRole('button', { name: /new status plan/i }))

    expect((screen.getByLabelText('Drawing') as HTMLSelectElement).value).toBe('fp1')
    expect(screen.getByRole('option', { name: /Site DWG/ })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: '2' } })
    fireEvent.click(screen.getByLabelText(/Distribution schematic/))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('E-100 Ground — Distribution schematic (page 2)')

    fireEvent.click(screen.getByRole('button', { name: /create plan/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p1/status-plans/pl9'))
    expect(createStatusPlanAction).toHaveBeenCalledWith({
      projectId: 'p1', floorPlanId: 'fp1', pageIndex: 2, purpose: 'distribution_schematic',
      name: 'E-100 Ground — Distribution schematic (page 2)',
    })
  })

  it("shows the action's sentence and stays open on a refusal", async () => {
    createStatusPlanAction.mockResolvedValue({ ok: false, error: 'This page of the drawing already has a plan for that purpose. Open the existing plan instead.' })
    render(<NewStatusPlanForm projectId="p1" drawings={DRAWINGS} />)
    fireEvent.click(screen.getByRole('button', { name: /new status plan/i }))
    fireEvent.click(screen.getByRole('button', { name: /create plan/i }))
    // No jest-dom in this repo (vitest.config.ts has no setupFiles): assert on textContent.
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a plan/)
    expect(push).not.toHaveBeenCalled()
  })

  it('says what to do when no drawing can be drawn on', () => {
    render(<NewStatusPlanForm projectId="p1" drawings={[DRAWINGS[1]!]} />)
    fireEvent.click(screen.getByRole('button', { name: /new status plan/i }))
    expect(screen.getByText(/Upload a PDF or image drawing under Floor Plans first/)).toBeTruthy()
  })
})
