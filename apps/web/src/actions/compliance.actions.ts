'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { trackServer, ANALYTICS_EVENTS } from '@/lib/analytics'

// ─── Site management ──────────────────────────────────────────────────────────

export async function createSiteAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .in('role', ['owner', 'admin', 'project_manager'])
    .limit(1)
    .single()

  if (!membership) {
    return { error: 'You do not have permission to create sites.' }
  }

  const name = (formData.get('name') as string)?.trim()
  const address = (formData.get('address') as string)?.trim()
  const city = (formData.get('city') as string | null)?.trim() || undefined
  const province = (formData.get('province') as string | null)?.trim() || undefined
  const erfNumber = (formData.get('erf_number') as string | null)?.trim() || undefined
  const siteType = (formData.get('site_type') as string | null) || 'residential'

  if (!name || !address) return { error: 'Name and address are required.' }

  const { data: site, error } = await supabase
    .schema('compliance')
    .from('sites')
    .insert({
      organisation_id: membership.organisation_id,
      created_by: user.id,
      name,
      address,
      city,
      province,
      erf_number: erfNumber,
      site_type: siteType,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/compliance')
  redirect(`/compliance/${site.id}`)
}

export async function updateSiteAction(
  siteId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  const address = (formData.get('address') as string)?.trim()

  if (!name || !address) return { error: 'Name and address are required.' }

  const { error } = await supabase
    .schema('compliance')
    .from('sites')
    .update({ name, address })
    .eq('id', siteId)

  if (error) return { error: error.message }

  revalidatePath(`/compliance/${siteId}`)
  return {}
}

// ─── Subsection management ────────────────────────────────────────────────────

export async function createSubsectionAction(
  siteId: string,
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string | null)?.trim() || undefined
  const sansRef = (formData.get('sans_ref') as string | null)?.trim() || undefined
  const sortOrderRaw = formData.get('sort_order')
  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0

  if (!name) return { error: 'Subsection name is required.' }

  // Get org ID from site
  const { data: site } = await supabase
    .schema('compliance')
    .from('sites')
    .select('organisation_id')
    .eq('id', siteId)
    .single()

  if (!site) return { error: 'Site not found.' }

  const { data: sub, error } = await supabase
    .schema('compliance')
    .from('subsections')
    .insert({
      site_id: siteId,
      organisation_id: site.organisation_id,
      name,
      description,
      sans_ref: sansRef,
      sort_order: sortOrder,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/compliance/${siteId}`)
  return { id: sub.id }
}

export async function updateSubsectionAction(
  subsectionId: string,
  siteId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string | null)?.trim() || null
  const sansRef = (formData.get('sans_ref') as string | null)?.trim() || null
  const sortOrder = Number(formData.get('sort_order') ?? 0)

  if (!name) return { error: 'Name is required.' }

  const { error } = await supabase
    .schema('compliance')
    .from('subsections')
    .update({ name, description, sans_ref: sansRef, sort_order: sortOrder })
    .eq('id', subsectionId)

  if (error) return { error: error.message }

  revalidatePath(`/compliance/${siteId}`)
  return {}
}

export async function deleteSubsectionAction(
  subsectionId: string,
  siteId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema('compliance')
    .from('subsections')
    .delete()
    .eq('id', subsectionId)

  if (error) return { error: error.message }

  revalidatePath(`/compliance/${siteId}`)
  return {}
}

// ─── COC review ───────────────────────────────────────────────────────────────

export async function reviewCocAction(
  uploadId: string,
  subsectionId: string,
  siteId: string,
  status: 'approved' | 'rejected',
  notes: string | null,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Check reviewer has PM/admin/owner role
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .in('role', ['owner', 'admin', 'project_manager'])
    .limit(1)
    .maybeSingle()

  if (!membership) return { error: 'Only project managers and admins can review COCs.' }

  // Update the coc_upload status
  const { error: uploadErr } = await supabase
    .schema('compliance')
    .from('coc_uploads')
    .update({
      status,
      reviewed_by: user.id,
      review_notes: notes,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', uploadId)

  if (uploadErr) return { error: uploadErr.message }

  // Mirror status on the subsection
  const subsectionStatus = status === 'approved' ? 'approved' : 'rejected'
  const { error: subErr } = await supabase
    .schema('compliance')
    .from('subsections')
    .update({ coc_status: subsectionStatus })
    .eq('id', subsectionId)

  if (subErr) return { error: subErr.message }

  // Send notification to uploader via edge function (best-effort)
  try {
    const { data: upload } = await supabase
      .schema('compliance')
      .from('coc_uploads')
      .select('uploaded_by')
      .eq('id', uploadId)
      .single()

    if (upload?.uploaded_by) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          userIds: [upload.uploaded_by],
          title: `COC ${status === 'approved' ? 'Approved ✓' : 'Rejected ✗'}`,
          body: notes ? `Review note: ${notes}` : `Your COC has been ${status}.`,
          data: { route: `/compliance/${siteId}` },
        }),
      }).catch(() => {/* non-blocking */})
    }
  } catch {
    // Notification failure must not block the review action
  }

  // Track COC approval in analytics funnel
  if (status === 'approved') {
    await trackServer(user.id, ANALYTICS_EVENTS.COC_APPROVED, {
      upload_id: uploadId,
      subsection_id: subsectionId,
      site_id: siteId,
    })
  }

  // If just approved, check if site is now 100% complete → trigger certificate pack generation
  if (status === 'approved') {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && serviceKey) {
        await fetch(`${supabaseUrl}/functions/v1/compliance-complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ siteId }),
        }).catch(() => {/* non-blocking */})
      }
    } catch {
      // Non-blocking — don't fail the review if this errors
    }
  }

  revalidatePath(`/compliance/${siteId}`)
  revalidatePath(`/compliance/${siteId}/${subsectionId}`)
  return {}
}

export async function markUnderReviewAction(
  uploadId: string,
  subsectionId: string,
  siteId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { error: uploadErr } = await supabase
    .schema('compliance')
    .from('coc_uploads')
    .update({ status: 'under_review' })
    .eq('id', uploadId)

  if (uploadErr) return { error: uploadErr.message }

  await supabase
    .schema('compliance')
    .from('subsections')
    .update({ coc_status: 'under_review' })
    .eq('id', subsectionId)

  revalidatePath(`/compliance/${siteId}`)
  revalidatePath(`/compliance/${siteId}/${subsectionId}`)
  return {}
}
