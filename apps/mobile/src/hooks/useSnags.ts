import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { snagService } from '@esite/shared'
import type { CreateSnagInput, UpdateSnagInput } from '@esite/shared'
import { useSupabase } from '../providers/SupabaseProvider'
import { useAuth } from '../providers/AuthProvider'

export function useSnags(projectId: string) {
  const client = useSupabase()
  return useQuery({
    queryKey: ['snags', projectId],
    queryFn: () => snagService.list(client, projectId),
    staleTime: 1000 * 60 * 5,
    enabled: !!projectId,
  })
}

export function useSnag(id: string) {
  const client = useSupabase()
  return useQuery({
    queryKey: ['snag', id],
    queryFn: () => snagService.getById(client, id),
    enabled: !!id,
  })
}

export function useSnagStats(projectId: string) {
  const client = useSupabase()
  return useQuery({
    queryKey: ['snag-stats', projectId],
    queryFn: () => snagService.getStats(client, projectId),
    staleTime: 1000 * 60 * 2,
    enabled: !!projectId,
  })
}

export function useCreateSnag(orgId: string) {
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateSnagInput) =>
      snagService.create(client, orgId, profile!.id, input),
    onSuccess: (snag) => {
      queryClient.invalidateQueries({ queryKey: ['snags', snag.project_id] })
      queryClient.invalidateQueries({ queryKey: ['snag-stats', snag.project_id] })
    },
  })
}

export function useUpdateSnag() {
  const client = useSupabase()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSnagInput }) =>
      snagService.update(client, id, input),
    onSuccess: (snag) => {
      queryClient.invalidateQueries({ queryKey: ['snag', snag.id] })
      queryClient.invalidateQueries({ queryKey: ['snags', snag.project_id] })
    },
  })
}

export function useSignOffSnag() {
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, signaturePath }: { id: string; signaturePath: string }) =>
      snagService.signOff(client, id, profile!.id, signaturePath),
    onSuccess: (snag) => {
      queryClient.invalidateQueries({ queryKey: ['snag', snag.id] })
      queryClient.invalidateQueries({ queryKey: ['snags', snag.project_id] })
    },
  })
}
