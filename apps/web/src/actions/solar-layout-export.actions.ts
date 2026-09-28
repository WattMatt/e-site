'use server'
/**
 * Export layout sheet (functional spec §6.3): the browser's rasterised crop +
 * a legend/title block computed HERE from the stored layout, saved as the next
 * version in projects.reports kind 'solar_layout_sheet' (source solar.layouts).
 * Writing needs Solar Edit; reading follows the Solar level (00211 +
 * report-kind-access.ts SOLAR_READ_REPORT_KINDS).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { scaleForSource } from '@/lib/solar/layout-loader'
import { renderLayoutSheetPdf } from '@/lib/solar/layout-sheet-pdf'
import { layoutSummary, stringColour, type LayoutObject } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
// The kind is written as a LITERAL at each .from('reports') call on purpose:
// report-kind-access.contract.test.ts finds writers by scanning for
// `kind: '<literal>'` / `.eq('kind', '<literal>')`; a constant would hide this
// writer from the contract.

export async function exportLayoutSheetAction(input: {
  projectId: string; layoutId: string; jpegBase64: string; crop: { x: number; y: number; w: number; h: number }; note?: string | null
}): Promise<{ ok: true; version: number; reportId: string } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (typeof input.jpegBase64 !== 'string' || input.jpegBase64.length < 100 || input.jpegBase64.length > 9_500_000) return { error: 'The sheet image could not be read — try again.' }
  const c = input.crop
  if (!c || ![c.x, c.y, c.w, c.h].every((v) => typeof v === 'number' && Number.isFinite(v)) || c.w <= 0 || c.h <= 0) return { error: 'The sheet image could not be read — try again.' }

  const { data: layout } = await supabase.schema('solar').from('layouts')
    .select('id, project_id, organisation_id, name, roof_source_id, design_t_min_c, design_t_amb_max_c').eq('id', input.layoutId).eq('project_id', input.projectId).maybeSingle()
  const l = layout as { organisation_id: string; name: string; roof_source_id: string; design_t_min_c: number; design_t_amb_max_c: number } | null
  if (!l) return { error: 'This layout no longer exists — reload.' }
  const [{ data: rs }, { data: objs }, { data: project }] = await Promise.all([
    supabase.schema('solar').from('roof_sources').select('id, kind, floor_plan_id, page_index, m_per_px, north_bearing_deg, attribution').eq('id', l.roof_source_id).maybeSingle(),
    supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', input.layoutId),
    supabase.schema('projects').from('projects').select('name').eq('id', input.projectId).maybeSingle(),
  ])
  const src = rs as { kind: string; floor_plan_id: string | null; page_index: number; m_per_px: number | null; north_bearing_deg: number | null; attribution: string | null } | null
  if (!src) return { error: 'This layout no longer exists — reload.' }
  let ppm: number | null = null
  let sourceLabel = 'Satellite capture'
  if (src.kind === 'drawing' && src.floor_plan_id) {
    const [{ data: plan }, { data: pages }] = await Promise.all([
      supabase.schema('tenants').from('floor_plans').select('id, name, pixels_per_meter').eq('id', src.floor_plan_id).maybeSingle(),
      supabase.schema('tenants').from('floor_plan_page_scales').select('page_index, pixels_per_meter').eq('floor_plan_id', src.floor_plan_id),
    ])
    const p = plan as { name: string; pixels_per_meter: number | null } | null
    sourceLabel = `${p?.name ?? 'Drawing'} · page ${src.page_index}`
    ppm = scaleForSource(src, new Map([[src.floor_plan_id, p?.pixels_per_meter == null ? null : Number(p.pixels_per_meter)]]),
      new Map(((pages ?? []) as Array<{ page_index: number; pixels_per_meter: number }>).map((x) => [`${src.floor_plan_id}#${x.page_index}`, Number(x.pixels_per_meter)])))
  } else ppm = scaleForSource(src, new Map(), new Map())

  const objects = ((objs ?? []) as Array<{ id: string; kind: string; geometry: unknown; props: unknown; pixels_per_meter: number | null }>)
    .map((o) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props, pixelsPerMeter: o.pixels_per_meter == null ? null : Number(o.pixels_per_meter) }) as LayoutObject)
  const s = layoutSummary(objects, { tMinC: Number(l.design_t_min_c), tAmbMaxC: Number(l.design_t_amb_max_c) })
  const inverters = new Map(objects.filter((o) => o.kind === 'inverter').map((o) => [o.id, o.kind === 'inverter' ? o.props.name : '']))
  const legend = objects.filter((o) => o.kind === 'string').map((o, i) => ({
    colour: stringColour(i),
    label: o.kind === 'string' ? `${inverters.get(o.props.inverterId) ?? 'Inverter'} MPPT ${o.props.mppt} · ${o.props.modules.length} modules` : '',
  }))
  const scaleChanged = ppm !== null && objects.some((o) => o.pixelsPerMeter !== null && Math.abs(o.pixelsPerMeter - ppm!) > 1e-6)

  const service = createServiceClient() as unknown as AnyClient
  const { data: prior } = await service.schema('projects').from('reports').select('id, version')
    .eq('project_id', input.projectId).eq('kind', 'solar_layout_sheet').eq('source_id', input.layoutId).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as { version: number }).version) + 1 : 1

  let pdf: Uint8Array
  try {
    pdf = await renderLayoutSheetPdf({
      jpegBase64: input.jpegBase64, imageWidthPx: c.w, imageHeightPx: c.h, metresPerImagePx: ppm ? 1 / ppm : null,
      northBearingDeg: src.north_bearing_deg == null ? null : Number(src.north_bearing_deg),
      projectName: (project as { name?: string } | null)?.name ?? '', layoutName: l.name, sourceLabel, version,
      dateIso: new Date().toISOString().slice(0, 10),
      summaryLines: [
        `${s.dcKwp.toFixed(2)} kWp DC · ${s.acKw.toFixed(1)} kW AC${s.dcAcRatio === null ? '' : ` · DC/AC ${s.dcAcRatio.toFixed(2)}`}`,
        `${s.moduleCount} modules · ${s.inverterCount} inverters`,
        `Strings: ${s.strings.pass} pass · ${s.strings.warn} warn · ${s.strings.fail} fail`,
        s.utilisationPct === null ? 'Roof utilisation: —' : `Roof utilisation: ${s.utilisationPct.toFixed(1)} %`,
      ],
      legend, attribution: src.attribution,
      warnings: [
        ...(scaleChanged ? ['The sheet scale changed since some objects were drawn; lengths use each object’s recorded scale.'] : []),
        ...(s.arraysOutsideRoof.length ? ['An array lies outside every roof area.'] : []),
      ],
    })
  } catch {
    return { error: 'The sheet image could not be read — try again.' }
  }

  const storagePath = `${l.organisation_id}/${input.projectId}/solar-layout-sheets/${input.layoutId}-v${version}.pdf`
  const { error: upErr } = await service.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: 'Could not store the sheet — try again.' }
  const { data: rep, error: insErr } = await service.schema('projects').from('reports').insert({
    organisation_id: l.organisation_id,
    project_id: input.projectId,
    kind: 'solar_layout_sheet',
    source_table: 'solar.layouts',
    source_id: input.layoutId,
    title: `PV layout — ${l.name}`,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version,
    summary: { modules: s.moduleCount, kwp: s.dcKwp, strings: s.strings.total },
    note: input.note ?? null,
    generated_by: user.id,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await service.storage.from('reports').remove([storagePath])
    return { error: 'Could not save the sheet — try again.' }
  }
  if (prior) await service.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', (prior as { id: string }).id)
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'layout_sheet_exported', objectRef: { layoutId: input.layoutId, version } })
  revalidatePath(`/projects/${input.projectId}/solar/layout/${input.layoutId}`)
  return { ok: true, version, reportId }
}
