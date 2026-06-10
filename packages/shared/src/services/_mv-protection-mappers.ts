/**
 * Row ↔ camelCase mappers for the four MV-protection tables (migrations
 * 00124 / 00125). PostgREST returns NUMERIC columns as strings, so every
 * numeric is coerced with `num` (which preserves null — never coerces to 0).
 *
 * The flat `lv_earthing_kind` / `lv_earthing_ohm` columns are re-assembled into
 * the nested `lvEarthing: { kind, ohm } | null` that the engine adapter
 * (`buildMvNetwork`'s FaultSource.lv_earthing) consumes. `*ToRow` mappers are
 * defined-keys-only (undefined skipped, explicit null passed through) so they
 * suit upsert/patch — matching the boq / project-settings mapper convention.
 */
import type {
  FaultSourceInput,
  ProtectionDeviceInput,
  MvStudySettingsInput,
  FaultSourceRole,
  EarthingKind,
  DeviceRole,
  DeviceType,
  ProtectionDeviceSettings,
} from '../schemas/mv-protection.schema'
import type { FaultSource as AdapterFaultSource } from './mv-network.service'

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

// ─────────────────────────────────────────────────────────────────────────
// Domain row shapes (camelCase) — what the service returns to callers.
// ─────────────────────────────────────────────────────────────────────────

// NOTE: prefixed `Mv*` to avoid colliding with the engine-input shapes
// `FaultSource` / `MvStudySettings` that mv-network.service already exports
// through the services barrel — these are the persisted camelCase domain rows.
export interface MvStudySettingsRow {
  id: string
  organisationId: string
  revisionId: string
  baseMva: number
  cMax: number
  cMin: number
  efFaultResistanceOhm: number
  frequencyHz: number
  createdAt: string
  updatedAt: string
}

export interface MvFaultSourceRow {
  id: string
  organisationId: string
  revisionId: string
  nodeId: string | null
  sourceId: string | null
  role: FaultSourceRole
  sscMva: number | null
  xrRatio: number | null
  z0OverZ1: number | null
  ukPct: number | null
  pkrW: number | null
  sRatedVa: number | null
  vectorGroup: string | null
  lvEarthingKind: EarthingKind | null
  lvEarthingOhm: number | null
  xdPct: number | null
  currentLimitFactor: number | null
  createdAt: string
  updatedAt: string
}

export interface MvProtectionDeviceRow {
  id: string
  organisationId: string
  revisionId: string
  nodeId: string | null
  supplyId: string | null
  deviceRole: DeviceRole
  deviceType: DeviceType
  manufacturer: string | null
  model: string | null
  frameRatingA: number | null
  curveRef: string | null
  settings: ProtectionDeviceSettings
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────
// mv_study_settings
// ─────────────────────────────────────────────────────────────────────────

export function rowToMvStudySettings(r: Record<string, unknown>): MvStudySettingsRow {
  return {
    id: r.id as string,
    organisationId: r.organisation_id as string,
    revisionId: r.revision_id as string,
    baseMva: num(r.base_mva) ?? 100,
    cMax: num(r.c_max) ?? 1.1,
    cMin: num(r.c_min) ?? 1.0,
    efFaultResistanceOhm: num(r.ef_fault_resistance_ohm) ?? 0,
    frequencyHz: num(r.frequency_hz) ?? 50,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

/** camelCase patch → snake_case row patch (defined keys only). */
export function mvStudySettingsToRow(patch: Partial<MvStudySettingsInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.baseMva !== undefined) out.base_mva = patch.baseMva
  if (patch.cMax !== undefined) out.c_max = patch.cMax
  if (patch.cMin !== undefined) out.c_min = patch.cMin
  if (patch.efFaultResistanceOhm !== undefined) out.ef_fault_resistance_ohm = patch.efFaultResistanceOhm
  if (patch.frequencyHz !== undefined) out.frequency_hz = patch.frequencyHz
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// fault_sources
// ─────────────────────────────────────────────────────────────────────────

export function rowToFaultSource(r: Record<string, unknown>): MvFaultSourceRow {
  return {
    id: r.id as string,
    organisationId: r.organisation_id as string,
    revisionId: r.revision_id as string,
    nodeId: (r.node_id as string) ?? null,
    sourceId: (r.source_id as string) ?? null,
    role: r.role as FaultSourceRole,
    sscMva: num(r.ssc_mva),
    xrRatio: num(r.xr_ratio),
    z0OverZ1: num(r.z0_over_z1),
    ukPct: num(r.uk_pct),
    pkrW: num(r.pkr_w),
    sRatedVa: num(r.s_rated_va),
    vectorGroup: (r.vector_group as string) ?? null,
    lvEarthingKind: (r.lv_earthing_kind as EarthingKind) ?? null,
    lvEarthingOhm: num(r.lv_earthing_ohm),
    xdPct: num(r.xd_pct),
    currentLimitFactor: num(r.current_limit_factor),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

/** camelCase patch → snake_case row patch (defined keys only). */
export function faultSourceToRow(patch: Partial<FaultSourceInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.nodeId !== undefined) out.node_id = patch.nodeId
  if (patch.sourceId !== undefined) out.source_id = patch.sourceId
  if (patch.role !== undefined) out.role = patch.role
  if (patch.sscMva !== undefined) out.ssc_mva = patch.sscMva
  if (patch.xrRatio !== undefined) out.xr_ratio = patch.xrRatio
  if (patch.z0OverZ1 !== undefined) out.z0_over_z1 = patch.z0OverZ1
  if (patch.ukPct !== undefined) out.uk_pct = patch.ukPct
  if (patch.pkrW !== undefined) out.pkr_w = patch.pkrW
  if (patch.sRatedVa !== undefined) out.s_rated_va = patch.sRatedVa
  if (patch.vectorGroup !== undefined) out.vector_group = patch.vectorGroup
  if (patch.lvEarthingKind !== undefined) out.lv_earthing_kind = patch.lvEarthingKind
  if (patch.lvEarthingOhm !== undefined) out.lv_earthing_ohm = patch.lvEarthingOhm
  if (patch.xdPct !== undefined) out.xd_pct = patch.xdPct
  if (patch.currentLimitFactor !== undefined) out.current_limit_factor = patch.currentLimitFactor
  return out
}

/**
 * Shape a fault_sources row for `buildMvNetwork`'s FaultSource input —
 * assembling the nested `lv_earthing: { kind, ohm } | null` from the flat
 * `lv_earthing_kind` / `lv_earthing_ohm` columns. Numerics already coerced.
 */
export function rowToAdapterFaultSource(r: Record<string, unknown>): AdapterFaultSource {
  const lvKind = (r.lv_earthing_kind as EarthingKind | null) ?? null
  return {
    node_id: (r.node_id as string) ?? null,
    source_id: (r.source_id as string) ?? null,
    role: r.role as AdapterFaultSource['role'],
    ssc_mva: num(r.ssc_mva),
    xr_ratio: num(r.xr_ratio),
    z0_over_z1: num(r.z0_over_z1),
    uk_pct: num(r.uk_pct),
    pkr_w: num(r.pkr_w),
    s_rated_va: num(r.s_rated_va),
    vector_group: (r.vector_group as string) ?? null,
    lv_earthing: lvKind == null ? null : { kind: lvKind, ohm: num(r.lv_earthing_ohm) },
    xd_pct: num(r.xd_pct),
    current_limit_factor: num(r.current_limit_factor),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// protection_devices
// ─────────────────────────────────────────────────────────────────────────

export function rowToProtectionDevice(r: Record<string, unknown>): MvProtectionDeviceRow {
  return {
    id: r.id as string,
    organisationId: r.organisation_id as string,
    revisionId: r.revision_id as string,
    nodeId: (r.node_id as string) ?? null,
    supplyId: (r.supply_id as string) ?? null,
    deviceRole: r.device_role as DeviceRole,
    deviceType: r.device_type as DeviceType,
    manufacturer: (r.manufacturer as string) ?? null,
    model: (r.model as string) ?? null,
    frameRatingA: num(r.frame_rating_a),
    curveRef: (r.curve_ref as string) ?? null,
    settings: (r.settings as ProtectionDeviceSettings) ?? {},
    createdBy: (r.created_by as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }
}

/** camelCase patch → snake_case row patch (defined keys only). */
export function protectionDeviceToRow(patch: Partial<ProtectionDeviceInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.nodeId !== undefined) out.node_id = patch.nodeId
  if (patch.supplyId !== undefined) out.supply_id = patch.supplyId
  if (patch.deviceRole !== undefined) out.device_role = patch.deviceRole
  if (patch.deviceType !== undefined) out.device_type = patch.deviceType
  if (patch.manufacturer !== undefined) out.manufacturer = patch.manufacturer
  if (patch.model !== undefined) out.model = patch.model
  if (patch.frameRatingA !== undefined) out.frame_rating_a = patch.frameRatingA
  if (patch.curveRef !== undefined) out.curve_ref = patch.curveRef
  if (patch.settings !== undefined) out.settings = patch.settings
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// fault_results — write-only cache (engine output → snake_case rows).
// ─────────────────────────────────────────────────────────────────────────

export interface FaultResultRow {
  nodeId: string
  ik3MaxKa: number | null
  ik3MinKa: number | null
  ik1MaxKa: number | null
  ik1MinKa: number | null
  xrRatio: number | null
  ipKa: number | null
  icAmps: number | null
  basis: string | null
}

/** One per-node computed fault-result → a snake_case row for upsert. */
export function faultResultToRow(
  revisionId: string,
  organisationId: string,
  res: FaultResultRow,
): Record<string, unknown> {
  return {
    revision_id: revisionId,
    organisation_id: organisationId,
    node_id: res.nodeId,
    ik3_max_ka: res.ik3MaxKa,
    ik3_min_ka: res.ik3MinKa,
    ik1_max_ka: res.ik1MaxKa,
    ik1_min_ka: res.ik1MinKa,
    xr_ratio: res.xrRatio,
    ip_ka: res.ipKa,
    ic_amps: res.icAmps,
    basis: res.basis,
  }
}

/**
 * Persisted fault-result row (camelCase) — the read shape the Fault view
 * consumes. Superset of the write `FaultResultRow` with the DB-assigned id +
 * computed_at; numerics already coerced from PostgREST's string NUMERICs.
 */
export interface MvFaultResultRow {
  id: string
  revisionId: string
  nodeId: string
  ik3MaxKa: number | null
  ik3MinKa: number | null
  ik1MaxKa: number | null
  ik1MinKa: number | null
  xrRatio: number | null
  ipKa: number | null
  icAmps: number | null
  basis: string | null
  computedAt: string
}

export function rowToFaultResult(r: Record<string, unknown>): MvFaultResultRow {
  return {
    id: r.id as string,
    revisionId: r.revision_id as string,
    nodeId: r.node_id as string,
    ik3MaxKa: num(r.ik3_max_ka),
    ik3MinKa: num(r.ik3_min_ka),
    ik1MaxKa: num(r.ik1_max_ka),
    ik1MinKa: num(r.ik1_min_ka),
    xrRatio: num(r.xr_ratio),
    ipKa: num(r.ip_ka),
    icAmps: num(r.ic_amps),
    basis: (r.basis as string) ?? null,
    computedAt: r.computed_at as string,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// discrimination_checks — computed cache (read shape).
// ─────────────────────────────────────────────────────────────────────────

export interface MvDiscriminationCheckRow {
  id: string
  revisionId: string
  upstreamDeviceId: string
  downstreamDeviceId: string
  atFaultA: number | null
  tUpS: number | null
  tDownS: number | null
  marginMs: number | null
  verdict: 'ok' | 'marginal' | 'fails'
  computedAt: string
}

export function rowToDiscriminationCheck(r: Record<string, unknown>): MvDiscriminationCheckRow {
  return {
    id: r.id as string,
    revisionId: r.revision_id as string,
    upstreamDeviceId: r.upstream_device_id as string,
    downstreamDeviceId: r.downstream_device_id as string,
    atFaultA: num(r.at_fault_a),
    tUpS: num(r.t_up_s),
    tDownS: num(r.t_down_s),
    marginMs: num(r.margin_ms),
    verdict: r.verdict as 'ok' | 'marginal' | 'fails',
    computedAt: r.computed_at as string,
  }
}
