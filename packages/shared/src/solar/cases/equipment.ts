/**
 * Equipment catalogue specs (functional spec §11) and the CSV import. PAN/OND import is deferred (D-19).
 * The DB CHECK (00216 equipment_specs_shape) guards the minimum; these schemas are the full contract.
 */
import { z } from 'zod'

export const EQUIPMENT_KINDS = ['module', 'inverter', 'battery'] as const
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

const num = (min: number, max: number) => z.number().finite().min(min).max(max)

export const ModuleSpecsSchema = z.object({
  pmaxW: num(1, 2000), gammaPmaxPctPerC: num(-1, 0),
  vocV: num(0, 200).optional(), iscA: num(0, 50).optional(), vmpV: num(0, 200).optional(), impA: num(0, 50).optional(),
  betaVocPctPerC: num(-1, 0).optional(), gammaVmpPctPerC: num(-1, 0).optional(),
  lengthMm: num(100, 5000).optional(), widthMm: num(100, 5000).optional(), bifacial: z.boolean().optional(),
}).strict()
export const InverterSpecsSchema = z.object({
  acKw: num(0.1, 100_000), euroEfficiencyPct: num(50, 100),
  mppts: z.number().int().min(1).max(100).optional(), vDcMax: num(0, 2000).optional(),
  vMpptMin: num(0, 2000).optional(), vMpptMax: num(0, 2000).optional(), iMpptMaxA: num(0, 500).optional(),
}).strict()
export const BatterySpecsSchema = z.object({
  usableKwh: num(0.1, 1e6), powerKw: num(0.1, 1e6), rtePct: num(50, 100),
  warrantyCycles: z.number().int().min(0).max(100_000).optional(),
}).strict()

const SCHEMAS = { module: ModuleSpecsSchema, inverter: InverterSpecsSchema, battery: BatterySpecsSchema } as const
const REQUIRED: Record<EquipmentKind, readonly string[]> = {
  module: ['pmaxW', 'gammaPmaxPctPerC'], inverter: ['acKw', 'euroEfficiencyPct'], battery: ['usableKwh', 'powerKw', 'rtePct'],
}
const COLUMNS: Record<EquipmentKind, readonly string[]> = {
  module: ['pmaxW', 'vocV', 'iscA', 'vmpV', 'impA', 'gammaPmaxPctPerC', 'betaVocPctPerC', 'gammaVmpPctPerC', 'lengthMm', 'widthMm', 'bifacial'],
  inverter: ['acKw', 'euroEfficiencyPct', 'mppts', 'vDcMax', 'vMpptMin', 'vMpptMax', 'iMpptMaxA'],
  battery: ['usableKwh', 'powerKw', 'rtePct', 'warrantyCycles'],
}
export const EQUIPMENT_CSV_HEADER: readonly string[] = ['kind', 'make', 'model', ...COLUMNS.module, ...COLUMNS.inverter, ...COLUMNS.battery]

export type EquipmentSpecs = Record<string, number | boolean>

export function parseEquipmentSpecs(kind: EquipmentKind, specs: unknown): { ok: true; specs: EquipmentSpecs } | { ok: false; errors: Record<string, string> } {
  const r = SCHEMAS[kind].safeParse(specs)
  if (r.success) return { ok: true, specs: r.data as EquipmentSpecs }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) errors[i.path.join('.') || '(root)'] ??= i.message
  return { ok: false, errors }
}

/** RFC 4180-ish: commas, double-quoted fields, "" escapes. One physical line per record. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export interface EquipmentCsvRow { kind: EquipmentKind; make: string; model: string; specs: EquipmentSpecs }
export interface EquipmentCsvResult { rows: EquipmentCsvRow[]; errors: Array<{ line: number; message: string }> }

export function parseEquipmentCsv(text: string): EquipmentCsvResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = splitCsvLine(lines[0] ?? '')
  if (header.join(',') !== EQUIPMENT_CSV_HEADER.join(',')) {
    return { rows: [], errors: [{ line: 1, message: `The header must be exactly: ${EQUIPMENT_CSV_HEADER.join(',')}` }] }
  }
  const rows: EquipmentCsvRow[] = []
  const errors: EquipmentCsvResult['errors'] = []
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2
    const cells = splitCsvLine(raw)
    const get = (col: string) => cells[EQUIPMENT_CSV_HEADER.indexOf(col)] ?? ''
    const kind = get('kind') as EquipmentKind
    if (!EQUIPMENT_KINDS.includes(kind)) { errors.push({ line, message: 'kind must be module, inverter or battery' }); return }
    const make = get('make'), model = get('model')
    if (!make || !model) { errors.push({ line, message: 'make and model are required' }); return }
    const foreign = EQUIPMENT_CSV_HEADER.slice(3).find((c) => !COLUMNS[kind].includes(c) && get(c) !== '')
    if (foreign) { errors.push({ line, message: `column ${foreign} does not apply to a ${kind}` }); return }
    const missing = REQUIRED[kind].find((c) => get(c) === '')
    if (missing) { errors.push({ line, message: `${missing} is required for a${kind === 'inverter' ? 'n' : ''} ${kind}` }); return }
    const specs: EquipmentSpecs = {}
    for (const c of COLUMNS[kind]) {
      const v = get(c)
      if (v === '') continue
      if (c === 'bifacial') { specs[c] = /^(true|yes|1)$/i.test(v); continue }
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n)) { errors.push({ line, message: `${c} must be a number` }); return }
      specs[c] = n
    }
    const check = parseEquipmentSpecs(kind, specs)
    if (!check.ok) { const [k, m] = Object.entries(check.errors)[0]!; errors.push({ line, message: `${k}: ${m}` }); return }
    rows.push({ kind, make, model, specs: check.specs })
  })
  return { rows, errors }
}

type Row = { id: string; make: string; model: string; specs: Record<string, unknown> }
const n = (v: unknown) => Number(v)

export const moduleSnapshot = (r: Row) =>
  ({ equipmentId: r.id, make: r.make, model: r.model, pmaxW: n(r.specs.pmaxW), gammaPmaxPctPerC: n(r.specs.gammaPmaxPctPerC) })
export const inverterSnapshot = (r: Row) =>
  ({ equipmentId: r.id, make: r.make, model: r.model, acKw: n(r.specs.acKw), euroEfficiencyPct: n(r.specs.euroEfficiencyPct) })
export const batterySnapshot = (r: Row) =>
  ({ equipmentId: r.id, make: r.make, model: r.model, usableKwh: n(r.specs.usableKwh), powerKw: n(r.specs.powerKw), rtePct: n(r.specs.rtePct) })
