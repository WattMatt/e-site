'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { diaryService, createDiarySchema, ORG_WRITE_ROLES, type CreateDiaryInput } from '@esite/shared'
import { notifyDiaryEntryCreated } from '@/lib/diary-email'

const uuidSchema = z.string().uuid()

/**
 * Create a site diary entry.
 *
 * Mirrors createRfiAction: validates with Zod, then writes via the cookie/RLS
 * client so migration 00143's INSERT policy is the write-role gate. `created_by`
 * is forced to the authenticated user and `organisation_id` is resolved from the
 * caller's active membership — never trusted from the client payload. Attachments
 * stay client-side (browser File objects + storage upload); this returns the new
 * entry's id so the caller commits them against it idempotently. Roster
 * notification is deliberately NOT fired here — the caller invokes
 * notifyDiaryEntryAction AFTER the attachments are committed, so the email can
 * reflect the complete entry (text + images).
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
 * Notify the whole project roster (bell + email) about a diary entry.
 *
 * Called by the client AFTER the entry AND its attachments are committed, so the
 * notification reflects the complete entry. The entry is loaded with the
 * cookie/RLS client first — that read only returns rows in the caller's org, so
 * it doubles as the tenancy gate and binds the notification to the entry's OWN
 * project_id and author (never a client-supplied id). Best-effort: never throws,
 * so a notification failure can't surface from or block the save.
 */
export async function notifyDiaryEntryAction(entryId: string): Promise<void> {
  const parse = uuidSchema.safeParse(entryId)
  if (!parse.success) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // The `projects` schema is not carried by the typed cookie client — cast as in
  // diary-email.ts. RLS still scopes this read to the caller's org, so it doubles
  // as the tenancy gate; the notifier re-loads the full entry with the service
  // client to build the email.
  const { data: entry } = await (supabase as any)
    .schema('projects')
    .from('site_diary_entries')
    .select('id, project_id, created_by')
    .eq('id', entryId)
    .maybeSingle()
  if (!entry) return

  await notifyDiaryEntryCreated({
    entryId: entry.id as string,
    projectId: entry.project_id as string,
    authorId: (entry.created_by as string | null) ?? user.id,
  })
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
