import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { RateLibraryForm } from './RateLibraryForm'

export const metadata: Metadata = { title: 'Cable schedule — rate library' }

export default async function RateLibraryPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/settings/cable-schedule/rates')

  // Get the user's primary org + role (mirrors the pattern used by
  // /settings/integrations/page.tsx).
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!membership) {
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
        <h1 className="page-title">Cable schedule — rate library</h1>
        <p style={{ color: 'var(--c-text-mid)' }}>
          You are not currently in an active organisation.
        </p>
      </div>
    )
  }

  const m = membership as { organisation_id: string; role: string }
  const canEdit = ['owner', 'admin', 'project_manager'].includes(m.role)

  // Load existing entries — RLS gates the read.
  const { data: entriesData } = await (supabase as any)
    .schema('cable_schedule')
    .from('rate_library')
    .select('id, size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each, notes, updated_at')
    .eq('organisation_id', m.organisation_id)
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
          href="/settings"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Settings
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Cable schedule — rate library</h1>
          <p className="page-subtitle">
            {entries.length} rate{entries.length !== 1 ? 's' : ''}
            {!canEdit && <> · read-only (your role: {m.role})</>}
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
        💡 Firm-wide rates. New cable-schedule revisions auto-seed their cost summary from these values. Per-revision cost tables remain editable for project-specific overrides — changes here only affect <strong style={{ color: 'var(--c-text)' }}>future</strong> revisions, not existing ones.
      </div>

      <RateLibraryForm
        organisationId={m.organisation_id}
        canEdit={canEdit}
        initialEntries={entries}
      />
    </div>
  )
}
