// apps/web/src/app/api/projects/[id]/solar/cloud-files/import/route.ts
/**
 * POST …/solar/cloud-files/import { items: [{ id, name }] (1..20) } — copy each chosen cloud file
 * into solar-meter-raw at <org>/<project>/<sha256>.<ext> with the CALLER's client (bucket policy:
 * Solar Edit on the project), then register it exactly like a browser upload. The dialog then calls
 * …/meter-files/parse with the returned file ids. Gate: Solar Edit.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256Hex } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { downloadCloudFile } from '@/services/cloud-storage-folder.server'
import { createMeterImportRepo, MAX_METER_FILE_BYTES, METER_RAW_BUCKET } from '@/lib/solar/meter-import/repo'
import { registerStoredRawFile } from '@/lib/solar/meter-import/register'
import { UUID_RE } from '@/lib/solar/load/meter-access'
import { METER_FILE_RE, projectMapping } from '@/lib/solar/load/cloud'

export const runtime = 'nodejs'
export const maxDuration = 300

const Body = z.object({ items: z.array(z.object({ id: z.string().min(1).max(500), name: z.string().trim().min(1).max(255) }).strict()).min(1).max(20) }).strict()
const MIME: Record<string, string> = {
  csv: 'text/csv', txt: 'text/plain', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  const m = await projectMapping(supabase, projectId)
  if (!m?.cloud_storage_connection_id) return NextResponse.json({ error: 'no_mapping' }, { status: 404 })
  const repo = createMeterImportRepo(supabase)

  const results: Array<Record<string, unknown>> = []
  for (const item of parsed.data.items) {
    const ext = item.name.match(METER_FILE_RE)?.[1]?.toLowerCase()
    if (!ext) { results.push({ name: item.name, error: 'not_a_meter_file' }); continue }
    let bytes: Uint8Array
    try {
      bytes = (await downloadCloudFile({ connectionId: m.cloud_storage_connection_id, fileId: item.id, maxBytes: MAX_METER_FILE_BYTES }, supabase as unknown as SupabaseClient)).bytes
    } catch (e) {
      results.push({ name: item.name, error: e instanceof Error && e.message === 'too_large' ? 'file_too_large' : 'cloud_download_failed' })
      continue
    }
    const sha = await sha256Hex(bytes)
    const storagePath = `${m.organisation_id}/${projectId}/${sha}.${ext}`
    const up = await supabase.storage.from(METER_RAW_BUCKET).upload(storagePath, bytes, { contentType: MIME[ext], upsert: false })
    const exists = up.error && /exist|duplicate/i.test(up.error.message)
    if (up.error && !exists) { results.push({ name: item.name, error: 'storage_upload_failed' }); continue }
    const out = await registerStoredRawFile(repo, { projectId, orgId: m.organisation_id, storagePath, originalName: item.name, bytes, sha })
    results.push(out.status === 409 ? { name: item.name, ...out.body } : { name: item.name, fileId: out.body.fileId, duplicate: out.body.duplicate })
  }
  return NextResponse.json({ results }, { status: 200 })
}
