import { type NextRequest, NextResponse } from 'next/server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { resolveBranding } from '@/lib/reports/branding'
import { renderBrandingPreview } from '@/lib/reports/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOGO_BUCKET = 'report-logos'
const ALL_PROJECT_ROLES = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
] as const

/**
 * Download a logo from the `report-logos` bucket and return it as a
 * `data:<mime>;base64,...` URI.  Returns null on any failure so the caller
 * can gracefully skip the logo rather than hard-failing the render.
 */
async function logoToDataUri(
  service: ReturnType<typeof createServiceClient>,
  storagePath: string,
): Promise<string | null> {
  try {
    const { data, error } = await service.storage
      .from(LOGO_BUCKET)
      .download(storagePath)
    if (error || !data) return null

    const arrayBuf = await data.arrayBuffer()
    const bytes = Buffer.from(arrayBuf)
    const mime = data.type || 'image/png'
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  // ── Auth: any project member may preview branding ──────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const roleGate = await requireEffectiveRole(supabase, projectId, ALL_PROJECT_ROLES)
  if (!roleGate.ok) {
    return NextResponse.json({ error: roleGate.error }, { status: 403 })
  }

  // ── Load project + org via service client ──────────────────────────────────
  const service = createServiceClient()

  const { data: project, error: projErr } = await (service as any)
    .schema('projects')
    .from('projects')
    .select('id, name, organisation_id, client_logo_url, project_logo_url, report_accent_color, status')
    .eq('id', projectId)
    .maybeSingle()

  if (projErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const { data: org } = await (service as any)
    .from('organisations')
    .select('id, name, logo_url, report_accent_color')
    .eq('id', project.organisation_id)
    .maybeSingle()

  // ── Resolve logos to data: URIs (download server-side) ────────────────────
  // react-pdf <Image> can fetch URLs but does so with no timeout and fails
  // silently.  Pass data: URIs to keep rendering deterministic.
  const [clientLogoSrc, projectMarkSrc] = await Promise.all([
    project.client_logo_url
      ? logoToDataUri(service, project.client_logo_url)
      : Promise.resolve(null),
    project.project_logo_url
      ? logoToDataUri(service, project.project_logo_url)
      : Promise.resolve(null),
  ])

  // Issuer (①) = org logo, if present.
  const orgLogoSrc = org?.logo_url
    ? await logoToDataUri(service, org.logo_url)
    : null

  // ── Build BrandingInput ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const input = {
    org: {
      name: org?.name ?? 'Organisation',
      logoSrc: orgLogoSrc ?? undefined,
      accent: org?.report_accent_color ?? null,
    },
    project: {
      name: project.name ?? 'Project',
      clientLogoSrc: clientLogoSrc ?? undefined,
      projectMarkSrc: projectMarkSrc ?? undefined,
      accent: project.report_accent_color ?? null,
      subtitle: project.status
        ? (project.status as string)
            .replace('_', ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
        : undefined,
    },
    // ④ Contractor has no context at the project-level preview — omit so the
    // parties strip simply drops that slot.
    contractor: null,
    kicker: 'ELECTRICAL INSPECTION',
    title: 'Branding Preview',
    date: today,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  let pdfBuffer: Buffer
  try {
    const resolved = resolveBranding(input)
    pdfBuffer = await renderBrandingPreview(resolved)
  } catch (err) {
    console.error('[branding-preview] render error', err)
    // TEMP DIAGNOSTIC (revert before merge): surface the real error so the
    // deployed failure can be diagnosed via the response (Vercel `logs` does
    // not stream function console output).
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    const stack =
      err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 10).join('\n') : ''
    return NextResponse.json({ error: 'PDF render failed', detail, stack }, { status: 500 })
  }

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="branding-preview.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
