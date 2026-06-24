/**
 * Canonical project-notification recipient resolver.
 *
 * Returns everyone with access to a site — active explicit project_members
 * UNION implicit org owners/admins/project_managers — resolved LIVE via the
 * `project_notification_recipients` SQL function (which reuses the exact
 * `user_has_project_access` predicates). Always service-role: the actor often
 * can't read cross-org/sub-org profiles under RLS, which would collapse the
 * audience. Used by every module's notify path (RFI / snags / diary).
 */

import { createServiceClient } from '@/lib/supabase/server'

export interface ProjectRecipient {
  userId: string
  email: string | null
  fullName: string | null
}

export async function resolveProjectRecipients(
  projectId: string,
  opts?: { excludeUserId?: string | null },
): Promise<{ userIds: string[]; emails: string[]; recipients: ProjectRecipient[] }> {
  const svc = createServiceClient()
  const { data, error } = await (svc as any).rpc('project_notification_recipients', {
    p_project_id: projectId,
    p_exclude_user: opts?.excludeUserId ?? null,
  })
  if (error || !Array.isArray(data)) {
    if (error) console.error('[recipients] resolve failed', { projectId, error: error.message })
    return { userIds: [], emails: [], recipients: [] }
  }
  const recipients: ProjectRecipient[] = data.map((r: any) => ({
    userId: r.user_id,
    email: r.email ?? null,
    fullName: r.full_name ?? null,
  }))
  return {
    userIds: recipients.map((r) => r.userId),
    emails: recipients.map((r) => r.email).filter((e): e is string => Boolean(e)),
    recipients,
  }
}
