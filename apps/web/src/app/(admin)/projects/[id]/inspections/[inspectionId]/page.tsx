import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listProjectMembersAction } from '@/actions/inspections.actions'
import { Badge } from '@/components/ui/Badge'
import CaptureForm from './CaptureForm'
import InspectionActions from './InspectionActions'
import AssignmentEditor from './AssignmentEditor'
import type { CapturedSignature } from './fields/photo-tally'
import StatusBanner from './StatusBanner'
import { requiresSeparateVerifier, type Template, type Response as InspectionResponse } from '@esite/shared'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Inspection' }

interface Props {
  params: Promise<{ id: string; inspectionId: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost'> = {
  assigned: 'ghost',
  in_progress: 'info',
  awaiting_verification: 'warning',
  certified: 'success',
  're-inspect_required': 'warning',
  abandoned: 'ghost',
}

export default async function CapturePage({ params }: Props) {
  const { id: projectId, inspectionId } = await params
  const supabase = (await createClient()) as AnyClient

  // Inspection row.
  const { data: inspection } = await supabase
    .schema('inspections')
    .from('inspections')
    .select(
      'id, project_id, organisation_id, template_id, target_label, target_location, status, verifier_id, assigned_to_id, coc_number, scheduled_at, completed_at, certified_at, reinspection_notes, abandoned_reason',
    )
    .eq('id', inspectionId)
    .single()
  if (!inspection) notFound()

  // Cross-schema joins via PostgREST embeds are unreliable — batch them.
  // Photos and signatures load by section_id+field_id: the engine counts them as the answer to
  // their field (section progress, required checks). Signatures were left out before, so a
  // required signature field could never count as done and blocked Submit.
  const [
    { data: template },
    { data: responsesRaw },
    { data: photosRaw },
    { data: signaturesRaw },
    { data: { user } },
  ] = await Promise.all([
    supabase
      .schema('inspections')
      .from('templates')
      .select('id, name, version, deliverable_type, schema_json')
      .eq('id', inspection.template_id)
      .single(),
    supabase
      .schema('inspections')
      .from('responses')
      .select(
        'section_id, field_id, value_bool, value_number, value_text, value_array, value_json, pass_state, fail_reason',
      )
      .eq('inspection_id', inspectionId),
    supabase
      .schema('inspections')
      .from('photos')
      .select('section_id, field_id')
      .eq('inspection_id', inspectionId),
    supabase
      .schema('inspections')
      .from('signatures')
      .select('section_id, field_id, signatory_name, signed_at')
      .eq('inspection_id', inspectionId),
    supabase.auth.getUser(),
  ])

  // Resolve assignee + verifier display names via the service client — the
  // RLS cookie client can't read other users' profiles (00009). The inspection
  // read above is RLS-gated, so a returned row already proves project access.
  const service = createServiceClient() as AnyClient
  const assigneeIds = [inspection.assigned_to_id, inspection.verifier_id].filter(
    (v): v is string => Boolean(v),
  )
  const { data: people } = assigneeIds.length
    ? await service.from('profiles').select('id, full_name, email').in('id', assigneeIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }
  const peopleMap = new Map(
    ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [
      p.id,
      p,
    ]),
  )
  const nameFrom = (uid: string | null) => {
    if (!uid) return null
    const p = peopleMap.get(uid)
    return p ? p.full_name ?? p.email ?? uid.slice(0, 8) : uid.slice(0, 8)
  }
  const assigneeName = nameFrom(inspection.assigned_to_id)

  // Who has entered answers: on a separate-verifier template none of them may verify (00248).
  // Read with the service client because response_history is not readable to every member; the
  // RLS-gated inspection read above already proves access.
  const { data: historyRows } = await service
    .schema('inspections')
    .from('response_history')
    .select('responded_by')
    .eq('inspection_id', inspectionId)
  const contributorIds = [
    ...new Set(((historyRows ?? []) as Array<{ responded_by: string | null }>).map((h) => h.responded_by).filter((v): v is string => !!v)),
  ]
  const verifierName = nameFrom(inspection.verifier_id)

  // The user's EFFECTIVE role on this project (a member promoted to project_manager counts), which
  // is what the transition guard (00235) applies to reassigning and abandoning.
  const { data: effectiveRole } = user
    ? await supabase.rpc('user_effective_project_role', { p_project_id: projectId, p_user_id: user.id })
    : { data: null }
  const userRole = (effectiveRole as string | null) ?? null
  const canEdit = ['owner', 'admin', 'project_manager'].includes(userRole ?? '')
  const members = canEdit ? await listProjectMembersAction(projectId) : []

  const responses = (responsesRaw ?? []) as InspectionResponse[]
  const photos = (photosRaw ?? []) as { section_id: string; field_id: string }[]
  const signatures = ((signaturesRaw ?? []) as CapturedSignature[]).filter((x) => x.section_id && x.field_id)
  const templateJson = template?.schema_json as Template | undefined
  const separateVerifier = requiresSeparateVerifier(
    template?.deliverable_type,
    (template?.schema_json as { requires_separate_verifier?: unknown } | undefined)?.requires_separate_verifier,
  )
  const isOpen = !['certified', 'abandoned'].includes(inspection.status)
  const isVerifier = !!user && inspection.verifier_id === user.id

  return (
    <div className="animate-fadeup" style={{ maxWidth: 1280 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/inspections`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Inspections
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{inspection.target_label}</h1>
          <p className="page-subtitle">
            {template?.name ?? 'Template unavailable'}
            {template?.version ? ` · v${template.version}` : ''}
            {inspection.target_location ? ` · ${inspection.target_location}` : ''}
          </p>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={STATUS_VARIANT[inspection.status] ?? 'default'}>
              {inspection.status.replace(/_/g, ' ')}
            </Badge>
            {inspection.coc_number && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--c-text-mid)',
                }}
              >
                {inspection.coc_number}
              </span>
            )}
          </div>
        </div>
        {/* The report is available at every stage: a preview while open, the issued certificate once
            certified. No page linked to either before (2026-10-12). */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            href={`/api/projects/${projectId}/inspections/${inspectionId}/report-preview`}
            target="_blank"
            rel="noopener"
            className="btn-primary-amber"
            style={{ textDecoration: 'none', background: 'transparent', color: 'var(--c-amber)', border: '1px solid var(--c-amber)' }}
          >
            {inspection.status === 'certified' ? 'Report (live preview)' : 'Preview report'}
          </a>
          {inspection.status === 'certified' && (
            <Link href={`/projects/${projectId}/inspections/${inspectionId}/report`} className="btn-primary-amber" style={{ textDecoration: 'none' }}>
              View certificate
            </Link>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <AssignmentEditor
          inspectionId={inspectionId}
          projectId={projectId}
          organisationId={inspection.organisation_id}
          assignedToId={inspection.assigned_to_id}
          verifierId={inspection.verifier_id}
          assigneeName={assigneeName}
          verifierName={verifierName}
          members={members}
          canEdit={canEdit && isOpen}
          separateVerifier={separateVerifier}
          contributorIds={contributorIds}
        />
      </div>

      <StatusBanner
        status={inspection.status}
        assigneeName={assigneeName}
        verifierName={verifierName}
        isVerifier={isVerifier}
        canReassign={canEdit && isOpen}
        separateVerifier={separateVerifier}
        verifierHasAnswered={!!inspection.verifier_id && contributorIds.includes(inspection.verifier_id)}
        completedAt={inspection.completed_at ?? null}
        certifiedAt={inspection.certified_at ?? null}
        cocNumber={inspection.coc_number ?? null}
        reinspectionNotes={inspection.reinspection_notes ?? null}
        abandonedReason={inspection.abandoned_reason ?? null}
      />

      {!templateJson ? (
        <div
          style={{
            padding: 16,
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            color: 'var(--c-text-dim)',
            fontSize: 13,
          }}
        >
          Template payload not found. The template may have been deprecated.
        </div>
      ) : (
        <CaptureForm
          inspectionId={inspectionId}
          projectId={projectId}
          template={templateJson}
          initialResponses={responses}
          initialPhotos={photos}
          initialSignatures={signatures}
          status={inspection.status}
          verifierId={inspection.verifier_id}
          separateVerifier={separateVerifier}
          currentUserId={user?.id ?? null}
          mode="capture"
          // The verifier of a separate-verifier inspection checks it; the database refuses their
          // answers and photos (00248), so the form does not offer them.
          readOnly={isVerifier && separateVerifier}
        />
      )}

      <InspectionActions
        inspectionId={inspectionId}
        projectId={projectId}
        status={inspection.status}
        role={userRole}
      />
    </div>
  )
}
