import 'server-only'
/**
 * Last 10 Solar audit events for a project, newest first. The events are read
 * through the CALLER's session (audit_events_select = solar_can_view), so a
 * caller without a level gets nothing. Actor names are resolved with the
 * service client afterwards (profiles are own-row-only under RLS).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { describeSolarAuditEvent } from '@esite/shared'
import type { SolarActivityItem } from './activity-types'

export type { SolarActivityItem }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

interface AuditRow { id: number; verb: string; object_ref: Record<string, unknown> | null; actor_id: string | null; created_at: string }

export async function loadSolarActivity(projectId: string, supabase: AnyClient): Promise<SolarActivityItem[]> {
  const { data, error } = await supabase
    .schema('solar').from('audit_events')
    .select('id, verb, object_ref, actor_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(10)
  const rows = (error ? [] : (data ?? [])) as AuditRow[]
  if (rows.length === 0) return []

  const ids = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => Boolean(v)))]
  const names = new Map<string, string>()
  if (ids.length) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: profiles } = await svc.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name?.trim()) names.set(p.id, p.full_name.trim())
    }
  }

  return rows.map((r) => ({
    id: r.id,
    at: r.created_at,
    actorName: (r.actor_id && names.get(r.actor_id)) || 'Someone',
    ...describeSolarAuditEvent(r.verb, r.object_ref ?? {}),
  }))
}
