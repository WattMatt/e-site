'use client'

/** A tenant plan with nothing uploaded yet: Upload for owner / admin / PM, a sentence for everyone else. */
import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import type { TenantPlanEmptyProps } from '@/lib/status-plans/types'
import { TenantPlanUploader } from './TenantPlanUploader'

const HINT: Record<TenantPlanEmptyProps['purpose'], string> = {
  tenant_layout: 'Upload the tenant floor plan, then mask each shop and link it to the tenant schedule.',
  distribution_schematic: 'Upload the 300 line diagram, then detect the DB blocks and hatch them by order status.',
}

export function TenantPlanEmpty({ projectId, purpose, canEdit }: TenantPlanEmptyProps) {
  return (
    <div className="data-panel" style={{ padding: 24, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{PURPOSE_LABEL[purpose]}</h1>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-mid)' }}>
        Nothing uploaded yet.{' '}
        {canEdit
          ? `${HINT[purpose]} PDF, PNG or JPEG, up to 60 MB each; every page of a PDF becomes a sheet.`
          : 'An owner, admin or project manager can upload it.'}
      </p>
      {canEdit && <div><TenantPlanUploader projectId={projectId} purpose={purpose} label="Upload" /></div>}
    </div>
  )
}
