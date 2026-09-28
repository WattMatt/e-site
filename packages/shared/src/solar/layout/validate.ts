/**
 * Shape check for one layout object on its way to solar_save_layout_objects
 * (00211). Server actions are directly invocable, so a malformed body must get
 * a sentence, never a TypeError or a raw Postgres error. The database still
 * binds everything that matters (scale, anchor, project); this only refuses
 * garbage early. Returns null when valid.
 */
import { LAYOUT_OBJECT_KINDS, type LayoutObjectKind } from './types'

export const MAX_MODULES_PER_ARRAY = 5000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const allFinite = (a: unknown): a is number[] => Array.isArray(a) && a.every(finite)

/** Exported for the New layout dialog and createLayoutAction (5-ii). */
export function moduleSpecError(m: unknown): string | null {
  if (!isRec(m)) return 'The module specification is missing.'
  if (!(finite(m.lengthM) && m.lengthM > 0 && finite(m.widthM) && m.widthM > 0)) return 'The module needs a positive size.'
  if (!(finite(m.powerW) && m.powerW > 0)) return 'The module needs a positive power rating.'
  for (const k of ['vocStc', 'vmpStc', 'iscStc', 'betaVocPerC', 'gammaVmpPerC']) if (!finite(m[k])) return 'The module datasheet figures must be numbers.'
  return null
}

export function inverterSpecError(v: unknown): string | null {
  if (!isRec(v)) return 'The inverter specification is missing.'
  if (!(finite(v.acKw) && v.acKw > 0)) return 'The inverter needs a positive AC rating.'
  if (!(Number.isInteger(v.mppts) && (v.mppts as number) >= 1)) return 'The inverter needs at least one MPPT.'
  for (const k of ['vDcMax', 'vMpptMin', 'vMpptMax', 'iMpptMax']) if (!(finite(v[k]) && (v[k] as number) > 0)) return 'The inverter datasheet figures must be positive numbers.'
  return null
}

export function validateObjectInput(o: unknown): string | null {
  if (!isRec(o) || !isRec(o.geometry) || !isRec(o.props)) return 'An object in the layout is malformed.'
  if (typeof o.id !== 'string' || !UUID.test(o.id)) return 'An object in the layout has an invalid id.'
  if (!(LAYOUT_OBJECT_KINDS as readonly string[]).includes(String(o.kind))) return 'An object in the layout has an unknown kind.'
  const kind = o.kind as LayoutObjectKind
  const g = o.geometry
  const p = o.props
  switch (kind) {
    case 'north':
      return 'North is set on the roof source, not drawn as an object.'
    case 'roof': {
      if (!Array.isArray(g.points) || g.points.length < 6 || g.points.length % 2 !== 0) return 'A roof outline needs at least three points.'
      if (!allFinite(g.points)) return 'A roof outline has a point that is not a number.'
      if (!(finite(p.setbackM) && p.setbackM >= 0)) return 'A roof needs an edge setback of 0 m or more.'
      if (!(finite(p.pitchDeg) && p.pitchDeg >= 0 && p.pitchDeg < 90)) return 'A roof pitch must be between 0° and 90°.'
      return null
    }
    case 'obstruction': {
      if ('r' in g) {
        if (!(finite(g.cx) && finite(g.cy) && finite(g.r) && g.r > 0)) return 'A circular obstruction needs a positive radius.'
      } else if (!Array.isArray(g.points) || g.points.length < 6 || !allFinite(g.points)) {
        return 'An obstruction outline needs at least three points.'
      }
      if (!(finite(p.setbackM) && p.setbackM >= 0)) return 'An obstruction needs a setback of 0 m or more.'
      return null
    }
    case 'array':
    case 'module_block': {
      if (!Array.isArray(g.modules)) return 'An array needs a module list.'
      if (g.modules.length > MAX_MODULES_PER_ARRAY) return `An array can hold at most ${MAX_MODULES_PER_ARRAY} modules; split it.`
      if (!g.modules.every((q) => Array.isArray(q) && q.length === 8 && allFinite(q))) return 'Every module needs four corners.'
      const me = moduleSpecError(p.module)
      if (me) return me
      if (typeof p.roofId !== 'string' || !UUID.test(p.roofId)) return 'An array must belong to a roof.'
      if (!(finite(p.tiltDeg) && p.tiltDeg >= 0 && p.tiltDeg < 90)) return 'An array tilt must be between 0° and 90°.'
      return null
    }
    case 'inverter':
    case 'equipment': {
      if (!finite(g.x) || !finite(g.y)) return 'A symbol needs a position.'
      if (kind === 'inverter') return inverterSpecError(p.inverter)
      if (!['battery', 'db', 'combiner'].includes(String(p.equipmentKind))) return 'Equipment must be a battery, DB or combiner.'
      if (p.nodeId !== null && (typeof p.nodeId !== 'string' || !UUID.test(p.nodeId))) return 'A DB symbol links to a board by its id.'
      return null
    }
    case 'string': {
      if (typeof p.inverterId !== 'string' || !UUID.test(p.inverterId)) return 'A string must belong to an inverter.'
      if (!(Number.isInteger(p.mppt) && (p.mppt as number) >= 1)) return 'A string must sit on MPPT 1 or higher.'
      if (!Array.isArray(p.modules) || !p.modules.every((m) => isRec(m) && typeof m.arrayId === 'string' && UUID.test(m.arrayId) && Number.isInteger(m.index) && (m.index as number) >= 0)) {
        return 'A string lists its modules by array and position.'
      }
      return null
    }
  }
}
