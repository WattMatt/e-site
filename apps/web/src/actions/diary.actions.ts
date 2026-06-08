'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { diaryService, ORG_WRITE_ROLES } from '@esite/shared'

const uuidSchema = z.string().uuid()

/**
 * Permanently delete a site diary entry.
 *
 * Gate: the entry's AUTHOR, or owner/admin/PM on the entry's project.
 * The entry is loaded with the cookie/RLS client first — that read only
 * returns rows in the caller's org, so it doubles as the tenancy guard and
 * binds the gate to the entry's OWN project_id (never a client-supplied id).
 * The delete + storage cleanup run with the service client (RLS-bypassing),
 * so the in-app gate is mandatory — matching snag-visit.actions.ts.
 */
export async function deleteDiaryEntryAction(
  entryId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(entryId)
  if (!parse.success) return { error: 'Invalid entry id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const entry = await diaryService.getEntryForGate(supabase as never, entryId)
  if (!entry) return { error: 'Entry not found' }

  const isAuthor = entry.created_by === user.id
  if (!isAuthor) {
    const gate = await requireEffectiveRole(supabase, entry.project_id, ORG_WRITE_ROLES)
    if (!gate.ok) return { error: 'You do not have permission to delete this entry.' }
  }

  const serviceClient = createServiceClient()
  try {
    await diaryService.hardDelete(serviceClient as never, entryId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath(`/projects/${entry.project_id}/diary`)
  revalidatePath('/diary')
  revalidatePath('/diary/weekly')
  return {}
}
