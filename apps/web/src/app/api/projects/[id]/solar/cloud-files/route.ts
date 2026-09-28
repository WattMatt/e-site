// apps/web/src/app/api/projects/[id]/solar/cloud-files/route.ts
/**
 * GET …/solar/cloud-files?trail=<id>&trail=<id>&pageToken= — browse the project's mapped cloud folder
 * for meter exports (spec §4.3 "Import from Dropbox folder"). Folders + .csv/.txt/.xlsx/.xls ≤ 50 MB only.
 * `trail` is the folder ids from the mapped root down; each step is proven by listing its parent, so no
 * folder outside the mapped root can be browsed (403 outside_mapped_folder). A legacy `folderId` must be
 * the root or the trail's last id. Gate: Solar Edit. The connection row is read through RLS.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { listCloudFolder } from '@/services/cloud-storage-folder.server'
import { UUID_RE } from '@/lib/solar/load/meter-access'
import { METER_FILE_RE, OUTSIDE_MAPPED_FOLDER, mappedFolderProbe, projectMapping } from '@/lib/solar/load/cloud'
import { MAX_METER_FILE_BYTES } from '@/lib/solar/meter-import/repo'

// A route module may export only route fields (Next 15 type-checks this at build): helpers live in lib/solar/load/cloud.ts.
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response
  const m = await projectMapping(supabase, projectId)
  if (!m?.cloud_storage_connection_id || !m.cloud_storage_folder_id) return NextResponse.json({ error: 'no_mapping' }, { status: 404 })
  const url = new URL(req.url)
  const connectionId = m.cloud_storage_connection_id
  const rootId = m.cloud_storage_folder_id
  const trail = url.searchParams.getAll('trail').filter((t) => t.length > 0 && t.length <= 500)
  const asked = url.searchParams.get('folderId')
  const outside = () => NextResponse.json({ error: 'outside_mapped_folder', message: OUTSIDE_MAPPED_FOLDER }, { status: 403 })
  if (asked !== null && asked !== (trail.length > 0 ? trail[trail.length - 1] : rootId)) return outside()
  try {
    const listPage = (folderId: string, pageToken?: string) => listCloudFolder({ connectionId, folderId, pageToken }, supabase as unknown as SupabaseClient)
    const folderId = await mappedFolderProbe(rootId, listPage).folderOf(trail)
    if (folderId === null) return outside()
    const r = await listPage(folderId, url.searchParams.get('pageToken') ?? undefined)
    const items = r.items
      .filter((i) => i.type === 'folder' || (METER_FILE_RE.test(i.name) && (i.size ?? 0) <= MAX_METER_FILE_BYTES))
      .map((i) => ({ id: i.id, name: i.name, type: i.type, size: i.size ?? null, path: i.path ?? null }))
    return NextResponse.json({ rootFolderId: m.cloud_storage_folder_id, rootPath: m.cloud_storage_folder_path ?? null, items, nextPageToken: r.nextPageToken ?? null })
  } catch (e) {
    console.error('[solar/cloud-files]', { projectId, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'cloud_list_failed' }, { status: 502 })
  }
}
