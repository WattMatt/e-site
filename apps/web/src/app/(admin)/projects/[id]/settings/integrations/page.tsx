import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { projectService } from '@esite/shared'
import type { OrgRole } from '@esite/shared'
import { getProjectSettingsCached } from '@/lib/project-settings'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { IntegrationsPanel } from './IntegrationsPanel'

const VIEW_ROLES: ReadonlyArray<OrgRole> = ['owner', 'admin']

interface Props {
  params: Promise<{ id: string }>
}

interface FeatureUnlock {
  feature_code: string
  unlocked_at: string
}

const FEATURE_LABELS: Record<string, string> = {
  jbcc:        'JBCC contract module',
  inspections: 'Inspections module',
  cable:       'Cable schedule module',
  tenant:      'Tenant schedule module',
}

export default async function Page({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) redirect(`/projects/${id}`)

  const orgId = (project as any).organisation_id ?? (project as any).organisationId
  const guard = await requireRole(supabase, orgId, VIEW_ROLES)
  if (!guard.ok) redirect(`/projects/${id}/settings/general`)

  // Fetch project settings for notification toggles.
  const settings = await getProjectSettingsCached(id)

  // Feature unlocks — query billing schema. Degrade gracefully if the
  // billing.org_feature_unlocks table doesn't exist in this environment.
  let unlocks: FeatureUnlock[] = []
  try {
    const { data } = await (supabase as any)
      .schema('billing')
      .from('org_feature_unlocks')
      .select('feature_code, unlocked_at')
      .eq('organisation_id', orgId)
    unlocks = data ?? []
  } catch {
    // billing schema or table not present — show degraded state
  }

  const notifyRfiEmail = settings?.notifyRfiEmail ?? false
  const notifyInspectionEmail = settings?.notifyInspectionEmail ?? false
  const notifySnagEmail = settings?.notifySnagEmail ?? true
  const notifyDiaryEmail = settings?.notifyDiaryEmail ?? true

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Feature unlocks section */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Feature unlocks</h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
                Features enabled for your organisation.
              </p>
            </div>
            <Link
              href="/settings/billing"
              style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'none', flexShrink: 0, marginTop: 2 }}
            >
              Manage unlocks →
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          {unlocks.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>
              No feature unlocks recorded for this organisation.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unlocks.map((u) => (
                <div
                  key={u.feature_code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--c-border)',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--c-text)' }}>
                    {FEATURE_LABELS[u.feature_code] ?? u.feature_code}
                  </span>
                  <span className="badge badge-green">Unlocked</span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Notification toggles — client component for immediate save */}
      <IntegrationsPanel
        projectId={id}
        initialNotifyRfiEmail={notifyRfiEmail}
        initialNotifyInspectionEmail={notifyInspectionEmail}
        initialNotifySnagEmail={notifySnagEmail}
        initialNotifyDiaryEmail={notifyDiaryEmail}
      />
    </div>
  )
}
