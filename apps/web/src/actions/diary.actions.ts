'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { diaryService, createDiarySchema, ORG_WRITE_ROLES, type CreateDiaryInput } from '@esite/shared'

const uuidSchema = z.string().uuid()

/**
 * Create a site diary entry.
 *
 * Mirrors createRfiAction: validates with Zod, then writes via the cookie/RLS
 * client so migration 00143's INSERT policy is the write-role gate. `created_by`
 * is forced to the authenticated user and `organisation_id` is resolved from the
 * caller's active membership — never trusted from the client payload. Attachments
 * stay client-side (browser File objects + storage upload); this returns the new
 * entry's id so the caller commits them against it idempotently.
 */
export async function createDiaryEntryAction(
  input: CreateDiaryInput,
): Promise<{ entryId?: string; error?: string }> {
  const parsed = createDiarySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: mem, error: memErr } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (memErr || !mem) return { error: 'No active organisation membership' }

  let entry: { id: string }
  try {
    entry = (await diaryService.create(
      supabase as never,
      mem.organisation_id,
      user.id,
      parsed.data,
    )) as { id: string }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath(`/projects/${parsed.data.projectId}/diary`)
  revalidatePath('/diary')
  revalidatePath('/diary/weekly')
  return { entryId: entry.id }
}

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
