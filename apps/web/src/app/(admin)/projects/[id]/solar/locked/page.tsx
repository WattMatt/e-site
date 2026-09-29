import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { loadSolarEntry } from '@/lib/solar/entry-loader'
import { grantorDisplayNames, listSolarGrantors } from '@/lib/solar/grantors'
import { solarPriceLine } from '@/lib/solar/price'
import { LockedScreen } from '../_components/LockedScreen'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar' }

/**
 * Lives OUTSIDE solar/(gated) so the gate's redirect here can never loop
 * (the jbcc/unlock pattern, apps/web/src/app/(admin)/projects/[id]/jbcc/unlock/page.tsx).
 */
export default async function SolarLockedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ payment?: string }>
}) {
  const { id } = await params
  const { payment } = await searchParams
  const ctx = await loadSolarEntry(id)
  if (!ctx) redirect('/dashboard')
  const state = ctx.state
  if (state.kind === 'hidden') redirect(`/projects/${id}`)
  if (state.kind === 'granted') redirect(`/projects/${id}/solar/overview`)

  const supabase = await createClient()
  const { data: org } = await supabase.from('organisations').select('name').eq('id', ctx.organisationId).maybeSingle()
  const orgName = (org as { name?: string } | null)?.name ?? 'your organisation'
  const grantorNames = state.kind === 'pending'
    ? grantorDisplayNames(await listSolarGrantors(ctx.organisationId))
    : []

  return (
    <LockedScreen
      projectId={id}
      projectName={ctx.projectName}
      orgName={orgName}
      state={state}
      priceLine={solarPriceLine()}
      grantorNames={grantorNames}
      paymentReturn={payment === 'received'}
    />
  )
}
