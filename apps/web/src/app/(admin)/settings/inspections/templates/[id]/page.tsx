import Link from 'next/link'
import { getTemplateAction } from '@/actions/inspections-template.actions'
import type { ParsedTemplate } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import MonacoView from '../MonacoView'
import TemplatePreviewPane from './TemplatePreviewPane'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ViewTemplatePage({ params }: Props) {
  const { id } = await params
  const t = await getTemplateAction(id) as {
    id: string
    template_id: string
    version: string
    name: string
    applies_to_node_types: string[]
    deliverable_type: 'coc' | 'inspection_only' | 'factory_test'
    is_active: boolean
    schema_json: ParsedTemplate
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings/inspections/templates"
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
        <Link href={`/settings/inspections/templates/${t.id}/new-version`} style={{ textDecoration: 'none' }}>
          <Button>+ New Version</Button>
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 16,
        }}
      >
        <Card>
          <CardHeader>
            <span className="data-panel-title">JSON (read-only)</span>
          </CardHeader>
          <CardBody>
            <MonacoView value={JSON.stringify(t.schema_json, null, 2)} readOnly />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="data-panel-title">Preview as inspector sees it</span>
          </CardHeader>
          <CardBody>
            <TemplatePreviewPane template={t.schema_json} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
