import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ link: vi.fn(async () => ({ ok: true })), unlink: vi.fn(async () => ({ ok: true })), share: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ linkMeterAction: h.link, unlinkMeterAction: h.unlink, setMeterShareAction: h.share }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('./GenerationImport', () => ({ GenerationImport: () => <div data-testid="import" /> }))
import { MetersCard } from './MetersCard'

const props = {
  projectId: 'p1', installationId: 'i1', organisationId: 'o1', canEdit: true,
  meters: [{ meterId: 'm1', label: 'PV main', kind: 'solar', role: 'generation' as const, sharePct: null }],
  availableMeters: [{ meterId: 'm2', label: 'Council', kind: 'council' }, { meterId: 'm3', label: 'PV roof B', kind: 'solar' }],
}
beforeEach(() => vi.clearAllMocks())

describe('MetersCard', () => {
  it('links an available meter in the role its kind allows', async () => {
    render(<MetersCard {...props} />)
    fireEvent.change(screen.getByLabelText('Meter to link'), { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link meter' }))
    await waitFor(() => expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm2', role: 'consumption' }))
    fireEvent.change(screen.getByLabelText('Meter to link'), { target: { value: 'm3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link meter' }))
    await waitFor(() => expect(h.link).toHaveBeenLastCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm3', role: 'generation' }))
  })
  it('unlink needs a second press', async () => {
    render(<MetersCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unlink PV main' }))
    expect(h.unlink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unlink PV main' }))
    await waitFor(() => expect(h.unlink).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm1' }))
  })
  it('says when shares are equal, and offers the import', () => {
    render(<MetersCard {...props} />)
    expect(screen.getByText(/allocated equally/)).toBeTruthy()
    expect(screen.getByTestId('import')).toBeTruthy()
  })
  it('View level: no controls', () => {
    render(<MetersCard {...props} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Link meter' })).toBeNull()
    expect(screen.queryByTestId('import')).toBeNull()
  })
})
