// apps/mobile/src/inspections/inspection-remote.ts
//
// Every Supabase read and write the native inspection path makes, as the
// signed-in user (RLS applies). Writes mirror the web server actions exactly:
//   * answers   → upsert on (inspection_id, section_id, field_id), as
//                 apps/web/src/actions/inspections.actions.ts upsertResponseAction;
//   * submit    → UPDATE of status + completed_at only, from in_progress or
//                 re-inspect_required, as submitInspectionAction. The DB status
//                 guard refuses a contributor update that touches any other
//                 column, so never widen this payload.
//
// The `inspections` schema is not in the generated Database types, so the
// client is taken structurally.

import type { OutboxRemote, RemoteError } from './response-outbox'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any
export interface SchemaClient {
  schema(name: string): { from(table: string): QueryBuilder }
}

type Raw = { data: unknown; error: { message: string; code?: string } | null; status: number }

export const SUBMITTABLE_STATUSES = ['in_progress', 're-inspect_required'] as const

export interface InspectionListRow {
  id: string
  target_label: string | null
  status: string
  coc_number: string | null
  scheduled_at: string | null
  updated_at: string | null
}

export interface CaptureBundle {
  inspection: { id: string; template_id: string; target_label: string | null; status: string; project_id: string }
  template: { id: string; name: string; schema_json: unknown } | null
  responses: Array<Record<string, unknown> & { section_id: string; field_id: string }>
  photos: Array<{ section_id: string; field_id: string }>
}

export interface InspectionRemote extends OutboxRemote {
  listInspections(opts: { assignedTo?: string }): Promise<InspectionListRow[]>
  loadCaptureBundle(inspectionId: string): Promise<CaptureBundle | null>
  projectIdFor(inspectionId: string): Promise<string | null>
}

function asError(r: Raw): RemoteError {
  return { message: r.error!.message, code: r.error!.code, status: r.status }
}

function orThrow<T>(r: Raw): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export function createInspectionRemote(client: SchemaClient): InspectionRemote {
  const t = (table: string) => client.schema('inspections').from(table)

  return {
    async upsertResponse(i) {
      const r: Raw = await t('responses').upsert(
        {
          inspection_id: i.inspectionId,
          section_id: i.sectionId,
          field_id: i.fieldId,
          ...i.values,
          latest_responded_by: i.respondedBy,
          latest_responded_at: i.respondedAt,
        },
        { onConflict: 'inspection_id,section_id,field_id' },
      )
      return r.error ? asError(r) : null
    },

    async submitInspection(i) {
      const r: Raw = await t('inspections')
        .update({ status: 'awaiting_verification', completed_at: i.completedAt })
        .eq('id', i.inspectionId)
        .in('status', [...SUBMITTABLE_STATUSES])
        .select('id')
      if (r.error) return asError(r)
      if (Array.isArray(r.data) && r.data.length > 0) return null

      // Nothing updated: find out why, so the user gets a sentence, not silence.
      const cur: Raw = await t('inspections').select('status').eq('id', i.inspectionId).maybeSingle()
      if (cur.error) return asError(cur)
      const status = (cur.data as { status?: string } | null)?.status
      if (!status) return { status: 404, message: 'This inspection no longer exists or is no longer visible to you.' }
      if (status === 'awaiting_verification' || status === 'certified') return null // already submitted
      return {
        status: 409,
        message: `Not submitted: the inspection is "${status}". It can only be submitted while in progress or after a re-inspection is requested.`,
      }
    },

    async listInspections({ assignedTo }) {
      let q = t('inspections')
        .select('id, target_label, status, coc_number, scheduled_at, updated_at')
        .not('status', 'in', '(certified,abandoned)')
      if (assignedTo) q = q.eq('assigned_to_id', assignedTo)
      const r: Raw = await q.order('updated_at', { ascending: false }).limit(100)
      return orThrow<InspectionListRow[]>(r) ?? []
    },

    async loadCaptureBundle(inspectionId) {
      const ir: Raw = await t('inspections')
        .select('id, template_id, target_label, status, project_id')
        .eq('id', inspectionId)
        .maybeSingle()
      const inspection = orThrow<CaptureBundle['inspection'] | null>(ir)
      if (!inspection) return null

      const tr: Raw = await t('templates').select('id, name, schema_json').eq('id', inspection.template_id).maybeSingle()
      const rr: Raw = await t('responses')
        .select('section_id, field_id, value_bool, value_number, value_text, value_array, value_json, pass_state, fail_reason')
        .eq('inspection_id', inspectionId)
      const pr: Raw = await t('photos').select('section_id, field_id').eq('inspection_id', inspectionId)

      return {
        inspection,
        template: orThrow<CaptureBundle['template']>(tr),
        responses: orThrow<CaptureBundle['responses']>(rr) ?? [],
        photos: orThrow<CaptureBundle['photos']>(pr) ?? [],
      }
    },

    async projectIdFor(inspectionId) {
      const r: Raw = await t('inspections').select('project_id').eq('id', inspectionId).maybeSingle()
      return orThrow<{ project_id: string } | null>(r)?.project_id ?? null
    },
  }
}
