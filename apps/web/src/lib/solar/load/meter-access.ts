// apps/web/src/lib/solar/load/meter-access.ts
import 'server-only'
/**
 * A meter is reachable from a project's Load tab only when it is LINKED to that project's study
 * (solar.study_meters). RLS decides whether the caller can read the rows at all; this decides
 * whether the meter belongs on THIS page (a library meter of another study is a 404 here).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { CHANNEL_COLUMNS, METER_COLUMNS, pickChannels, type ChannelRow, type MeterChannels, type MeterRow } from './gather'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface StudyMeter { studyId: string; meter: MeterRow; channels: ChannelRow[]; picked: MeterChannels }

export async function loadStudyMeter(supabase: AnyClient, projectId: string, meterId: string): Promise<StudyMeter | null> {
  const solar = () => supabase.schema('solar')
  const { data: study } = await solar().from('studies').select('id').eq('project_id', projectId).maybeSingle()
  const studyId = (study as { id?: string } | null)?.id
  if (!studyId) return null
  const { data: link } = await solar().from('study_meters').select('meter_id').eq('study_id', studyId).eq('meter_id', meterId).maybeSingle()
  if (!link) return null
  const { data: meter } = await solar().from('meters').select(METER_COLUMNS).eq('id', meterId).maybeSingle()
  if (!meter) return null
  const { data: channels } = await solar().from('meter_channels').select(CHANNEL_COLUMNS).eq('meter_id', meterId)
  const rows = (channels ?? []) as ChannelRow[]
  return { studyId, meter: meter as MeterRow, channels: rows, picked: pickChannels(meter as MeterRow, rows) }
}

/** Local SAST time label for a CSV row (the spec's `ts_end (SAST)`). */
export function sastLabel(tsEnd: number): string {
  return new Date(tsEnd + 7_200_000).toISOString().slice(0, 16).replace('T', ' ')
}

/** RFC 4180 CSV (quotes only when needed). */
export function toCsvText(rows: Array<Array<string | number | null>>): string {
  return rows.map((r) => r.map((c) => {
    const s = c === null ? '' : String(c)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\r\n') + '\r\n'
}

export function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9._ -]+/g, '_').trim().slice(0, 80) || 'meter'
}
