'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRoleForRevision, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'

interface ShortCodeUpdate {
  boardId: string
  shortCode: string | null  // null = clear / unset
}

/**
 * Bulk-upsert board short_codes for a given revision.
 *
 * - DRAFT-only: refuses to update boards on ISSUED/SUPERSEDED revisions
 *   (consistent with the rest of the cable-schedule write-path policy)
 * - Validates each shortCode: trimmed, 1-12 chars, or NULL
 * - Single transaction: all or nothing
 * - Caller responsible for the cable_tag regeneration step (T6) since
 *   not every short_code edit warrants a tag-text rewrite
 */
export async function updateBoardShortCodesAction(
  projectId: string,
  revisionId: string,
  updates: ShortCodeUpdate[],
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // C12: role gate — only engineers can edit board short codes.
  const roleCheck = await requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  // Status gate
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('status')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!rev) return { ok: false, error: 'Revision not found' }
  if (rev.status !== 'DRAFT') {
    return { ok: false, error: 'Short codes can only be edited on DRAFT revisions' }
  }

  // Validate + normalise input
  const normalised: ShortCodeUpdate[] = []
  for (const u of updates) {
    if (!u.boardId) return { ok: false, error: 'Each update needs a boardId' }
    const trimmed = u.shortCode?.trim() ?? ''
    if (trimmed === '') {
      normalised.push({ boardId: u.boardId, shortCode: null })
      continue
    }
    if (trimmed.length > 12) {
      return { ok: false, error: `Short code "${trimmed}" exceeds 12 characters` }
    }
    if (!/^[A-Z0-9.\-]+$/i.test(trimmed)) {
      return { ok: false, error: `Short code "${trimmed}" contains invalid characters (only A-Z, 0-9, ., - allowed)` }
    }
    normalised.push({ boardId: u.boardId, shortCode: trimmed.toUpperCase() })
  }

  // Apply per-row updates (PostgREST doesn't support batch-UPDATE with
  // different values per row, so we issue one UPDATE per row. For ~50
  // boards per project this is acceptable; if we ever cross 500 boards
  // per project, lift to a server-side function.)
  // structure.nodes is project-scoped (not revision-scoped), so scope by
  // project_id + id only.
  let updated = 0
  for (const u of normalised) {
    const { error } = await supabase
      .schema('structure')
      .from('nodes')
      .update({ short_code: u.shortCode })
      .eq('id', u.boardId)
      .eq('project_id', projectId)
    if (error) {
      return { ok: false, error: `Update failed for node ${u.boardId}: ${error.message}` }
    }
    updated += 1
  }

  // Invalidate the bulk-edit screen + the tags page
  revalidatePath(`/projects/${projectId}/cables/${revisionId}/boards/short-codes`)
  revalidatePath(`/projects/${projectId}/cables/${revisionId}/tags`)

  return { ok: true, updated }
}
