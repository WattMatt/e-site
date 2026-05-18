import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listTemplatesAction } from '@/actions/inspections-template.actions'
import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import DeprecateButton from './DeprecateButton'

export const dynamic = 'force-dynamic'

async function getOrgId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!org) redirect('/onboarding')
  return org.organisation_id as string
}

type TemplateRow = Awaited<ReturnType<typeof listTemplatesAction>>[number]

export default async function TemplateLibraryPage() {
  const orgId = await getOrgId()
  const templates = await listTemplatesAction(orgId)

  // Group by template_id so multiple versions cluster under one header.
  const grouped = new Map<string, TemplateRow[]>()
  for (const t of templates) {
    if (!grouped.has(t.template_id)) grouped.set(t.template_id, [])
    grouped.get(t.template_id)!.push(t)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Settings
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Inspection Templates</h1>
          <p className="page-subtitle">Versioned schemas powering the inspector capture flow.</p>
        </div>
        <Link href="/settings/inspections/templates/new" style={{ textDecoration: 'none' }}>
          <Button>+ Import Template (JSON)</Button>
        </Link>
      </div>

      {grouped.size === 0 && (
        <Card>
          <CardBody>
            <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13 }}>
              No templates yet.{' '}
              <Link href="/settings/inspections/templates/new" style={{ color: 'var(--c-amber)', textDecoration: 'underline' }}>
                Import one
              </Link>{' '}
              by pasting JSON.
            </div>
          </CardBody>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {Array.from(grouped.entries()).map(([templateId, versions]) => {
          const latest = versions[0]
          return (
            <Card key={templateId}>
              <CardHeader>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', margin: 0 }}>{latest.name}</h2>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>{templateId}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge variant={latest.deliverable_type === 'coc' ? 'warning' : 'info'}>
                      {latest.deliverable_type.replace(/_/g, ' ')}
                    </Badge>
                    {latest.applies_to_node_types.map((nt) => (
                      <Badge key={nt} variant="ghost">{nt}</Badge>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardBody>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--c-border)', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em' }}>
                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>VERSION</th>
                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>STATUS</th>
                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>UPDATED</th>
                      <th style={{ textAlign: 'right', padding: '6px 4px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                        <td style={{ padding: '8px 4px', fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>{v.version}</td>
                        <td style={{ padding: '8px 4px' }}>
                          {v.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="ghost">Deprecated</Badge>}
                        </td>
                        <td style={{ padding: '8px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                          {new Date(v.updated_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                          <Link
                            href={`/settings/inspections/templates/${v.id}`}
                            style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline', marginRight: 12 }}
                          >
                            View
                          </Link>
                          {v.is_active && <DeprecateButton templateId={v.id} organisationId={orgId} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
