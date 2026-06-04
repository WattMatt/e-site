/**
 * snag-visit-report-data.ts
 *
 * Pure data-gathering layer for the Snag & Defect Report.
 * Mirrors the pattern established in branding-preview/route.ts:
 *   - RBAC gate via requireEffectiveRole (caller's cookie client)
 *   - All DB reads via createServiceClient (bypasses RLS, resolves names)
 *   - All photos fetched as data: URIs (never pass signed URLs to react-pdf)
 *   - resolveBranding for the branded cover
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { resolveBranding, type ResolvedBranding } from './branding'
import {
  computeVisitBuckets,
  CLOSED_STATUSES,
  type BucketSnag,
} from '@esite/shared'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SnagPhotoData {
  id: string
  dataUri: string
  caption: string | null
}

export interface ReportSnag {
  id: string
  /** e.g. "3.1" — "{visit_no}.{sequence}" derived from raised_on_visit_id + order */
  number: string
  title: string
  priority: string | null
  status: string
  location: string | null
  category: string | null
  description: string | null
  raisedByName: string | null
  assignedToName: string | null
  /** Raised visit number label, e.g. "Visit 2" or "Initial backlog" */
  raisedOnVisitLabel: string | null
  /** For NEW and STILL-OPEN: all photos (evidence + markup) */
  photos: SnagPhotoData[]
  /** For CLOSED only: evidence photos (before) */
  beforePhotos: SnagPhotoData[]
  /** For CLOSED only: closeout photos (after) */
  afterPhotos: SnagPhotoData[]
}

export interface SnagVisitReportData {
  /** Resolved branding for the Cover */
  branding: ResolvedBranding

  /** The visit being reported */
  visit: {
    id: string
    visitNo: number
    isBacklog: boolean
    visitDate: string | null
    title: string | null
    notes: string | null
    conductedByName: string | null
    attendeeNames: string[]
    newCount: number
    openCount: number
    closedCount: number
  }

  /** Project name (used in cover subtitle) */
  projectName: string

  /** Three carry-forward buckets */
  newSnags: ReportSnag[]
  stillOpen: ReportSnag[]
  closedThisVisit: ReportSnag[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SNAG_PHOTO_BUCKET = 'snag-photos'

const ALL_PROJECT_ROLES = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
] as const

const LOGO_BUCKET = 'report-logos'

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

/** Resolve a snag photo storage path to a data: URI (uses snag-photos bucket). */
async function photoToDataUri(
  service: ReturnType<typeof createServiceClient>,
  filePath: string,
): Promise<string | null> {
  return fileToDataUri(service, SNAG_PHOTO_BUCKET, filePath)
}

// ---------------------------------------------------------------------------
// Main gatherer
// ---------------------------------------------------------------------------

/**
 * Gather all data needed to render a SnagVisitReportDocument.
 *
 * Throws a string error message on auth failures or not-found cases —
 * the route handler should surface these as the appropriate HTTP status.
 */
export async function gatherSnagVisitReportData(
  supabase: SupabaseClient,
  projectId: string,
  visitId: string,
): Promise<SnagVisitReportData> {
  // 1. RBAC gate: any project member may generate the report.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const roleGate = await requireEffectiveRole(supabase, projectId, ALL_PROJECT_ROLES)
  if (!roleGate.ok) throw new Error(roleGate.error)

  // 2. All DB reads via service client so profile rows for other users are visible.
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

  // Load the target visit.
  const { data: visitRow, error: visitErr } = await (service as any)
    .schema('field')
    .from('snag_visits')
    .select('*')
    .eq('id', visitId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (visitErr || !visitRow) throw new Error('Visit not found')

  // Load all visits for this project (needed for computeVisitBuckets + visit labels).
  const { data: allVisitRows, error: allVisitsErr } = await (service as any)
    .schema('field')
    .from('snag_visits')
    .select('id, visit_no, is_backlog')
    .eq('project_id', projectId)
    .order('visit_no', { ascending: true })
  if (allVisitsErr) throw new Error('Failed to load visits')
  const allVisits: Array<{ id: string; visit_no: number; is_backlog: boolean }> = allVisitRows ?? []

  // Build a visit-no lookup for labels.
  const visitNoById = new Map(allVisits.map(v => [v.id, v.visit_no]))
  const visitLabelById = new Map(
    allVisits.map(v => [v.id, v.is_backlog ? 'Initial backlog' : `Visit ${v.visit_no}`]),
  )

  // Load all snags for the project with photos (listVisitSnags pattern).
  const { data: snagRows, error: snagErr } = await (service as any)
    .schema('field')
    .from('snags')
    .select('*, snag_photos(id, file_path, caption, photo_type, sort_order)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (snagErr) throw new Error('Failed to load snags')
  const snags: any[] = snagRows ?? []

  // 3. Compute the three buckets.
  const buckets = computeVisitBuckets(
    { id: visitRow.id, visit_no: visitRow.visit_no },
    allVisits,
    snags,
  )

  // 4. Resolve user names via service client.
  //    Collect all unique user IDs referenced across visit + snags.
  const userIds = new Set<string>()
  if (visitRow.conducted_by) userIds.add(visitRow.conducted_by)
  if (Array.isArray(visitRow.attendees)) {
    for (const a of visitRow.attendees) if (a) userIds.add(a)
  }
  for (const s of snags) {
    if (s.raised_by) userIds.add(s.raised_by)
    if (s.assigned_to) userIds.add(s.assigned_to)
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

  // 5. Fetch photos as data: URIs.
  //    For NEW + STILL-OPEN: all photos (evidence + markup).
  //    For CLOSED: partition into before (evidence) and after (closeout).
  async function resolveSnagPhotos(s: any, isClosed: boolean): Promise<Pick<ReportSnag, 'photos' | 'beforePhotos' | 'afterPhotos'>> {
    const rawPhotos: any[] = (s.snag_photos ?? []).sort(
      (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    )

    if (!isClosed) {
      // All photos (skip closeout on open snags — not meaningful without context).
      const photos = await Promise.all(
        rawPhotos
          .filter((p: any) => p.photo_type !== 'closeout')
          .map(async (p: any): Promise<SnagPhotoData | null> => {
            const dataUri = await photoToDataUri(service, p.file_path)
            if (!dataUri) return null
            return { id: p.id, dataUri, caption: p.caption ?? null }
          }),
      )
      return { photos: photos.filter(Boolean) as SnagPhotoData[], beforePhotos: [], afterPhotos: [] }
    } else {
      // CLOSED: before = evidence, after = closeout.
      const [beforePhotos, afterPhotos] = await Promise.all([
        Promise.all(
          rawPhotos
            .filter((p: any) => p.photo_type === 'evidence')
            .map(async (p: any): Promise<SnagPhotoData | null> => {
              const dataUri = await photoToDataUri(service, p.file_path)
              if (!dataUri) return null
              return { id: p.id, dataUri, caption: p.caption ?? null }
            }),
        ),
        Promise.all(
          rawPhotos
            .filter((p: any) => p.photo_type === 'closeout')
            .map(async (p: any): Promise<SnagPhotoData | null> => {
              const dataUri = await photoToDataUri(service, p.file_path)
              if (!dataUri) return null
              return { id: p.id, dataUri, caption: p.caption ?? null }
            }),
        ),
      ])
      return {
        photos: [],
        beforePhotos: beforePhotos.filter(Boolean) as SnagPhotoData[],
        afterPhotos: afterPhotos.filter(Boolean) as SnagPhotoData[],
      }
    }
  }

  // Build a snag number: "{visit_no}.{sequence_within_bucket}"
  function makeNumber(s: any, idx: number): string {
    const vno = s.raised_on_visit_id ? (visitNoById.get(s.raised_on_visit_id) ?? 0) : 0
    return `${vno}.${idx + 1}`
  }

  async function toReportSnag(
    s: any,
    idx: number,
    isClosed: boolean,
  ): Promise<ReportSnag> {
    const photoData = await resolveSnagPhotos(s, isClosed)
    return {
      id: s.id,
      number: makeNumber(s, idx),
      title: s.title ?? 'Untitled',
      priority: s.priority ?? null,
      status: s.status,
      location: s.location ?? null,
      category: s.category ?? null,
      description: s.description ?? null,
      raisedByName: nameOf(s.raised_by),
      assignedToName: nameOf(s.assigned_to),
      raisedOnVisitLabel: s.raised_on_visit_id ? (visitLabelById.get(s.raised_on_visit_id) ?? null) : null,
      ...photoData,
    }
  }

  const [newSnags, stillOpen, closedThisVisit] = await Promise.all([
    Promise.all(buckets.newSnags.map((s, i) => toReportSnag(s, i, false))),
    Promise.all(buckets.stillOpen.map((s, i) => toReportSnag(s, i, false))),
    Promise.all(buckets.closedThisVisit.map((s, i) => toReportSnag(s, i, true))),
  ])

  // 5 (cont). Branding — resolve logos to data: URIs.
  const [clientLogoSrc, projectMarkSrc, orgLogoSrc] = await Promise.all([
    project.client_logo_url ? logoToDataUri(service, project.client_logo_url) : Promise.resolve(null),
    project.project_logo_url ? logoToDataUri(service, project.project_logo_url) : Promise.resolve(null),
    org?.logo_url ? logoToDataUri(service, org.logo_url) : Promise.resolve(null),
  ])

  const visitLabel = visitRow.is_backlog ? 'Initial backlog' : `Site Visit ${visitRow.visit_no}`
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
      subtitle: visitLabel,
    },
    contractor: null,
    kicker: 'SNAG & DEFECT REPORT',
    title: 'Snag & Defect Report',
    date: visitRow.visit_date ?? today,
  })

  // 6. Assemble the serialisable result.
  const attendeeNames = (Array.isArray(visitRow.attendees) ? visitRow.attendees : [])
    .map((id: string) => nameOf(id) ?? id)

  return {
    branding,
    visit: {
      id: visitRow.id,
      visitNo: visitRow.visit_no,
      isBacklog: visitRow.is_backlog ?? false,
      visitDate: visitRow.visit_date ?? null,
      title: visitRow.title ?? null,
      notes: visitRow.notes ?? null,
      conductedByName: nameOf(visitRow.conducted_by),
      attendeeNames,
      newCount: newSnags.length,
      openCount: stillOpen.length,
      closedCount: closedThisVisit.length,
    },
    projectName: project.name ?? 'Project',
    newSnags,
    stillOpen,
    closedThisVisit,
  }
}
