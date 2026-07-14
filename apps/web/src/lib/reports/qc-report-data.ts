/**
 * qc-report-data.ts
 *
 * Pure data-gathering layer for the Quality Control Report.
 * Mirrors the pattern established in snag-visit-report-data.ts:
 *   - Visibility gate = cookie-client (RLS) read of the qc_reports row —
 *     client viewers never see drafts (migration 00172) — plus
 *     requireEffectiveRole over the full project-roles set
 *   - All other DB reads via createServiceClient (bypasses RLS, resolves names)
 *   - All photos fetched as data: URIs (never pass signed URLs to react-pdf)
 *   - resolveBranding for the branded cover
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { compareQcPhotos } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { resolveBranding, type ResolvedBranding } from './branding'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QcReportPhotoData {
  id: string
  /**
   * 1-based position within the entry's FULL photo list (pre-cap) — per-photo
   * comments reference "Photo N", so numbering must stay stable even when a
   * photo is omitted by the cap or its download fails.
   */
  index: number
  dataUri: string
  caption: string | null
  kind: 'photo' | 'markup'
  /** Source floor-plan name for markups (null for plain photos or deleted plans). */
  planName: string | null
}

export interface QcReportCommentData {
  id: string
  authorName: string | null
  createdAt: string
  body: string
  /** 1-based index of the referenced photo; null = comment on the whole entry. */
  photoIndex: number | null
}

export interface QcReportEntryData {
  id: string
  /** 1-based position within the report (sort_order sequence). */
  number: number
  title: string
  description: string | null
  photos: QcReportPhotoData[]
  omittedCount: number
  comments: QcReportCommentData[]
}

export interface QcReportData {
  /** Resolved branding for the Cover */
  branding: ResolvedBranding

  report: {
    id: string
    reportNo: number
    title: string
    description: string | null
    location: string | null
    inspectionDate: string | null
    status: string
    raisedByName: string | null
    issuedAt: string | null
    issuedByName: string | null
  }

  /** Project name (used in cover subtitle) */
  projectName: string

  entries: QcReportEntryData[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const QC_PHOTO_BUCKET = 'qc-report-entries'

const ALL_PROJECT_ROLES = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
] as const

const LOGO_BUCKET = 'report-logos'

// Cap mirrors inspection-report-data.ts MAX_PHOTOS_PER_FIELD — an uncapped
// entry means an unbounded download fan-out and a huge render buffer.
const MAX_PHOTOS_PER_ENTRY = 24

/**
 * Download a file from a Supabase storage bucket and return it as a
 * `data:<mime>;base64,...` URI.  Returns null on any failure so the render
 * degrades gracefully (no photo slot) rather than throwing.
 */
async function fileToDataUri(
  service: ReturnType<typeof createServiceClient>,
  bucket: string,
  path: string,
): Promise<string | null> {
  try {
    const { data, error } = await service.storage.from(bucket).download(path)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    const mime = data.type || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** Resolve a logo storage path to a data: URI (uses report-logos bucket). */
async function logoToDataUri(
  service: ReturnType<typeof createServiceClient>,
  storagePath: string,
): Promise<string | null> {
  return fileToDataUri(service, LOGO_BUCKET, storagePath)
}

// ---------------------------------------------------------------------------
// Main gatherer
// ---------------------------------------------------------------------------

/**
 * Gather all data needed to render a QcReportDocument.
 *
 * Throws a string error message on auth failures or not-found cases —
 * the route handler should surface these as the appropriate HTTP status.
 */
export async function gatherQcReportData(
  supabase: SupabaseClient,
  projectId: string,
  reportId: string,
): Promise<QcReportData> {
  // 1. Auth + gates. The cookie-client read of the report row IS the
  //    visibility gate: RLS hides drafts from client viewers, so an invisible
  //    report surfaces as not-found, never as a leaked draft.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: report } = await (supabase as any)
    .schema('projects')
    .from('qc_reports')
    .select('*')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!report) throw new Error('Report not found')

  const roleGate = await requireEffectiveRole(supabase, projectId, ALL_PROJECT_ROLES)
  if (!roleGate.ok) throw new Error(roleGate.error)

  // 2. All remaining reads via service client so profile rows for other users
  //    are visible (cookie client only returns the viewer's own — 00009).
  const service = createServiceClient()

  // Load project + org for branding.
  const { data: project, error: projErr } = await (service as any)
    .schema('projects')
    .from('projects')
    .select('id, name, organisation_id, client_logo_url, project_logo_url, report_accent_color, status')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) throw new Error('Project not found')

  const { data: org } = await (service as any)
    .from('organisations')
    .select('id, name, logo_url, report_accent_color')
    .eq('id', project.organisation_id)
    .maybeSingle()

  // Load entries with their photos + comments in one query.
  const { data: entryRows, error: entryErr } = await (service as any)
    .schema('projects')
    .from('qc_entries')
    .select('*, qc_entry_photos(*), qc_comments(*)')
    .eq('report_id', reportId)
    .order('sort_order', { ascending: true })
  if (entryErr) throw new Error('Failed to load entries')
  const entries: any[] = entryRows ?? []

  // 3. Resolve user names via service client.
  const userIds = new Set<string>()
  if (report.raised_by) userIds.add(report.raised_by)
  if (report.issued_by) userIds.add(report.issued_by)
  for (const e of entries) {
    for (const c of e.qc_comments ?? []) {
      if (c.created_by) userIds.add(c.created_by)
    }
  }

  const profileMap = new Map<string, string | null>()
  if (userIds.size > 0) {
    const { data: profiles } = await (service as any)
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [...userIds])
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.full_name ?? p.email ?? null)
    }
  }

  const nameOf = (id: string | null | undefined): string | null =>
    id ? (profileMap.get(id) ?? null) : null

  // 4. Resolve floor-plan names for markup labels ("Drawing markup — {plan}").
  const planIds = new Set<string>()
  for (const e of entries) {
    for (const p of e.qc_entry_photos ?? []) {
      if (p.kind === 'markup' && p.source_floor_plan_id) planIds.add(p.source_floor_plan_id)
    }
  }
  const planNameById = new Map<string, string>()
  if (planIds.size > 0) {
    const { data: plans } = await (service as any)
      .schema('tenants')
      .from('floor_plans')
      .select('id, name')
      .in('id', [...planIds])
    for (const pl of plans ?? []) planNameById.set(pl.id, pl.name)
  }

  // 5. Fetch photos as data: URIs (capped) + map comments per entry.
  const reportEntries: QcReportEntryData[] = await Promise.all(
    entries.map(async (e: any, entryIdx: number): Promise<QcReportEntryData> => {
      // compareQcPhotos = the ONE ordering rule (sort_order, created_at, id)
      // shared with qcService.listEntriesWithPhotos, so the PDF's "Photo N"
      // always matches the web UI's — even across duplicate sort_order values.
      const sortedPhotos: any[] = (e.qc_entry_photos ?? []).slice().sort(compareQcPhotos)
      // Numbering over the FULL sorted list keeps "Photo N" comment
      // references stable across the cap and failed downloads.
      const photoIndexById = new Map<string, number>(
        sortedPhotos.map((p: any, i: number) => [p.id, i + 1]),
      )

      const rendered = sortedPhotos.slice(0, MAX_PHOTOS_PER_ENTRY)
      const photos = (await Promise.all(
        rendered.map(async (p: any): Promise<QcReportPhotoData | null> => {
          const dataUri = await fileToDataUri(service, QC_PHOTO_BUCKET, p.file_path)
          if (!dataUri) return null
          return {
            id: p.id,
            index: photoIndexById.get(p.id)!,
            dataUri,
            caption: p.caption ?? null,
            kind: p.kind === 'markup' ? 'markup' : 'photo',
            planName: p.source_floor_plan_id
              ? (planNameById.get(p.source_floor_plan_id) ?? null)
              : null,
          }
        }),
      )).filter(Boolean) as QcReportPhotoData[]

      const comments: QcReportCommentData[] = (e.qc_comments ?? [])
        .slice()
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((c: any): QcReportCommentData => ({
          id: c.id,
          authorName: nameOf(c.created_by),
          createdAt: c.created_at,
          body: c.body,
          photoIndex: c.photo_id ? (photoIndexById.get(c.photo_id) ?? null) : null,
        }))

      return {
        id: e.id,
        number: entryIdx + 1,
        title: e.title ?? 'Untitled',
        description: e.description ?? null,
        photos,
        omittedCount: Math.max(0, sortedPhotos.length - MAX_PHOTOS_PER_ENTRY),
        comments,
      }
    }),
  )

  // 6. Branding — resolve logos to data: URIs.
  const [clientLogoSrc, projectMarkSrc, orgLogoSrc] = await Promise.all([
    project.client_logo_url ? logoToDataUri(service, project.client_logo_url) : Promise.resolve(null),
    project.project_logo_url ? logoToDataUri(service, project.project_logo_url) : Promise.resolve(null),
    org?.logo_url ? logoToDataUri(service, org.logo_url) : Promise.resolve(null),
  ])

  const reportLabel = `QC Report ${report.report_no}`
  const today = new Date().toISOString().slice(0, 10)

  const branding = resolveBranding({
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
      subtitle: reportLabel,
    },
    contractor: null,
    kicker: 'QUALITY CONTROL REPORT',
    title: 'Quality Control Report',
    date: report.inspection_date ?? today,
  })

  // 7. Assemble the serialisable result.
  return {
    branding,
    report: {
      id: report.id,
      reportNo: report.report_no,
      title: report.title ?? 'Untitled',
      description: report.description ?? null,
      location: report.location ?? null,
      inspectionDate: report.inspection_date ?? null,
      status: report.status,
      raisedByName: nameOf(report.raised_by),
      issuedAt: report.issued_at ?? null,
      issuedByName: nameOf(report.issued_by),
    },
    projectName: project.name ?? 'Project',
    entries: reportEntries,
  }
}
