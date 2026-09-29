/**
 * Wrappers for 00217's two aggregation functions. They return ONE jsonb document, so no PostgREST
 * row cap can truncate a month (WM M3/G12), and they run as the caller (RLS decides).
 *
 * loadMonthSeries returns one point per SPAN (end, interval): meters on different intervals are
 * separate points, possibly with the same end time. Consumers either weigh points by overlap
 * (lostSteps) or fold them onto one grid first (plantSeries, before downtime detection); nothing
 * may key the series by end time alone.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMonthKey, monthFirstDay, type MeterMonths, type MonthKey, type SeriesPoint } from '@esite/shared/solar-operations'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type MeterRole = 'generation' | 'consumption'

export async function loadMeterMonths(client: AnyClient, installationId: string, role: MeterRole): Promise<MeterMonths> {
  const { data, error } = await client.rpc('solar_ops_monthly_kwh', { p_installation_id: installationId, p_role: role })
  if (error) throw new Error(`meter totals could not be read: ${error.message}`)
  const out: MeterMonths = {}
  for (const [meterId, months] of Object.entries((data ?? {}) as Record<string, Record<string, Record<string, unknown>>>)) {
    const m: MeterMonths[string] = {}
    for (const [k, v] of Object.entries(months ?? {})) {
      if (isMonthKey(k)) m[k] = { kwh: Number(v.kwh), n: Number(v.n), minutes: Number(v.minutes), intervalMin: Number(v.intervalMin) }
    }
    out[meterId] = m
  }
  return out
}

export async function loadMonthSeries(client: AnyClient, installationId: string, role: MeterRole, month: MonthKey): Promise<SeriesPoint[]> {
  const { data, error } = await client.rpc('solar_ops_series', { p_installation_id: installationId, p_role: role, p_month: monthFirstDay(month) })
  if (error) throw new Error(`the month's readings could not be read: ${error.message}`)
  const points = ((data as { points?: unknown[] } | null)?.points ?? []) as Array<[unknown, unknown, unknown]>
  return points.map(([t, kw, iv]) => ({ endMs: Number(t), kw: Number(kw), intervalMin: Number(iv) }))
}

export function monthsWithData(m: MeterMonths): MonthKey[] {
  const set = new Set<MonthKey>()
  for (const months of Object.values(m)) for (const [k, v] of Object.entries(months)) if (v.n > 0) set.add(k)
  return [...set].sort()
}
