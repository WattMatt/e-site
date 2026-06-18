'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'
import {
  ORG_WRITE_ROLES,
  type ClientGcrReviewPayload,
  type GcrChangeRequestInput,
} from '@esite/shared'

export interface ClientSiteRow {
  project_id: string
  project_name: string
  organisation_name: string | null
}

/** List the projects (sites) this client has been granted review access to. */
export async function getClientSitesAction(): Promise<ClientSiteRow[] | { error: string }> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return { error: 'Not authenticated' }

  const { data, error } = await (supabase as any)
    .from('client_site_grants')
    .select('project_id, projects:project_id (name, organisations:organisation_id (name))')
    .eq('user_id', userData.user.id)
  if (error) return { error: error.message }

  return ((data ?? []) as any[]).map((r) => ({
    project_id: r.project_id,
    project_name: r.projects?.name ?? 'Site',
    organisation_name: r.projects?.organisations?.name ?? null,
  }))
}

/**
 * The ONLY client GCR read path: the grant-gated, outputs-only RPC. Returns a
 * null payload when no snapshot has been published yet (caller renders empty).
 */
export async function getClientGcrReviewAction(
  projectId: string,
): Promise<{ payload: ClientGcrReviewPayload | null } | { error: string }> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return { error: 'Not authenticated' }

  const { data, error } = await (supabase as any)
    .schema('gcr')
    .rpc('get_client_review', { p_project_id: projectId })
  if (error) return { error: error.message }

  return { payload: (data as ClientGcrReviewPayload | null) ?? null }
}

/**
 * Submit a batch of captured proposals + comments, pinned to the latest
 * published snapshot. RLS gates the insert (granted client only). Then notifies
 * the project's write-role members (in-app + branded email), best-effort.
 */
export async function submitGcrChangeRequestsAction(
  projectId: string,
  requests: GcrChangeRequestInput[],
): Promise<{ ok: true; submitted: number } | { error: string }> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return { error: 'Not authenticated' }
  if (requests.length === 0) return { error: 'Nothing to submit' }

  const userId = userData.user.id

  // Pin to the latest published snapshot (deterministic order matches the RPC).
  const { data: snap } = await (supabase as any)
    .schema('gcr')
    .from('review_snapshots')
    .select('id, organisation_id')
    .eq('project_id', projectId)
    .order('published_for_client_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!snap) return { error: 'No published review to comment on' }

  const rows = requests.map((r) => ({
    project_id: projectId,
    organisation_id: snap.organisation_id,
    snapshot_id: snap.id,
    node_id: r.nodeId,
    client_id: userId,
    field: r.field,
    old_value: r.oldValue,
    new_value: r.newValue,
    comment: r.comment,
  }))

  const { error } = await (supabase as any)
    .schema('gcr')
    .from('change_requests')
    .insert(rows)
  if (error) return { error: error.message ?? 'Failed to submit requests' }

  // Notify the project's write-role members. The submitting client is NOT an org
  // member of the project, so the cookie client can't read project_members under
  // RLS — resolve recipients with the service client (elevated read after the
  // RLS-gated insert already authorised the submit). Best-effort throughout.
  try {
    const service = createServiceClient() as any
    const { data: members } = await service
      .schema('projects')
      .from('project_members')
      .select('user_id, role')
      .eq('project_id', projectId)
      .in('role', ORG_WRITE_ROLES as unknown as string[])
    const adminIds = Array.from(
      new Set(((members ?? []) as any[]).map((m) => m.user_id).filter(Boolean)),
    )

    if (adminIds.length > 0) {
      await dispatchNotification({
        userIds: adminIds,
        title: 'New GCR client requests',
        body: `A client submitted ${rows.length} change request(s) for review.`,
        route: `/projects/${projectId}/generator-cost-recovery`,
        type: 'gcr_change_request_submitted',
        entityType: 'gcr_change_request',
        entityId: snap.id,
      })

      const { data: profs } = await service
        .from('profiles')
        .select('email')
        .in('id', adminIds)
      const to = ((profs ?? []) as any[])
        .map((p) => p.email)
        .filter((e): e is string => Boolean(e))

      if (to.length > 0) {
        await supabase.functions
          .invoke('send-email', {
            body: {
              type: 'gcr-client-request',
              payload: { to, projectId, requestCount: rows.length },
            },
          })
          .catch(() => {/* email failure must never block submit */})
      }
    }
  } catch {
    /* notifications are best-effort */
  }

  return { ok: true, submitted: rows.length }
}
