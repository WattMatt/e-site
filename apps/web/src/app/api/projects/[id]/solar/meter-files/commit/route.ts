/**
 * POST /api/projects/[id]/solar/meter-files/commit
 * Body: CommitBody (series | register | skip). Gate: Solar Edit on the project. Everything is written
 * with the caller's client (RLS applies); readings go through solar.write_readings and are counted
 * back before the file is marked accepted.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { CommitBodySchema, CommitError, commitMeterFile } from '@/lib/solar/meter-import/commit'
import { createMeterImportRepo } from '@/lib/solar/meter-import/repo'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const parsed = CommitBodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })

  const repo = createMeterImportRepo(supabase)
  const orgId = await repo.projectOrg(projectId)
  if (!orgId) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const file = await repo.getFile(parsed.data.fileId)
  if (!file || file.project_id !== projectId) return NextResponse.json({ error: 'file not found' }, { status: 404 })

  try {
    const out = await commitMeterFile(repo, { projectId, orgId, file }, parsed.data)
    return NextResponse.json(out, { status: 200 })
  } catch (e) {
    if (e instanceof CommitError) return NextResponse.json(e.body, { status: e.status })
    console.error('[solar/meter-files/commit]', { projectId, fileId: file.id, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'commit_failed' }, { status: 500 })
  }
}
