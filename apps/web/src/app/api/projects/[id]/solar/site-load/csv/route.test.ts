import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ createClient: vi.fn(), gate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))

import { fakeSupabase } from '@/test/fake-supabase'
import { GET } from './route'

const P = '00000000-0000-0000-0000-000000000001'
const call = (q: string) => GET(new Request(`http://x/csv?${q}`), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, level: 'view', userId: 'u' })
  h.createClient.mockResolvedValue(fakeSupabase({
    tables: {
      'solar.studies': [{ id: 's1', project_id: P }],
      'solar.site_load': [{ id: 'sl', study_id: 's1', reference_year: 2025, series: Array(HOURS_PER_YEAR).fill(2), built_at: 't' }],
    },
  }).client)
})

describe('site-load csv', () => {
  it('annual = 8,760 hourly rows', async () => {
    const text = await (await call('chart=annual')).text()
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(HOURS_PER_YEAR + 1)
  })
  it('monthly energy, average day, day types and LDC', async () => {
    expect((await (await call('chart=monthly')).text()).split('\r\n')[1]).toBe('January,1488.000')
    expect((await (await call('chart=avgday')).text()).split('\r\n')[0]).toContain('hour,January')
    expect((await (await call('chart=daytype')).text()).split('\r\n')[0]).toBe('hour,weekday_kW,saturday_kW,sunday_holiday_kW')
    expect((await (await call('chart=ldc')).text()).split('\r\n')[1]).toBe('0,2.000')
  })
  it('400 on an unknown chart; 404 with no profile', async () => {
    expect((await call('chart=nope')).status).toBe(400)
    h.createClient.mockResolvedValue(fakeSupabase({ tables: { 'solar.studies': [{ id: 's1', project_id: P }] } }).client)
    expect((await call('chart=annual')).status).toBe(404)
  })
})
