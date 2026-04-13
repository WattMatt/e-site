import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, snagService, rfiService, formatDate, formatZAR } from '@esite/shared'
import { floorPlanService } from '@esite/shared'
import { ReportButton } from '@/components/ui/ReportButton'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody, KpiCard } from '@/components/ui/Card'
import { projectStatusBadge, snagStatusBadge, priorityBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const [project, snagStats, rfis, floorPlans] = await Promise.all([
    projectService.getById(supabase as any, id).catch(() => null),
    snagService.getStats(supabase as any, id),
    rfiService.list(supabase as any, id),
    floorPlanService.listByProject(supabase as any, id).catch(() => []),
  ])

  if (!project) notFound()

  const openRfis = rfis.filter((r) => r.status === 'open').length

  return (
    <div>
      <div className="mb-6">
        <Link href="/projects" className="text-slate-400 hover:text-white text-sm">← Projects</Link>
      </div>

      <PageHeader
        title={project.name}
        subtitle={`${project.city ?? ''}${project.province ? `, ${project.province}` : ''}`}
        actions={
          <div className="flex items-center gap-3">
            {projectStatusBadge(project.status)}
            <Link href={`/projects/${id}/floor-plans`}>
              <Button size="sm" variant="ghost">Floor Plans {floorPlans.length > 0 ? `(${floorPlans.length})` : ''}</Button>
            </Link>
            <ReportButton type="snag-list" entityId={id} label="↓ Snag Report" />
            <Link href={`/projects/${id}/snags/new`}>
              <Button size="sm">+ Snag</Button>
            </Link>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Open Snags" value={snagStats.open + snagStats.in_progress} variant={snagStats.open > 0 ? 'danger' : 'default'} />
        <KpiCard label="Pending Sign-off" value={snagStats.pending_sign_off} variant={snagStats.pending_sign_off > 0 ? 'warning' : 'default'} />
        <KpiCard label="Closed Snags" value={snagStats.signed_off + snagStats.closed} variant="success" />
        <KpiCard label="Open RFIs" value={openRfis} variant={openRfis > 0 ? 'warning' : 'default'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Project details */}
        <Card className="lg:col-span-1">
          <CardBody className="space-y-3">
            <h3 className="font-semibold text-white">Details</h3>
            {[
              ['Client', project.client_name],
              ['Contact', project.client_contact],
              ['Contract Value', project.contract_value ? formatZAR(project.contract_value) : null],
              ['Start Date', project.start_date ? formatDate(project.start_date) : null],
              ['End Date', project.end_date ? formatDate(project.end_date) : null],
            ].map(([label, value]) =>
              value ? (
                <div key={label as string}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-sm text-white">{value}</p>
                </div>
              ) : null
            )}
          </CardBody>
        </Card>

        {/* Recent snags */}
        <Card className="lg:col-span-2">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-white">Recent Snags</h3>
            <Link href={`/projects/${id}/snags`} className="text-blue-400 text-sm hover:text-blue-300">
              View all
            </Link>
          </div>
          <div className="divide-y divide-slate-700/50">
            {rfis.slice(0, 5).length === 0 ? (
              <p className="px-6 py-8 text-slate-400 text-sm text-center">No snags yet</p>
            ) : (
              rfis.slice(0, 5).map((rfi) => (
                <div key={rfi.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">{rfi.subject}</p>
                    <p className="text-xs text-slate-400">{formatDate(rfi.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {priorityBadge(rfi.priority)}
                    {snagStatusBadge(rfi.status)}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Members */}
      {(project.project_members as any[])?.length > 0 && (
        <Card className="mt-6">
          <div className="px-6 py-4 border-b border-slate-700">
            <h3 className="font-semibold text-white">Team ({(project.project_members as any[]).length})</h3>
          </div>
          <div className="px-6 py-4 flex flex-wrap gap-3">
            {(project.project_members as any[]).map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-slate-700 rounded-full px-3 py-1.5">
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
                  {m.profile?.full_name?.[0] ?? '?'}
                </div>
                <span className="text-sm text-white">{m.profile?.full_name}</span>
                <span className="text-xs text-slate-400">{m.role}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
