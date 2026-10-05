'use server'
/**
 * Load profile tab (E8). Every action gates itself on the caller's EFFECTIVE project role
 * (requireEffectiveRole — a result object, checked with `.ok`), then writes through the caller's
 * session so 00225's RLS is the second gate. Not Solar-gated (E8-D1).
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { LOAD_PROFILE_BUCKET, LOAD_PROFILE_READ_ROLES, LOAD_PROFILE_WRITE_ROLES } from '@/lib/load-profile/access'
import { buildMeterRows, parseStoredFile, type ChannelSelection, type ParseResult } from '@/lib/load-profile/pipeline'
import { listPublishedLicensees, listPublishedTariffs, loadCostingTariff, type PublishedLicensee, type PublishedTariffOption } from '@/lib/load-profile/tariff-source'
import type { AnyClient } from '@/lib/load-profile/load'

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

const SelectionSchema = z.object({ column: z.string().min(1).max(200), label: z.string().max(200), withKva: z.boolean() })
const CommitSchema = z.object({
  path: z.string().min(1).max(300),
  fileName: z.string().min(1).max(255),
  sheet: z.string().max(200).nullable(),
  selections: z.array(SelectionSchema).min(1).max(20),
})

export async function commitLoadProfileFileAction(projectId: string, input: { path: string; fileName: string; sheet: string | null; selections: ChannelSelection[] }): Promise<{ ok: true; imported: number; replaced: number } | Err> {
  const parsed = CommitSchema.safeParse(input)
  if (!parsed.success) return { error: 'Choose at least one channel to import.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  const built = await buildMeterRows({ download: downloader(g.supabase), projectId, ...parsed.data })
  if (!built.ok) return { error: built.error }
  const t = g.supabase.schema('projects').from('load_profile_sources')
  let imported = 0
  let replaced = 0
  for (const row of built.rows) {
    const { data: existing } = await t.select('id').eq('profile_id', profileId).eq('file_sha256', row.file_sha256).eq('source_column', row.source_column).maybeSingle()
    if (existing) {
      const { error } = await t.update({ ...row, included: true }).eq('id', (existing as { id: string }).id)
      if (error) return { error: GENERIC }
      replaced++
    } else {
      const { error } = await t.insert({ ...row, profile_id: profileId })
      if (error) return { error: GENERIC }
      imported++
    }
  }
  revalidatePath(pagePath(projectId))
  return { ok: true, imported, replaced }
}

// ── Synthetic blocks ──────────────────────────────────────────────────────────

const ARCHETYPES = ['retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant'] as const
const SyntheticSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tenant_schedule'), label: z.string().trim().min(1).max(200), params: z.object({ commonAreaPct: z.number().min(0).max(100) }) }),
  z.object({
    kind: z.literal('admd'), label: z.string().trim().min(1).max(200),
    params: z.object({ units: z.number().int().min(1).max(100_000), admdKva: z.number().min(0.1).max(1000), archetype: z.enum(ARCHETYPES) }),
  }),
])
export type SyntheticInput = z.infer<typeof SyntheticSchema>

export async function addSyntheticSourceAction(projectId: string, input: SyntheticInput): Promise<{ ok: true } | Err> {
  const parsed = SyntheticSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the values.' }
  const g = await gate(projectId, LOAD_PROFILE_WRITE_ROLES)
  if ('error' in g) return g
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  const { error } = await g.supabase.schema('projects').from('load_profile_sources').insert({ profile_id: profileId, ...parsed.data })
  if (error) return { error: GENERIC }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

const UpdateSchema = z.object({ included: z.boolean().optional(), label: z.string().trim().min(1).max(200).optional() })

export async function updateLoadProfileSourceAction(projectId: string, sourceId: string, patch: { included?: boolean; label?: string }): Promise<{ ok: true } | Err> {
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
  const t = g.supabase.schema('projects').from('load_profile_sources')
  const { data, error } = await t.delete().eq('id', sourceId).eq('project_id', projectId).select('file_path')
  if (error) return { error: GENERIC }
  if (!data || data.length === 0) return { error: 'That source is not in this project.' }
  // Remove the raw file once no source of this project still points at it.
  const filePath = (data[0] as { file_path: string | null }).file_path
  if (filePath) {
    const { count } = await t.select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('file_path', filePath)
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
  if (parsed.data.tariffId && !(await loadCostingTariff(parsed.data.tariffId))) return { error: 'That tariff is not published.' }
  const profileId = await ensureProfile(g.supabase, projectId)
  if (typeof profileId !== 'string') return profileId
  const { referenceYear, powerFactor, nmdKva, tariffId } = parsed.data
  const { error } = await g.supabase.schema('projects').from('load_profiles')
    .update({ reference_year: referenceYear, power_factor: powerFactor, nmd_kva: nmdKva, tariff_id: tariffId }).eq('id', profileId)
  if (error) return { error: GENERIC }
  revalidatePath(pagePath(projectId))
  return { ok: true }
}

export async function listPublishedLicenseesAction(projectId: string): Promise<{ ok: true; licensees: PublishedLicensee[] } | Err> {
  const g = await gate(projectId, LOAD_PROFILE_READ_ROLES)
  if ('error' in g) return g
  try {
    return { ok: true, licensees: await listPublishedLicensees() }
  } catch {
    return { error: GENERIC }
  }
}

export async function listPublishedTariffsAction(projectId: string, licenseeId: string): Promise<{ ok: true; tariffs: PublishedTariffOption[] } | Err> {
  if (!uuid.safeParse(licenseeId).success) return { error: 'Unknown supplier.' }
  const g = await gate(projectId, LOAD_PROFILE_READ_ROLES)
  if ('error' in g) return g
  try {
    return { ok: true, tariffs: await listPublishedTariffs(licenseeId) }
  } catch {
    return { error: GENERIC }
  }
}
