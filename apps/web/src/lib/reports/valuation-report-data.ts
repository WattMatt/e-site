/**
 * valuation-report-data.ts
 *
 * Pure data-gathering layer for the Payment Certificate.
 * Mirrors the pattern established in snag-visit-report-data.ts:
 *   - RBAC gate via requireEffectiveRole (caller's cookie client) — COST_VIEW_ROLES
 *   - All DB reads via createServiceClient (bypasses RLS, resolves names)
 *   - Logos fetched as data: URIs (never pass signed URLs to react-pdf)
 *   - resolveBranding for the branded cover
 *
 * The certificate figures come from the pure computeCertificate (Task 4); the
 * per-bill breakdown is built by walking the BOQ section tree (item → its
 * section → up to its kind='bill' ancestor) and summing value_to_date per bill,
 * reusing the boqService.getTree shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { resolveBranding, type ResolvedBranding } from './branding'
import {
  COST_VIEW_ROLES,
  valuationService,
  boqService,
  computeCertificate,
  type BoqSection,
} from '@esite/shared'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CertificateBill {
  /** Bill code, e.g. "A" (falls back to "" when the bill has no code). */
  code: string
  title: string
  /** Sum of this bill's lines' value_to_date. */
  grossToDate: number
  /**
   * v1: the bill's gross-to-date. The previous-cert delta lives in the SUMMARY
   * block (not decomposed per bill), so per-bill thisPeriod === grossToDate.
   */
  thisPeriod: number
  /** The bill's share of retention (gross × retentionPct). */
  retention: number
}

export interface CertificateSummary {
  grossToDate: number
  retention: number
  netToDate: number
  previousNet: number
  dueExVat: number
  vat: number
  dueInclVat: number
}

export interface ValuationReportData {
  /** Resolved branding for the Cover. */
  branding: ResolvedBranding

  /** Project name (cover subtitle). */
  projectName: string

  /** The valuation being certified. */
  valuation: {
    no: number
    date: string
    status: string
    retentionPct: number
  }

  /** The certificate figures — straight from computeCertificate. */
  summary: CertificateSummary

  /** Per-bill schedule. Totals reconcile to summary.grossToDate. */
  bills: CertificateBill[]

  /** Resolved certifier name (the engineer/PQS who certified, or will). */
  certifiedByName: string | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const LOGO_BUCKET = 'report-logos'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Download a file from a Supabase storage bucket and return it as a
 * `data:<mime>;base64,...` URI. Returns null on any failure so the render
 * degrades gracefully (no logo) rather than throwing.
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
    const mime = data.type || 'image/png'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** Resolve a logo storage path to a data: URI (report-logos bucket). */
async function logoToDataUri(
  service: ReturnType<typeof createServiceClient>,
  storagePath: string,
): Promise<string | null> {
  return fileToDataUri(service, LOGO_BUCKET, storagePath)
}

/**
 * Walk up the section tree from a leaf section to its nearest kind='bill'
 * ancestor. Returns that bill section, or the topmost reached section if no
 * 'bill' kind exists (so every line still lands in a bucket).
 */
function findOwningBill(
  startSectionId: string | null,
  sectionById: Map<string, BoqSection>,
): BoqSection | null {
  let current = startSectionId ? sectionById.get(startSectionId) ?? null : null
  let topmost = current
  // Bounded walk — section trees are acyclic; the visited guard is defensive.
  const visited = new Set<string>()
  while (current) {
    if (current.kind === 'bill') return current
    topmost = current
    if (visited.has(current.id)) break
    visited.add(current.id)
    current = current.parentSectionId ? sectionById.get(current.parentSectionId) ?? null : null
  }
  return topmost
}

// ---------------------------------------------------------------------------
// Main gatherer
// ---------------------------------------------------------------------------

/**
 * Gather all data needed to render a ValuationReportDocument.
 *
 * Throws a string error message on auth/not-found cases — the route handler
 * should surface these as the appropriate HTTP status.
 */
export async function gatherValuationReportData(
  supabase: SupabaseClient,
  projectId: string,
  valuationId: string,
): Promise<ValuationReportData> {
  // 1. RBAC gate: cost figures are restricted to owner/admin/PM.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const roleGate = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!roleGate.ok) throw new Error(roleGate.error)

  // 2. All DB reads via the service client so other users' profile rows resolve.
  const service = createServiceClient()

  // Project + org for branding.
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

  // 3. Valuation + its lines.
  const result = await valuationService.get(service, valuationId)
  if (!result) throw new Error('Valuation not found')
  const { valuation, lines } = result

  // 4. BOQ tree (for the per-bill walk): sections give the bill ancestry, items
  //    give each valuation line's owning section (line.boqItemId → item.sectionId).
  const { sections, items } = await boqService.getTree(service, valuation.boqImportId)
  const sectionById = new Map(sections.map(sec => [sec.id, sec]))
  const itemSectionById = new Map(items.map(it => [it.id, it.sectionId]))

  // 5. Certificate math — the pure computeCertificate is the single source of
  //    truth for the summary.
  const previousNet = await valuationService.getPreviousNet(service, projectId, valuation.valuationNo)
  const summary = computeCertificate(
    lines.map(l => ({ valueToDate: l.valueToDate })),
    valuation.retentionPct,
    previousNet,
  )

  // 6. Per-bill breakdown: map each line → its item's section → the owning bill,
  //    summing value_to_date into that bill (the boq rollup tree-walk).
  // Accumulate raw gross per bill, preserving first-seen order.
  const billOrder: string[] = []
  const billGross = new Map<string, number>()
  const billMeta = new Map<string, { code: string; title: string }>()

  for (const line of lines) {
    const sectionId = itemSectionById.get(line.boqItemId) ?? null
    const bill = findOwningBill(sectionId, sectionById)
    // Key on the bill id; lines whose item/section resolves to nothing land in
    // a synthetic "Unattributed" bucket so the totals still reconcile.
    const key = bill?.id ?? '__unattributed__'
    if (!billGross.has(key)) {
      billOrder.push(key)
      billGross.set(key, 0)
      billMeta.set(key, {
        code: bill?.code ?? '',
        title: bill?.title ?? 'Unattributed',
      })
    }
    billGross.set(key, billGross.get(key)! + line.valueToDate)
  }

  const bills: CertificateBill[] = billOrder.map(key => {
    const gross = round2(billGross.get(key)!)
    const meta = billMeta.get(key)!
    return {
      code: meta.code,
      title: meta.title,
      grossToDate: gross,
      thisPeriod: gross,
      retention: round2(gross * (valuation.retentionPct / 100)),
    }
  })

  // 7. Branding — logos to data: URIs.
  const [clientLogoSrc, projectMarkSrc, orgLogoSrc] = await Promise.all([
    project.client_logo_url ? logoToDataUri(service, project.client_logo_url) : Promise.resolve(null),
    project.project_logo_url ? logoToDataUri(service, project.project_logo_url) : Promise.resolve(null),
    org?.logo_url ? logoToDataUri(service, org.logo_url) : Promise.resolve(null),
  ])

  const certLabel = `Certificate No. ${valuation.valuationNo}`

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
      subtitle: certLabel,
    },
    contractor: null,
    kicker: 'PAYMENT CERTIFICATE',
    title: `Payment Certificate No. ${valuation.valuationNo}`,
    date: valuation.valuationDate,
  })

  // 8. Resolve the certifier name via the service client.
  let certifiedByName: string | null = null
  if (valuation.certifiedBy) {
    const { data: profile } = await (service as any)
      .from('profiles')
      .select('id, full_name, email')
      .in('id', [valuation.certifiedBy])
    const row = (profile ?? [])[0]
    certifiedByName = row ? (row.full_name ?? row.email ?? null) : null
  }

  return {
    branding,
    projectName: project.name ?? 'Project',
    valuation: {
      no: valuation.valuationNo,
      date: valuation.valuationDate,
      status: valuation.status,
      retentionPct: valuation.retentionPct,
    },
    summary,
    bills,
    certifiedByName,
  }
}
