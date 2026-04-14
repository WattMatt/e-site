import { usePowerSync } from '@powersync/react-native'
import { useSupabase } from '../providers/SupabaseProvider'
import { POWERSYNC_TABLES } from './powersyncTables'

export { POWERSYNC_TABLES }

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
