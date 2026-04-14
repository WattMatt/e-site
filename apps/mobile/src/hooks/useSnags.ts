// apps/mobile/src/hooks/useSnags.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDb, type LocalDb } from './useDb'
import { useSupabase } from '../providers/SupabaseProvider'

type Snag = {
  id: string
  project_id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  created_at: string
  updated_at: string
}

export function useSnags(projectId: string) {
  const { type, db } = useDb('snags')
  const supabase = useSupabase()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['snags', projectId, type],
    queryFn: async (): Promise<Snag[]> => {
      if (type === 'local') {
        return (db as LocalDb).getAll<Snag>(
          'SELECT * FROM snags WHERE project_id = ? ORDER BY created_at DESC',
          [projectId]
        )
      }
      const { data, error } = await (db as typeof supabase)
        .from('snags')
        .select('*')
        .eq('project_id', projectId)
      if (error) throw error
      return data as Snag[]
    },
    enabled: !!projectId,
  })

  const createSnag = useMutation({
    mutationFn: async (input: Omit<Snag, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('snags').insert(input).select()
      if (error) throw error
      return data[0] as Snag
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snags', projectId] })
    },
  })

  const updateSnag = useMutation({
    mutationFn: async (input: Partial<Snag> & { id: string }) => {
      const { id, ...update } = input
      const { data, error } = await supabase
        .from('snags')
        .update(update)
        .eq('id', id)
        .select()
      if (error) throw error
      return data[0] as Snag
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snags', projectId] })
    },
  })

  const deleteSnag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('snags').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snags', projectId] })
    },
  })

  return {
    snags: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createSnag: createSnag.mutate,
    updateSnag: updateSnag.mutate,
    deleteSnag: deleteSnag.mutate,
  }
}
