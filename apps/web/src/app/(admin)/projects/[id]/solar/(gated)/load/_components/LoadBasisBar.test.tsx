import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), run: vi.fn(async () => true) }))
vi.mock('@/actions/solar-load.actions', () => ({ saveLoadBasisAction: h.save }))
vi.mock('@/lib/solar/load/use-rebuild', async (orig) => ({
  ...(await orig<object>()),
  useRebuild: () => ({ state: { running: false, message: null, error: null, done: null }, run: h.run }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { LoadBasisBar } from './LoadBasisBar'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })

describe('LoadBasisBar', () => {
  it('saves the basis on the loaded version, then rebuilds', async () => {
    render(<LoadBasisBar projectId="p1" basis="S2" updatedAt="T0" canEdit hint={null} />)
    await userEvent.selectOptions(screen.getByLabelText('Load basis'), 'S4')
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', basis: 'S4', expectedUpdatedAt: 'T0' })
    expect(h.run).toHaveBeenCalled()
  })
  it('shows a stale refusal and does not rebuild', async () => {
    h.save.mockResolvedValue({ error: 'Someone else changed this — reload to see their version.' })
    render(<LoadBasisBar projectId="p1" basis="S2" updatedAt="T0" canEdit hint={null} />)
    await userEvent.selectOptions(screen.getByLabelText('Load basis'), 'S1')
    expect((await screen.findByRole('alert')).textContent).toContain('Someone else changed this')
    expect(h.run).not.toHaveBeenCalled()
  })
  it('a View user sees the basis as text, no control', () => {
    render(<LoadBasisBar projectId="p1" basis="S1" updatedAt="T0" canEdit={false} hint={null} />)
    expect(screen.queryByLabelText('Load basis')).toBeNull()
    expect(screen.getByText(/Bulk meter \(S1\)/)).toBeTruthy()
  })
})
