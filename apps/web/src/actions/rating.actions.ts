'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const submitRatingSchema = z.object({
  supplierId:         z.string().uuid('Invalid supplier.'),
  orderId:            z.string().uuid('Invalid order.'),
  deliveryScore:      z.preprocess(val => Number(val), z.number().int().min(1).max(5, 'Scores must be 1–5.')),
  qualityScore:       z.preprocess(val => Number(val), z.number().int().min(1).max(5, 'Scores must be 1–5.')),
  communicationScore: z.preprocess(val => Number(val), z.number().int().min(1).max(5, 'Scores must be 1–5.')),
  pricingScore:       z.preprocess(val => Number(val), z.number().int().min(1).max(5, 'Scores must be 1–5.')),
  comment:            z.string().max(1000).optional(),
})

export async function submitRatingAction(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const parsed = submitRatingSchema.safeParse({
    supplierId:         formData.get('supplierId'),
    orderId:            formData.get('orderId'),
    deliveryScore:      formData.get('deliveryScore'),
    qualityScore:       formData.get('qualityScore'),
    communicationScore: formData.get('communicationScore'),
    pricingScore:       formData.get('pricingScore'),
    comment:            formData.get('comment') ?? undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const { supplierId, orderId, deliveryScore, qualityScore, communicationScore, pricingScore, comment } = parsed.data

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
      supplier_id:          supplierId,
      order_id:             orderId,
      contractor_org_id:    membership.organisation_id,
      rated_by:             user.id,
      delivery_score:       deliveryScore,
      quality_score:        qualityScore,
      communication_score:  communicationScore,
      pricing_score:        pricingScore,
      comment:              comment?.trim() || null,
    })

  if (error) return { error: error.message }

  await (supabase as any).rpc('refresh_supplier_rating_summary').catch(() => {})

  redirect(`/marketplace/${supplierId}`)
}
