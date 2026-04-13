import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { projectStatusBadge } from '@/components/ui/Badge'
import { formatDate, formatZAR } from '@esite/shared'
import Link from 'next/link'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const projects = membership
    ? await projectService.list(supabase as any, membership.organisation_id)
    : []

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length !== 1 ? 's' : ''}`}
        actions={
          <Link href="/projects/new">
            <Button>+ New Project</Button>
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No projects yet"
          description="Create your first project to start tracking snags, RFIs, and compliance."
          action={
            <Link href="/projects/new">
              <Button>Create Project</Button>
            </Link>
          }
        />
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Client</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Value</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link href={`/projects/${project.id}`} className="text-white hover:text-blue-400 font-medium">
                      {project.name}
                    </Link>
                    {project.city && (
                      <p className="text-slate-500 text-xs">{project.city}{project.province ? `, ${project.province}` : ''}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">{projectStatusBadge(project.status)}</td>
                  <td className="px-4 py-3 text-slate-300">{project.client_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {project.contract_value ? formatZAR(project.contract_value) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(project.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
