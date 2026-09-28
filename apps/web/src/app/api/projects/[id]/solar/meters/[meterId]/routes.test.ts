// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ createClient: vi.fn(), gate: vi.fn(), load: vi.fn(), read: vi.fn(), sums: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/load/meter-access', async (orig) => ({ ...(await orig<object>()), loadStudyMeter: h.load }))
vi.mock('@/lib/solar/load/readings', () => ({ readChannelReadings: h.read, channelSummaries: h.sums }))

import { GET as series } from './series/route'
import { GET as heatmap } from './heatmap/route'
import { GET as csv } from './csv/route'

const P = '00000000-0000-0000-0000-000000000001'
const M = '00000000-0000-0000-0000-000000000002'
const ctx = { params: Promise.resolve({ id: P, meterId: M }) }
const CH = { id: 'c1', meter_id: M, file_id: 'f1', source_column: 'p14', quantity: 'active_power', direction: 'import', unit: 'kW', interval_min: 30, is_primary: true, coverage_only: false, updated_at: 't' }
const T0 = Date.parse('2025-03-10T00:00:00+02:00')
const readings = Array.from({ length: 96 }, (_, i) => ({ tsEnd: T0 + (i + 1) * 1_800_000, value: i === 5 ? null : 3, quality: i === 5 ? 1 : 0 }))

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({})
  h.gate.mockResolvedValue({ ok: true, level: 'view', userId: 'u1' })
  h.load.mockResolvedValue({ studyId: 's1', meter: { id: M, label: 'Shop 12' }, channels: [CH], picked: { primary: [CH], kva: [], pv: null } })
  h.sums.mockResolvedValue(new Map([['c1', { channelId: 'c1', firstTs: readings[0].tsEnd, lastTs: readings[95].tsEnd, nRows: 96, nUsable: 95, maxValue: 3, sumValue: 285 }]]))
  h.read.mockResolvedValue(new Map([['c1', readings]]))
})

describe('meter series', () => {
  it('gates on Solar View and 404s a meter outside the study', async () => {
    h.load.mockResolvedValue(null)
    const res = await series(new Request('http://x/series'), ctx)
    expect(h.gate).toHaveBeenCalledWith({}, P, 'view')
    expect(res.status).toBe(404)
  })
  it('refuses without Solar View', async () => {
    h.gate.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) })
    expect((await series(new Request('http://x/series'), ctx)).status).toBe(403)
  })
  it('returns full-resolution points for a small window, with the missing value as a gap', async () => {
    const body = await (await series(new Request('http://x/series'), ctx)).json()
    expect(body.fullResolution).toBe(true)
    expect(body.buckets).toHaveLength(96)
    expect(body.gaps).toEqual([{ from: readings[5].tsEnd - 1_800_000, to: readings[5].tsEnd }])
    expect(body.channel).toMatchObject({ id: 'c1', unit: 'kW' })
  })
  it('refuses a channel of another meter', async () => {
    expect((await series(new Request('http://x/series?channel=zz'), ctx)).status).toBe(404)
  })
})

describe('meter heatmap', () => {
  it('returns day × hour cells', async () => {
    const body = await (await heatmap(new Request('http://x/heatmap'), ctx)).json()
    expect(body.dates).toEqual(['2025-03-10', '2025-03-11'])
    expect(body.cells[0]).toHaveLength(24)
  })
  it('422 for a daily channel', async () => {
    const daily = { ...CH, interval_min: 1440 }
    h.load.mockResolvedValue({ studyId: 's1', meter: { id: M, label: 'x' }, channels: [daily], picked: { primary: [daily], kva: [], pv: null } })
    expect((await heatmap(new Request('http://x/heatmap'), ctx)).status).toBe(422)
  })
})

describe('meter csv', () => {
  it('downloads ts_end (SAST), value, unit, quality with a safe file name', async () => {
    const res = await csv(new Request('http://x/csv'), ctx)
    expect(res.headers.get('content-disposition')).toContain('Shop 12-normalised.csv')
    const text = await res.text()
    expect(text.split('\r\n')[0]).toBe('ts_end (SAST),value,unit,quality')
    expect(text.split('\r\n')[1]).toBe('2025-03-10 00:30,3,kW,0')
    expect(text.split('\r\n')[6]).toBe('2025-03-10 03:00,,kW,1')
  })
})
