'use server'

/**
 * Project Valuations / Payment-Certificate server actions.
 *
 * Shape mirrors boq.actions.ts exactly:
 *   1. createClient() (cookie/RLS client) — used for the auth + role gate.
 *   2. requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES) — project-scoped
 *      gate (honours per-project role overrides; see migration 00107). Certificate
 *      figures are cost data, so reads + draft writes gate on COST_VIEW_ROLES;
 *      delete gates on the broader ORG_WRITE_ROLES.
 *   3. Service-role (RLS-bypassing) reads/writes sit BEHIND the gate, via
 *      createServiceClient().
 *   4. Cross-project guard: every action that takes a valuationId resolves that
 *      valuation's project_id via the service client and refuses ('Not found')
 *      if it isn't this project — done BEFORE any write, so a forged valuation id
 *      from another project cannot be touched.
 *   5. { data } | { error } result; revalidatePath after writes.
 *
 * Profiles-RLS lesson: certifier/creator display names are resolved via the
 * SERVICE client after the gate — the caller's RLS client only returns their OWN
 * public.profiles row.
 */

import { revalidatePath } from 'next/cache'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  valuationService,
  boqService,
  computeCertificate,
  valuationProgressPatchSchema,
  COST_VIEW_ROLES,
  ORG_WRITE_ROLES,
  type Valuation,
  type ValuationLine,
  type ValuationProgressPatch,
  type BoqSection,
} from '@esite/shared'
import { gatherValuationReportData } from '@/lib/reports/valuation-report-data'
import { renderValuationReport } from '@/lib/reports/render-valuation'

const REPORTS_BUCKET = 'reports'

function bust(projectId: string): void {
  revalidatePath(`/projects/${projectId}/settings/valuations`, 'page')
}

/** Resolve project → organisation_id so we gate against the *project's* org. */
async function resolveProjectOrg(
  supabase: any,
  projectId: string,
): Promise<{ organisationId: string } | null> {
  const { data } = await supabase
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!data) return null
  return { organisationId: data.organisation_id }
}

/**
 * Cross-project guard: resolve a valuation's project_id + status via the SERVICE
 * client. Returns the row, or null if it does not exist / belongs to another
 * project (callers map both to { error: 'Not found' }).
 */
async function resolveValuationForGate(
  service: any,
  projectId: string,
  valuationId: string,
): Promise<{ id: string; status: string } | null> {
  const { data } = await service
    .schema('projects')
    .from('valuations')
    .select('id, project_id, status')
    .eq('id', valuationId)
    .maybeSingle()
  if (!data || data.project_id !== projectId) return null
  return { id: data.id, status: data.status }
}

/** The rate fields computeLineValue needs, mapped off a raw boq_items row. */
type RateItem = {
  amount: number | null
  supplyRate: number | null
  installRate: number | null
  rate: number | null
  rateModel: string
}

function rowToRateItem(row: any): RateItem {
  return {
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    supplyRate: row.supply_rate === null || row.supply_rate === undefined ? null : Number(row.supply_rate),
    installRate: row.install_rate === null || row.install_rate === undefined ? null : Number(row.install_rate),
    rate: row.rate === null || row.rate === undefined ? null : Number(row.rate),
    rateModel: row.rate_model,
  }
}

// ─── listValuationsAction ────────────────────────────────────────────────────

export type ListValuationsResult = { data: { valuations: Valuation[] } } | { error: string }

export async function listValuationsAction(projectId: string): Promise<ListValuationsResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  try {
    const service = createServiceClient()
    const valuations = await valuationService.list(service as any, projectId)
    return { data: { valuations } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load valuations' }
  }
}

// ─── getValuationAction ──────────────────────────────────────────────────────

export type GetValuationResult =
  | {
      data: {
        valuation: Valuation
        lines: ValuationLine[]
        certificate: ReturnType<typeof computeCertificate>
        certifiedByName: string | null
        createdByName: string | null
      }
    }
  | { error: string }

export async function getValuationAction(
  projectId: string,
  valuationId: string,
): Promise<GetValuationResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  try {
    const service = createServiceClient()
    const result = await valuationService.get(service as any, valuationId)
    // Cross-project guard: the valuation must belong to this project.
    if (!result || result.valuation.projectId !== projectId) return { error: 'Not found' }

    const { valuation, lines } = result

    // Live certificate figures (recomputed; the frozen figures only exist once
    // certified). previousNet = the prior certified valuation's net.
    const previousNet = await valuationService.getPreviousNet(
      service as any,
      projectId,
      valuation.valuationNo,
    )
    const certificate = computeCertificate(
      lines.map((l) => ({ valueToDate: l.valueToDate })),
      valuation.retentionPct,
      previousNet,
    )

    // created_by isn't on the Valuation domain type — read it off the row.
    const { data: row } = await (service as any)
      .schema('projects')
      .from('valuations')
      .select('created_by')
      .eq('id', valuationId)
      .maybeSingle()
    const createdById: string | null = row?.created_by ?? null

    // Resolve certifier + creator names via the SERVICE client (profiles RLS
    // only returns the caller's own row to the cookie client).
    const ids = [valuation.certifiedBy, createdById].filter((id): id is string => Boolean(id))
    let certifiedByName: string | null = null
    let createdByName: string | null = null
    if (ids.length > 0) {
      const { data: profiles } = await (service as any)
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids)
      const byId = new Map(
        ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
          (p) => [p.id, p.full_name ?? p.email ?? null],
        ),
      )
      certifiedByName = valuation.certifiedBy ? byId.get(valuation.certifiedBy) ?? null : null
      createdByName = createdById ? byId.get(createdById) ?? null : null
    }

    return { data: { valuation, lines, certificate, certifiedByName, createdByName } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load valuation' }
  }
}

// ─── createValuationAction ───────────────────────────────────────────────────

export type CreateValuationResult = { data: { valuation: Valuation } } | { error: string }

export async function createValuationAction(
  projectId: string,
  valuationDate: string,
): Promise<CreateValuationResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const { data: { user } } = await supabase.auth.getUser()

  try {
    const service = createServiceClient()

    // A valuation prices against the current BOQ import — refuse if none.
    const current = await boqService.getCurrent(service as any, projectId)
    if (!current) return { error: 'Import a BOQ on the Rates tab first' }

    // Read the project's retention_pct (project_settings; numeric(5,2), default 5).
    const { data: settings } = await (service as any)
      .schema('projects')
      .from('project_settings')
      .select('retention_pct')
      .eq('project_id', projectId)
      .maybeSingle()
    const retentionPct = settings?.retention_pct != null ? Number(settings.retention_pct) : 5

    const valuation = await valuationService.create(service as any, {
      projectId,
      organisationId: proj.organisationId,
      boqImportId: current.id,
      valuationDate,
      retentionPct,
      createdBy: user?.id ?? null,
    })
    bust(projectId)
    return { data: { valuation } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Create failed' }
  }
}

// ─── updateValuationLineAction ───────────────────────────────────────────────

export type UpdateValuationLineResult = { data: { line: ValuationLine } } | { error: string }

export async function updateValuationLineAction(
  projectId: string,
  valuationId: string,
  patch: ValuationProgressPatch,
): Promise<UpdateValuationLineResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const parsed = valuationProgressPatchSchema.safeParse(patch)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid progress patch' }
  }

  const service = createServiceClient()

  // Cross-project + certified guard (before any write).
  const val = await resolveValuationForGate(service as any, projectId, valuationId)
  if (!val) return { error: 'Not found' }
  if (val.status === 'certified') {
    return { error: 'This valuation is certified and can no longer be edited.' }
  }

  try {
    // Load the boq item (for its rate fields). It must belong to this project's
    // current import; the upsert is scoped to the valuation, so cross-project is
    // already covered by the valuation guard above.
    const { data: itemRow } = await (service as any)
      .schema('projects')
      .from('boq_items')
      .select('id, amount, supply_rate, install_rate, rate, rate_model')
      .eq('id', parsed.data.boqItemId)
      .maybeSingle()
    if (!itemRow) return { error: 'Not found' }

    const line = await valuationService.upsertLine(
      service as any,
      valuationId,
      parsed.data,
      rowToRateItem(itemRow),
    )
    bust(projectId)
    return { data: { line } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// ─── setSectionPercentAction ─────────────────────────────────────────────────

export type SetSectionPercentResult = { data: { updated: true } } | { error: string }

export async function setSectionPercentAction(
  projectId: string,
  valuationId: string,
  sectionId: string,
  percent: number,
): Promise<SetSectionPercentResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  if (typeof percent !== 'number' || percent < 0 || percent > 100) {
    return { error: 'Percent must be between 0 and 100' }
  }

  const service = createServiceClient()

  // Cross-project + certified guard (before any write).
  const val = await resolveValuationForGate(service as any, projectId, valuationId)
  if (!val) return { error: 'Not found' }
  if (val.status === 'certified') {
    return { error: 'This valuation is certified and can no longer be edited.' }
  }

  try {
    // Resolve the valuation's import, then gather every item under sectionId by
    // descending the section tree.
    const result = await valuationService.get(service as any, valuationId)
    if (!result) return { error: 'Not found' }

    const { sections, items } = await boqService.getTree(service as any, result.valuation.boqImportId)

    // Children-of map for an O(n) descent.
    const childrenOf = new Map<string, BoqSection[]>()
    for (const sec of sections) {
      const key = sec.parentSectionId ?? '__root__'
      const arr = childrenOf.get(key) ?? []
      arr.push(sec)
      childrenOf.set(key, arr)
    }

    // Collect sectionId + all its descendant section ids.
    const inScope = new Set<string>()
    const stack = [sectionId]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (inScope.has(id)) continue
      inScope.add(id)
      for (const child of childrenOf.get(id) ?? []) stack.push(child.id)
    }

    const targetItems = items
      .filter((it) => inScope.has(it.sectionId))
      .map((it) => ({
        boqItemId: it.id,
        item: {
          amount: it.amount,
          supplyRate: it.supplyRate,
          installRate: it.installRate,
          rate: it.rate,
          rateModel: it.rateModel,
        },
      }))

    await valuationService.setSectionPercent(service as any, valuationId, targetItems, percent)
    bust(projectId)
    return { data: { updated: true } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
}

// ─── certifyValuationAction ──────────────────────────────────────────────────

export type CertifyValuationResult =
  | { data: { valuation: Valuation; reportId: string; storagePath: string } }
  | { error: string }

/**
 * Certify a valuation: lock the figures + render + persist the Payment
 * Certificate PDF.
 *
 * Mirrors exportSnagVisitReportAction's report-persist pattern:
 *   gather → render → supersede-check → upload → insert projects.reports row →
 *   valuationService.certify(figures + reportId) → revalidate.
 */
export async function certifyValuationAction(
  projectId: string,
  valuationId: string,
): Promise<CertifyValuationResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Cross-project + already-certified guard (before any org lookup / render).
  const val = await resolveValuationForGate(service as any, projectId, valuationId)
  if (!val) return { error: 'Not found' }
  if (val.status === 'certified') {
    return { error: 'This valuation is already certified.' }
  }

  const proj = await resolveProjectOrg(supabase, projectId)
  if (!proj) return { error: 'Project not found' }

  const { data: { user } } = await supabase.auth.getUser()

  // ── Gather data + render the PDF ───────────────────────────────────────────
  let pdfBuffer: Buffer
  let brandingSnapshot: unknown
  let certNo: number
  let figures: ReturnType<typeof computeCertificate>
  try {
    const reportData = await gatherValuationReportData(supabase, projectId, valuationId)
    pdfBuffer = await renderValuationReport(reportData)
    figures = reportData.summary
    certNo = reportData.valuation.no
    brandingSnapshot = {
      accent: reportData.branding.accent,
      issuer: reportData.branding.issuer.wordmark
        ? { wordmark: reportData.branding.issuer.wordmark }
        : { hasLogo: true },
      kicker: reportData.branding.kicker,
      projectLine: reportData.branding.projectLine,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[certifyValuationAction] gather/render error', err)
    return { error: msg }
  }

  // ── Supersede check — the current issued report for this valuation ─────────
  const { data: priorRow } = await (service as any)
    .schema('projects')
    .from('reports')
    .select('id, version')
    .eq('source_table', 'valuations')
    .eq('source_id', valuationId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const newVersion: number = priorRow ? (priorRow as { version: number }).version + 1 : 1

  // ── Upload PDF to storage ──────────────────────────────────────────────────
  const storagePath = `${proj.organisationId}/${projectId}/valuation-${valuationId}-v${newVersion}.pdf`
  const { error: uploadError } = await service.storage
    .from(REPORTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: false })
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` }

  // ── Insert projects.reports row ────────────────────────────────────────────
  const { data: newReport, error: insertError } = await (service as any)
    .schema('projects')
    .from('reports')
    .insert({
      organisation_id: proj.organisationId,
      project_id: projectId,
      kind: 'valuation',
      source_table: 'valuations',
      source_id: valuationId,
      title: `Payment Certificate No. ${certNo}`,
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdfBuffer.length,
      status: 'issued',
      version: newVersion,
      branding_snapshot: brandingSnapshot,
      generated_by: user?.id ?? null,
    })
    .select('id')
    .single()

  if (insertError) {
    // Best-effort rollback of the storage upload to avoid orphans.
    await service.storage.from(REPORTS_BUCKET).remove([storagePath])
    return { error: `Failed to save report record: ${insertError.message}` }
  }

  const reportId = (newReport as { id: string }).id

  // ── Supersede ALL prior issued rows for this valuation (self-healing) ──────
  const { error: supersededError } = await (service as any)
    .schema('projects')
    .from('reports')
    .update({ status: 'superseded', superseded_by: reportId })
    .eq('source_table', 'valuations')
    .eq('source_id', valuationId)
    .eq('status', 'issued')
    .neq('id', reportId)
  if (supersededError) {
    console.error('[certifyValuationAction] supersede error', supersededError)
    // Non-blocking: the new row is valid.
  }

  // ── Freeze the figures + mark certified ────────────────────────────────────
  try {
    const valuation = await valuationService.certify(service as any, valuationId, {
      certifiedBy: user?.id ?? null,
      reportId,
      figures,
    })
    bust(projectId)
    return { data: { valuation, reportId, storagePath } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Certify failed' }
  }
}

// ─── getValuationReportUrlAction ─────────────────────────────────────────────

export type GetValuationReportUrlResult = { data: { url: string } } | { error: string }

/**
 * Resolve a short-lived signed URL for a certified valuation's Payment
 * Certificate PDF (the current `issued` projects.reports row). Read-gated on
 * COST_VIEW_ROLES + the cross-project guard. Used by CertifyBar with
 * previewViaSignedUrl so the click-gesture opens the PDF tab.
 */
export async function getValuationReportUrlAction(
  projectId: string,
  valuationId: string,
): Promise<GetValuationReportUrlResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Cross-project guard.
  const val = await resolveValuationForGate(service as any, projectId, valuationId)
  if (!val) return { error: 'Not found' }

  const { data: row } = await (service as any)
    .schema('projects')
    .from('reports')
    .select('storage_path')
    .eq('source_table', 'valuations')
    .eq('source_id', valuationId)
    .eq('status', 'issued')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const storagePath = (row as { storage_path?: string } | null)?.storage_path
  if (!storagePath) return { error: 'No certificate found for this valuation' }

  const { data: signed, error } = await service.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(storagePath, 3600)
  if (error || !signed?.signedUrl) {
    return { error: error?.message ?? 'Could not create a download link' }
  }
  return { data: { url: signed.signedUrl } }
}

// ─── deleteValuationAction ───────────────────────────────────────────────────

export type DeleteValuationResult = { data: { deleted: true } } | { error: string }

export async function deleteValuationAction(
  projectId: string,
  valuationId: string,
): Promise<DeleteValuationResult> {
  const supabase = await createClient()

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const service = createServiceClient()

  // Cross-project + certified guard (before the delete).
  const val = await resolveValuationForGate(service as any, projectId, valuationId)
  if (!val) return { error: 'Not found' }
  if (val.status === 'certified') {
    return { error: 'A certified valuation cannot be deleted.' }
  }

  try {
    const { error } = await (service as any)
      .schema('projects')
      .from('valuations')
      .delete()
      .eq('id', valuationId)
    if (error) throw new Error(error.message)
    bust(projectId)
    return { data: { deleted: true } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Delete failed' }
  }
}
