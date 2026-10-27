import { evaluateInspection, type Template, type Response as InspectionResponse } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Why an inspection may not be submitted yet, or null when it is complete.
 *
 * The capture page runs the same check in the browser, but that only stops a Submit pressed on
 * the page: the server action took any submit as complete, so a stale tab or a direct call could
 * send an inspection with required answers, photos or signatures missing to the verifier.
 * Reads through the caller's session, so RLS decides what counts.
 */
export async function submitBlocker(supabase: AnyClient, inspectionId: string): Promise<string | null> {
  const db = supabase.schema('inspections')
  const { data: insp } = await db.from('inspections').select('template_id').eq('id', inspectionId).maybeSingle()
  if (!insp) return 'Inspection not found.'

  const [{ data: tpl }, { data: responses }, { data: photos }, { data: signatures }] = await Promise.all([
    db.from('templates').select('schema_json').eq('id', insp.template_id).maybeSingle(),
    db
      .from('responses')
      .select('section_id, field_id, value_bool, value_number, value_text, value_array, value_json, pass_state, fail_reason')
      .eq('inspection_id', inspectionId),
    db.from('photos').select('section_id, field_id').eq('inspection_id', inspectionId),
    db.from('signatures').select('section_id, field_id').eq('inspection_id', inspectionId),
  ])
  const template = tpl?.schema_json as Template | undefined
  if (!template?.sections) return 'The template for this inspection could not be loaded.'

  const result = evaluateInspection(template, (responses ?? []) as InspectionResponse[], {
    photos: (photos ?? []) as { section_id: string; field_id: string }[],
    signatures: (signatures ?? []) as { section_id?: string; field_id?: string }[],
  })
  if (result.missingRequired.length === 0) return null

  const n = result.missingRequired.length
  const first = result.missingRequired[0]
  const where = template.sections.find((s) => s.section_id === first.sectionId)?.title ?? first.sectionId
  return `${n} required ${n === 1 ? 'item is' : 'items are'} still missing. The first is in "${where}". Complete ${n === 1 ? 'it' : 'them'} and submit again.`
}
