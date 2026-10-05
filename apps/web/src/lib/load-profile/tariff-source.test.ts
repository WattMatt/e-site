import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const L = '00000000-0000-0000-0000-00000000000a'
const Y25 = '00000000-0000-0000-0000-000000000025'
const Y26 = '00000000-0000-0000-0000-000000000026'
const DRAFT = '00000000-0000-0000-0000-0000000000dd'
const OLD = '00000000-0000-0000-0000-0000000000a1'
const NEW = '00000000-0000-0000-0000-0000000000b1'
const UNPUB = '00000000-0000-0000-0000-0000000000c1'

const tariffRow = (id: string, year: string, extra: Record<string, unknown> = {}) => ({
  id, tariff_year_id: year, name: 'Business Flat', code: 'BF1', family: null, category: 'commercial', metering: 'conventional', structure: 'flat',
  voltage_band: null, phase: null, transmission_zone: null, local_authority: false, min_amps: null, max_amps: null, min_kva: null, max_kva: null,
  eligibility: null, export_tariff_id: null, is_legacy: false, ...extra,
})
let tables: Record<string, Array<Record<string, unknown>>>
vi.mock('@/lib/solar/tariff/calendar-loader', () => ({ loadStudyCalendar: async () => ({ calendar: null, assumedEskom: false, fromEskomFallback: false }) }))

const { listPublishedLicensees, listPublishedTariffs, loadCostingTariff } = await import('./tariff-source')
const db = () => fakeSupabase({ tables }).client as never

beforeEach(() => {
  tables = {
    'tariffs.licensee': [{ id: L, name: 'Test City', kind: 'municipality', province: 'GP' }],
    'tariffs.licensee_alias': [{ alias: 'TCity', licensee_id: L }],
    'tariffs.tariff_year': [
      { id: Y25, licensee_id: L, financial_year: '2025/26', effective_from: '2025-07-01', state: 'superseded' },
      { id: Y26, licensee_id: L, financial_year: '2026/27', effective_from: '2026-07-01', state: 'published' },
      { id: DRAFT, licensee_id: L, financial_year: '2027/28', effective_from: '2027-07-01', state: 'in_review' },
    ],
    'tariffs.tariff': [tariffRow(OLD, Y25), tariffRow(NEW, Y26), tariffRow(UNPUB, DRAFT, { code: 'DRAFT' })],
    'tariffs.charge': [],
  }
})

describe('tariff-source (caller session, published years only)', () => {
  it('lists only published years’ tariffs', async () => {
    expect((await listPublishedTariffs(db(), L)).map((t) => t.id)).toEqual([NEW])
    expect(await listPublishedLicensees(db())).toEqual([{ id: L, name: 'Test City', kind: 'municipality', province: 'GP', aliases: ['TCity'] }])
  })
  it('never loads a tariff from a draft year', async () => {
    expect(await loadCostingTariff(db(), UNPUB)).toBeNull()
  })
  it('follows a superseded tariff into the current published year by code, and says so', async () => {
    const t = await loadCostingTariff(db(), OLD)
    expect(t?.tariffId).toBe(NEW)
    expect(t?.financialYear).toBe('2026/27')
    expect(t?.label).toBe('Test City · 2026/27 · Business Flat (chosen in 2025/26; now 2026/27)')
  })
  it('a superseded tariff with no single successor is not costed', async () => {
    tables['tariffs.tariff'] = [tariffRow(OLD, Y25), tariffRow(NEW, Y26, { code: 'OTHER' })]
    expect(await loadCostingTariff(db(), OLD)).toBeNull()
  })
})
