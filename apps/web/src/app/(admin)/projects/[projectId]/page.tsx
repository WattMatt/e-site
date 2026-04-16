/**
 * Project detail page
 *
 * Shows: project header, KPIs (snags, COCs, diary entries, members),
 * recent snags, recent diary entries, and project team.
 */

import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/layout/Header'
import { snagPriorityBadge, snagStatusBadge, projectStatusBadge } from '@/components/ui/Badge'
import { formatDate, formatZAR } from '@esite/shared'

interface Props {
  params: Promise<{ projectId: string }>
}

export default async function ProjectDetailPage({ params }: Props) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Fetch project ─────────────────────────────────────────────────────────
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select(`
      id, name, description, address, city, province,
      status, start_date, end_date, contract_value,
      client_name, client_contact, created_at, organisation_id,
      project_members (
        user_id, role,
        profiles:user_id ( full_name, email, avatar_url )
      )
    `)
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [snagResult, diaryResult, cocResult] = await Promise.all([
    // Recent open snags
    (supabase as any)
      .schema('field')
      .from('snags')
      .select('id, title, priority, status, created_at, assigned_to, profiles:assigned_to(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(8),

    // Recent diary entries
    (supabase as any)
      .schema('projects')
      .from('site_diary_entries')
      .select('id, date, entry_type, progress_notes, safety_notes, workforce_count, created_by, profiles:created_by(full_name)')
      .eq('project_id', projectId)
      .order('date', { ascending: false })
      .limit(5),

    // COC status counts for this project's sites
    (supabase as any)
      .schema('compliance')
      .from('subsections')
      .select('coc_status')
      .eq('organisation_id', project.organisation_id),
  ])

  const snags: any[] = snagResult.data ?? []
  const diaryEntries: any[] = diaryResult.data ?? []
  const subsections: any[] = cocResult.data ?? []

  // KPI calculations
  const openSnags = snags.filter(s => ['open', 'in_progress'].includes(s.status)).length
  const resolvedSnags = snags.filter(s => ['resolved', 'signed_off', 'closed'].includes(s.status)).length
  const criticalSnags = snags.filter(s => s.priority === 'critical' && s.status === 'open').length

  const approvedCocs = subsections.filter(s => s.coc_status === 'approved').length
  const pendingCocs = subsections.filter(s => ['submitted', 'under_review'].includes(s.coc_status)).length
  const totalCocs = subsections.length
  const cocScore = totalCocs > 0 ? Math.round((approvedCocs / totalCocs) * 100) : 0

  const members: any[] = project.project_members ?? []

  // Deadline proximity
  const today = new Date()
  const endDate = project.end_date ? new Date(project.end_date) : null
  const daysUntilEnd = endDate
    ? Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null

  const ENTRY_TYPE_COLORS: Record<string, string> = {
    progress: 'text-blue-400',
    safety: 'text-red-400',
    quality: 'text-purple-400',
    delay: 'text-amber-400',
    weather: 'text-sky-400',
    workforce: 'text-emerald-400',
    general: 'text-slate-400',
  }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        title={project.name}
        subtitle={
          [project.city, project.province].filter(Boolean).join(', ') ||
          project.address ||
          undefined
        }
        actions={
          <div className="flex gap-2">
            <Link href="/projects">
              <Button variant="ghost">← Projects</Button>
            </Link>
            <Link href={`/snags/new?projectId=${projectId}`}>
              <Button variant="secondary">Log Snag</Button>
            </Link>
            <Link href={`/diary?projectId=${projectId}`}>
              <Button>+ Diary Entry</Button>
            </Link>
          </div>
        }
      />

      {/* ── Meta strip ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 text-sm text-slate-400">
        <span>{projectStatusBadge(project.status)}</span>
        {project.client_name && <span>Client: <span className="text-slate-200">{project.client_name}</span></span>}
        {project.contract_value && <span>Value: <span className="text-slate-200">{formatZAR(project.contract_value)}</span></span>}
        {project.start_date && <span>Start: <span className="text-slate-200">{formatDate(project.start_date)}</span></span>}
        {endDate && (
          <span>
            End: <span className={
              daysUntilEnd !== null && daysUntilEnd <= 7 ? 'text-red-400 font-medium' :
              daysUntilEnd !== null && daysUntilEnd <= 14 ? 'text-amber-400' :
              'text-slate-200'
            }>
              {formatDate(project.end_date!)}
              {daysUntilEnd !== null && daysUntilEnd >= 0 && ` (${daysUntilEnd}d)`}
              {daysUntilEnd !== null && daysUntilEnd < 0 && ' (overdue)'}
            </span>
          </span>
        )}
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`bg-slate-800 border rounded-xl p-4 ${openSnags > 0 ? 'border-red-800' : 'border-slate-700'}`}>
          <p className={`text-3xl font-bold ${openSnags > 0 ? 'text-red-400' : 'text-white'}`}>{openSnags}</p>
          <p className="text-xs text-slate-400 mt-1">Open Snags</p>
          {criticalSnags > 0 && <p className="text-xs text-red-400 mt-1">{criticalSnags} critical</p>}
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-3xl font-bold text-emerald-400">{resolvedSnags}</p>
          <p className="text-xs text-slate-400 mt-1">Resolved</p>
        </div>
        <div className={`bg-slate-800 border rounded-xl p-4 ${pendingCocs > 0 ? 'border-amber-800' : 'border-slate-700'}`}>
          <p className={`text-3xl font-bold ${cocScore === 100 ? 'text-emerald-400' : cocScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {cocScore}%
          </p>
          <p className="text-xs text-slate-400 mt-1">COC Score</p>
          <p className="text-xs text-slate-500 mt-1">{approvedCocs}/{totalCocs} approved</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <p className="text-3xl font-bold text-white">{diaryEntries.length}</p>
          <p className="text-xs text-slate-400 mt-1">Diary Entries</p>
          <p className="text-xs text-slate-500 mt-1">recent</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Snags ─────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="font-semibold text-white">Snags</h2>
            <Link href={`/snags?projectId=${projectId}`} className="text-xs text-blue-400 hover:text-blue-300">
              See all →
            </Link>
          </div>
          {snags.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-500 text-sm">No snags logged yet.</div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {snags.map((snag) => (
                <Link
                  key={snag.id}
                  href={`/snags/${snag.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-700/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{snag.title}</p>
                    {snag.profiles?.full_name && (
                      <p className="text-xs text-slate-500 mt-0.5">→ {snag.profiles.full_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {snagPriorityBadge(snag.priority)}
                    {snagStatusBadge(snag.status)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Right column: diary + team ─────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          {/* Diary entries */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="font-semibold text-white">Site Diary</h2>
              <Link href={`/diary?projectId=${projectId}`} className="text-xs text-blue-400 hover:text-blue-300">
                See all →
              </Link>
            </div>
            {diaryEntries.length === 0 ? (
              <div className="px-5 py-6 text-center text-slate-500 text-sm">No diary entries.</div>
            ) : (
              <div className="divide-y divide-slate-700/50">
                {diaryEntries.map((entry) => (
                  <div key={entry.id} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-medium capitalize ${ENTRY_TYPE_COLORS[entry.entry_type] ?? 'text-slate-400'}`}>
                        {entry.entry_type}
                      </span>
                      <span className="text-xs text-slate-500">{formatDate(entry.date)}</span>
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-2">
                      {entry.progress_notes || entry.safety_notes || 'No notes.'}
                    </p>
                    {entry.workforce_count != null && (
                      <p className="text-xs text-slate-500 mt-1">{entry.workforce_count} workers on site</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Project team */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700">
              <h2 className="font-semibold text-white">Team ({members.length})</h2>
            </div>
            {members.length === 0 ? (
              <div className="px-5 py-6 text-center text-slate-500 text-sm">No members added.</div>
            ) : (
              <div className="divide-y divide-slate-700/50">
                {members.map((m: any) => (
                  <div key={m.user_id} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-xs text-slate-300 flex-shrink-0">
                      {m.profiles?.full_name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{m.profiles?.full_name ?? 'Unknown'}</p>
                      <p className="text-xs text-slate-500 capitalize">{m.role?.replace('_', ' ')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Description ─────────────────────────────────────────────────── */}
      {project.description && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h2 className="font-semibold text-white mb-2">Description</h2>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{project.description}</p>
        </div>
      )}
    </div>
  )
}
