/**
 * Loads the full data graph required to render an inspection PDF: the
 * inspection row, its template, project, responses, response history,
 * photos (with signed URLs), signatures (with signed URLs), contributor
 * profiles, and the verifier profile.
 *
 * Cross-schema joins via PostgREST embeds are unreliable when the related
 * table lives in a different schema (e.g. `inspections.inspections`
 * referencing `public.profiles`), so we batch each lookup separately.
 *
 * Signed URLs are issued with a 1-hour expiry — long enough for the
 * renderer to fetch them inline, short enough that they expire before any
 * accidental log leakage becomes useful.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface InspectionPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inspection: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  project: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responses: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseHistory: any[]
  photos: {
    id: string
    section_id: string
    field_id: string
    signed_url: string
    caption?: string
    gps_lat?: number
    gps_lng?: number
    taken_at?: string
    captured_by_profile_id?: string | null
    file_size_bytes?: number | null
  }[]
  capturedByLookup: Map<string, string>
  signatures: {
    id: string
    role: string
    signatory_name: string
    signatory_title?: string
    registration_number?: string
    signed_url: string
    signed_at: string
  }[]
  contributors: { id: string; full_name: string | null; email: string | null }[]
  verifier: { full_name: string | null; email: string | null } | null
}

export async function loadInspectionPayload(
  supabase: AnyClient,
  inspectionId: string,
): Promise<InspectionPayload> {
  const { data: inspection, error: ie } = await supabase
    .schema('inspections')
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .single()
  if (ie || !inspection) throw new Error(`Inspection ${inspectionId} not found`)

  const { data: template } = await supabase
    .schema('inspections')
    .from('templates')
    .select('*')
    .eq('id', inspection.template_id)
    .single()

  const { data: project } = await supabase
    .schema('projects')
    .from('projects')
    .select('id, name, code, organisation_id')
    .eq('id', inspection.project_id)
    .single()

  const { data: responses } = await supabase
    .schema('inspections')
    .from('responses')
    .select('*')
    .eq('inspection_id', inspectionId)

  const { data: responseHistory } = await supabase
    .schema('inspections')
    .from('response_history')
    .select('*')
    .eq('inspection_id', inspectionId)
    .order('responded_at')

  const { data: photoRows } = await supabase
    .schema('inspections')
    .from('photos')
    .select('id, section_id, field_id, storage_path, caption, gps_lat, gps_lng, taken_at, captured_by_profile_id, file_size_bytes')
    .eq('inspection_id', inspectionId)
  const photos = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((photoRows ?? []) as any[]).map(async (p: any) => {
      const { data: sig } = await supabase.storage
        .from('inspection-photos')
        .createSignedUrl(p.storage_path, 3600)
      return { ...p, signed_url: sig?.signedUrl ?? '' }
    }),
  )

  // Build capturedByLookup: batch-fetch profiles for unique captured_by_profile_id values.
  // Avoids PostgREST cross-schema embed (PGRST200 risk) — same pattern as cable-schedule
  // export-payload.ts batched profile lookup.
  const capturedByIds = Array.from(
    new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      photos.map((ph: any) => ph.captured_by_profile_id).filter((id: string | null) => !!id),
    ),
  ) as string[]
  const capturedByLookup = new Map<string, string>()
  if (capturedByIds.length > 0) {
    const { data: capturedProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', capturedByIds)
    for (const prof of (capturedProfiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (prof.full_name) capturedByLookup.set(prof.id, prof.full_name)
    }
  }

  const { data: sigRows } = await supabase
    .schema('inspections')
    .from('signatures')
    .select(
      'id, role, signatory_name, signatory_title, registration_number, storage_path, signed_at',
    )
    .eq('inspection_id', inspectionId)
  const signatures = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((sigRows ?? []) as any[]).map(async (s: any) => {
      const { data: sig } = await supabase.storage
        .from('inspection-signatures')
        .createSignedUrl(s.storage_path, 3600)
      return { ...s, signed_url: sig?.signedUrl ?? '' }
    }),
  )

  // Distinct contributors from response_history → public.profiles batched.
  const contributorIds = Array.from(
    new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((responseHistory ?? []) as any[])
        .map((h: any) => h.responded_by)
        .filter((id: string | null) => !!id),
    ),
  )
  let contributors: InspectionPayload['contributors'] = []
  if (contributorIds.length > 0) {
    const { data: contribProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', contributorIds)
    contributors = (contribProfiles ?? []) as InspectionPayload['contributors']
  }

  let verifier: InspectionPayload['verifier'] = null
  if (inspection.verifier_id) {
    const { data: v } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', inspection.verifier_id)
      .single()
    verifier = (v ?? null) as InspectionPayload['verifier']
  }

  return {
    inspection,
    template,
    project,
    responses: responses ?? [],
    responseHistory: responseHistory ?? [],
    photos,
    signatures,
    contributors,
    verifier,
    capturedByLookup,
  }
}

// Re-export createClient so callers don't need a second import line.
export { createClient }
