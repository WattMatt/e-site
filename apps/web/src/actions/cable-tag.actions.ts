'use server'

/**
 * Cable tag schedule — server actions.
 *
 * Tags are auto-generated from cables on demand (one row per cable end,
 * so 2 rows per cable). Re-generating is idempotent: any cable that
 * already has a (FROM, TO) pair of tags is left alone; missing ones are
 * created. tag_text is the canonical {FROM}-{TO}-{SIZE}-{N} per spec §3.2
 * unless the cable has a tag_override.
 *
 * Print bookkeeping: markTagsPrintedAction flips `printed = TRUE` + stamps
 * printed_at + printed_by. Reprint is an explicit second markTags call —
 * the change_log entry distinguishes first-print from reprint.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()

interface CableJoin {
  id: string
  cable_no: number
  size_mm2: number
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null
  tag_override: string | null
  supply: {
    id: string
    from_source_id: string | null
    from_board_id: string | null
    to_board_id: string
    source?: { code: string } | null
    from_board?: { code: string; short_code?: string | null } | null
    to_board?: { code: string; short_code?: string | null } | null
  }
}

function cableTagText(c: CableJoin): string {
  if (c.tag_override) return c.tag_override
  const from =
    c.supply.source?.code
    ?? c.supply.from_board?.short_code
    ?? c.supply.from_board?.code
    ?? '?'
  const to =
    c.supply.to_board?.short_code
    ?? c.supply.to_board?.code
    ?? '?'
  return `${from}-${to}-${c.size_mm2}-${c.cable_no}`
}

export async function generateTagsAction(
  revisionId: string,
): Promise<{ created?: number; alreadyPresent?: number; error?: string }> {
  if (!uuid.safeParse(revisionId).success) return { error: 'Invalid revision id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Project info for revalidation + the QR payload
  const { data: rev, error: revErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, project_id, organisation_id')
    .eq('id', revisionId)
    .single()
  if (revErr || !rev) return { error: 'Revision not found' }

  // Load all cables with supply + endpoint codes resolved
  const { data: cables, error: cabErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, cable_no, size_mm2, cores, conductor, insulation, armour, tag_override, ' +
      'supply:supplies!supply_id(' +
        'id, from_source_id, from_board_id, to_board_id, ' +
        'source:sources!from_source_id(code), ' +
        'from_board:boards!from_board_id(code, short_code), ' +
        'to_board:boards!to_board_id(code, short_code))',
    )
    .eq('revision_id', revisionId)
  if (cabErr) return { error: cabErr.message }
  const list = (cables ?? []) as unknown as CableJoin[]

  // Load existing tags for this revision's cables to skip duplicates
  const cableIds = list.map((c) => c.id)
  const { data: existing } = await (supabase as any)
    .schema('cable_schedule')
    .from('cable_tags')
    .select('cable_id, end_position')
    .in('cable_id', cableIds.length > 0 ? cableIds : ['00000000-0000-0000-0000-000000000000'])
  const have = new Set(
    ((existing ?? []) as Array<{ cable_id: string; end_position: 'FROM' | 'TO' }>)
      .map((e) => `${e.cable_id}:${e.end_position}`),
  )

  const rows: any[] = []
  for (const c of list) {
    const tagText = cableTagText(c)
    const qrPayload = {
      p: rev.project_id,
      s: c.supply.id,
      c: c.id,
      r: rev.code,
    }
    for (const end of ['FROM', 'TO'] as const) {
      if (have.has(`${c.id}:${end}`)) continue
      rows.push({
        cable_id: c.id,
        organisation_id: rev.organisation_id,
        end_position: end,
        tag_text: tagText,
        qr_payload: qrPayload,
        printed: false,
      })
    }
  }
  if (rows.length > 0) {
    const { error: insErr } = await (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .insert(rows)
    if (insErr) return { error: insErr.message }
  }

  revalidatePath(`/projects/${rev.project_id}/cables/${revisionId}/tags`)
  return { created: rows.length, alreadyPresent: have.size }
}

const markPrintedSchema = z.object({
  tagIds: z.array(uuid).min(1),
})

export async function markTagsPrintedAction(
  input: z.infer<typeof markPrintedSchema>,
): Promise<{ updated?: number; error?: string }> {
  const parsed = markPrintedSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const now = new Date().toISOString()
  const { data: updated, error } = await (supabase as any)
    .schema('cable_schedule')
    .from('cable_tags')
    .update({ printed: true, printed_at: now, printed_by: user.id })
    .in('id', parsed.data.tagIds)
    .select('id, cable_id')
  if (error) return { error: error.message }

  // Revalidate via the cable's revision (best-effort one-shot lookup)
  if ((updated as any[])?.length) {
    const oneCableId = (updated as Array<{ cable_id: string }>)[0]!.cable_id
    const { data: cable } = await (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select('revision_id, revision:revisions!revision_id(project_id)')
      .eq('id', oneCableId)
      .single()
    const c = cable as any
    if (c?.revision?.project_id) {
      revalidatePath(`/projects/${c.revision.project_id}/cables/${c.revision_id}/tags`)
    }
  }
  return { updated: (updated as any[])?.length ?? 0 }
}
