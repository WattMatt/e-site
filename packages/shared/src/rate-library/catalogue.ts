/**
 * Catalogue naming: a signature is the identity of an item; its code and
 * description are derived from it, so the same signature always gets the same
 * name and two signatures never share a code.
 */
import { parseSignature, type RateCategory } from './match'

const LABEL: Record<RateCategory, string> = {
  conduit: 'Conduit', conduit_box: 'Conduit box', trunking: 'Trunking', powerskirting: 'Powerskirting',
  cable_tray: 'Cable support', lv_cable: 'LV cable', cable_termination: 'LV cable termination',
  earth_termination: 'Earth termination', mv_cable: 'MV cable', mv_cable_termination: 'MV cable termination',
  mv_cable_joint: 'MV cable joint', conductor: 'Single-core conductor', earth_conductor: 'Earth conductor',
  multicore_wiring: 'Multicore wiring', draw_wire: 'Draw wire', cable_sleeve: 'Cable sleeve',
  socket_outlet: 'Socket outlet', isolator: 'Isolator', light_switch: 'Light switch',
  distribution_board: 'Distribution board', mini_substation: 'Miniature substation', power_pole: 'Power pole',
  floor_box: 'Floor box', telephone_board: 'Telephone board', geyser_connection: 'Geyser connection',
  photocell: 'Photocell', labour: 'Labour', trenching: 'Trenching',
}

const nice = (s: string) => s.replace(/_/g, ' ')

function attrPhrases(category: RateCategory, a: Record<string, string>): string[] {
  const out: string[] = []
  const take = (k: string, f: (v: string) => string) => { if (a[k] !== undefined) out.push(f(a[k])) }
  switch (category) {
    case 'lv_cable': case 'cable_termination': case 'multicore_wiring':
    case 'mv_cable': case 'mv_cable_termination': case 'mv_cable_joint':
      if (a.cores && a.size) out.push(`${a.cores === '2+e' ? 'twin & earth' : `${a.cores} core`} × ${a.size} mm²`)
      else take('size', v => `${v} mm²`)
      take('conductor', v => (v === 'al' ? 'Al' : 'Cu'))
      take('kv', v => `${v} kV`)
      take('install', v => `in ${v.split('+').join(' / ')}`)
      break
    case 'conductor': case 'earth_conductor': case 'earth_termination': take('size', v => `${v} mm²`); break
    case 'conduit': case 'cable_sleeve': case 'draw_wire':
      take('material', v => (v === 'pvc' ? 'PVC' : v === 'hdpe' ? 'HDPE' : v === 'nextube' ? 'NEXTUBE' : 'steel'))
      take('dia', v => `${v} mm dia`)
      break
    case 'conduit_box': take('material', v => (v === 'pvc' ? 'PVC' : 'steel')); take('size', v => (v.startsWith('round') ? `round ${v.slice(5)} mm` : v)); take('mount', nice); break
    case 'trunking': take('profile', v => v.toUpperCase()); take('component', nice); break
    case 'powerskirting': take('compartments', v => `${v} compartment`); take('component', nice); break
    case 'cable_tray': take('type', nice); take('width', v => `${v} mm wide`); take('component', nice); break
    case 'socket_outlet':
      take('rating', v => `${v} A`); take('pins', v => (v === 'euro' ? 'euro' : `${v} pin`)); take('gang', nice); take('switching', nice); take('mount', v => `on ${nice(v)}`)
      break
    case 'isolator': case 'geyser_connection': take('rating', v => `${v} A`); take('poles', v => v.toUpperCase()); break
    case 'light_switch': take('ways', v => `${v} way`); take('levers', v => `${v} lever`); break
    case 'distribution_board': take('ways', v => `${v} way`); break
    case 'mini_substation': take('kva', v => `${v} kVA`); break
    case 'power_pole': take('height', v => `${v} m`); break
    case 'floor_box': take('type', v => v.toUpperCase()); break
    case 'telephone_board': take('size', v => `${v} mm`); take('mount', nice); break
    case 'labour': take('trade', nice); take('time', v => (v === 'normal' ? 'normal time' : v)); break
    case 'trenching': if (a.width && a.depth) out.push(`${a.width} wide × ${a.depth} deep`); take('ground', nice); break
    default: break
  }
  if (a.scope) out.push(a.scope === 'install_only' ? 'install only' : 'supply only')
  return out
}

export function describeSignature(signature: string): string {
  const { category, attributes } = parseSignature(signature)
  return [LABEL[category] ?? nice(category), ...attrPhrases(category, attributes)].join(', ')
}

export function codeForSignature(signature: string): string {
  const { category, unit, attributes } = parseSignature(signature)
  const vals = Object.keys(attributes).sort().map(k => attributes[k])
  return [category, ...vals, unit].join('-').toUpperCase()
}
