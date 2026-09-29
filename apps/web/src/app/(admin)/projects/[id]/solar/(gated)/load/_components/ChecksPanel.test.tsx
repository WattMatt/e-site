import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ ack: vi.fn(async (_i: unknown) => ({ ok: true })), unack: vi.fn(async (_i: unknown) => ({ ok: true })) }))
vi.mock('@/actions/solar-load.actions', () => ({ acknowledgeCheckAction: h.ack, unacknowledgeCheckAction: h.unack }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { ChecksPanel } from './ChecksPanel'
import type { ChecksView } from '@/lib/solar/load/view-types'

const view: ChecksView = {
  studyId: 's1', builtAt: '2025-09-01T00:00:00Z',
  checks: [
    { key: 'recon_bulk:b:3', severity: 'warning', message: 'Month 3: Σ metered tenants is 85 % of Bulk.', meterId: 'b', ack: null },
    { key: 'excluded_kind:pv', severity: 'info', message: 'PV is a solar meter and is never counted as load.', meterId: 'pv', ack: { at: '2025-09-02T00:00:00Z', note: 'expected' } },
  ],
  imports: [{ fileId: 'f1', fileName: 'Shop 12.csv', format: 'A', acceptedAt: '2025-08-30T00:00:00Z', errors: [], warnings: [{ code: 'spikes', message: '3 spikes flagged.' }] }],
}
beforeEach(() => vi.clearAllMocks())

describe('ChecksPanel', () => {
  it('lists site checks with links to the object and import reports with their warnings', () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit />)
    expect(screen.getByText('Month 3: Σ metered tenants is 85 % of Bulk.')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open meter' })[0]!.getAttribute('href')).toBe('/projects/p1/solar/load?tab=meters&meter=b')
    expect(screen.getByText('3 spikes flagged.')).toBeTruthy()
    expect(screen.getByText(/Acknowledged .*expected/)).toBeTruthy()
  })
  it('acknowledges a warning with a note', async () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit />)
    await userEvent.type(screen.getByLabelText('Note for recon_bulk:b:3'), 'common area')
    await userEvent.click(screen.getByRole('button', { name: 'Mark as acknowledged' }))
    expect(h.ack).toHaveBeenCalledWith({ projectId: 'p1', checkKey: 'recon_bulk:b:3', note: 'common area' })
  })
  it('undo removes an acknowledgement', async () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(h.unack).toHaveBeenCalledWith({ projectId: 'p1', checkKey: 'excluded_kind:pv' })
  })
  it('View users cannot acknowledge or undo', () => {
    render(<ChecksPanel projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Mark as acknowledged' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('before the first build it says how to run the checks', () => {
    render(<ChecksPanel projectId="p1" view={{ studyId: null, builtAt: null, checks: [], imports: [] }} canEdit />)
    expect(screen.getByText(/Build the site profile/)).toBeTruthy()
    expect(screen.getByText('No imported meter files in this study.')).toBeTruthy()
  })
})
