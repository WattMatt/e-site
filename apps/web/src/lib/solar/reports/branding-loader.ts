import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolarBrandingData } from './branding'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const LOGO_BUCKET = 'report-logos'

async function toDataUri(svc: AnyClient, path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await svc.storage.from(LOGO_BUCKET).download(path)
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Branding inputs for a project. `svc` is the service client; the CALLER has already gated. */
export async function loadSolarBrandingData(svc: AnyClient, projectId: string): Promise<SolarBrandingData> {
  const { data: p } = await svc.schema('projects').from('projects')
    .select('name, organisation_id, client_logo_url, report_accent_color').eq('id', projectId).maybeSingle()
  const proj = (p ?? {}) as { name?: string; organisation_id?: string; client_logo_url?: string | null; report_accent_color?: string | null }
  const { data: o } = proj.organisation_id
    ? await svc.from('organisations').select('name, logo_url, report_accent_color').eq('id', proj.organisation_id).maybeSingle()
    : { data: null }
  const org = (o ?? {}) as { name?: string; logo_url?: string | null; report_accent_color?: string | null }
  const [orgLogoDataUri, clientLogoDataUri] = await Promise.all([toDataUri(svc, org.logo_url), toDataUri(svc, proj.client_logo_url)])
  return {
    orgName: org.name?.trim() || 'Organisation',
    orgLogoDataUri, clientLogoDataUri,
    orgAccent: org.report_accent_color ?? null,
    projectAccent: proj.report_accent_color ?? null,
    projectName: proj.name ?? '',
  }
}
