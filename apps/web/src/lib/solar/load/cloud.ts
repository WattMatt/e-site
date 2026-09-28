// apps/web/src/lib/solar/load/cloud.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export const METER_FILE_RE = /\.(csv|txt|xlsx|xls)$/i
export interface ProjectMapping {
  organisation_id: string
  cloud_storage_connection_id: string | null
  cloud_storage_folder_id: string | null
  cloud_storage_folder_path?: string | null
}

/** The project's cloud mapping, read through the caller's session (RLS on projects.projects). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function projectMapping(supabase: SupabaseClient<any, any, any>, projectId: string): Promise<ProjectMapping | null> {
  const { data } = await supabase.schema('projects').from('projects')
    .select('organisation_id, cloud_storage_connection_id, cloud_storage_folder_id, cloud_storage_folder_path').eq('id', projectId).maybeSingle()
  return (data as ProjectMapping | null) ?? null
}
