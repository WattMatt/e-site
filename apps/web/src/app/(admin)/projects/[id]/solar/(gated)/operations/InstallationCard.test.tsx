import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ createInstallationAction: h.create, saveInstallationAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { InstallationCard } from './InstallationCard'

const inst = {
  id: 'i1', commissioningDate: '2026-02-15', notes: null, updatedAt: 'T1', annualP50Kwh: 150_000,
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
    equipment: [{ kind: 'module' as const, make: 'Acme', model: 'M-500', rating: 500, unit: 'W' as const, quantity: 200 }] },
  baseline: { version: 1 as const, caseRunId: 'run-1234abcd', inputsHash: 'h', dcKwp: 100, acKw: 80, performanceRatio: 0.81, monthlyKwh: [], diurnalKw: [], ghiKwhM2: null },
}
beforeEach(() => vi.clearAllMocks())

describe('InstallationCard — before installation', () => {
  it('shows the reason when it cannot be created', () => {
    render(<InstallationCard projectId="p1" canEdit installation={null} acceptedProposal={null} setupReason="No accepted proposal yet." />)
    expect(screen.getByText('No accepted proposal yet.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('records the installation from the accepted proposal', async () => {
    h.create.mockResolvedValue({ ok: true, installationId: 'i1', warning: null })
    render(<InstallationCard projectId="p1" canEdit installation={null} acceptedProposal={{ id: 'prop', version: 3 }} setupReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record installation from proposal v3' }))
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ projectId: 'p1' }))
    expect(h.refresh).toHaveBeenCalled()
  })
  it('a View user is told who records it', () => {
    render(<InstallationCard projectId="p1" canEdit={false} installation={null} acceptedProposal={{ id: 'prop', version: 3 }} setupReason={null} />)
    expect(screen.getByText(/Someone with Solar Edit access records the installation/)).toBeTruthy()
  })
})

describe('InstallationCard — as-built', () => {
  it('saves commissioning date, sizes and equipment as numbers', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<InstallationCard projectId="p1" canEdit installation={inst} acceptedProposal={null} setupReason={null} />)
    expect(screen.getByText(/150 000 kWh a year \(P50\)/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Commissioning date'), { target: { value: '2026-02-20' } })
    fireEvent.change(screen.getByLabelText('DC kWp'), { target: { value: '101.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save installation' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    expect(h.save.mock.calls[0]![0]).toMatchObject({
      projectId: 'p1', installationId: 'i1', commissioningDate: '2026-02-20', expectedUpdatedAt: 'T1',
      asBuilt: { dcKwp: 101.5, acKw: 80, batteryKwh: null, equipment: [{ kind: 'module', make: 'Acme', model: 'M-500', rating: 500, unit: 'W', quantity: 200 }] },
    })
  })
  it('shows field errors from the action', async () => {
    h.save.mockResolvedValue({ fieldErrors: { commissioningDate: 'Enter a real date (YYYY-MM-DD).' } })
    render(<InstallationCard projectId="p1" canEdit installation={inst} acceptedProposal={null} setupReason={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save installation' }))
    expect(await screen.findByText('Enter a real date (YYYY-MM-DD).')).toBeTruthy()
  })
  it('View level is read-only', () => {
    render(<InstallationCard projectId="p1" canEdit={false} installation={inst} acceptedProposal={null} setupReason={null} />)
    expect(screen.queryByRole('button', { name: 'Save installation' })).toBeNull()
    expect((screen.getByLabelText('DC kWp') as HTMLInputElement).disabled).toBe(true)
  })
})
