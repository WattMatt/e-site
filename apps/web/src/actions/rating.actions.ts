'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function submitRatingAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supplierId = formData.get('supplierId') as string
  const orderId = formData.get('orderId') as string
  const deliveryScore = Number(formData.get('deliveryScore'))
  const qualityScore = Number(formData.get('qualityScore'))
  const communicationScore = Number(formData.get('communicationScore'))
  const pricingScore = Number(formData.get('pricingScore'))
  const comment = formData.get('comment') as string

  if (!supplierId || !orderId) return { error: 'Missing required fields' }
  if ([deliveryScore, qualityScore, communicationScore, pricingScore].some(s => s < 1 || s > 5)) {
    return { error: 'All scores must be between 1 and 5' }
  }

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership) return { error: 'Not a member of any organisation' }

  const { error } = await (supabase as any)
    .schema('marketplace')
    .from('supplier_ratings')
    .insert({
      supplier_id: supplierId,
      order_id: orderId,
      contractor_org_id: membership.organisation_id,
      rated_by: user.id,
      delivery_score: deliveryScore,
      quality_score: qualityScore,
      communication_score: communicationScore,
      pricing_score: pricingScore,
      comment: comment?.trim() || null,
    })

  if (error) return { error: error.message }

  // Refresh the materialized view
  await (supabase as any).rpc('refresh_supplier_rating_summary').catch(() => {})

  redirect(`/marketplace/${supplierId}`)
}
