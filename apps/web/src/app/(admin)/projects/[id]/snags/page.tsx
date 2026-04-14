import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, snagService, formatDate } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { snagStatusBadge, priorityBadge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

interface Props { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }

export default async function ProjectSnagsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status } = await searchParams
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, projectId).catch(() => null)
  if (!project) notFound()

  const allSnags = await snagService.list(supabase as any, projectId).catch(() => [])
  const snags = status ? allSnags.filter(s => s.status === status) : allSnags

  const stats = allSnags.reduce((acc: Record<string, number>, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  const STATUS_COLORS: Record<string, string> = {
    open: 'text-red-400', in_progress: 'text-orange-400', resolved: 'text-blue-400',
    pending_sign_off: 'text-amber-400', signed_off: 'text-emerald-400', closed: 'text-slate-400',
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/projects/${projectId}`} className="text-slate-400 hover:text-white text-sm">← {project.name}</Link>
      </div>
      <PageHeader
        title="Snags"
        subtitle={project.name}
        actions={
          <Link href={`/projects/${projectId}/snags/new`}>
            <Button size="sm">+ New Snag</Button>
          </Link>
        }
      />

      {/* Status filter pills */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <Link href={`/projects/${projectId}/snags`}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!status ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          All ({allSnags.length})
        </Link>
        {Object.entries(stats).map(([s, count]) => (
          <Link key={s} href={`/projects/${projectId}/snags?status=${s}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${status === s ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {s.replace(/_/g, ' ')} ({count})
          </Link>
        ))}
      </div>

      {snags.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-white font-semibold">No snags{status ? ` with status "${status}"` : ''}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {snags.map((snag) => {
            const raisedBy = (snag as any).raised_by_profile
            const assignedTo = (snag as any).assigned_to_profile
            return (
              <Link key={snag.id} href={`/snags/${snag.id}`}>
                <Card className="hover:border-slate-600 transition-colors cursor-pointer">
                  <div className="px-5 py-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {priorityBadge(snag.priority)}
                        <p className="text-sm font-medium text-white truncate">{snag.title}</p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-400 mt-1">
                        {snag.location && <span>📍 {snag.location}</span>}
                        {raisedBy && <span>By {raisedBy.full_name}</span>}
                        {assignedTo && <span>→ {assignedTo.full_name}</span>}
                        <span>{formatDate(snag.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {snagStatusBadge(snag.status)}
                    </div>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
