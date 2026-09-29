import { buildProposalSnapshot, offerPrice, type BuildSnapshotInput, type ProposalSnapshot } from '@esite/shared/solar-reports'
import { pdfText } from '@/lib/solar/reports/pdf-text'

export function proposalSnapshotInput(over: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  return {
    proposal: { id: 'p1', familyId: 'p1', version: 2, title: 'Rooftop PV for Acme → phase 1', issuedAt: '2026-09-29T08:00:00.000Z', validUntil: '2026-10-29T08:00:00.000Z' },
    issuer: { orgName: 'Sun Co', proposerName: 'Pat Proposer', proposerEmail: 'pat@sun.example' },
    project: { name: 'Acme Mall', address: '1 Main Rd, Pretoria' },
    case: { id: 'c1', name: 'Base', runId: 'r1', inputsHash: 'a'.repeat(64), engineVersion: '0.1.0', runFinishedAt: '2026-09-28T10:00:00.000Z' },
    kpis: { dcKwp: 500, acKw: 400, batteryKwh: 200, batteryKw: 100, annualAcKwh: 845_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.834, solarFraction: 0.581, exportKwh: 140_000 },
    price: offerPrice(1_000_000, 15),
    bills: { beforeZar: 1_000_000, afterZar: 600_000 },
    financeOptions: [
      { kind: 'cash', view: 'owner', upfrontZar: 1_150_000, year1NetZar: 390_000, lifetimeNetZar: 9_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 3.1, years: 25, terms: 'Paid upfront' },
      { kind: 'ppa', view: 'client', upfrontZar: 0, year1NetZar: 60_000, lifetimeNetZar: 2_500_000, npvZar: 500_000, irr: null, simplePaybackYears: null, years: 20, terms: 'R 1.45/kWh escalating 6.0 %/yr for 20 years' },
    ],
    draft: {
      clientName: 'Acme Retail (Pty) Ltd', marginPct: 15, validityDays: 30, financeOptions: ['cash', 'ppa'],
      summary: 'Insulation ≤ 0,2 Ω ✓', scope: 'Supply → install\nCommission', priceTerms: '40 % deposit', assumptions: 'Roof sound',
      inclusions: ['Monitoring ✓'], exclusions: ['Roof repairs'], terms: 'Standard terms', narrative: 'A narrative paragraph.',
    },
    disclaimer: 'Org disclaimer',
    provenance: { financeInputsHash: 'b'.repeat(64), tariff: null },
    ...over,
  }
}

/** The snapshot exactly as Issue stores it: sanitised with pdfText. */
export function proposalSnapshot(over: Partial<BuildSnapshotInput> = {}): ProposalSnapshot {
  return buildProposalSnapshot(proposalSnapshotInput(over), pdfText)
}
