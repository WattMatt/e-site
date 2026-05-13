/**
 * POST /api/cable-schedule/parse
 *
 * Receives a multipart upload of an .xlsx workbook + projectId, parses
 * the CABLE SCHEDULE sheet via the excel-importer pipeline, and returns
 * the preview JSON the UI renders for green/amber/red validation. No DB
 * writes happen here — that's the commit step.
 *
 * Auth: server-side createClient picks up the user session from cookies.
 * Org membership is verified before we even open the file.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseScheduleWorkbook, vdFidelityOk } from '@/lib/cable-schedule/excel-importer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024  // 50 MB upper bound — matches storage caps

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form' }, { status: 400 })

  const file = form.get('file')
  const projectId = form.get('projectId')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (typeof projectId !== 'string') {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 50 MB)` }, { status: 413 })
  }

  // Verify the user belongs to the project's org. RLS on projects.projects
  // would reject the read otherwise.
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id, name')
    .eq('id', projectId)
    .single()
  if (projErr || !project) {
    return NextResponse.json({ error: 'Project not accessible' }, { status: 403 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  let preview
  try {
    preview = await parseScheduleWorkbook(buffer)
  } catch (e: any) {
    return NextResponse.json({ error: `Parse failed: ${e?.message ?? 'unknown'}` }, { status: 422 })
  }

  // Inject VD fidelity check per row + roll up totals
  let fidelity_ok = 0
  let fidelity_skipped = 0
  let fidelity_fail = 0
  for (const c of preview.cables) {
    const fid = vdFidelityOk(c)
    if (fid.computed == null || fid.source == null) {
      fidelity_skipped++
    } else if (fid.ok) {
      fidelity_ok++
    } else {
      fidelity_fail++
      c.warnings.push(`VD% fidelity ${fid.delta!.toFixed(4)}% off source`)
    }
  }

  const greenCount = preview.cables.filter((c) => c.errors.length === 0 && c.warnings.length === 0).length
  const amberCount = preview.cables.filter((c) => c.errors.length === 0 && c.warnings.length > 0).length
  const redCount   = preview.cables.filter((c) => c.errors.length > 0).length

  return NextResponse.json({
    fileName: file.name,
    fileSizeBytes: file.size,
    project: { id: project.id, name: project.name, organisation_id: project.organisation_id },
    preview,
    counts: {
      total: preview.cables.length,
      green: greenCount,
      amber: amberCount,
      red:   redCount,
      fidelity_ok,
      fidelity_skipped,
      fidelity_fail,
    },
  })
}
