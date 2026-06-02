import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listProjectMembersAction } from '@/actions/inspections.actions'
import { Badge } from '@/components/ui/Badge'
import CaptureForm from './CaptureForm'
import InspectionActions from './InspectionActions'
import AssignmentEditor from './AssignmentEditor'
import type { Template, Response as InspectionResponse } from '@esite/shared'

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
      'id, project_id, organisation_id, template_id, target_label, target_location, status, verifier_id, assigned_to_id, coc_number, scheduled_at',
    )
    .eq('id', inspectionId)
    .single()
  if (!inspection) notFound()

  // Cross-schema joins via PostgREST embeds are unreliable — batch them.
  // photos load only section_id+field_id (engine uses them for min_count enforcement).
  // Signatures intentionally omitted: inspections.signatures has `role` not
  // section_id/field_id — signature_required validation is enforced at certify time
  // via separate count of signatures-by-role. Wire signature attachments once a
  // future migration adds section_id+field_id to the signatures table.
  const [
    { data: template },
    { data: responsesRaw },
    { data: photosRaw },
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
  const verifierName = nameFrom(inspection.verifier_id)

  // Resolve the user's org-level role for showing danger-zone controls.
  const { data: orgRole } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .eq('organisation_id', inspection.organisation_id)
    .eq('is_active', true)
    .single()
  const userOrgRole = (orgRole as { role: string } | null)?.role ?? null
  const canEdit = ['owner', 'admin', 'project_manager'].includes(userOrgRole ?? '')
  const members = canEdit ? await listProjectMembersAction(projectId) : []

  const responses = (responsesRaw ?? []) as InspectionResponse[]
  const photos = (photosRaw ?? []) as { section_id: string; field_id: string }[]
  const templateJson = template?.schema_json as Template | undefined

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
          canEdit={canEdit}
        />
      </div>

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
          status={inspection.status}
          verifierId={inspection.verifier_id}
          currentUserId={user?.id ?? null}
          mode="capture"
          readOnly={false}
        />
      )}

      <InspectionActions
        inspectionId={inspectionId}
        projectId={projectId}
        status={inspection.status}
        role={userOrgRole}
      />
    </div>
  )
}
