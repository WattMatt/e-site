import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/Badge'
import CaptureForm from './CaptureForm'
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
  const [{ data: template }, { data: responsesRaw }, { data: { user } }] = await Promise.all([
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
    supabase.auth.getUser(),
  ])

  const verifierProfile = inspection.verifier_id
    ? (
        await supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('id', inspection.verifier_id)
          .single()
      ).data
    : null

  const responses = (responsesRaw ?? []) as InspectionResponse[]
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
            {verifierProfile && (
              <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                verifier: {verifierProfile.full_name ?? verifierProfile.email}
              </span>
            )}
          </div>
        </div>
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
          status={inspection.status}
          verifierId={inspection.verifier_id}
          currentUserId={user?.id ?? null}
          mode="capture"
          readOnly={false}
        />
      )}
    </div>
  )
}
