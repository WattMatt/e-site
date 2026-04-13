import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { priorityBadge } from '@/components/ui/Badge'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@esite/shared'
import Link from 'next/link'

export default async function RfisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const { data: rfis } = membership
    ? await supabase
        .schema('projects')
        .from('rfis')
        .select(`
          *,
          raised_by_profile:profiles!raised_by(id, full_name),
          project:projects!project_id(id, name)
        `)
        .eq('organisation_id', membership.organisation_id)
        .order('created_at', { ascending: false })
    : { data: [] }

  const RFI_STATUS_VARIANT: Record<string, any> = {
    draft: 'ghost', open: 'danger', responded: 'warning', closed: 'success'
  }

  return (
    <div>
      <PageHeader title="RFIs" subtitle={`${rfis?.length ?? 0} requests`} />

      {!rfis?.length ? (
        <EmptyState icon="❓" title="No RFIs yet" description="Requests for information raised on projects will appear here." />
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Subject</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Project</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Priority</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Raised</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {rfis.map((rfi) => (
                <tr key={rfi.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/rfis/${rfi.id}`} className="text-white hover:text-blue-400 font-medium">
                      {rfi.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/projects/${(rfi as any).project?.id}`} className="text-slate-300 hover:text-blue-400 text-xs">
                      {(rfi as any).project?.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{priorityBadge(rfi.priority)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={RFI_STATUS_VARIANT[rfi.status]}>{rfi.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{formatDate(rfi.created_at)}</td>
                  <td className="px-4 py-3 text-slate-400">{rfi.due_date ? formatDate(rfi.due_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
