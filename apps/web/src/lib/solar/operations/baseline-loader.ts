import 'server-only'
/**
 * Seed an installation from the study's ACCEPTED proposal (spec §10): the run it froze → the
 * modelled baseline (frozen in the installation row) and the as-built record. Service client, used
 * only after the caller's Edit gate: proposals are a money table, but only their id / version /
 * run id are read here, and none of it is returned to the browser except the version number.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { decodeHourlyCsv } from '@esite/shared/solar-cases'
import { parsePvgisTmyCsv } from '@esite/shared/solar-engine'
import { asBuiltFromCase, buildBaseline, type AsBuilt, type OpsBaseline } from '@esite/shared/solar-operations'
import { getGzipText, RUNS_BUCKET, WEATHER_BUCKET } from '@/lib/solar/cases/storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const INSTALL_REASONS = {
  noStudy: 'Save Site & Supply first — the installation belongs to the study.',
  noAccepted: 'No accepted proposal yet. A client accepts a proposal on Reports & Proposal; the installation starts from it.',
  runMissing: 'The accepted proposal’s run is no longer stored, so its modelled baseline cannot be read.',
  runUnreadable: 'The accepted run’s hourly results could not be read — try again.',
  exists: 'This study already has an installation record.',
} as const

/** The parts of the stored case config the seed reads; passthrough so 4b's schema can grow. */
const SystemSnapshot = z.object({
  pv: z.object({
    dcKwp: z.number(), acKw: z.number(), tiltDeg: z.number(), azimuthDeg: z.number(),
    module: z.object({ make: z.string(), model: z.string(), pmaxW: z.number() }).passthrough().nullable(),
    inverter: z.object({ make: z.string(), model: z.string(), acKw: z.number() }).passthrough().nullable(),
  }).passthrough(),
  battery: z.object({
    enabled: z.boolean(),
    unit: z.object({ make: z.string(), model: z.string(), usableKwh: z.number(), powerKw: z.number() }).passthrough().nullable(),
    usableKwh: z.number(), maxDischargeKw: z.number(),
  }).passthrough(),
  degradation: z.object({ annualPct: z.number() }).passthrough(),
}).passthrough()

export async function acceptedProposal(svc: AnyClient, studyId: string): Promise<{ id: string; version: number; caseRunId: string | null } | null> {
  const { data } = await svc.schema('solar').from('proposals').select('id, version, case_run_id, issued_at')
    .eq('study_id', studyId).eq('status', 'accepted').order('issued_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  const r = data as Row
  return { id: String(r.id), version: Number(r.version), caseRunId: (r.case_run_id as string | null) ?? null }
}

export type InstallationSeed =
  | { ok: true; proposalId: string; baseline: OpsBaseline; asBuilt: AsBuilt; degradationPctPerYear: number }
  | { ok: false; reason: string }

export async function loadInstallationSeed(svc: AnyClient, studyId: string): Promise<InstallationSeed> {
  const prop = await acceptedProposal(svc, studyId)
  if (!prop) return { ok: false, reason: INSTALL_REASONS.noAccepted }
  if (!prop.caseRunId) return { ok: false, reason: INSTALL_REASONS.runMissing }
  const { data: runRow } = await svc.schema('solar').from('case_runs')
    .select('id, status, inputs_hash, hourly_path, weather_dataset_id, config_snapshot, outputs').eq('id', prop.caseRunId).maybeSingle()
  const run = runRow as Row | null
  if (!run || run.status !== 'succeeded' || !run.hourly_path) return { ok: false, reason: INSTALL_REASONS.runMissing }

  let pvAc: Float64Array
  try {
    pvAc = decodeHourlyCsv(await getGzipText(svc, RUNS_BUCKET, String(run.hourly_path))).pvAc
  } catch {
    return { ok: false, reason: INSTALL_REASONS.runUnreadable }
  }

  let tmyRows: Array<{ month: number; ghi: number }> | null = null
  try {
    const { data: w } = await svc.schema('solar').from('weather_datasets').select('storage_path').eq('id', String(run.weather_dataset_id)).maybeSingle()
    if (w) tmyRows = parsePvgisTmyCsv(await getGzipText(svc, WEATHER_BUCKET, String((w as Row).storage_path))).rows.map((r) => ({ month: r.month, ghi: r.ghi }))
  } catch {
    tmyRows = null
  }

  const outputs = (run.outputs ?? {}) as { kpis?: { dcKwp: number; acKw: number; performanceRatio: number }; monthly?: Array<{ month: number; pvKwh: number }> }
  if (!outputs.kpis || !outputs.monthly) return { ok: false, reason: INSTALL_REASONS.runMissing }
  let baseline: OpsBaseline
  try {
    baseline = buildBaseline({ caseRunId: String(run.id), inputsHash: String(run.inputs_hash), kpis: outputs.kpis, monthly: outputs.monthly, pvAc, tmyRows })
  } catch {
    return { ok: false, reason: INSTALL_REASONS.runMissing }
  }

  const sys = SystemSnapshot.safeParse(run.config_snapshot)
  const asBuilt: AsBuilt = sys.success
    ? asBuiltFromCase(sys.data)
    : { dcKwp: baseline.dcKwp, acKw: baseline.acKw, batteryKwh: null, batteryKw: null, tiltDeg: null, azimuthDeg: null, equipment: [] }
  return { ok: true, proposalId: prop.id, baseline, asBuilt, degradationPctPerYear: sys.success ? sys.data.degradation.annualPct : 0 }
}
