// apps/mobile/src/hooks/useProjects.ts
import { useQuery } from '@tanstack/react-query'
import { useDb } from './useDb'
import type { LocalDb } from './useDb'
import { useSupabase } from '../providers/SupabaseProvider'
import { PROJECTS_LOCAL_QUERY } from './projects.queries'

type Project = {
  id: string
  name: string
  status: string
  city: string | null
  province: string | null
  organisation_id: string
  client_name: string | null
  contract_value: number | null
  start_date: string | null
  end_date: string | null
}

// Returns every project the current user may see. No org filter: the local
// PowerSync DB (and, on the remote fallback, RLS) already scope the result to
// own-org projects + cross-org sites shared via project_members (00155/00157).
export function useProjects() {
  const { type, db } = useDb('projects')
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['projects', type],
    queryFn: async (): Promise<Project[]> => {
      if (type === 'local') {
        return (db as LocalDb).getAll<Project>(PROJECTS_LOCAL_QUERY)
      }
      const { data, error } = await (db as typeof supabase)
        .schema('projects')
        .from('projects')
        .select('*')
      if (error) throw error
      return data as unknown as Project[]
    },
  })
}
