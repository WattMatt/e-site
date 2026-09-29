/**
 * The as-built system on an installation (spec §10: "installed system from accepted proposal case,
 * editable as-built"). Seeded from the accepted case's config; every line is editable afterwards.
 * The monthly report prints this table — an empty table is refused at Generate, never filled with
 * placeholders (WM defect M4).
 */
import { z } from 'zod'

export const EQUIPMENT_KINDS = ['module', 'inverter', 'battery', 'other'] as const
export const EQUIPMENT_UNITS = ['W', 'kW', 'kWh'] as const

const num = (min: number, max: number) => z.number().finite().min(min).max(max)

export const EquipmentLineSchema = z.object({
  kind: z.enum(EQUIPMENT_KINDS),
  make: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  rating: z.number().finite().positive().max(10_000_000),
  unit: z.enum(EQUIPMENT_UNITS),
  quantity: z.number().int().min(1).max(1_000_000),
}).strict()
export type EquipmentLine = z.infer<typeof EquipmentLineSchema>

export const AsBuiltSchema = z.object({
  dcKwp: num(0.1, 100_000),
  acKw: num(0.1, 100_000),
  batteryKwh: num(0, 1_000_000).nullable(),
  batteryKw: num(0, 1_000_000).nullable(),
  tiltDeg: num(0, 90).nullable(),
  azimuthDeg: z.number().finite().min(0).lt(360).nullable(),
  equipment: z.array(EquipmentLineSchema).max(50),
}).strict()
export type AsBuilt = z.infer<typeof AsBuiltSchema>

/** The parts of 4b's CaseConfig the seed reads (structural, so the full config type is not imported). */
export interface CaseSystemLike {
  pv: {
    dcKwp: number; acKw: number; tiltDeg: number; azimuthDeg: number
    module: { make: string; model: string; pmaxW: number } | null
    inverter: { make: string; model: string; acKw: number } | null
  }
  battery: {
    enabled: boolean
    unit: { make: string; model: string; usableKwh: number; powerKw: number } | null
    usableKwh: number; maxDischargeKw: number
  }
}

export function asBuiltFromCase(c: CaseSystemLike): AsBuilt {
  const equipment: EquipmentLine[] = []
  if (c.pv.module) {
    equipment.push({ kind: 'module', make: c.pv.module.make, model: c.pv.module.model, rating: c.pv.module.pmaxW, unit: 'W',
      quantity: Math.max(1, Math.round((c.pv.dcKwp * 1000) / c.pv.module.pmaxW)) })
  }
  if (c.pv.inverter) {
    equipment.push({ kind: 'inverter', make: c.pv.inverter.make, model: c.pv.inverter.model, rating: c.pv.inverter.acKw, unit: 'kW',
      quantity: Math.max(1, Math.round(c.pv.acKw / c.pv.inverter.acKw)) })
  }
  if (c.battery.enabled && c.battery.unit) {
    equipment.push({ kind: 'battery', make: c.battery.unit.make, model: c.battery.unit.model, rating: c.battery.unit.usableKwh, unit: 'kWh',
      quantity: Math.max(1, Math.round(c.battery.usableKwh / c.battery.unit.usableKwh)) })
  }
  return {
    dcKwp: c.pv.dcKwp, acKw: c.pv.acKw,
    batteryKwh: c.battery.enabled ? c.battery.usableKwh : null,
    batteryKw: c.battery.enabled ? c.battery.maxDischargeKw : null,
    tiltDeg: c.pv.tiltDeg, azimuthDeg: c.pv.azimuthDeg,
    equipment,
  }
}

export function parseAsBuilt(raw: unknown): { ok: true; value: AsBuilt } | { ok: false; errors: string[] } {
  const r = AsBuiltSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'record'}: ${i.message}`) }
}

export function equipmentComplete(a: AsBuilt): { ok: boolean; reason: string | null } {
  const has = (k: EquipmentLine['kind']) => a.equipment.some((e) => e.kind === k)
  return has('module') && has('inverter')
    ? { ok: true, reason: null }
    : { ok: false, reason: 'Record at least one module line and one inverter line on the installation.' }
}
