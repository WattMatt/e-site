'use server'
/**
 * Load profile tab (E8). Every action gates itself on the caller's EFFECTIVE project role
 * (requireEffectiveRole — a result object, checked with `.ok`), then writes through the caller's
 * session so 00230's RLS is the second gate. Not Solar-gated (E8-D1).
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { LOAD_PROFILE_BUCKET, LOAD_PROFILE_READ_ROLES, LOAD_PROFILE_WRITE_ROLES, MAX_PROFILE_SLOTS } from '@/lib/load-profile/access'
import { buildMeterRows, parseStoredFile, type ChannelSelection, type ParseResult } from '@/lib/load-profile/pipeline'
import { listPublishedLicensees, listPublishedTariffs, loadCostingTariff, type PublishedLicensee, type PublishedTariffOption } from '@/lib/load-profile/tariff-source'
import { loadTenants, type AnyClient } from '@/lib/load-profile/load'
import { computeTenantBenchmarks } from '@/lib/load-profile/benchmarks'
import { LOAD_ROLES, roleOfKind, type MeterKind } from '@esite/shared/load-profile'

type Err = { error: string }
const GENERIC = 'Something went wrong. Try again.'
const pagePath = (projectId: string) => `/projects/${projectId}/load-profile`
const uuid = z.string().uuid()

async function gate(projectId: string, roles: typeof LOAD_PROFILE_READ_ROLES): Promise<{ supabase: AnyClient } | Err> {
  if (!uuid.safeParse(projectId).success) return { error: 'Unknown project.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const r = await requireEffectiveRole(supabase, projectId, roles)
  if (!r.ok) return { error: r.error }
  return { supabase }
}

function downloader(supabase: AnyClient) {
  return async (path: string) => {
    const { data, error } = await supabase.storage.from(LOAD_PROFILE_BUCKET).download(path)
    if (error || !data) return null
    return new Uint8Array(await data.arrayBuffer())
  }
}

async function ensureProfile(supabase: AnyClient, projectId: string): Promise<string | Err> {
  const p = supabase.schema('projects')
  const { data } = await p.from('load_profiles').select('id').eq('project_id', projectId).maybeSingle()
  if (data) return (data as { id: string }).id
  const { data: made, error } = await p.from('load_profiles').insert({ project_id: projectId }).select('id').single()
  if (error) {
    // A concurrent first import created it: read it back.
    const again = await p.from('load_profiles').select('id').eq('project_id', projectId).maybeSingle()
    return again.data ? (again.data as { id: string }).id : { error: GENERIC }
  }
  return (made as { id: string }).id
}

// ── Import ────────────────────────────────────────────────────────────────────

export async function parseLoadProfileFileAction(projectId: string, path: string, fileName: string): Promise<ParseResult | Err> {
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  try {
    return await parseStoredFile({ download: downloader(g.supabase), projectId, path, fileName: fileName.slice(0, 255) })
  } catch {
    return { error: 'The file could not be read as a meter export.' }
  }
}

const SelectionSchema = z.object({
  column: z.string().min(1).max(200),
  label: z.string().max(200, 'A label can be at most 200 characters.'),
  withKva: z.boolean(),
  role: z.enum(LOAD_ROLES),
})
const CommitSchema = z.object({
  path: z.string().min(1).max(300),
  fileName: z.string().min(1).max(255),
  sheet: z.string().max(200).nullable(),
  selections: z.array(SelectionSchema).min(1, 'Choose at least one channel to import.').max(20, 'Import at most 20 channels at a time.'),
})


export async function commitLoadProfileFileAction(projectId: string, input: { path: string; fileName: string; sheet: string | null; selections: ChannelSelection[] }): Promise<{ ok: true; imported: number; replaced: number; warnings: string[] } | Err> {
  const parsed = CommitSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the channels to import.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  const built = await buildMeterRows({ download: downloader(g.supabase), projectId, ...parsed.data })
  if (!built.ok) return { error: built.error }
  const t = () => g.supabase.schema('projects').from('load_profile_sources')
  const { data: held } = await t().select('file_sha256, source_column, kva_column, slots:quality_report->>slots').eq('profile_id', profileId).eq('kind', 'meter')
  const replacing = new Set(built.rows.map((r) => `${r.file_sha256}|${r.source_column}`))
  // A paired kVA channel stores a second array of the same length: it counts twice.
  const kept = ((held ?? []) as Array<{ file_sha256: string; source_column: string; kva_column: string | null; slots: string | null }>)
    .filter((h) => !replacing.has(`${h.file_sha256}|${h.source_column}`))
    .reduce((sum, h) => sum + Number(h.slots ?? 0) * (h.kva_column ? 2 : 1), 0)
  const adding = built.rows.reduce((sum, r) => sum + r.values.length * (r.kva_values ? 2 : 1), 0)
  if (kept + adding > MAX_PROFILE_SLOTS) {
    return { error: `This would hold ${(kept + adding).toLocaleString('en-ZA')} readings; a profile holds at most ${MAX_PROFILE_SLOTS.toLocaleString('en-ZA')}. Remove a source, or import fewer channels.` }
  }
  let imported = 0
  let replaced = 0
  for (const row of built.rows) {
    const { data: existing } = await t().select('id').eq('profile_id', profileId).eq('file_sha256', row.file_sha256).eq('source_column', row.source_column).maybeSingle()
    if (existing) {
      const { error } = await t().update({ ...row, included: true }).eq('id', (existing as { id: string }).id)
      if (error) return { error: GENERIC }
      replaced++
    } else {
      const { error } = await t().insert({ ...row, profile_id: profileId })
      if (error) return { error: GENERIC }
      imported++
    }
  }
  revalidatePath(pagePath(projectId))
  return { ok: true, imported, replaced, warnings: built.warnings }
}

// ── Synthetic blocks ──────────────────────────────────────────────────────────

const ARCHETYPES = ['retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant'] as const
const SyntheticSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tenant_schedule'), label: z.string().trim().min(1).max(200),
    params: z.object({ commonAreaPct: z.number().min(0).max(100), basis: z.enum(['measured', 'generic']).default('measured') }),
  }),
  z.object({
    kind: z.literal('admd'), label: z.string().trim().min(1).max(200),
    params: z.object({ units: z.number().int().min(1).max(100_000), admdKva: z.number().min(0.1).max(1000), archetype: z.enum(ARCHETYPES) }),
  }),
])
export type SyntheticInput = z.input<typeof SyntheticSchema>

export async function addSyntheticSourceAction(projectId: string, input: SyntheticInput): Promise<{ ok: true } | Err> {
  const parsed = SyntheticSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the values.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  // An estimate of the tenants stands in for them; an ADMD block is new load on top (roles.ts).
  const role = parsed.data.kind === 'admd' ? 'addition' : 'tenant'
  const { data: made, error } = await g.supabase.schema('projects').from('load_profile_sources').insert({ profile_id: profileId, ...parsed.data, role }).select('id').single()
  if (error || !made) return { error: GENERIC }
  if (parsed.data.kind === 'tenant_schedule' && parsed.data.params.basis === 'measured') {
    const r = await refreshBenchmarks(g.supabase, projectId, (made as { id: string }).id)
    if ('error' in r) { revalidatePath(pagePath(projectId)); return { error: `The estimate was added with generic figures: ${r.error}` } }
  }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

// ── Measured tenant benchmarks ────────────────────────────────────────────────

/**
 * Re-reads the library's measured stores for every tenant brand in the schedule and stores the
 * benchmarks on the source (benchmark-store.ts). Reads through the caller's session: an org without a
 * Solar library gets none, so every tenant stays on the generic figures.
 */
async function refreshBenchmarks(supabase: AnyClient, projectId: string, sourceId: string): Promise<{ ok: true; brands: number } | Err> {
  const p = supabase.schema('projects')
  const { data: src } = await p.from('load_profile_sources').select('id, kind, params, profile_id').eq('id', sourceId).eq('project_id', projectId).maybeSingle()
  const row = src as { kind: string; params: Record<string, unknown> | null; profile_id: string } | null
  if (!row || row.kind !== 'tenant_schedule') return { error: 'That tenant-schedule estimate is not in this project.' }
  const { data: prof } = await p.from('load_profiles').select('reference_year').eq('id', row.profile_id).maybeSingle()
  const referenceYear = prof ? Number((prof as { reference_year: number }).reference_year) : 2025
  let benchmarks
  try {
    const tenants = await loadTenants(supabase, projectId)
    benchmarks = await computeTenantBenchmarks(supabase, tenants.map((t) => t.matchName ?? t.label), referenceYear)
  } catch (e) {
    console.error('[load-profile] benchmarks', e)
    return { error: 'the library could not be read. Try Refresh again.' }
  }
  const { data, error } = await p.from('load_profile_sources').update({ params: { ...(row.params ?? {}), basis: 'measured', benchmarks } }).eq('id', sourceId).eq('project_id', projectId).select('id')
  if (error || !data?.length) return { error: GENERIC }
  return { ok: true, brands: Object.keys(benchmarks.byKey).length }
}

export async function refreshTenantBenchmarksAction(projectId: string, sourceId: string): Promise<{ ok: true; brands: number } | Err> {
  if (!uuid.safeParse(sourceId).success) return { error: 'Unknown source.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const r = await refreshBenchmarks(g.supabase, projectId, sourceId)
  revalidatePath(pagePath(projectId))
  return r
}

/** Generic figures, or measured stores of each tenant's brand (computed now if never computed). */
export async function setTenantEstimateBasisAction(projectId: string, sourceId: string, basis: 'measured' | 'generic'): Promise<{ ok: true } | Err> {
  if (!uuid.safeParse(sourceId).success || (basis !== 'measured' && basis !== 'generic')) return { error: 'Check the values.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const p = g.supabase.schema('projects')
  const { data: src } = await p.from('load_profile_sources').select('kind, params').eq('id', sourceId).eq('project_id', projectId).maybeSingle()
  const row = src as { kind: string; params: Record<string, unknown> | null } | null
  if (!row || row.kind !== 'tenant_schedule') return { error: 'That tenant-schedule estimate is not in this project.' }
  if (basis === 'measured' && !row.params?.benchmarks) {
    const r = await refreshBenchmarks(g.supabase, projectId, sourceId)
    revalidatePath(pagePath(projectId))
    return 'error' in r ? r : { ok: true }
  }
  const { error } = await p.from('load_profile_sources').update({ params: { ...(row.params ?? {}), basis } }).eq('id', sourceId).eq('project_id', projectId)
  if (error) return { error: GENERIC }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

const UpdateSchema = z.object({ included: z.boolean().optional(), label: z.string().trim().min(1).max(200).optional(), role: z.enum(LOAD_ROLES).optional() })

export async function updateLoadProfileSourceAction(projectId: string, sourceId: string, patch: { included?: boolean; label?: string; role?: (typeof LOAD_ROLES)[number] }): Promise<{ ok: true } | Err> {
  const parsed = UpdateSchema.safeParse(patch)
  if (!parsed.success || !uuid.safeParse(sourceId).success) return { error: 'Check the values.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('projects').from('load_profile_sources').update(parsed.data).eq('id', sourceId).eq('project_id', projectId).select('id')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: 'That source is not in this project.' }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

export async function deleteLoadProfileSourceAction(projectId: string, sourceId: string): Promise<{ ok: true } | Err> {
  if (!uuid.safeParse(sourceId).success) return { error: 'Unknown source.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const t = () => g.supabase.schema('projects').from('load_profile_sources')
  const { data, error } = await t().delete().eq('id', sourceId).eq('project_id', projectId).select('file_path')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: 'That source is not in this project.' }
  // Remove the raw file once no source of this project still points at it.
  const filePath = (data[0] as { file_path: string | null }).file_path
  if (filePath) {
    const { count } = await t().select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('file_path', filePath)
    if (!count) await g.supabase.storage.from(LOAD_PROFILE_BUCKET).remove([filePath])
  }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

// ── Settings + tariff ─────────────────────────────────────────────────────────

const SettingsSchema = z.object({
  referenceYear: z.number().int().min(2000).max(2100),
  powerFactor: z.number().gt(0).max(1),
  nmdKva: z.number().positive().max(1_000_000).nullable(),
  tariffId: z.string().uuid().nullable(),
})

export async function saveLoadProfileSettingsAction(projectId: string, input: z.infer<typeof SettingsSchema>): Promise<{ ok: true } | Err> {
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the values.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  if (parsed.data.tariffId && !(await loadCostingTariff(g.supabase, parsed.data.tariffId))) return { error: 'That tariff is not available: it is not published, or the tariff library is not open to your organisation yet.' }
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  const { referenceYear, powerFactor, nmdKva, tariffId } = parsed.data
  const { error } = await g.supabase.schema('projects').from('load_profiles')
    .update({ reference_year: referenceYear, power_factor: powerFactor, nmd_kva: nmdKva, tariff_id: tariffId }).eq('id', profileId)
  if (error) return { error: GENERIC }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

/** The pickers serve whoever may CHOOSE a tariff (write roles); readers see only the chosen one's bill. */
export async function listPublishedLicenseesAction(projectId: string): Promise<{ ok: true; licensees: PublishedLicensee[] } | Err> {
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  try {
    return { ok: true, licensees: await listPublishedLicensees(g.supabase) }
  } catch {
    return { error: GENERIC }
  }
}

export async function listPublishedTariffsAction(projectId: string, licenseeId: string): Promise<{ ok: true; tariffs: PublishedTariffOption[] } | Err> {
  if (!uuid.safeParse(licenseeId).success) return { error: 'Unknown supplier.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  try {
    return { ok: true, tariffs: await listPublishedTariffs(g.supabase, licenseeId) }
  } catch {
    return { error: GENERIC }
  }
}

// ── Solar library meters ─────────────────────────────────────────────────────

export interface LibraryMeterOption { id: string; label: string; kind: string; siteLabel: string | null; shopNo: string | null; inThisProject: boolean }

/**
 * Meters of the org's Solar library: those whose files were imported for THIS project first, then any
 * matching `q` (label or site). Read through the caller's session, so Solar RLS decides what is listed.
 */
export async function listLibraryMetersAction(projectId: string, q = ''): Promise<{ ok: true; meters: LibraryMeterOption[] } | Err> {
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const solar = g.supabase.schema('solar')
  // Fully imported files only: a file that failed part-way leaves a meter that must not be offered.
  const { data: files } = await solar.from('meter_files').select('id').eq('project_id', projectId).eq('status', 'accepted').limit(2000)
  const fileIds = ((files ?? []) as Array<{ id: string }>).map((f) => f.id)
  const here = new Set<string>()
  for (let i = 0; i < fileIds.length; i += 150) {
    const { data } = await solar.from('meter_series_hashes').select('meter_id').in('file_id', fileIds.slice(i, i + 150))
    for (const r of (data ?? []) as Array<{ meter_id: string }>) here.add(r.meter_id)
  }
  const cols = 'id, label, kind, site_label, shop_no'
  const ownRows: Array<Record<string, unknown>> = []
  const hereIds = [...here]
  for (let i = 0; i < hereIds.length; i += 150) {
    const { data } = await solar.from('meters').select(cols).in('id', hereIds.slice(i, i + 150))
    ownRows.push(...((data ?? []) as Array<Record<string, unknown>>))
  }
  const own = { data: ownRows }
  const term = q.trim().replace(/[%,()]/g, ' ').slice(0, 60)
  const found = term ? await solar.from('meters').select(cols).or(`label.ilike.%${term}%,site_label.ilike.%${term}%`).neq('kind', 'water').order('site_label').order('label').limit(200) : { data: [] }
  const seen = new Set<string>()
  const meters: LibraryMeterOption[] = []
  for (const m of [...((own.data ?? []) as Array<Record<string, unknown>>), ...((found.data ?? []) as Array<Record<string, unknown>>)]) {
    const id = String(m.id)
    if (seen.has(id)) continue
    seen.add(id)
    meters.push({ id, label: String(m.label), kind: String(m.kind), siteLabel: (m.site_label as string | null) ?? null, shopNo: (m.shop_no as string | null) ?? null, inThisProject: here.has(id) })
  }
  meters.sort((a, b) => Number(b.inThisProject) - Number(a.inThisProject) || (a.siteLabel ?? '').localeCompare(b.siteLabel ?? '') || a.label.localeCompare(b.label))
  return { ok: true, meters }
}

/** Reference library meters from this project's profile; the role defaults from the meter's kind. */
export async function addLibraryMetersAction(projectId: string, meterIds: string[]): Promise<{ ok: true; added: number } | Err> {
  const ids = [...new Set(meterIds)]
  if (ids.length === 0 || ids.length > 150 || !ids.every((id) => uuid.safeParse(id).success)) return { error: 'Choose between 1 and 150 meters.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const { data: meters, error } = await g.supabase.schema('solar').from('meters').select('id, label, kind, site_label').in('id', ids)
  if (error) return { error: GENERIC }
  const visible = (meters ?? []) as Array<{ id: string; label: string; kind: MeterKind; site_label: string | null }>
  if (visible.length !== ids.length) return { error: 'Some of those meters are not in your organisation\'s Solar library.' }
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  const t = () => g.supabase.schema('projects').from('load_profile_sources')
  const { data: held } = await t().select('solar_meter_id').eq('profile_id', profileId).in('solar_meter_id', ids)
  const already = new Set(((held ?? []) as Array<{ solar_meter_id: string }>).map((h) => h.solar_meter_id))
  const rows = visible.filter((m) => !already.has(m.id)).map((m) => ({
    profile_id: profileId, kind: 'library_meter', solar_meter_id: m.id, role: roleOfKind(m.kind),
    label: `${m.site_label ? `${m.site_label} · ` : ''}${m.label}`.slice(0, 200),
  }))
  if (rows.length) {
    const { error: e } = await t().insert(rows)
    if (e) return { error: GENERIC }
  }
  revalidatePath(pagePath(projectId))
  return { ok: true, added: rows.length }
}
