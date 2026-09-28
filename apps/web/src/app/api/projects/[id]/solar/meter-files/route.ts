/**
 * POST /api/projects/[id]/solar/meter-files
 * Registers a raw meter file the browser already uploaded to Storage (solar-meter-raw).
 * Gate: Solar Edit on the project (requireSolarLevelAPI). Reads Storage with the caller's client,
 * so the bucket's policy applies too. Recomputes the sha256 from the bytes; the file name must be it.
 * app/api/* is outside (admin)/layout.tsx, so this route gates itself.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sha256Hex } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { createMeterImportRepo, MAX_METER_FILE_BYTES } from '@/lib/solar/meter-import/repo'

export const runtime = 'nodejs'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const Body = z.object({ storagePath: z.string().min(1).max(300), originalName: z.string().trim().min(1).max(255) }).strict()

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const repo = createMeterImportRepo(supabase)
  const orgId = await repo.projectOrg(projectId)
  if (!orgId) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const m = parsed.data.storagePath.match(/^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f]{64})\.(csv|txt|xlsx|xls)$/)
  if (!m || m[1] !== orgId || m[2] !== projectId) {
    return NextResponse.json({ error: 'storage path must be <org>/<project>/<sha256>.<ext> for this project' }, { status: 400 })
  }
  let bytes: Uint8Array | null
  try {
    bytes = await repo.downloadRaw(parsed.data.storagePath)
  } catch {
    return NextResponse.json({ error: 'file is larger than 50 MB' }, { status: 413 })
  }
  if (!bytes) return NextResponse.json({ error: 'uploaded file not found in storage' }, { status: 404 })
  if (bytes.byteLength > MAX_METER_FILE_BYTES) return NextResponse.json({ error: 'file is larger than 50 MB' }, { status: 413 })
  const sha = await sha256Hex(bytes)
  if (sha !== m[3]) return NextResponse.json({ error: 'sha256_mismatch', expected: m[3], actual: sha }, { status: 400 })

  const existing = await repo.fileBySha(orgId, sha)
  if (existing && existing.project_id !== projectId) {
    // meter_files is unique per (org, sha256), so these bytes cannot get a row of their own here, and
    // parse/commit only act on this project's files: returning the other project's id would dead-end.
    // Say where the data already lives (the meters it feeds, as far as the caller's RLS lets them
    // read) so the dialog can offer "Same data as <meter> at <site>". Linking that meter into this
    // study is Phase 3b's Copy-from-library, not this route.
    const meters = await repo.metersForFile(existing.id)
    return NextResponse.json({ error: 'duplicate_in_other_project', fileId: existing.id, meters }, { status: 409 })
  }
  if (existing) return NextResponse.json({ fileId: existing.id, duplicate: true, status: existing.status }, { status: 200 })
  const row = await repo.insertFile({
    project_id: projectId, organisation_id: orgId, sha256: sha, size_bytes: bytes.byteLength,
    storage_path: parsed.data.storagePath, original_name: parsed.data.originalName,
  })
  return NextResponse.json({ fileId: row.id, duplicate: false }, { status: 201 })
}
