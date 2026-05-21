import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireRole, ROLES_ENGINEER } from '@/lib/cable-schedule/require-role'
import { RateLibraryForm } from './RateLibraryForm'

export const metadata: Metadata = { title: 'Cable schedule — project rate library' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectRateLibraryPage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/projects/${projectId}/cables/rates`)

  // Resolve the project + its organisation.
  const { data: projectRow } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, name, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!projectRow) redirect(`/projects/${projectId}/cables`)
  const project = projectRow as { id: string; name: string; organisation_id: string }

  // Admin gate — owner / admin / project_manager only. Field workers and
  // client viewers are bounced back to the cable schedule.
  const roleCheck = await requireRole(supabase, project.organisation_id, ROLES_ENGINEER)
  if (!roleCheck.ok) redirect(`/projects/${projectId}/cables`)

  // Load this project's rate library — RLS gates the read.
  const { data: entriesData } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('id, size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each, notes, updated_at')
    .eq('project_id', projectId)
    .order('size_mm2', { ascending: true })
    .order('conductor', { ascending: true })

  const entries = (entriesData ?? []) as Array<{
    id: string
    size_mm2: number
    conductor: 'CU' | 'AL'
    supply_rate_per_m: number
    install_rate_per_m: number
    termination_rate_each: number
    notes: string | null
    updated_at: string
  }>

  return (
    <div className="animate-fadeup" style={{ maxWidth: 960 }}>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Cable schedule · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Project rate library</h1>
          <p className="page-subtitle">
            {project.name} · {entries.length} rate{entries.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div style={{
        margin: '0 0 14px',
        padding: '10px 14px',
        borderLeft: '3px solid var(--c-accent, #e8923a)',
        background: 'var(--c-base, #f7f7f5)',
        fontSize: 12,
        color: 'var(--c-text-dim)',
        lineHeight: 1.5,
      }}>
        💡 Cable rates for this project. New cable-schedule revisions auto-seed their cost summary from these values. Per-revision cost tables stay editable for revision-specific overrides — changes here only affect <strong style={{ color: 'var(--c-text)' }}>future</strong> revisions, not existing ones.
      </div>

      <RateLibraryForm
        projectId={projectId}
        canEdit={true}
        initialEntries={entries}
      />
    </div>
  )
}
