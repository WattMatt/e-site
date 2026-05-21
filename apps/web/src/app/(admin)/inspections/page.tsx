import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { InspectionsTabs } from './InspectionsTabs'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Inspections' }

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'

const STATUS_VARIANT: Record<string, Variant> = {
  assigned: 'ghost',
  in_progress: 'info',
  awaiting_verification: 'warning',
  certified: 'success',
  're-inspect_required': 'danger',
  abandoned: 'ghost',
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_verification', label: 'Awaiting verification' },
  { value: 'certified', label: 'Certified' },
  { value: 're-inspect_required', label: 'Re-inspect required' },
  { value: 'abandoned', label: 'Abandoned' },
]

interface Props {
  searchParams: Promise<{ status?: string }>
}

export default async function PortfolioRollupPage({ searchParams }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: orgs } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
  const orgIds = (orgs ?? []).map((o: any) => o.organisation_id)
  if (!orgIds.length) redirect('/onboarding')
  const isAdmin = (orgs ?? []).some((o: any) => o.role === 'owner' || o.role === 'admin')

  const { status } = await searchParams

  let q = supabase.schema('inspections').from('inspections')
    .select('id, project_id, target_label, target_node_type, status, coc_number, certified_at, template_id, verifier_id, updated_at')
    .in('organisation_id', orgIds)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (status) q = q.eq('status', status)
  const { data: items } = await q

  const arr = (items as any[]) ?? []

  // Hydrate template names + deliverable_type, verifier identity, project name (batched, no embeds)
  const tids = [...new Set(arr.map((i) => i.template_id).filter(Boolean))]
  const vids = [...new Set(arr.map((i) => i.verifier_id).filter(Boolean))]
  const pids = [...new Set(arr.map((i) => i.project_id).filter(Boolean))]

  const [templatesRes, verifiersRes, projectsRes] = await Promise.all([
    tids.length
      ? supabase.schema('inspections').from('templates')
          .select('id, name, deliverable_type')
          .in('id', tids)
      : Promise.resolve({ data: [] }),
    vids.length
      ? supabase.from('profiles')
          .select('id, full_name, email')
          .in('id', vids)
      : Promise.resolve({ data: [] }),
    pids.length
      ? (supabase as any).schema('projects').from('projects')
          .select('id, name, code')
          .in('id', pids)
      : Promise.resolve({ data: [] }),
  ])

  const tmap = new Map<string, any>(((templatesRes.data as any[]) ?? []).map((t) => [t.id, t]))
  const vmap = new Map<string, any>(((verifiersRes.data as any[]) ?? []).map((v) => [v.id, v]))
  const pmap = new Map<string, any>(((projectsRes.data as any[]) ?? []).map((p) => [p.id, p]))

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1200 }}>
      {isAdmin && <InspectionsTabs active="inspections" />}
      <div className="page-header">
        <div>
          <h1 className="page-title">Inspections</h1>
          <p className="page-subtitle">Portfolio rollup across every project in your organisation.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATUS_FILTERS.map((s) => {
          const isActive = (status ?? '') === s.value
          const href = s.value ? `/inspections?status=${s.value}` : '/inspections'
          return (
            <Link key={s.value || 'all'} href={href} style={{ textDecoration: 'none' }}>
              <Badge variant={isActive ? 'info' : 'ghost'}>{s.label}</Badge>
            </Link>
          )
        })}
      </div>

      <Card>
        {arr.length === 0 ? (
          <CardBody>
            <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13 }}>
              {status ? (
                <>
                  No inspections with status <span style={{ fontFamily: 'var(--font-mono)' }}>{status}</span>.{' '}
                  <Link href="/inspections" style={{ color: 'var(--c-amber)', textDecoration: 'underline' }}>
                    Clear filter
                  </Link>
                  .
                </>
              ) : (
                <>No inspections yet. Open a project to assign one from a template.</>
              )}
            </div>
          </CardBody>
        ) : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--c-border)', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>PROJECT</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>TARGET</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>TEMPLATE</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>STATUS</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>COC #</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>VERIFIER</th>
                <th style={{ textAlign: 'right', padding: '10px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {arr.map((i) => {
                const p = pmap.get(i.project_id)
                const t = tmap.get(i.template_id)
                const v = vmap.get(i.verifier_id)
                return (
                  <tr key={i.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <td style={{ padding: '10px 14px', color: 'var(--c-text)' }}>
                      {p?.name ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--c-text)' }}>
                      {i.target_label}{' '}
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        ({i.target_node_type})
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--c-text-mid)' }}>
                      {t?.name ?? '—'}
                      {t?.deliverable_type && (
                        <Badge variant={t.deliverable_type === 'coc' ? 'warning' : 'info'} className="ml-1">
                          {String(t.deliverable_type).replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Badge variant={STATUS_VARIANT[i.status] ?? 'default'}>
                        {String(i.status).replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)' }}>
                      {i.coc_number ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--c-text-mid)' }}>
                      {v?.email ?? v?.full_name ?? '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <Link
                        href={`/projects/${i.project_id}/inspections/${i.id}`}
                        style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline' }}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
