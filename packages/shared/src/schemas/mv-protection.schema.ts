import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────
// Enums — mirror the DB CHECK constraints from migrations
//   00124_mv_study_and_fault_sources.sql  (fault_sources.role, lv_earthing_kind)
//   00125_mv_devices_and_results.sql       (protection_devices.device_role/type)
// Always derive role/type lists from these consts — never hardcode the strings.
// ─────────────────────────────────────────────────────────────────────────

export const FAULT_SOURCE_ROLES = ['utility', 'transformer', 'generator', 'inverter'] as const
export const EARTHING_KINDS = ['solid', 'resistance', 'reactance'] as const
export const DEVICE_ROLES = ['incomer', 'feeder', 'transformer', 'sub_circuit'] as const
export const DEVICE_TYPES = ['relay', 'MCCB', 'ACB', 'fuse', 'RMU_fuse'] as const

export const faultSourceRoleSchema = z.enum(FAULT_SOURCE_ROLES)
export const earthingKindSchema = z.enum(EARTHING_KINDS)
export const deviceRoleSchema = z.enum(DEVICE_ROLES)
export const deviceTypeSchema = z.enum(DEVICE_TYPES)

const uuid = z.string().uuid()

// ─────────────────────────────────────────────────────────────────────────
// MvStudySettingsInput — write shape for cable_schedule.mv_study_settings.
// Bounds mirror the DB CHECKs (base_mva/c_max/c_min/frequency_hz > 0,
// ef_fault_resistance_ohm >= 0). All optional with the DB defaults documented;
// the service supplies the revision_id / organisation_id (server-resolved).
// ─────────────────────────────────────────────────────────────────────────

export const mvStudySettingsInputSchema = z.object({
  revisionId: uuid,
  baseMva: z.number().positive().optional(),
  cMax: z.number().positive().optional(),
  cMin: z.number().positive().optional(),
  efFaultResistanceOhm: z.number().nonnegative().optional(),
  frequencyHz: z.number().positive().optional(),
})

// ─────────────────────────────────────────────────────────────────────────
// FaultSourceInput — write shape for cable_schedule.fault_sources.
// node_id XOR source_id (mirrors the fault_sources_origin_xor CHECK). Per-role
// fields are all individually optional + bound to the column CHECKs; the engine
// adapter (buildMvNetwork) reads only the fields relevant to `role`.
// ─────────────────────────────────────────────────────────────────────────

export const faultSourceInputSchema = z
  .object({
    revisionId: uuid,
    nodeId: uuid.nullable().optional(),
    sourceId: uuid.nullable().optional(),
    role: faultSourceRoleSchema,
    // utility
    sscMva: z.number().positive().nullable().optional(),
    xrRatio: z.number().nonnegative().nullable().optional(),
    z0OverZ1: z.number().positive().nullable().optional(),
    // transformer
    ukPct: z.number().positive().nullable().optional(),
    pkrW: z.number().nonnegative().nullable().optional(),
    sRatedVa: z.number().positive().nullable().optional(),
    vectorGroup: z.string().trim().max(40).nullable().optional(),
    lvEarthingKind: earthingKindSchema.nullable().optional(),
    lvEarthingOhm: z.number().nonnegative().nullable().optional(),
    // generator
    xdPct: z.number().positive().nullable().optional(),
    // inverter
    currentLimitFactor: z.number().positive().nullable().optional(),
  })
  .refine(
    (d) => (d.nodeId != null) !== (d.sourceId != null),
    { message: 'Exactly one of nodeId or sourceId must be set' },
  )

// ─────────────────────────────────────────────────────────────────────────
// ProtectionDeviceInput — write shape for cable_schedule.protection_devices.
// device_role / device_type mirror the DB CHECKs; settings is the parametric
// IDMT/definite-time JSONB (std/curve/pickup_a/tms/td/dt_s/inst_multiple/
// inst_time_s) — kept as a permissive record (the engine reads it).
// ─────────────────────────────────────────────────────────────────────────

export const protectionDeviceSettingsSchema = z.object({
  std: z.string().optional(),
  curve: z.string().optional(),
  pickupA: z.number().positive().optional(),
  tms: z.number().nonnegative().optional(),
  td: z.number().nonnegative().optional(),
  dtS: z.number().nonnegative().optional(),
  instMultiple: z.number().positive().optional(),
  instTimeS: z.number().nonnegative().optional(),
}).passthrough()

export const protectionDeviceInputSchema = z
  .object({
    revisionId: uuid,
    nodeId: uuid.nullable().optional(),
    supplyId: uuid.nullable().optional(),
    deviceRole: deviceRoleSchema,
    deviceType: deviceTypeSchema,
    manufacturer: z.string().trim().max(120).nullable().optional(),
    model: z.string().trim().max(120).nullable().optional(),
    frameRatingA: z.number().positive().nullable().optional(),
    curveRef: z.string().trim().max(120).nullable().optional(),
    settings: protectionDeviceSettingsSchema.optional(),
  })
  .refine(
    (d) => d.nodeId != null || d.supplyId != null,
    { message: 'A protection device must reference a nodeId and/or a supplyId' },
  )

// ─────────────────────────────────────────────────────────────────────────
// MvStudySignoffInput — write shape for cable_schedule.mv_study_signoff, the
// §9 gated-issue evidence (one row per revision). The four gate fields plus the
// source-data confirmation tick; `signed_off_by` / `signed_off_at` are NOT in
// the input — the action stamps them server-side when the gate is complete.
// All gate fields optional here (a partial save is allowed); completeness is
// judged by `mvSignoffComplete`, and the issue guard enforces it.
// ─────────────────────────────────────────────────────────────────────────

export const mvStudySignoffInputSchema = z.object({
  revisionId: uuid,
  prEngName: z.string().trim().max(160).nullable().optional(),
  prEngEcsaReg: z.string().trim().max(80).nullable().optional(),
  curveManualRev: z.string().trim().max(120).nullable().optional(),
  sourceDataConfirmed: z.boolean().optional(),
  validationPackRef: z.string().trim().max(200).nullable().optional(),
})

// ─────────────────────────────────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────────────────────────────────

export type FaultSourceRole = (typeof FAULT_SOURCE_ROLES)[number]
export type EarthingKind = (typeof EARTHING_KINDS)[number]
export type DeviceRole = (typeof DEVICE_ROLES)[number]
export type DeviceType = (typeof DEVICE_TYPES)[number]
export type MvStudySettingsInput = z.infer<typeof mvStudySettingsInputSchema>
export type MvStudySignoffInput = z.infer<typeof mvStudySignoffInputSchema>
export type FaultSourceInput = z.infer<typeof faultSourceInputSchema>
export type ProtectionDeviceInput = z.infer<typeof protectionDeviceInputSchema>
export type ProtectionDeviceSettings = z.infer<typeof protectionDeviceSettingsSchema>
