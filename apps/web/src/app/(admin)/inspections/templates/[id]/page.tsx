import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getTemplateAction,
  getTemplateInspectionCountAction,
} from '@/actions/inspections-template.actions'
import { createClient } from '@/lib/supabase/server'
import type { ParsedTemplate } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import TemplatePreviewPane from './TemplatePreviewPane'
import DeleteTemplateButton from '../DeleteTemplateButton'
import TemplateDetailsEditor from './TemplateDetailsEditor'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ViewTemplatePage({ params }: Props) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: orgData } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!orgData) redirect('/onboarding')

  const orgId = orgData.organisation_id as string
  const role = orgData.role as string
  const isOwner = role === 'owner'
  const canEditDetails = role === 'owner' || role === 'admin'

  const t = await getTemplateAction(id) as {
    id: string
    template_id: string
    version: string
    name: string
    description: string | null
    applies_to_node_types: string[]
    deliverable_type: 'coc' | 'inspection_only' | 'factory_test'
    is_active: boolean
    schema_json: ParsedTemplate
  }

  const inspectionCount = isOwner
    ? await getTemplateInspectionCountAction(t.template_id, t.version, orgId)
    : 0

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/inspections/templates"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Templates
        </Link>
      </div>

      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{t.name}</h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
            {t.template_id} · v{t.version}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <Badge variant={t.deliverable_type === 'coc' ? 'warning' : 'info'}>
              {t.deliverable_type.replace(/_/g, ' ')}
            </Badge>
            {t.applies_to_node_types.map((nt) => (
              <Badge key={nt} variant="ghost">{nt}</Badge>
            ))}
            {!t.is_active && <Badge variant="ghost">Deprecated</Badge>}
          </div>
        </div>
        <Link href={`/inspections/templates/${t.id}/new-version`} style={{ textDecoration: 'none' }}>
          <Button>+ New Version</Button>
        </Link>
      </div>

      <div style={{ marginBottom: 16 }}>
        <TemplateDetailsEditor
          organisationId={orgId}
          templateId={t.template_id}
          initialName={t.name}
          initialDescription={t.description}
          canEdit={canEditDetails}
        />
      </div>

      <Card>
        <CardHeader>
          <span className="data-panel-title">Preview as inspector sees it</span>
        </CardHeader>
        <CardBody>
          <TemplatePreviewPane template={t.schema_json} />
        </CardBody>
      </Card>

      {isOwner && (
        <div
          className="data-panel animate-fadeup animate-fadeup-4"
          style={{ marginTop: 24, borderColor: 'var(--c-red, #dc2626)' }}
        >
          <div className="data-panel-header" style={{ borderColor: 'var(--c-red, #dc2626)' }}>
            <span className="data-panel-title" style={{ color: 'var(--c-red, #dc2626)' }}>
              Danger zone (owner only)
            </span>
          </div>
          <div style={{ padding: '14px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
              Permanently delete this template version. Blocked if any inspection references it.
            </p>
            <DeleteTemplateButton
              id={t.id}
              organisationId={orgId}
              templateId={t.template_id}
              version={t.version}
              inspectionCount={inspectionCount}
              redirectTo="/inspections/templates"
            />
          </div>
        </div>
      )}
    </div>
  )
}
