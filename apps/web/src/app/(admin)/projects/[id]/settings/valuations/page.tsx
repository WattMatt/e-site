import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, COST_VIEW_ROLES } from '@esite/shared'

import { listValuationsAction } from '@/actions/valuation.actions'
import { listBoqAction } from '@/actions/boq.actions'
import { Card, CardBody } from '@/components/ui/Card'
import { ValuationsTab } from './_components/ValuationsTab'

interface Props {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) notFound()

  const guard = await requireEffectiveRole(supabase, id, COST_VIEW_ROLES)
  if (!guard.ok) redirect(`/projects/${id}`)

  // A valuation prices against the current BOQ import — gate on it existing.
  const boq = await listBoqAction(id)
  const boqData = 'data' in boq ? boq.data : null

  if (!boqData?.import) {
    return (
      <Card>
        <CardBody>
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 600, color: 'var(--c-text)' }}>
              No BOQ to value against
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-mid)', fontFamily: 'var(--font-sans)', maxWidth: 420, marginInline: 'auto' }}>
              Import a BOQ on the Rates tab first. Valuations measure progress against the priced contract Bill of Quantities.
            </p>
          </div>
        </CardBody>
      </Card>
    )
  }

  const valuationsRes = await listValuationsAction(id)
  const valuations = 'data' in valuationsRes ? valuationsRes.data.valuations : []

  return (
    <ValuationsTab
      projectId={id}
      canEdit={true}
      valuations={valuations}
      sections={boqData.sections}
      items={boqData.items}
    />
  )
}
