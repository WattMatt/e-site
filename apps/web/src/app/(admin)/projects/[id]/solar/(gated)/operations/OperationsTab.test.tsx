import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('./InstallationCard', () => ({ InstallationCard: () => <div data-testid="installation" /> }))
vi.mock('./MetersCard', () => ({ MetersCard: () => <div data-testid="meters" /> }))
vi.mock('./GuaranteeCard', () => ({ GuaranteeCard: () => <div data-testid="guarantee" /> }))
vi.mock('./PerformanceTable', () => ({ PerformanceTable: () => <div data-testid="performance" /> }))
vi.mock('./IrradiationCard', () => ({ IrradiationCard: () => <div data-testid="irradiation" /> }))
vi.mock('./DowntimeLog', () => ({ DowntimeLog: () => <div data-testid="downtime" /> }))
vi.mock('./MonthlyReportPanel', () => ({ MonthlyReportPanel: () => <div data-testid="monthly" /> }))
vi.mock('./HandoverChecklist', () => ({ HandoverChecklist: () => <div data-testid="handover" /> }))
import { OperationsTab } from './OperationsTab'
import type { OperationsView } from '@/lib/solar/operations/data'

const base: OperationsView = {
  level: 'edit', canEdit: true, canSeeMoney: false, studyId: 's1', organisationId: 'o1', setupReason: null, acceptedProposal: null,
  installation: null, meters: [], availableMeters: [], guarantee: null, irradiation: [], downtime: [], months: [], selectedMonth: null,
  performance: [], candidates: [], handover: { items: [], completion: { done: 0, total: 0, pct: 0, requiredDone: 0, requiredTotal: 0 }, documents: [], templateName: '' },
  monthly: null, readiness: null,
}
const installed = { ...base, installation: { id: 'i1', commissioningDate: '2026-02-15', notes: null, updatedAt: 'T', annualP50Kwh: 12000,
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0, equipment: [] },
  baseline: { version: 1, caseRunId: 'r', inputsHash: 'h', dcKwp: 100, acKw: 80, performanceRatio: 0.8, monthlyKwh: new Array(12).fill(1000), diurnalKw: [], ghiKwhM2: null } } } as unknown as OperationsView

describe('OperationsTab', () => {
  it('before installation: only the installation card', () => {
    render(<OperationsTab projectId="p1" view={base} />)
    expect(screen.getByTestId('installation')).toBeTruthy()
    expect(screen.queryByTestId('performance')).toBeNull()
  })
  it('installed, no money: every section except the monthly report', () => {
    render(<OperationsTab projectId="p1" view={installed} />)
    for (const id of ['installation', 'meters', 'guarantee', 'performance', 'irradiation', 'downtime', 'handover']) expect(screen.getByTestId(id)).toBeTruthy()
    expect(screen.queryByTestId('monthly')).toBeNull()
  })
  it('money level: the monthly report panel appears', () => {
    render(<OperationsTab projectId="p1" view={{ ...installed, canSeeMoney: true, monthly: { notes: {} as never, notesUpdatedAt: {} as never, generateReason: 'x', tariffName: null } }} />)
    expect(screen.getByTestId('monthly')).toBeTruthy()
  })
})
