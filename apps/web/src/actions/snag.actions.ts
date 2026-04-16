'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'

/**
 * signOffSnagAction — validates closeout photo before allowing sign-off.
 *
 * Per T-030 AC: "closeout photo required before sign-off."
 * Separated from updateSnagStatusAction to avoid adding a storage query
 * to every status change.
 */
export async function signOffSnagAction(
  snagId: string,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify a closeout photo exists
  const { data: photos, error: photoErr } = await supabase
    .schema('field')
    .from('snag_photos')
    .select('id')
    .eq('snag_id', snagId)
    .eq('photo_type', 'closeout')
    .limit(1)

  if (photoErr) return { error: photoErr.message }
  if (!photos || photos.length === 0) {
    return { error: 'A closeout photo is required before signing off. Please upload evidence of the resolved defect.' }
  }

  // Apply sign-off
  const { data: snag, error } = await supabase
    .schema('field')
    .from('snags')
    .update({
      status: 'signed_off',
      signed_off_by: user.id,
      signed_off_at: new Date().toISOString(),
    })
    .eq('id', snagId)
    .select('title, raised_by, organisation_id')
    .single()

  if (error) return { error: error.message }

  await trackServer(user.id, ANALYTICS_EVENTS.SNAG_RESOLVED, {
    snag_id: snagId,
    project_id: projectId,
    org_id: snag.organisation_id,
    new_status: 'signed_off',
  })

  revalidatePath(`/snags/${snagId}`)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/snags')
  return {}
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  pending_sign_off: 'Pending Sign-off',
  signed_off: 'Signed Off',
  closed: 'Closed',
}

export async function updateSnagStatusAction(
  snagId: string,
  newStatus: string,
  projectId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const updates: Record<string, unknown> & any = { status: newStatus }
  if (newStatus === 'resolved') updates.resolved_at = new Date().toISOString()
  if (newStatus === 'signed_off') {
    updates.signed_off_by = user.id
    updates.signed_off_at = new Date().toISOString()
  }

  const { data: snag, error } = await supabase
    .schema('field')
    .from('snags')
    .update(updates)
    .eq('id', snagId)
    .select('title, raised_by, assigned_to, organisation_id')
    .single()

  if (error) return { error: error.message }

  // Track funnel events
  if (newStatus === 'resolved' || newStatus === 'signed_off') {
    await trackServer(user.id, ANALYTICS_EVENTS.SNAG_RESOLVED, {
      snag_id: snagId,
      project_id: projectId,
      org_id: snag.organisation_id,
      new_status: newStatus,
    })
  }

  // Notify relevant parties (best-effort, non-blocking)
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      const notifyUserIds = [
        snag.raised_by,
        snag.assigned_to,
      ].filter((id): id is string => Boolean(id) && id !== user.id)

      const uniqueIds = [...new Set(notifyUserIds)]
      if (uniqueIds.length > 0) {
        await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            userIds: uniqueIds,
            title: `Snag status updated`,
            body: `"${snag.title}" is now ${STATUS_LABELS[newStatus] ?? newStatus}`,
            data: { route: `/snags/${snagId}` },
          }),
        }).catch(() => {/* non-blocking */})
      }
    }
  } catch {
    // Notification failure must not block the status update
  }

  revalidatePath(`/snags/${snagId}`)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/snags')
  return {}
}
