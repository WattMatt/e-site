/**
 * POST /api/cable-schedule/commit
 *
 * Commits a parsed import preview into a new DRAFT cable_schedule
 * revision. Reuses the parse output verbatim — the client posts the
 * preview JSON back so we don't re-read the workbook. Two-step flow
 * (parse → commit) lets the user fix amber rows inline before any DB
 * writes happen.
 *
 * Steps:
 *   1. Open a fresh DRAFT revision on the project (auto-numbered).
 *   2. For every unique FROM_label that doesn't already exist as a
 *      source or board, create a board (since the importer can't tell
 *      a Source from a Board on text alone — Source-vs-Board is a
 *      polish task once an org has a Schematic baseline).
 *      Same for unique TO_labels.
 *      Reference the bounded list of known Source codes from the
 *      reference workbook (RMU / MINI SUB N) to upgrade those to type
 *      MINISUB | RMU heuristically.
 *   3. Group cables by (FROM, TO) into supplies. Voltage + load come
 *      from the first cable in each group.
 *   4. Insert cables. ohm_per_km comes from the workbook; we'll let
 *      C-3.2's SANS-lookup retrofit kick in later via a "Re-fetch
 *      lookups" button if the engineer wants to.
 *   5. Write a change_log row tagged entity_type = 'import' with the
 *      file fingerprint summary.
 */

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ImportedCablePayload {
  source_row: number
  tag_input: string | null
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
  size_mm2: number | null
  ohm_per_km: number | null
  cable_no: number
  /** When set, this row was fanned out from a single Excel row with a Parallel column (parse-side). Carries the strand index (1..N) for traceability; the commit logic doesn't need to do anything different — the fanned rows already share a (FROM, TO) group and so land on the same supply. */
  fanned_from_parallel?: number
  measured_length_m: number | null
  source_vd_pct: number | null
  conductor: 'CU' | 'AL'
  section: 'NORMAL' | 'EMERGENCY' | null
  warnings: string[]
  errors: string[]
}

interface CommitPayload {
  projectId: string
  fileName: string
  fileSizeBytes: number
  /** When set, override the "new revision" default and import into this
   *  existing DRAFT revision. The revision must already be DRAFT. */
  intoRevisionId?: string
  /** Optional human-readable description for the new revision. */
  revisionDescription?: string
  cables: ImportedCablePayload[]
}

function isLikelySource(code: string): { is: boolean; type: 'MINISUB' | 'RMU' | 'STANDBY' | 'UTILITY' | 'PV' } {
  const c = code.toUpperCase()
  if (/MINI\s*SUB/.test(c)) return { is: true, type: 'MINISUB' }
  if (/^RMU$/.test(c) || /CONSUMER\s*RMU/.test(c)) return { is: true, type: 'RMU' }
  if (/STANDBY|STANDBY\s*PLANT/.test(c)) return { is: true, type: 'STANDBY' }
  if (/UTILITY|ESKOM|MUNICIPAL/.test(c)) return { is: true, type: 'UTILITY' }
  if (/^PV($|\W)/.test(c) || /PV\s*PLANT/.test(c)) return { is: true, type: 'PV' }
  return { is: false, type: 'MINISUB' }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null) as CommitPayload | null
  if (!body || !body.projectId || !Array.isArray(body.cables)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Verify project access + org
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id, name')
    .eq('id', body.projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not accessible' }, { status: 403 })
  const projectId = (project as any).id as string
  const orgId = (project as any).organisation_id as string

  // Reject any rows that still have errors
  const blocked = body.cables.filter((c) => c.errors.length > 0)
  if (blocked.length > 0) {
    return NextResponse.json({
      error: `${blocked.length} row(s) have errors and must be fixed before commit`,
      blockedSourceRows: blocked.map((b) => b.source_row),
    }, { status: 422 })
  }

  // 1. Open / locate revision
  let revisionId: string
  if (body.intoRevisionId) {
    const { data: rev } = await (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id, status')
      .eq('id', body.intoRevisionId)
      .eq('project_id', projectId)
      .single()
    if (!rev || rev.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Target revision not found or not in DRAFT' }, { status: 422 })
    }
    revisionId = rev.id
  } else {
    // Pick next free Rev N
    const { data: existing } = await (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('code')
      .eq('project_id', projectId)
    const used = new Set(((existing ?? []) as Array<{ code: string }>).map((r) => r.code))
    let n = 0
    while (used.has(`Rev ${n}`)) n++
    const { data: revRow, error: revErr } = await (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .insert({
        project_id: projectId,
        organisation_id: orgId,
        code: `Rev ${n}`,
        description: body.revisionDescription ?? `Imported from ${body.fileName}`,
        status: 'DRAFT',
        created_by: user.id,
      })
      .select('id')
      .single()
    if (revErr || !revRow) {
      const msg = revErr?.message?.includes('one_draft_per_project')
        ? 'There is already a DRAFT revision for this project. Issue or discard it before importing.'
        : revErr?.message ?? 'Failed to create revision'
      return NextResponse.json({ error: msg }, { status: 422 })
    }
    revisionId = (revRow as { id: string }).id
  }

  // 2. Collect distinct nodes; promote source-like labels to Sources
  const labels = new Set<string>()
  for (const c of body.cables) {
    if (c.from_label) labels.add(c.from_label)
    if (c.to_label)   labels.add(c.to_label)
  }
  const sources = [...labels].filter((l) => isLikelySource(l).is)
  const boards = [...labels].filter((l) => !isLikelySource(l).is)

  const sourceIds = new Map<string, string>()
  if (sources.length > 0) {
    const rows = sources.map((code) => {
      const cls = isLikelySource(code)
      return {
        revision_id: revisionId,
        organisation_id: orgId,
        code,
        type: cls.type,
      }
    })
    const { data: ins, error } = await (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .insert(rows)
      .select('id, code')
    if (error) return NextResponse.json({ error: `Source insert: ${error.message}` }, { status: 422 })
    for (const r of ins as Array<{ id: string; code: string }>) sourceIds.set(r.code, r.id)
  }

  const boardIds = new Map<string, string>()
  if (boards.length > 0) {
    const rows = boards.map((code) => ({
      revision_id: revisionId,
      organisation_id: orgId,
      code,
    }))
    const { data: ins, error } = await (supabase as any)
      .schema('cable_schedule')
      .from('boards')
      .insert(rows)
      .select('id, code')
    if (error) return NextResponse.json({ error: `Board insert: ${error.message}` }, { status: 422 })
    for (const r of ins as Array<{ id: string; code: string }>) boardIds.set(r.code, r.id)
  }

  // 3. Group cables by (FROM, TO) into supplies
  type GroupKey = string
  interface PendingSupply {
    fromSourceId: string | null
    fromBoardId: string | null
    toBoardId: string
    voltage_v: number
    design_load_a: number
    section: 'NORMAL' | 'EMERGENCY' | null
    cables: ImportedCablePayload[]
  }
  const supplyByKey = new Map<GroupKey, PendingSupply>()
  const errors: string[] = []

  for (const c of body.cables) {
    const fromIsSource = sourceIds.has(c.from_label)
    const fromBoard = boardIds.get(c.from_label)
    const toBoard = boardIds.get(c.to_label)
    if (!toBoard) {
      errors.push(`Row ${c.source_row}: TO node "${c.to_label}" couldn't be resolved`)
      continue
    }
    if (!fromIsSource && !fromBoard) {
      errors.push(`Row ${c.source_row}: FROM node "${c.from_label}" couldn't be resolved`)
      continue
    }
    const key = `${c.from_label}||${c.to_label}`
    if (!supplyByKey.has(key)) {
      supplyByKey.set(key, {
        fromSourceId: fromIsSource ? sourceIds.get(c.from_label)! : null,
        fromBoardId:  fromIsSource ? null : fromBoard!,
        toBoardId:    toBoard,
        voltage_v:    c.voltage_v ?? 400,
        design_load_a: c.load_a ?? 1,
        section:      c.section,
        cables:       [],
      })
    }
    supplyByKey.get(key)!.cables.push(c)
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Node resolution failed', details: errors }, { status: 422 })
  }

  // Insert supplies
  const supplyRows = [...supplyByKey.entries()].map(([, s]) => ({
    revision_id: revisionId,
    organisation_id: orgId,
    from_source_id: s.fromSourceId,
    from_board_id:  s.fromBoardId,
    to_board_id:    s.toBoardId,
    voltage_v:      s.voltage_v,
    design_load_a:  s.design_load_a,
    section:        s.section,
  }))
  const { data: supplyInserted, error: supErr } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .insert(supplyRows)
    .select('id, from_source_id, from_board_id, to_board_id')
  if (supErr) return NextResponse.json({ error: `Supply insert: ${supErr.message}` }, { status: 422 })

  // Build supply lookup back to its grouping key
  const supplyIdByKey = new Map<string, string>()
  let i = 0
  for (const [key] of supplyByKey) {
    supplyIdByKey.set(key, (supplyInserted as Array<{ id: string }>)[i++]!.id)
  }

  // 4. Insert cables
  const cableRows: Record<string, unknown>[] = []
  for (const [key, group] of supplyByKey) {
    const supplyId = supplyIdByKey.get(key)!
    for (const c of group.cables) {
      cableRows.push({
        supply_id: supplyId,
        revision_id: revisionId,
        organisation_id: orgId,
        cable_no: c.cable_no,
        size_mm2: c.size_mm2 ?? 16,         // fallback to satisfy NOT NULL; warning already raised in preview
        cores: '4',
        conductor: c.conductor,
        insulation: 'XLPE',                  // workbook doesn't carry insulation per row; default
        armour: 'SWA',
        standard: c.conductor === 'AL' ? 'SANS 1507-4' : 'SANS 1507-4',
        measured_length_m: c.measured_length_m,
        length_status: c.measured_length_m != null ? 'MEASURED' : 'UNMEASURED',
        ohm_per_km: c.ohm_per_km,
        manual_override: c.ohm_per_km != null,
        tag_override: c.tag_input,
        import_warning: c.warnings.length > 0,
        notes: c.warnings.length > 0 ? c.warnings.join(' · ') : null,
      })
    }
  }
  if (cableRows.length > 0) {
    const { error: cabErr } = await (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .insert(cableRows)
    if (cabErr) return NextResponse.json({ error: `Cable insert: ${cabErr.message}` }, { status: 422 })
  }

  // 5. change_log entry tagged 'import'
  await (supabase as any)
    .schema('cable_schedule')
    .from('change_log')
    .insert({
      revision_id: revisionId,
      organisation_id: orgId,
      entity_type: 'import',
      entity_id: null,
      field_name: null,
      old_value: null,
      new_value: {
        fileName: body.fileName,
        fileSizeBytes: body.fileSizeBytes,
        cables: body.cables.length,
        warnings: body.cables.reduce((s, c) => s + c.warnings.length, 0),
      },
      reason: 'Excel ingestion',
      changed_by: user.id,
    })

  revalidatePath(`/projects/${projectId}/cables/${revisionId}`)
  return NextResponse.json({
    ok: true,
    revisionId,
    inserted: {
      sources: sourceIds.size,
      boards: boardIds.size,
      supplies: supplyInserted?.length ?? 0,
      cables: cableRows.length,
    },
  })
}
