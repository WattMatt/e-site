// apps/web/src/lib/solar/load/readings.ts
import 'server-only'
/**
 * Bulk reads through 00215's SECURITY INVOKER RPCs: one row per channel with parallel arrays, so a
 * year of readings does not hit PostgREST's 1,000-row cap. meter_readings_select (RLS) decides what
 * comes back; a channel the caller may not read simply returns nothing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Reading } from '@esite/shared/meter-data'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export const READ_BATCH = 10

export interface ChannelSummary {
  channelId: string
  firstTs: number | null
  lastTs: number | null
  nRows: number
  nUsable: number
  maxValue: number | null
  sumValue: number | null
}

export async function readChannelReadings(
  supabase: AnyClient, channelIds: string[], fromMs: number, toMs: number,
  onBatch?: (done: number, total: number) => void,
): Promise<Map<string, Reading[]>> {
  const out = new Map<string, Reading[]>()
  for (let i = 0; i < channelIds.length; i += READ_BATCH) {
    const batch = channelIds.slice(i, i + READ_BATCH)
    const { data, error } = await supabase.schema('solar').rpc('channel_readings', {
      p_channel_ids: batch, p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString(),
    })
    if (error) throw new Error(`channel readings: ${error.message}`)
    for (const row of (data ?? []) as Array<{ channel: string; ts_ends: string[]; vals: Array<number | null>; quals: number[] }>) {
      out.set(row.channel, row.ts_ends.map((t, k) => ({ tsEnd: Date.parse(t), value: row.vals[k], quality: row.quals[k] as Reading['quality'] })))
    }
    onBatch?.(Math.min(i + READ_BATCH, channelIds.length), channelIds.length)
  }
  for (const id of channelIds) if (!out.has(id)) out.set(id, [])
  return out
}

export async function channelSummaries(supabase: AnyClient, channelIds: string[]): Promise<Map<string, ChannelSummary>> {
  const out = new Map<string, ChannelSummary>()
  if (channelIds.length === 0) return out
  const { data, error } = await supabase.schema('solar').rpc('channel_summaries', { p_channel_ids: channelIds })
  if (error) throw new Error(`channel summaries: ${error.message}`)
  for (const r of (data ?? []) as Array<{ channel: string; first_ts: string | null; last_ts: string | null; n_rows: number; n_usable: number; max_value: number | null; sum_value: number | null }>) {
    out.set(r.channel, {
      channelId: r.channel,
      firstTs: r.first_ts ? Date.parse(r.first_ts) : null,
      lastTs: r.last_ts ? Date.parse(r.last_ts) : null,
      nRows: Number(r.n_rows),
      nUsable: Number(r.n_usable),
      maxValue: r.max_value === null ? null : Number(r.max_value),
      sumValue: r.sum_value === null ? null : Number(r.sum_value),
    })
  }
  return out
}
