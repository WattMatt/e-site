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
import { requireRoleForRevision, ROLES_ENGINEER_AND_FIELD } from '@/lib/cable-schedule/require-role'

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
    from_node_id: string | null
    to_node_id: string | null
    source?: { code: string } | null
    from_node?: { code: string; short_code: string | null } | null
    to_node?: { code: string; short_code: string | null } | null
  }
}

function cableTagText(c: CableJoin): string {
  if (c.tag_override) return c.tag_override
  const from =
    c.supply.source?.code
    ?? (c.supply.from_node ? (c.supply.from_node.short_code ?? c.supply.from_node.code) : null)
    ?? '?'
  const to =
    c.supply.to_node
      ? (c.supply.to_node.short_code ?? c.supply.to_node.code)
      : '?'
  return `${from}-${to}-${c.size_mm2}-${c.cable_no}`
}

export async function generateTagsAction(
  revisionId: string,
): Promise<{ created?: number; alreadyPresent?: number; error?: string }> {
  if (!uuid.safeParse(revisionId).success) return { error: 'Invalid revision id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // C12: role gate — engineers + field workers can generate tags.
  const roleCheck = await requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER_AND_FIELD)
  if (!roleCheck.ok) return { error: roleCheck.error }

  // Project info for revalidation + the QR payload
  const { data: rev, error: revErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, project_id, organisation_id')
    .eq('id', revisionId)
    .single()
  if (revErr || !rev) return { error: 'Revision not found' }

  // Load all cables + their supply edge IDs. Cross-schema embeds don't work
  // (PGRST200), so nodes are fetched separately and joined in JS below.
  const { data: cables, error: cabErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, cable_no, size_mm2, cores, conductor, insulation, armour, tag_override, ' +
      'supply:supplies!supply_id(' +
        'id, from_source_id, from_node_id, to_node_id, ' +
        'source:sources!from_source_id(code))',
    )
    .eq('revision_id', revisionId)
  if (cabErr) return { error: cabErr.message }
  const rawList = (cables ?? []) as unknown as Array<Omit<CableJoin, 'supply'> & {
    supply: {
      id: string
      from_source_id: string | null
      from_node_id: string | null
      to_node_id: string | null
      source?: { code: string } | null
    }
  }>

  // Collect all referenced node IDs and fetch structure.nodes in one query.
  const nodeIds = [
    ...new Set(
      rawList.flatMap((c) => [c.supply.from_node_id, c.supply.to_node_id].filter((id): id is string => Boolean(id))),
    ),
  ]
  const nodeById = new Map<string, { code: string; short_code: string | null }>()
  if (nodeIds.length > 0) {
    const { data: nodeRows } = await (supabase as any)
      .schema('structure')
      .from('nodes')
      .select('id, code, short_code')
      .in('id', nodeIds)
    for (const n of (nodeRows ?? []) as Array<{ id: string; code: string; short_code: string | null }>) {
      nodeById.set(n.id, n)
    }
  }

  // Attach node references so cableTagText() can resolve codes.
  const list: CableJoin[] = rawList.map((c) => ({
    ...c,
    supply: {
      ...c.supply,
      from_node: c.supply.from_node_id ? (nodeById.get(c.supply.from_node_id) ?? null) : null,
      to_node: c.supply.to_node_id ? (nodeById.get(c.supply.to_node_id) ?? null) : null,
    },
  }))

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

/**
 * Recompute tag_text for every existing cable_tag on the revision
 * using current board.short_code values. Use after backfilling short
 * codes via the bulk-edit screen so existing tags pick up the new
 * abbreviated form.
 *
 * DRAFT-only. Per-row UPDATE since tag_text values differ.
 */
export async function regenerateTagTextAction(
  revisionId: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  if (!uuid.safeParse(revisionId).success) return { ok: false, error: 'Invalid revision id' }
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // C12: role gate — engineers + field workers can regenerate tags.
  const roleCheck = await requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER_AND_FIELD)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  // Status gate
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, project_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!rev) return { ok: false, error: 'Revision not found' }
  if (rev.status !== 'DRAFT') {
    return { ok: false, error: 'Tag regeneration only allowed on DRAFT revisions' }
  }

  // Fetch all cables + tags. Cross-schema embeds don't work (PGRST200), so
  // nodes are fetched separately and joined in JS — mirrors generateTagsAction.
  const [cablesRes, tagsRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, cable_no, size_mm2, cores, conductor, insulation, armour, tag_override, ' +
        'supply:supplies!supply_id(' +
          'id, from_source_id, from_node_id, to_node_id, ' +
          'source:sources!from_source_id(code))',
      )
      .eq('revision_id', revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .select('id, cable_id, end_position'),
  ])

  type RawCable = Omit<CableJoin, 'supply'> & {
    supply: {
      id: string
      from_source_id: string | null
      from_node_id: string | null
      to_node_id: string | null
      source?: { code: string } | null
    }
  }
  const rawCables = (cablesRes.data ?? []) as unknown as RawCable[]

  // Fetch node codes for all referenced node IDs.
  const regenNodeIds = [
    ...new Set(
      rawCables.flatMap((c) => [c.supply.from_node_id, c.supply.to_node_id].filter((id): id is string => Boolean(id))),
    ),
  ]
  const regenNodeById = new Map<string, { code: string; short_code: string | null }>()
  if (regenNodeIds.length > 0) {
    const { data: nodeRows } = await (supabase as any)
      .schema('structure')
      .from('nodes')
      .select('id, code, short_code')
      .in('id', regenNodeIds)
    for (const n of (nodeRows ?? []) as Array<{ id: string; code: string; short_code: string | null }>) {
      regenNodeById.set(n.id, n)
    }
  }

  const cables: CableJoin[] = rawCables.map((c) => ({
    ...c,
    supply: {
      ...c.supply,
      from_node: c.supply.from_node_id ? (regenNodeById.get(c.supply.from_node_id) ?? null) : null,
      to_node: c.supply.to_node_id ? (regenNodeById.get(c.supply.to_node_id) ?? null) : null,
    },
  }))

  const tags = (tagsRes.data ?? []) as Array<{
    id: string
    cable_id: string
    end_position: 'FROM' | 'TO'
  }>

  const cableById = new Map(cables.map((c) => [c.id, c] as const))

  let updated = 0
  for (const tag of tags) {
    const c = cableById.get(tag.cable_id)
    if (!c) continue
    const newTagText = cableTagText(c)

    const { error } = await (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .update({ tag_text: newTagText })
      .eq('id', tag.id)
    if (error) {
      return { ok: false, error: `Update failed for tag ${tag.id}: ${error.message}` }
    }
    updated += 1
  }

  revalidatePath(`/projects/${rev.project_id}/cables/${revisionId}/tags`)
  return { ok: true, updated }
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

  // C12: role gate — engineers + field workers can mark tags printed.
  // Derive revisionId via the first tag's cable -> revision_id chain.
  const firstTagId = parsed.data.tagIds[0]!
  const { data: tagRow } = await (supabase as any)
    .schema('cable_schedule')
    .from('cable_tags')
    .select('cable:cables!cable_id(revision_id)')
    .eq('id', firstTagId)
    .maybeSingle()
  const tagRevId = (tagRow as { cable?: { revision_id?: string } } | null)?.cable?.revision_id
  if (!tagRevId) return { error: 'Tag not found' }
  const roleCheck = await requireRoleForRevision(supabase, tagRevId, ROLES_ENGINEER_AND_FIELD)
  if (!roleCheck.ok) return { error: roleCheck.error }

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
