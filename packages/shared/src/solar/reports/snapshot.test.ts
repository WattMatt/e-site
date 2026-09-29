import { describe, it, expect } from 'vitest'
import { buildProposalSnapshot, financeOptionTable, keyFigures, toClientSnapshot, type BuildSnapshotInput } from './snapshot'
import { offerPrice } from './offer'

export const snapshotInput = (): BuildSnapshotInput => ({
  proposal: { id: 'p1', familyId: 'p1', version: 2, title: 'Rooftop PV for Acme', issuedAt: '2026-09-29T08:00:00.000Z', validUntil: '2026-10-29T08:00:00.000Z' },
  issuer: { orgName: 'Sun Co', proposerName: 'Pat Proposer', proposerEmail: 'pat@sun.example' },
  project: { name: 'Acme Mall', address: '1 Main Rd, Pretoria' },
  case: { id: 'c1', name: 'Base', runId: 'r1', inputsHash: 'a'.repeat(64), engineVersion: '0.1.0', runFinishedAt: '2026-09-28T10:00:00.000Z' },
  kpis: { dcKwp: 500, acKw: 400, batteryKwh: null, batteryKw: null, annualAcKwh: 845_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.834, solarFraction: 0.581, exportKwh: 140_000 },
  price: offerPrice(1_000_000, 15),
  bills: { beforeZar: 1_000_000, afterZar: 600_000 },
  financeOptions: [
    { kind: 'cash', view: 'owner', upfrontZar: 1_150_000, year1NetZar: 390_000, lifetimeNetZar: 9_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 3.1, years: 25, terms: 'Paid upfront' },
    { kind: 'ppa', view: 'client', upfrontZar: 0, year1NetZar: 60_000, lifetimeNetZar: 2_500_000, npvZar: 500_000, irr: null, simplePaybackYears: null, years: 20, terms: 'R 1.45/kWh escalating 6.0 %/yr for 20 years' },
  ],
  draft: {
    clientName: 'Acme Retail (Pty) Ltd', marginPct: 15, validityDays: 30, financeOptions: ['cash', 'ppa'],
    summary: 'Resistance ≤ 0,2 Ω ✓', scope: 'Supply → install', priceTerms: 'Deposit 40 %', assumptions: 'None',
    inclusions: ['Monitoring'], exclusions: ['Roof repairs'], terms: 'Terms', narrative: 'Narrative',
  },
  disclaimer: 'Org disclaimer',
  provenance: { financeInputsHash: 'b'.repeat(64), tariff: { tariffId: 't1', tariffName: 'Business 1', financialYear: '2026/27', licenseeName: 'City of Tshwane' } },
})

describe('buildProposalSnapshot', () => {
  it('freezes the client price but NEVER the capex or the margin', () => {
    const s = buildProposalSnapshot(snapshotInput())
    expect(s.price).toEqual({ offerExclVatZar: 1_150_000, vatZar: 172_500, offerInclVatZar: 1_322_500 })
    const json = JSON.stringify(s)
    expect(json).not.toContain('marginPct')
    expect(json).not.toContain('capexExclVatZar')
    expect(json).not.toContain('marginZar')
  })
  it('passes every string through the sanitiser (so PDF and page print identical text)', () => {
    const s = buildProposalSnapshot(snapshotInput(), (t) => t.replace(/[^\x20-\x7e]/g, '?'))
    expect(s.text.summary).toBe('Resistance ? 0,2 ? ?')
    expect(s.client.name).toBe('Acme Retail (Pty) Ltd')
  })
  it('is JSON-stable (what is stored is what is served)', () => {
    const s = buildProposalSnapshot(snapshotInput())
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('keyFigures / financeOptionTable (one source for PDF and page)', () => {
  it('lists the client-facing figures with units', () => {
    expect(keyFigures(buildProposalSnapshot(snapshotInput()))).toEqual([
      { label: 'System size', value: '500.0 kWp DC / 400.0 kW AC' },
      { label: 'Year-1 solar generation', value: '845.0 MWh' },
      { label: 'Specific yield', value: '1 690 kWh/kWp' },
      { label: 'Share of your consumption from solar', value: '58.1 %' },
      { label: 'Offer price (excl. VAT)', value: 'R 1 150 000.00' },
      { label: 'VAT (15 %)', value: 'R 172 500.00' },
      { label: 'Offer price (incl. VAT)', value: 'R 1 322 500.00' },
      { label: 'Estimated year-1 electricity saving (excl. VAT)', value: 'R 400 000' },
      { label: 'Valid until', value: '2026-10-29' },
    ])
  })
  it('adds the battery line only when there is one', () => {
    const i = snapshotInput()
    i.kpis = { ...i.kpis, batteryKwh: 200, batteryKw: 100 }
    expect(keyFigures(buildProposalSnapshot(i))).toContainEqual({ label: 'Battery', value: '200.0 kWh / 100.0 kW' })
  })
  it('tabulates the offered options side by side', () => {
    const t = financeOptionTable(buildProposalSnapshot(snapshotInput()))
    expect(t.columns).toEqual(['', 'Cash purchase', 'Power purchase agreement (PPA)'])
    expect(t.rows).toEqual([
      ['Terms', 'Paid upfront', 'R 1.45/kWh escalating 6.0 %/yr for 20 years'],
      ['Upfront payment', 'R 1 150 000', 'R 0'],
      ['Year-1 net benefit', 'R 390 000', 'R 60 000'],
      ['Net benefit over the term', 'R 9 000 000 (25 years)', 'R 2 500 000 (20 years)'],
      ['Simple payback', '3.1 years', 'n/a'],
      ['IRR', '21.0 %', 'n/a'],
    ])
  })
})

describe('toClientSnapshot (what reaches an anonymous browser)', () => {
  const withBattery = () => { const i = snapshotInput(); i.kpis = { ...i.kpis, batteryKwh: 200, batteryKw: 100 }; return buildProposalSnapshot(i) }
  it('produces the IDENTICAL key figures and finance table as the full snapshot (the PDF)', () => {
    for (const full of [buildProposalSnapshot(snapshotInput()), withBattery()]) {
      const c = toClientSnapshot(full)
      expect(keyFigures(c)).toEqual(keyFigures(full))
      expect(financeOptionTable(c)).toEqual(financeOptionTable(full))
    }
  })
  it('carries no internal id, run, hash, provenance or finance internals', () => {
    const full = buildProposalSnapshot(snapshotInput())
    const c = toClientSnapshot(full) as unknown as Record<string, unknown>
    expect(Object.keys(c).sort()).toEqual(['bills', 'client', 'financeOptions', 'issuer', 'price', 'project', 'proposal', 'system', 'text'])
    expect(Object.keys(c.proposal as object).sort()).toEqual(['issuedAt', 'title', 'validUntil', 'version'])
    const json = JSON.stringify(c)
    for (const needle of ['"case"', 'provenance', 'familyId', 'runId', 'inputsHash', 'engineVersion', 'financeInputsHash', 'tariffId', 'npvZar', '"view"', 'a'.repeat(64), 'b'.repeat(64), '"p1"', '"c1"', '"r1"']) {
      expect(json).not.toContain(needle)
    }
  })
})
