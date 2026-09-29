import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadMeterMonths, loadMonthSeries, monthsWithData } from './series'

describe('RPC wrappers', () => {
  it('parses the per-meter monthly totals (numbers may arrive as strings)', async () => {
    const f = fakeSupabase({ rpc: { solar_ops_monthly_kwh: (args) => ({ data: args.p_role === 'generation'
      ? { m1: { '2026-03': { kwh: '900.5', n: 1488, intervalMin: 30 }, bogus: { kwh: 1, n: 1, intervalMin: 30 } } } : {}, error: null }) } })
    await expect(loadMeterMonths(f.client as never, 'i1', 'generation')).resolves.toEqual({ m1: { '2026-03': { kwh: 900.5, n: 1488, intervalMin: 30 } } })
    await expect(loadMeterMonths(f.client as never, 'i1', 'consumption')).resolves.toEqual({})
    expect(f.client.rpc).toHaveBeenCalledWith('solar_ops_monthly_kwh', { p_installation_id: 'i1', p_role: 'generation' })
  })
  it('parses the month series and passes the month as its first day', async () => {
    const f = fakeSupabase({ rpc: { solar_ops_series: { data: { points: [[1773136800000, '7.5', 30]] }, error: null } } })
    await expect(loadMonthSeries(f.client as never, 'i1', 'generation', '2026-03')).resolves.toEqual([{ endMs: 1773136800000, kw: 7.5, intervalMin: 30 }])
    expect(f.client.rpc).toHaveBeenCalledWith('solar_ops_series', { p_installation_id: 'i1', p_role: 'generation', p_month: '2026-03-01' })
  })
  it('throws on an RPC error instead of reporting zero generation (WM M12)', async () => {
    const f = fakeSupabase({ rpc: { solar_ops_monthly_kwh: { data: null, error: { message: 'boom' } } } })
    await expect(loadMeterMonths(f.client as never, 'i1', 'generation')).rejects.toThrow('could not be read')
  })
  it('months with data, sorted, across meters', () => {
    expect(monthsWithData({ a: { '2026-04': { kwh: 1, n: 1, intervalMin: 30 } }, b: { '2026-02': { kwh: 1, n: 1, intervalMin: 30 }, '2026-04': { kwh: 1, n: 1, intervalMin: 30 } } }))
      .toEqual(['2026-02', '2026-04'])
  })
})
