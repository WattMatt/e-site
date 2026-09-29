import { describe, it, expect } from 'vitest'
import { loadTariffTab } from './load-tariff-tab'
import { fakeSupabase } from '@/test/fake-supabase'

const tables = {
  'solar.studies': [{ id: 's1', project_id: 'p1', organisation_id: 'org1', updated_at: 'T1', licensee_name: 'city of probe', licensee_id: null,
    nmd_kva: '500', supply_voltage_v: 400, tariff_id: null, tariff_override_id: null, export_rule: null, escalation: null }],
  'tariffs.licensee_alias': [{ alias: 'CITY OF PROBE', licensee_id: 'l1' }],
  'tariffs.licensee': [{ id: 'l1', name: 'City of Probe', kind: 'municipal' }],
  'tariffs.tariff_year': [
    { id: 'y25', licensee_id: 'l1', financial_year: '2025/26', state: 'published', effective_from: '2025-07-01', effective_to: '2026-06-30', approved_increase_pct: '12.72' },
    { id: 'y24', licensee_id: 'l1', financial_year: '2024/25', state: 'superseded', effective_from: '2024-07-01', effective_to: '2025-06-30', approved_increase_pct: null },
  ],
  'tariffs.tariff': [
    { id: 't1', tariff_year_id: 'y25', name: 'Commercial', code: null, category: 'commercial', metering: 'conventional', structure: 'flat', voltage_band: null, phase: null, min_kva: null, max_kva: '100', min_amps: null, max_amps: null, is_legacy: false, export_tariff_id: null },
    { id: 't2', tariff_year_id: 'y25', name: 'Bulk LV', code: null, category: 'bulk', metering: 'conventional', structure: 'tou', voltage_band: null, phase: null, min_kva: '100', max_kva: null, min_amps: null, max_amps: null, is_legacy: false, export_tariff_id: null },
  ],
}

describe('loadTariffTab', () => {
  it('resolves the licensee from the Site & Supply name through the alias, defaults the year covering today, lists its tariffs', async () => {
    const { client } = fakeSupabase({ tables })
    const d = await loadTariffTab(client as never, 'p1', { fy: null, todayIso: '2026-01-10' })
    expect(d.licensee).toEqual({ id: 'l1', name: 'City of Probe', kind: 'municipal' })
    expect(d.years.map((y) => y.financialYear)).toEqual(['2025/26', '2024/25'])
    expect(d.selectedYearId).toBe('y25')
    expect(d.yearNote).toBeNull()
    expect(d.tariffs.map((t) => t.id).sort()).toEqual(['t1', 't2'])
    expect(d.supply).toEqual({ nmdKva: 500, supplyVoltageV: 400 })
    expect(d.pinned).toBeNull()
  })
  it('the ?fy= choice wins; an unknown year falls back', async () => {
    const { client } = fakeSupabase({ tables })
    expect((await loadTariffTab(client as never, 'p1', { fy: '2024/25', todayIso: '2026-01-10' })).selectedYearId).toBe('y24')
    expect((await loadTariffTab(client as never, 'p1', { fy: '1999/00', todayIso: '2026-01-10' })).selectedYearId).toBe('y25')
  })
  it('no study: says so', async () => {
    const d = await loadTariffTab(fakeSupabase({}).client as never, 'p1', { fy: null, todayIso: '2026-01-10' })
    expect(d.study).toBeNull()
  })
  it('a pinned tariff selects its year, reports a newer published year, and notes the pinned year when it no longer covers today', async () => {
    const t = {
      ...tables,
      'solar.studies': [{ ...tables['solar.studies'][0], tariff_id: 't0' }],
      'tariffs.tariff': [...tables['tariffs.tariff'], { id: 't0', tariff_year_id: 'y24', name: 'Commercial', code: null, category: 'commercial', metering: 'conventional', structure: 'flat', export_tariff_id: null }],
    }
    const d = await loadTariffTab(fakeSupabase({ tables: t }).client as never, 'p1', { fy: null, todayIso: '2026-01-10' })
    expect(d.selectedYearId).toBe('y24')
    expect(d.pinned).toMatchObject({ id: 't0', financialYear: '2024/25', yearState: 'superseded', newerYear: '2025/26' })
    expect(d.yearNote).toBe('2024/25 does not cover today: 2025/26 is published in the library')
  })
  it('a pinned tariff in the year covering today: no note, no newer year', async () => {
    const t = { ...tables, 'solar.studies': [{ ...tables['solar.studies'][0], tariff_id: 't1' }] }
    const d = await loadTariffTab(fakeSupabase({ tables: t }).client as never, 'p1', { fy: null, todayIso: '2026-01-10' })
    expect(d.selectedYearId).toBe('y25')
    expect(d.pinned).toMatchObject({ id: 't1', newerYear: null })
    expect(d.yearNote).toBeNull()
  })
  it('the library is a year behind: the escalation note shows whether the year came from the default or ?fy=', async () => {
    const { client } = fakeSupabase({ tables })
    expect((await loadTariffTab(client as never, 'p1', { fy: null, todayIso: '2026-08-01' })).yearNote)
      .toBe('2026/27 not yet published in the library — using 2025/26 with escalation')
    expect((await loadTariffTab(client as never, 'p1', { fy: '2025/26', todayIso: '2026-08-01' })).yearNote)
      .toBe('2026/27 not yet published in the library — using 2025/26 with escalation')
  })
})
