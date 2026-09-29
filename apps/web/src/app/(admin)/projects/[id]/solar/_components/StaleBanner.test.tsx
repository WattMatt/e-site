import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ refresh: vi.fn(), post: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('./runCase', () => ({ postRun: h.post }))
import { StaleBanner } from './StaleBanner'

beforeEach(() => vi.clearAllMocks())
describe('StaleBanner', () => {
  it('names the case and, for writers, re-runs it and refreshes on success', async () => {
    h.post.mockResolvedValue({ ok: true, runId: 'r2' })
    render(<StaleBanner projectId="p1" caseId="c1" caseName="Base" canRun />)
    expect(screen.getByRole('status').textContent).toContain('Results for “Base” no longer match its inputs')
    fireEvent.click(screen.getByRole('button', { name: 'Re-run selected case' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(h.post).toHaveBeenCalledWith('p1', 'c1')
  })
  it('shows the server sentence on failure; no button for View users', async () => {
    h.post.mockResolvedValue({ ok: false, error: 'Build the site load on the Load tab first.' })
    const { rerender } = render(<StaleBanner projectId="p1" caseId="c1" caseName="Base" canRun />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run selected case' }))
    await screen.findByText('Build the site load on the Load tab first.')
    expect(h.refresh).not.toHaveBeenCalled()
    rerender(<StaleBanner projectId="p1" caseId="c1" caseName="Base" canRun={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
