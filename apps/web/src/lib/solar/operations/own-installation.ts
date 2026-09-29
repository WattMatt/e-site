/**
 * An INSERT addressed by installation id is checked against the GATED project first (review round
 * 2): the bind triggers take project/org from the installation, so without this read an Edit user
 * of project A could file a row under project B's installation id whenever RLS also admits B.
 * The read runs through the caller's session, so RLS still decides what exists.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { opsError } from './errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export const NOT_THIS_PROJECT = 'That installation is not in this project — reload.'

/** null when the installation belongs to the project; otherwise the sentence to return. */
export async function installationNotInProject(supabase: AnyClient, projectId: string, installationId: string): Promise<{ error: string } | null> {
  const { data, error } = await supabase.schema('solar').from('installations').select('id')
    .eq('id', installationId).eq('project_id', projectId).maybeSingle()
  if (error) return { error: opsError(error) }
  return data ? null : { error: NOT_THIS_PROJECT }
}
