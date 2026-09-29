// apps/web/src/lib/solar/load/cloud.ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export const METER_FILE_RE = /\.(csv|txt|xlsx|xls)$/i
export interface ProjectMapping {
  organisation_id: string
  cloud_storage_connection_id: string | null
  cloud_storage_folder_id: string | null
  cloud_storage_folder_path?: string | null
}

/** The project's cloud mapping, read through the caller's session (RLS on projects.projects). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function projectMapping(supabase: SupabaseClient<any, any, any>, projectId: string): Promise<ProjectMapping | null> {
  const { data } = await supabase.schema('projects').from('projects')
    .select('organisation_id, cloud_storage_connection_id, cloud_storage_folder_id, cloud_storage_folder_path').eq('id', projectId).maybeSingle()
  return (data as ProjectMapping | null) ?? null
}

export const OUTSIDE_MAPPED_FOLDER = "That folder is outside this project's mapped cloud folder."

interface ListedItem { id: string; name: string; type: 'file' | 'folder'; size?: number; path?: string }
type ListPage = (folderId: string, pageToken?: string) => Promise<{ items: ListedItem[]; nextPageToken?: string }>

const MAX_TRAIL_DEPTH = 20
const MAX_PAGES_PER_FOLDER = 20

/**
 * Proves, by listing, that ids handed in by the client sit inside the project's mapped folder.
 *
 * The providers have no common "path of this id" call (Google Drive has no paths at all), so the
 * client sends the TRAIL of folder ids from the mapped root down to the folder it means, and each
 * step is checked to be a folder child of the one above it — a folder anywhere else in the account
 * cannot be reached, whatever id is sent. Listings are memoised per request.
 */
export function mappedFolderProbe(rootId: string, listPage: ListPage) {
  const listings = new Map<string, Promise<ListedItem[] | null>>()
  const truncatedFolders = new Set<string>()
  const children = (folderId: string) => {
    let p = listings.get(folderId)
    if (!p) {
      p = (async () => {
        const all: ListedItem[] = []
        let token: string | undefined
        for (let i = 0; i < MAX_PAGES_PER_FOLDER; i++) {
          const r = await listPage(folderId, token)
          all.push(...r.items)
          token = r.nextPageToken
          if (!token) return all
        }
        truncatedFolders.add(folderId)
        return all  // a very large folder: the first pages only (a child beyond them reads as outside)
      })()
      listings.set(folderId, p)
    }
    return p
  }
  /** The folder id the trail ends at (the root for an empty trail), or null when any step does not hold. */
  async function folderOf(trail: readonly string[]): Promise<string | null> {
    if (trail.length > MAX_TRAIL_DEPTH) return null
    let parent = rootId
    for (const id of trail) {
      const kids = await children(parent)
      if (!kids?.some((k) => k.id === id && k.type === 'folder')) return null
      parent = id
    }
    return parent
  }
  /** The provider's own listing entry for a file under the trail's folder, or null. */
  async function fileIn(trail: readonly string[], fileId: string): Promise<ListedItem | null> {
    const folder = await folderOf(trail)
    if (folder === null) return null
    return (await children(folder))?.find((k) => k.id === fileId && k.type === 'file') ?? null
  }
  /** True once `children(folderId)` stopped at the page cap with more pages left. */
  const truncated = (folderId: string) => truncatedFolders.has(folderId)
  return { folderOf, fileIn, children, truncated }
}
