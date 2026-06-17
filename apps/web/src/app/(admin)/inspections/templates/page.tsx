import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  listTemplatesAction,
  getTemplateInspectionCountAction,
} from '@/actions/inspections-template.actions'
import { createClient } from '@/lib/supabase/server'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import DeprecateButton from './DeprecateButton'
import ReactivateButton from './ReactivateButton'
import DeleteTemplateButton from './DeleteTemplateButton'

export const dynamic = 'force-dynamic'

async function getOrgContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: org } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!org) redirect('/onboarding')
  return {
    orgId: org.organisation_id as string,
    role: org.role as string,
  }
}

type TemplateRow = Awaited<ReturnType<typeof listTemplatesAction>>[number]

export default async function TemplateLibraryPage() {
  const { orgId, role } = await getOrgContext()
  const isOwner = role === 'owner'
  const templates = await listTemplatesAction(orgId)

  // For owner-only delete: pre-fetch inspection counts for all templates.
  // This runs in parallel across all versions so the page doesn't slow down
  // for non-owner users (the condition short-circuits the fetches).
  const inspectionCountMap = new Map<string, number>()
  if (isOwner && templates.length > 0) {
    await Promise.all(
      templates.map(async (t) => {
        const count = await getTemplateInspectionCountAction(t.template_id, t.version, orgId)
        inspectionCountMap.set(t.id, count)
      }),
    )
  }

  // Group by category, then by template_id (so multiple versions cluster).
  const CATEGORY_LABELS: Record<string, string> = {
    medium_voltage: 'Medium Voltage',
    generators: 'Generators',
    solar_pv: 'Solar PV',
    low_voltage: 'Low Voltage',
    reports_site: 'Reports & Site',
  }
  const humanise = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const GENERAL = '__general__'
  const byCategory = new Map<string, Map<string, TemplateRow[]>>()
  for (const t of templates) {
    const cat = t.category ?? GENERAL
    if (!byCategory.has(cat)) byCategory.set(cat, new Map())
    const fam = byCategory.get(cat)!
    if (!fam.has(t.template_id)) fam.set(t.template_id, [])
    fam.get(t.template_id)!.push(t)
  }
  // Named categories first (alpha by display label), "General" last.
  const categoryOrder = Array.from(byCategory.keys()).sort((a, b) => {
    if (a === GENERAL) return 1
    if (b === GENERAL) return -1
    return (CATEGORY_LABELS[a] ?? humanise(a)).localeCompare(CATEGORY_LABELS[b] ?? humanise(b))
  })

  return (
    <div className="animate-fadeup" style={{ maxWidth: 960 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inspection Templates</h1>
          <p className="page-subtitle">Versioned schemas powering the inspector capture flow.</p>
        </div>
        <Link href="/inspections/templates/new" style={{ textDecoration: 'none' }}>
          <Button>+ New template</Button>
        </Link>
      </div>

      {templates.length === 0 && (
        <Card>
          <CardBody>
            <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13 }}>
              No templates yet.{' '}
              <Link href="/inspections/templates/new" style={{ color: 'var(--c-amber)', textDecoration: 'underline' }}>
                → Use the builder to create your first template
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {categoryOrder.map((cat) => {
          const families = byCategory.get(cat)!
          const categoryLabel = cat === GENERAL ? 'General' : (CATEGORY_LABELS[cat] ?? humanise(cat))
          return (
            <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-dim)' }}>
                {categoryLabel}
              </div>
              {Array.from(families.entries()).map(([templateId, versions]) => {
          const latest = versions[0]
          return (
            <Card key={templateId}>
              <CardHeader>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', margin: 0 }}>{latest.name}</h2>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>{templateId}</p>
                    {latest.description && (
                      <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 6, maxWidth: 620 }}>
                        {latest.description}
                      </p>
                    )}
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
                            href={`/inspections/templates/${v.id}`}
                            style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline', marginRight: 12 }}
                          >
                            View
                          </Link>
                          <Link
                            href={`/inspections/templates/${v.id}/clone`}
                            style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline', marginRight: 12 }}
                          >
                            Edit
                          </Link>
                          {v.is_active ? (
                            <DeprecateButton templateId={v.id} organisationId={orgId} />
                          ) : (
                            <ReactivateButton templateId={v.id} organisationId={orgId} />
                          )}
                          {isOwner && (
                            <DeleteTemplateButton
                              id={v.id}
                              organisationId={orgId}
                              templateId={v.template_id}
                              version={v.version}
                              inspectionCount={inspectionCountMap.get(v.id) ?? 0}
                            />
                          )}
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
          )
        })}
      </div>
    </div>
  )
}
