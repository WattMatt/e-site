import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { HandoverActions } from './HandoverActions'

const DEFAULT_ITEMS = [
  'All snags signed off',
  'COC issued and filed',
  'As-built drawings complete',
  'Client walkthrough completed',
  'Punch list cleared',
  'Warranties and manuals handed over',
  'Final invoice submitted',
  'Project photos archived',
]

interface Props { params: Promise<{ id: string }> }

export default async function HandoverPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = mem?.organisation_id ?? ''

  const [project, { data: rawItems }] = await Promise.all([
    projectService.getById(supabase as any, id).catch(() => null),
    supabase
      .schema('projects')
      .from('handover_checklist')
      .select('*, completed_by_profile:profiles!completed_by(id, full_name)')
      .eq('project_id', id)
      .order('sort_order'),
  ])

  if (!project) notFound()

  // Seed defaults if empty
  let items = rawItems ?? []
  if (items.length === 0) {
    const { data: seeded } = await supabase
      .schema('projects')
      .from('handover_checklist')
      .insert(
        DEFAULT_ITEMS.map((item, i) => ({
          project_id: id,
          organisation_id: orgId,
          item,
          sort_order: i,
        }))
      )
      .select('*, completed_by_profile:profiles!completed_by(id, full_name)')
    items = seeded ?? []
  }

  const total = items.length
  const done = items.filter((i: any) => i.is_complete).length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div>
      <div className="mb-4">
        <Link href={`/projects/${id}`} className="text-slate-400 hover:text-white text-sm">
          ← {project.name}
        </Link>
      </div>

      <PageHeader
        title="Handover Checklist"
        subtitle={`${done} / ${total} complete`}
      />

      {/* Progress bar */}
      <div className="mb-6 bg-slate-800 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: pct === 100 ? '#10B981' : pct >= 50 ? '#3B82F6' : '#F59E0B',
          }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardBody>
            <HandoverActions
              projectId={id}
              orgId={orgId}
              userId={user!.id}
              items={items as any}
            />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody>
              <div className="text-center">
                <p className="text-4xl font-bold text-white mb-1">{pct}%</p>
                <p className="text-sm text-slate-400">Completion</p>
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Complete</span>
                  <span className="text-green-400 font-medium">{done}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Remaining</span>
                  <span className="text-amber-400 font-medium">{total - done}</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {pct === 100 && (
            <Card>
              <CardBody>
                <div className="text-center">
                  <p className="text-3xl mb-2">🎉</p>
                  <p className="text-sm font-semibold text-green-400">All items complete!</p>
                  <p className="text-xs text-slate-400 mt-1">Project is ready for handover.</p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
