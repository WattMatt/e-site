import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectService } from '@esite/shared'
import type { CreateProjectInput } from '@esite/shared'
import { useSupabase } from '../providers/SupabaseProvider'
import { useAuth } from '../providers/AuthProvider'

export function useProjects(orgId: string) {
  const client = useSupabase()
  return useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => projectService.list(client, orgId),
    enabled: !!orgId,
  })
}

export function useProject(id: string) {
  const client = useSupabase()
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectService.getById(client, id),
    enabled: !!id,
  })
}

export function useCreateProject(orgId: string) {
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      projectService.create(client, orgId, profile!.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', orgId] })
    },
  })
}
