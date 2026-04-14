import { usePowerSync } from '@powersync/react-native'
import { useSupabase } from '../providers/SupabaseProvider'

// Tables in this set are synced locally via PowerSync.
// All other tables go direct to Supabase.
const POWERSYNC_TABLES = new Set(['snags', 'projects', 'snag_photos'])

export type LocalDb = ReturnType<typeof usePowerSync>
export type RemoteDb = ReturnType<typeof useSupabase>

export type DbResult =
  | { type: 'local'; db: LocalDb }
  | { type: 'remote'; db: RemoteDb }

export function useDb(table: string): DbResult {
  const powerSync = usePowerSync()
  const supabase = useSupabase()

  if (POWERSYNC_TABLES.has(table)) {
    return { type: 'local', db: powerSync }
  }
  return { type: 'remote', db: supabase }
}
