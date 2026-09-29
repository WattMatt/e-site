import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff, type Tariff } from '../types'
import { normaliseAlias, runIngest, type IngestPlan, type LicenseeYearDraft } from './ingest-core'
import { createMemoryTariffStore } from './memory-store'

const SHA = 'a'.repeat(64)
const cp = (block1: number): Tariff => makeTariff({ name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: block1, blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly', extractionMethod: 'parser' }),
] })
const draft = (over: Partial<LicenseeYearDraft> = {}): LicenseeYearDraft => ({
  licenseeName: 'City Power', aliases: ['CITY POWER', 'City Power'], kind: 'municipal',
  effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30', approvedIncreasePct: 9.01,
  tariffs: [cp(247.76)], lossFactors: [], ssegRule: null, issues: [], unresolved: [], ...over,
})
const plan = (years: LicenseeYearDraft[], sha = SHA): IngestPlan => ({
  parser: 'rfd_pdf',
  source: {
    fileName: 'city-power.pdf', bytes: new Uint8Array([37, 80, 68, 70]), sha256: sha, contentType: 'application/pdf',
    kind: 'nersa_decision', title: 'City Power RfD 2026/27', financialYear: '2026/27', status: 'nersa_approved',
    url: null, retrievedAt: null, pageCount: 41,
  },
  years,
})

describe('normaliseAlias', () => {
  it('matches the database CHECK (upper, trimmed, single spaces)', () => {
    expect(normaliseAlias('CITY OF CAPE ')).toBe('CITY OF CAPE')
    expect(normaliseAlias(' Modale  City')).toBe('MODALE CITY')
  })
})

describe('runIngest', () => {
  it('dry run (default) writes nothing and skips an unknown licensee', async () => {
    const store = createMemoryTariffStore()
    const r = await runIngest(plan([draft()]), store, { apply: false, createMissingLicensees: false })
    expect(r.status).toBe('dry_run')
    expect(r.years[0].action).toBe('skip_unknown_licensee')
    expect(store.state.writes).toEqual([])
  })

  it('applies: uploads by sha, records the run, writes the year in review', async () => {
    const store = createMemoryTariffStore()
    const r = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    expect(r.status).toBe('applied')
    expect(r.storagePath).toBe(`2026-27/${SHA}.pdf`)
    expect([...store.state.uploads.keys()]).toEqual([`2026-27/${SHA}.pdf`])
    const year = [...store.state.years.values()][0]
    expect(year).toMatchObject({ financialYear: '2026/27', state: 'in_review' })
    expect([...store.state.aliases.keys()].sort()).toEqual(['CITY POWER'])
    expect([...store.state.runs.values()][0]).toMatchObject({ status: 'succeeded' })
    expect(r.years[0]).toMatchObject({ action: 'create', tariffs: 1, charges: 1 })
    // The validators' verdict is recorded after the last content write, before review (publish needs it = 0).
    expect(year).toMatchObject({ validationBlocking: 0 })
    const w = store.state.writes
    expect(w.indexOf(w.find((x) => x.startsWith('validation:'))!)).toBeLessThan(w.indexOf(w.find((x) => x.endsWith(':in_review'))!))
  })

  it('records the blocking count the validators found', async () => {
    const store = createMemoryTariffStore()
    const gap = makeTariff({ name: 'Gappy', structure: 'ibt', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, blockMinKwh: 0, blockMaxKwh: 50, blockBasis: 'monthly' }),
    ] })
    const r = await runIngest(plan([draft({ tariffs: [gap] })]), store, { apply: true, createMissingLicensees: true })
    expect(r.years[0].blocking).toBe(1)
    expect([...store.state.years.values()][0]).toMatchObject({ validationBlocking: 1, state: 'in_review' })
  })

  it('is idempotent on sha256', async () => {
    const store = createMemoryTariffStore()
    await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    const before = store.state.writes.length
    const again = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    expect(again.status).toBe('already_ingested')
    expect(store.state.writes.length).toBe(before)
  })

  it('replaces an in-review draft and never touches a published year', async () => {
    const store = createMemoryTariffStore({
      licensees: [{ name: 'City Power', kind: 'municipal', aliases: ['CITY POWER'] }],
      years: [
        { licensee: 'City Power', financialYear: '2026/27', state: 'in_review', tariffs: [cp(1)] },
        { licensee: 'City Power', financialYear: '2025/26', state: 'published', tariffs: [cp(227.28)] },
      ],
    })
    const r = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: false })
    expect(r.years[0].action).toBe('replace_draft')
    const draftYear = [...store.state.years.values()].find((y) => y.financialYear === '2026/27')!
    expect(store.state.tariffsByYear.get(draftYear.id)?.[0].charges[0].amountExclVat).toBe(247.76)
    expect(draftYear.state).toBe('in_review')
    // YoY against the published 2025/26: 227.28 -> 247.76 is 9.011%, inside the band.
    expect(r.years[0].yoy).toMatchObject({ changed: 1, outOfBand: 0 })

    const store2 = createMemoryTariffStore({
      licensees: [{ name: 'City Power', kind: 'municipal', aliases: ['CITY POWER'] }],
      years: [{ licensee: 'City Power', financialYear: '2026/27', state: 'published', tariffs: [cp(1)] }],
    })
    const r2 = await runIngest(plan([draft()], 'b'.repeat(64)), store2, { apply: true, createMissingLicensees: false })
    expect(r2.years[0].action).toBe('skip_published')
    expect(store2.state.writes.filter((w) => w.startsWith('year:') || w.startsWith('tariffs:'))).toEqual([])
  })

  it('marks the run failed on error and lets a retry reuse the document', async () => {
    const store = createMemoryTariffStore(undefined, { failOnce: 'insertTariffs' })
    await expect(runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })).rejects.toThrow(/insertTariffs/)
    expect([...store.state.runs.values()][0]).toMatchObject({ status: 'failed' })
    const retry = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: true })
    expect(retry.status).toBe('applied')
    expect(store.state.uploads.size).toBe(1)
    expect(store.state.docs.size).toBe(1)
  })

  it('records a run that skipped an unknown licensee as partial, so the same file can be re-ingested after seeding', async () => {
    const store = createMemoryTariffStore()
    const first = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: false })
    expect(first.years[0].action).toBe('skip_unknown_licensee')
    expect([...store.state.runs.values()][0]).toMatchObject({ status: 'partial' })
    await store.createLicensee({ name: 'City Power', kind: 'metro', aliases: ['CITY POWER'] })
    const again = await runIngest(plan([draft()]), store, { apply: true, createMissingLicensees: false })
    expect(again.status).toBe('applied')
    expect(again.years[0].action).toBe('create')
    expect(store.state.docs.size).toBe(1)
  })

  it('refuses two drafts for the same licensee in one file instead of failing half-way', async () => {
    const store = createMemoryTariffStore({ licensees: [{ name: 'City Power', kind: 'metro', aliases: ['CITY POWER', 'CITY OF JOHANNESBURG'] }] })
    const r = await runIngest(plan([draft(), draft({ licenseeName: 'Joburg', aliases: ['CITY OF JOHANNESBURG'] })]), store, { apply: true, createMissingLicensees: false })
    expect(r.years.map((y) => y.action)).toEqual(['create', 'skip_duplicate_licensee'])
    expect(r.years[1].issues.map((i) => i.code)).toContain('duplicate_licensee_year')
    expect(store.state.years.size).toBe(1)
    expect([...store.state.runs.values()][0]).toMatchObject({ status: 'partial' })
    // Two NEW licensees with the same name are duplicates too.
    const s2 = createMemoryTariffStore()
    const r2 = await runIngest(plan([draft(), draft({ aliases: ['CITY POWER JHB'] })], 'b'.repeat(64)), s2, { apply: false, createMissingLicensees: true })
    expect(r2.years.map((y) => y.action)).toEqual(['create', 'skip_duplicate_licensee'])
  })

  it('links an import tariff to its export tariff by code', async () => {
    const store = createMemoryTariffStore()
    const hf = makeTariff({ name: 'Homeflex 1 (HF101N)', code: 'HF101N', structure: 'tou', exportTariffCode: 'GOHF101N', charges: cp(706.97).charges })
    const go = makeTariff({ name: 'Gen-Offset Homeflex (GOHF101N)', code: 'GOHF101N', structure: 'tou', category: 'sseg', charges: cp(185.41).charges })
    await runIngest(plan([draft({ licenseeName: 'Eskom', aliases: ['ESKOM'], kind: 'eskom', tariffs: [hf, go] })]), store, { apply: true, createMissingLicensees: true })
    expect(store.state.links).toHaveLength(1)
  })
})
