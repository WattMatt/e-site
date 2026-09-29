import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ add: vi.fn(async () => ({ ok: true, id: 'd9' })), upd: vi.fn(async () => ({ ok: true, updatedAt: 'D2' })), del: vi.fn(async () => ({ ok: true })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ addDowntimeAction: h.add, updateDowntimeAction: h.upd, deleteDowntimeAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { DowntimeLog } from './DowntimeLog'

const row = { id: 'd1', startsAt: '2026-03-10T08:00:00.000Z', endsAt: '2026-03-10T10:00:00.000Z', cause: 'grid_outage', description: 'Eskom',
  excludedFromGuarantee: true, source: 'manual' as const, updatedAt: 'D1', lostKwh: 16.1 }
const cand = { startsAt: '2026-03-12T09:30:00.000Z', endsAt: '2026-03-12T11:00:00.000Z', intervals: 3, hours: 1.5 }
beforeEach(() => vi.clearAllMocks())

describe('DowntimeLog', () => {
  it('lists downtime in SAST with lost kWh and the guarantee flag', () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[row]} candidates={[]} selectedMonth="2026-03" />)
    const r = screen.getByRole('row', { name: /2026-03-10 10:00/ })
    expect(r.textContent).toContain('2026-03-10 12:00')
    expect(r.textContent).toContain('Grid outage')
    expect(r.textContent).toContain('Excluded')
    expect(r.textContent).toContain('16')
  })
  it('adds downtime from the form (datetime-local is SAST)', async () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[]} candidates={[]} selectedMonth="2026-03" />)
    fireEvent.change(screen.getByLabelText('Start (SAST)'), { target: { value: '2026-03-11T10:00' } })
    fireEvent.change(screen.getByLabelText('End (SAST)'), { target: { value: '2026-03-11T12:00' } })
    fireEvent.change(screen.getByLabelText('Cause'), { target: { value: 'inverter_fault' } })
    fireEvent.click(screen.getByLabelText('Excluded from the guarantee'))
    fireEvent.click(screen.getByRole('button', { name: 'Add downtime' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', startsAt: '2026-03-11T10:00', endsAt: '2026-03-11T12:00',
      cause: 'inverter_fault', description: '', excludedFromGuarantee: true, source: 'manual' }))
  })
  it('confirming a candidate records it as detected with the chosen cause', async () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[]} candidates={[cand]} selectedMonth="2026-03" />)
    expect(screen.getByText(/zero output while the sun was more than 5°/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cause for 2026-03-12 11:30'), { target: { value: 'communications' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 2026-03-12 11:30' }))
    await waitFor(() => expect(h.add).toHaveBeenCalledWith(expect.objectContaining({ startsAt: cand.startsAt, endsAt: cand.endsAt, cause: 'communications', source: 'detected' })))
  })
  it('dismiss hides a candidate without writing', () => {
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[]} candidates={[cand]} selectedMonth="2026-03" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss 2026-03-12 11:30' }))
    expect(screen.queryByRole('button', { name: 'Confirm 2026-03-12 11:30' })).toBeNull()
    expect(h.add).not.toHaveBeenCalled()
  })
  it('delete needs a second press; View level has no controls', async () => {
    const { unmount } = render(<DowntimeLog projectId="p1" installationId="i1" canEdit downtime={[row]} candidates={[]} selectedMonth="2026-03" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete downtime 2026-03-10 10:00' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete 2026-03-10 10:00' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', id: 'd1' }))
    unmount()
    render(<DowntimeLog projectId="p1" installationId="i1" canEdit={false} downtime={[row]} candidates={[]} selectedMonth="2026-03" />)
    expect(screen.queryByRole('button', { name: 'Add downtime' })).toBeNull()
  })
})
