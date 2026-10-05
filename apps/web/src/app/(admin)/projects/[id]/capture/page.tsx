import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { BookOpen, AlertTriangle, FileText, ClipboardCheck, Camera, Lock } from 'lucide-react'
import { ORG_ROLES, projectService, type OrgRole } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { hasFeature } from '@/lib/features'
import { captureActions, orgRoleCanAssignInspection, type CaptureKey } from '@/lib/capture/capture-actions'

export const metadata: Metadata = { title: 'Capture' }

interface Props {
  params: Promise<{ id: string }>
}

const ICONS: Record<CaptureKey, typeof BookOpen> = {
  diary: BookOpen,
  snag: AlertTriangle,
  form: FileText,
  inspection: ClipboardCheck,
  photo: Camera,
}

/**
 * The single in-project capture entry (E1). Reached from the project sidebar's
 * "Capture" item or the overview header, so every action below is two taps
 * from anywhere inside a project. Tiles are filtered by the caller's effective
 * project role (lib/capture/capture-actions.ts); each target re-gates itself.
 */
export default async function ProjectCapturePage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project = await projectService.getById(supabase as any, id).catch(() => null)
  if (!project) notFound()

  const orgId = (project.organisation_id as string | null) ?? null
  const gate = await requireEffectiveRole(supabase, id, ORG_ROLES)
  const role = gate.ok ? gate.role : null

  // Inspections are assigned by createInspectionAction, which checks the ORG
  // role (requirePmOrAbove), not the effective project role — so the tile reads
  // the caller's role in the project's own organisation.
  const { data: { user } } = await supabase.auth.getUser()
  const [inspectionsUnlocked, orgRoleRow] = await Promise.all([
    orgId ? hasFeature(orgId, 'inspections', supabase) : Promise.resolve(false),
    orgId && user
      ? supabase
          .from('user_organisations')
          .select('role')
          .eq('user_id', user.id)
          .eq('organisation_id', orgId)
          .eq('is_active', true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const orgRole = ((orgRoleRow as { data: { role: OrgRole } | null }).data?.role ?? null)
  const actions = captureActions(id, role, {
    inspectionsUnlocked,
    canAssignInspection: orgRoleCanAssignInspection(orgRole),
  })

  return (
    <div className="animate-fadeup" style={{ maxWidth: 880 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${id}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Capture</h1>
          <p className="page-subtitle">Record something on site for {project.name}.</p>
        </div>
      </div>

      {actions.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '40px 18px' }}>
            {role === null
              ? 'You are not on this project’s team yet, so there is nothing to capture here. Ask a project manager to add you.'
              : 'Your role on this project is read-only, so there is nothing to capture here.'}
          </div>
        </div>
      ) : (
        <ul
          aria-label="Capture actions"
          style={{
            listStyle: 'none', margin: 0, padding: 0,
            display: 'grid', gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          }}
        >
          {actions.map(({ key, label, description, href, locked }) => {
            const Icon = ICONS[key]
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-label={locked ? `${label} (locked)` : label}
                  aria-describedby={`capture-${key}-desc`}
                  className="data-panel"
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                    padding: '18px 18px', minHeight: 88, textDecoration: 'none',
                    color: 'var(--c-text)', opacity: locked ? 0.75 : 1,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--c-amber-dim)', color: 'var(--c-amber)',
                    }}
                  >
                    <Icon size={20} />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {label}
                      {locked && <Lock size={12} aria-hidden="true" />}
                    </span>
                    <span id={`capture-${key}-desc`} style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                      {locked ? 'Inspections are not unlocked for this organisation.' : description}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
