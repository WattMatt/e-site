// apps/mobile/src/hooks/useProjects.ts
import { useQuery } from '@tanstack/react-query'
import { useDb } from './useDb'
import type { LocalDb } from './useDb'
import { useSupabase } from '../providers/SupabaseProvider'
import { useAuth } from '../providers/AuthProvider'

type Project = {
  id: string
  name: string
  status: string
  city: string | null
  province: string | null
  organisation_id: string
}

export function useProjects() {
  const { type, db } = useDb('projects')
  const supabase = useSupabase()
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? null

  return useQuery({
    queryKey: ['projects', orgId, type],
    queryFn: async (): Promise<Project[]> => {
      if (!orgId) return []

      if (type === 'local') {
        return (db as LocalDb).getAll<Project>(
          'SELECT * FROM projects WHERE organisation_id = ? ORDER BY name ASC',
          [orgId]
        )
      }
      const { data, error } = await (db as typeof supabase)
        .from('projects')
        .select('*')
        .eq('organisation_id', orgId)
      if (error) throw error
      return data as Project[]
    },
    enabled: !!orgId,
  })
}
