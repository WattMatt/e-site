/**
 * Deterministic matcher: one priced BOQ line → a catalogue signature.
 *
 * Rules read the SECTION HEADING and the DESCRIPTION together, because BOQ
 * lines are terse ("20mm Ø" means nothing outside its CONDUIT heading).
 *
 * Outcomes:
 *   excluded — not a unit rate (PC/provisional sums, profit %, contingency,
 *              unpriced, lump sums). Never enters the library.
 *   match    — a rule filled every required attribute. `confidence: 'high'`.
 *              `assumed` lists attributes filled by an industry default
 *              (e.g. PVC conduit when no material is stated) so a reviewer
 *              can see what was inferred.
 *   partial  — the category is clear but a required attribute is missing.
 *              Goes to the review queue as a suggestion; NEVER auto-confirmed.
 *   none     — no rule applies. Goes to the review queue unmatched.
 *
 * The unit is part of every signature: a trunking length priced per 3 m
 * length and one priced per metre are different items, and merging them
 * would corrupt every statistic.
 */
import { normaliseText, normaliseUnit, type RateUnit } from './normalise'
import type { QuantityMode } from '../schemas/boq.schema'

export const RATE_CATEGORIES = [
  'conduit', 'conduit_box', 'trunking', 'powerskirting', 'cable_tray',
  'lv_cable', 'cable_termination', 'earth_termination', 'mv_cable', 'mv_cable_termination', 'mv_cable_joint',
  'conductor', 'earth_conductor', 'multicore_wiring', 'draw_wire', 'cable_sleeve',
  'socket_outlet', 'isolator', 'light_switch', 'distribution_board', 'mini_substation',
  'power_pole', 'floor_box', 'telephone_board', 'geyser_connection', 'photocell',
  'labour', 'trenching',
] as const
export type RateCategory = (typeof RATE_CATEGORIES)[number]

export type ExclusionReason = 'pc_or_provisional' | 'percentage' | 'unpriced' | 'lump_sum'


export interface MatchInput {
  /** Outermost first. The last element is the line's own heading. */
  sectionPath: string[]
  description: string
  unit: string | null
  quantityMode?: QuantityMode | null
  supplyRate?: number | null
  installRate?: number | null
  /** A single all-in rate, when the BOQ has no supply/install split. */
  rate?: number | null
}

export type Attrs = Record<string, string>

export type MatchResult =
  | { kind: 'excluded'; reason: ExclusionReason }
  | { kind: 'match'; confidence: 'high'; method: 'rule'; category: RateCategory; unit: RateUnit; attributes: Attrs; assumed: string[]; signature: string }
  | { kind: 'partial'; method: 'rule'; category: RateCategory; unit: RateUnit | null; attributes: Attrs; missing: string[] }
  | { kind: 'none' }

/** All-in unit rate of a line: the single rate, else supply + install. */
export function lineTotalRate(i: Pick<MatchInput, 'supplyRate' | 'installRate' | 'rate'>): number {
  const r = Number(i.rate ?? 0)
  if (r > 0) return r
  return Number(i.supplyRate ?? 0) + Number(i.installRate ?? 0)
}

export function buildSignature(category: RateCategory, unit: RateUnit, attributes: Attrs): string {
  const parts = Object.keys(attributes).sort().map(k => `${k}=${attributes[k]}`)
  return [category, unit, ...parts].join('|')
}

export function parseSignature(sig: string): { category: RateCategory; unit: RateUnit; attributes: Attrs } {
  const [category, unit, ...rest] = sig.split('|')
  const attributes: Attrs = {}
  for (const p of rest) {
    const i = p.indexOf('=')
    attributes[p.slice(0, i)] = p.slice(i + 1)
  }
  return { category: category as RateCategory, unit: unit as RateUnit, attributes }
}

// ── extractors ───────────────────────────────────────────────────────────────

const num = (s: string) => String(Number(s))

function coresSize(t: string): { cores?: string; size?: string } {
  let m = t.match(/\b(\d)\s*(?:c|core|cores|cr)\s*x\s*(\d+(?:\.\d+)?)\s*mm2?\b/)
  if (m) return { cores: m[1], size: num(m[2]) }
  m = t.match(/\b(\d+(?:\.\d+)?)\s*mm2?\s*x\s*(\d)\s*(?:c|core|cores)?\b(?!\s*x)/)
  if (m) return { cores: m[2], size: num(m[1]) }
  return {}
}
function sizeMm2(t: string): string | undefined {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*mm2?\b/)
  return m ? num(m[1]) : undefined
}
function dia(t: string): string | undefined {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:mm)?\s*dia\b/) ?? t.match(/\bdia\s*(\d+(?:\.\d+)?)\b/)
  return m ? num(m[1]) : undefined
}
function ratingA(t: string): string | undefined {
  const m = t.match(/\b(\d+)\s*a\b/)
  return m ? num(m[1]) : undefined
}
function poles(t: string): string | undefined {
  const m = t.match(/\b(sp|dp|tp|tpn|4p)\b/)
  if (m) return m[1]
  if (/single pole/.test(t)) return 'sp'
  if (/double pole/.test(t)) return 'dp'
  if (/(triple|three) pole/.test(t)) return 'tp'
  return undefined
}
function conductorOf(t: string): string | undefined {
  if (/\b(al|alu|aluminium|aluminum)\b/.test(t)) return 'al'
  if (/\b(cu|copper)\b/.test(t)) return 'cu'
  return undefined
}
function kv(t: string): string | undefined {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*kv\b/)
  return m ? num(m[1]) : undefined
}
function component(d: string): string | undefined {
  if (/straight/.test(d)) return 'straight'
  if (/horizontal bend/.test(d)) return 'horizontal_bend'
  if (/vertical bend/.test(d)) return 'vertical_bend'
  if (/\bext(ernal)? bend/.test(d)) return 'external_bend'
  if (/\bint(ernal)? bend/.test(d)) return 'internal_bend'
  if (/\bbends?\b/.test(d)) return 'bend'
  if (/\bt\s*-?\s*pieces?\b|\btee\b/.test(d)) return 't_piece'
  if (/cross ?overs?|\bcross\b/.test(d)) return 'crossover'
  if (/end ?caps?\b/.test(d)) return 'end_cap'
  if (/reducer/.test(d)) return 'reducer'
  if (/coupler|joiner|couplings?/.test(d)) return 'coupler'
  if (/corner/.test(d)) return 'corner'
  if (/off\s*-?\s*sets?/.test(d)) return 'offset'
  if (/\bcovers?\b/.test(d)) return 'cover'
  return undefined
}
function installMethods(t: string): string | undefined {
  const set = new Set<string>()
  if (/\bin ground\b|laid in ground|\bburied\b|\bunderground\b/.test(t)) set.add('ground')
  if (/sleeve/.test(t)) set.add('sleeve')
  if (/\btray\b/.test(t)) set.add('tray')
  if (/trunking/.test(t)) set.add('trunking')
  if (/ladder/.test(t)) set.add('ladder')
  if (/basket/.test(t)) set.add('basket')
  return set.size ? [...set].sort().join('+') : undefined
}

// ── rules ────────────────────────────────────────────────────────────────────

interface Ctx { h: string; d: string; t: string; path: string; unit: string | null }
interface RuleOut { attrs: Attrs; required: string[]; assumed?: string[] }
interface Rule { category: RateCategory; when: (c: Ctx) => boolean; extract: (c: Ctx) => RuleOut }

const set = (a: Attrs, k: string, v: string | undefined) => { if (v !== undefined && v !== '') a[k] = v }

const RULES: Rule[] = [
  {
    category: 'labour',
    when: c => /\blabour\b/.test(c.h) || /^(electrician|conduit installer|labou?rer|foreman|supervisor|cable jointer|assistant|artisan)\b/.test(c.d),
    extract: c => {
      const a: Attrs = {}
      const tr = c.d.match(/\b(electrician|conduit installer|labou?rer|foreman|supervisor|cable jointer|assistant|artisan)\b/)
      set(a, 'trade', tr?.[1].replace(/ /g, '_').replace(/^laborer$/, 'labourer'))
      set(a, 'time',
        /over ?time/.test(c.d) ? 'overtime' : /saturday/.test(c.d) ? 'saturday'
          : /sunday|public holiday/.test(c.d) ? 'sunday' : /normal|ordinary/.test(c.d) ? 'normal' : undefined)
      return { attrs: a, required: ['trade', 'time'] }
    },
  },
  {
    category: 'cable_sleeve',
    when: c => /sleeve|nextube/.test(c.t) && dia(c.d) !== undefined,
    extract: c => {
      const a: Attrs = {}
      set(a, 'dia', dia(c.d))
      set(a, 'material', /nextube/.test(c.t) ? 'nextube' : /\bhdpe\b/.test(c.t) ? 'hdpe' : /\bpvc\b/.test(c.t) ? 'pvc' : undefined)
      return { attrs: a, required: ['dia'] }
    },
  },
  {
    category: 'draw_wire',
    when: c => /draw ?wire/.test(c.t),
    extract: c => { const a: Attrs = {}; set(a, 'dia', dia(c.d)); return { attrs: a, required: ['dia'] } },
  },
  {
    category: 'trenching',
    when: c => /trench|excavat/.test(c.t) && /pickable|blasting|\brock\b|sand fill|backfill|bedding/.test(c.d),
    extract: c => {
      const a: Attrs = {}
      const wd = c.t.match(/(\d+)\s*(?:mm)?\s*wide\s*(?:x|&)\s*(\d+)\s*(?:mm)?\s*deep/)
      set(a, 'width', wd?.[1]); set(a, 'depth', wd?.[2])
      set(a, 'ground',
        /soft pickable/.test(c.d) ? 'soft_pickable' : /hard pickable/.test(c.d) ? 'hard_pickable'
          : /pickable/.test(c.d) ? 'pickable'
          : /soft rock/.test(c.d) ? 'soft_rock' : /hard rock/.test(c.d) ? 'hard_rock'
          : /blasting/.test(c.d) ? 'blasting' : /sand fill/.test(c.d) ? 'sand_fill'
          : /backfill/.test(c.d) ? 'backfill' : /bedding/.test(c.d) ? 'bedding' : undefined)
      return { attrs: a, required: ['width', 'depth', 'ground'] }
    },
  },
  {
    category: 'mv_cable_termination',
    when: c => /\bkv\b|medium voltage|\bmv\b/.test(c.t) && /terminat|cable end|end glanded/.test(c.d),
    extract: c => mvExtract(c),
  },
  {
    category: 'mv_cable_joint',
    when: c => /\bkv\b|medium voltage|\bmv\b/.test(c.t) && /\bjoint\b/.test(c.d),
    extract: c => mvExtract(c),
  },
  {
    category: 'mv_cable',
    when: c => /\bkv\b|medium voltage|\bmv cables?\b/.test(c.t) && /\bcables?\b|xlpe|pilc/.test(c.t) && sizeMm2(c.t) !== undefined,
    extract: c => mvExtract(c),
  },
  {
    category: 'earth_termination',
    when: c => /earth terminations?/.test(c.h) && sizeMm2(c.d) !== undefined,
    extract: c => { const a: Attrs = {}; set(a, 'size', sizeMm2(c.d)); return { attrs: a, required: ['size'] } },
  },
  {
    category: 'cable_termination',
    when: c => /terminations?\b|terminated/.test(c.t) && !/earth terminations?/.test(c.h),
    extract: c => {
      const a: Attrs = {}
      const cs = coresSize(c.d)
      const twin = /twin and earth|twin & earth/.test(c.t)
      set(a, 'cores', cs.cores ?? (twin ? '2+e' : undefined))
      set(a, 'size', cs.size ?? (twin ? sizeMm2(c.d) : undefined))
      const assumed: string[] = []
      const cond = conductorOf(c.t)
      if (cond) a.conductor = cond
      else { a.conductor = 'cu'; assumed.push('conductor') }
      // A 3-core aluminium termination with no voltage is as likely MV as LV.
      const required = ['cores', 'size']
      if (a.cores === '3' && a.conductor === 'al') required.push('voltage')
      return { attrs: a, required, assumed }
    },
  },
  {
    category: 'lv_cable',
    when: c => coresSize(c.d).size !== undefined && !/terminat/.test(c.t)
      && (/\bcables?\b|\becc\b|\bswa\b|pvc\/swa/.test(c.t) || /\(uncategorised\)/.test(c.h)),
    extract: c => {
      const a: Attrs = {}
      const cs = coresSize(c.d)
      set(a, 'cores', cs.cores); set(a, 'size', cs.size)
      set(a, 'install', installMethods(c.t))
      const assumed: string[] = []
      const cond = conductorOf(c.t)
      if (cond) a.conductor = cond
      else { a.conductor = 'cu'; assumed.push('conductor') }
      return { attrs: a, required: ['cores', 'size', 'install'], assumed }
    },
  },
  {
    category: 'multicore_wiring',
    when: c => (/conductor|wiring|twin and earth|flat twin/.test(c.h) || /surfix|flat twin/.test(c.d))
      && (coresSize(c.d).size !== undefined || /twin and earth|flat twin/.test(c.t)),
    extract: c => {
      const a: Attrs = {}
      const cs = coresSize(c.d)
      set(a, 'cores', cs.cores ?? (/twin and earth|flat twin/.test(c.t) ? '2+e' : undefined))
      set(a, 'size', cs.size ?? sizeMm2(c.d))
      return { attrs: a, required: ['cores', 'size'] }
    },
  },
  {
    category: 'earth_conductor',
    when: c => (/earth conductor|earthing|earth wire|bare copper/.test(c.t)) && sizeMm2(c.d) !== undefined,
    extract: c => { const a: Attrs = {}; set(a, 'size', sizeMm2(c.d)); return { attrs: a, required: ['size'] } },
  },
  {
    category: 'conductor',
    when: c => /conductor/.test(c.h) && sizeMm2(c.d) !== undefined,
    extract: c => { const a: Attrs = {}; set(a, 'size', sizeMm2(c.d)); return { attrs: a, required: ['size'] } },
  },
  {
    category: 'conduit_box',
    // Covers are accessories, not boxes: left for review rather than given a box's price.
    when: c => /conduit box|draw box|junction box/.test(c.t) && !/\bcovers?\b/.test(c.d),
    extract: c => {
      const a: Attrs = {}
      const dims = c.d.match(/\b(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\b/)
      const round = dia(c.d)
      set(a, 'size', dims ? `${dims[1]}x${dims[2]}x${dims[3]}` : round ? `round${round}` : undefined)
      const assumed: string[] = []
      if (/galv|steel|metal/.test(c.t)) a.material = 'steel'
      else { a.material = 'pvc'; if (!/\bpvc\b/.test(c.t)) assumed.push('material') }
      if (/surface/.test(c.d)) a.mount = 'surface'
      return { attrs: a, required: ['size'], assumed }
    },
  },
  {
    category: 'conduit',
    when: c => /conduit/.test(c.t) && dia(c.d) !== undefined,
    extract: c => {
      const a: Attrs = {}
      set(a, 'dia', dia(c.d))
      const assumed: string[] = []
      if (/galv|steel|metal/.test(c.t)) a.material = 'steel'
      else { a.material = 'pvc'; if (!/\bpvc\b/.test(c.t)) assumed.push('material') }
      return { attrs: a, required: ['dia'], assumed }
    },
  },
  {
    category: 'socket_outlet',
    // A combination socket ("Combo socket 164-2") is a named product: left for review.
    when: c => /socket outlet|\bs\.?s\.?o\b|\bsocket\b/.test(c.d) && !/\bcombo\b/.test(c.d),
    extract: c => {
      const a: Attrs = {}
      set(a, 'rating', ratingA(c.d))
      const pins = c.d.match(/\b(\d)\s*pin\b/)
      const assumed: string[] = []
      if (/\beuro\b/.test(c.d)) a.pins = 'euro'
      else if (pins) a.pins = pins[1]
      else if (/three phase|3 phase/.test(c.d)) a.pins = '5'
      else if (a.rating && Number(a.rating) <= 16) { a.pins = '3'; assumed.push('pins') }
      a.gang = /\bdouble\b|\btwin\b/.test(c.d) ? 'double' : 'single'
      a.switching = /unswitched/.test(c.d) ? 'unswitched' : /dedicated|\bred\b/.test(c.d) ? 'dedicated' : 'switched'
      const mount = /power ?skirting/.test(c.t) ? 'powerskirting' : /power ?pole/.test(c.t) ? 'power_pole'
        : /floor box/.test(c.t) ? 'floor_box' : undefined
      set(a, 'mount', mount)
      return { attrs: a, required: ['rating', 'pins'], assumed }
    },
  },
  {
    category: 'isolator',
    // "isolator, flexible connection, wiring …" is a whole equipment connection, not an isolator.
    when: c => (/\bisolators?\b/.test(c.t) && !/connection/.test(c.t))
      || (/air-?condition/.test(c.h) && /^\d+a,?\s*(sp|dp|tp|tpn)\b/.test(c.d)),
    extract: c => {
      const a: Attrs = {}
      set(a, 'rating', ratingA(c.d)); set(a, 'poles', poles(c.d))
      return { attrs: a, required: ['rating', 'poles'] }
    },
  },
  {
    category: 'light_switch',
    // The line itself must describe a switch; a LIGHT SWITCHES heading also
    // holds door bells, sensors and key switches.
    when: c => /\blever\b/.test(c.d) && /\bway\b/.test(c.d) && !/key switch|position/.test(c.d),
    extract: c => {
      const a: Attrs = {}
      const w = c.d.match(/\b(1|one|2|two)\s*-?\s*way\b/)
      set(a, 'ways', w ? (/^(1|one)$/.test(w[1]) ? '1' : '2') : /intermediate/.test(c.d) ? 'intermediate' : undefined)
      const l = c.d.match(/\b(\d|one|two|three|four)\s*lever\b/)
      const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4' }
      set(a, 'levers', l ? (words[l[1]] ?? l[1]) : undefined)
      return { attrs: a, required: ['ways', 'levers'] }
    },
  },
  {
    category: 'powerskirting',
    when: c => /power ?skirting/.test(c.t),
    extract: c => {
      const a: Attrs = {}
      set(a, 'component', component(c.d))
      const comp = c.d.match(/\b(\d)\s*compartment/)
      set(a, 'compartments', comp?.[1])
      return { attrs: a, required: ['component'] }
    },
  },
  {
    category: 'trunking',
    when: c => /trunking/.test(c.t) || /\bp\s?\d{3,4}\b/.test(c.d),
    extract: c => {
      const a: Attrs = {}
      const p2 = c.d.match(/\bp2\s+(\d{3})\b/)
      const p = c.d.match(/\bp\s?(\d{3,4})\b/)
      set(a, 'profile', p2 ? `p2-${p2[1]}` : p ? `p${p[1]}` : undefined)
      set(a, 'component', component(c.d))
      return { attrs: a, required: ['profile', 'component'] }
    },
  },
  {
    category: 'cable_tray',
    when: c => /\btray\b|wire basket|cable ladder|\bbasket\b/.test(c.t),
    extract: c => {
      const a: Attrs = {}
      a.type = /basket/.test(c.t) ? 'wire_basket' : /ladder/.test(c.t) ? 'ladder' : 'tray'
      const w = c.d.match(/\b(\d+)\s*(?:mm)?\s*wide\b/)
      set(a, 'width', w?.[1])
      set(a, 'component', component(c.d))
      const assumed: string[] = []
      // "300 wide" priced per metre with no fitting named is the straight run.
      if (!a.component && normaliseUnit(c.unit) === 'm' && /^\d+\s*(?:mm)?\s*wide$/.test(c.d)) {
        a.component = 'straight'; assumed.push('component')
      }
      return { attrs: a, required: ['width', 'component'], assumed }
    },
  },
  {
    category: 'distribution_board',
    when: c => /distribution board/.test(c.h) && /\b\d+\s*way\b/.test(c.d),
    extract: c => { const a: Attrs = {}; set(a, 'ways', c.d.match(/\b(\d+)\s*way\b/)?.[1]); return { attrs: a, required: ['ways'] } },
  },
  {
    category: 'mini_substation',
    when: c => /miniature substation|mini ?sub/.test(c.t) && /\d+\s*kva\b/.test(c.d),
    extract: c => { const a: Attrs = {}; set(a, 'kva', c.d.match(/(\d+)\s*kva\b/)?.[1]); return { attrs: a, required: ['kva'] } },
  },
  {
    category: 'floor_box',
    when: c => /floor box|pedestal/.test(c.t) && !/socket|s\.?s\.?o|data/.test(c.d),
    extract: c => { const a: Attrs = {}; set(a, 'type', c.d.match(/\b(fd\d|graf\s?\d+)\b/)?.[1].replace(/\s/g, '')); return { attrs: a, required: ['type'] } },
  },
  {
    category: 'power_pole',
    when: c => /power ?pole/.test(c.d) && !/socket|s\.?s\.?o|data|outlet/.test(c.d),
    extract: c => { const a: Attrs = {}; set(a, 'height', c.d.match(/\b(\d+(?:\.\d+)?)\s*m\b/)?.[1]); return { attrs: a, required: [] } },
  },
  {
    category: 'telephone_board',
    when: c => /telephone board/.test(c.h),
    extract: c => {
      const a: Attrs = {}
      const s = c.d.match(/\b(\d+)\s*(?:mm)?\s*x\s*(\d+)\b/)
      set(a, 'size', s ? `${s[1]}x${s[2]}` : undefined)
      set(a, 'mount', /flush/.test(c.h) ? 'flush' : /surface/.test(c.h) ? 'surface' : undefined)
      return { attrs: a, required: ['size', 'mount'] }
    },
  },
  {
    category: 'geyser_connection',
    when: c => /geyser/.test(c.t) && /connection/.test(c.d),
    extract: c => { const a: Attrs = {}; set(a, 'rating', ratingA(c.d)); set(a, 'poles', poles(c.d)); return { attrs: a, required: ['rating'] } },
  },
  {
    category: 'photocell',
    when: c => /photo ?cell/.test(c.t),
    extract: () => ({ attrs: {}, required: [] }),
  },
]

function mvExtract(c: Ctx): RuleOut {
  const a: Attrs = {}
  const cs = coresSize(c.t)
  set(a, 'size', cs.size ?? sizeMm2(c.t)); set(a, 'cores', cs.cores)
  set(a, 'conductor', conductorOf(c.t)); set(a, 'kv', kv(c.t))
  return { attrs: a, required: ['size', 'cores', 'conductor', 'kv'] }
}

/** Categories whose price legitimately sits in either column. */
const SCOPE_EXEMPT = new Set<RateCategory>(['labour', 'trenching'])

function scopeOf(i: MatchInput): string | undefined {
  if (Number(i.rate ?? 0) > 0) return undefined
  const s = Number(i.supplyRate ?? 0), n = Number(i.installRate ?? 0)
  if (s > 0 && n <= 0) return 'supply_only'
  if (n > 0 && s <= 0) return 'install_only'
  return undefined
}

export function matchLine(input: MatchInput): MatchResult {
  const unit = normaliseUnit(input.unit)
  const rawUnit = (input.unit ?? '').trim()
  const h = normaliseText(input.sectionPath[input.sectionPath.length - 1] ?? '')
  const path = normaliseText(input.sectionPath.join(' / '))
  const d = normaliseText(input.description)
  const c: Ctx = { h, d, t: `${h} | ${d}`, path, unit: input.unit }

  // ── exclusions ─────────────────────────────────────────────────────────────
  if (input.quantityMode === 'pc_sum' || input.quantityMode === 'provisional' || unit === 'pc'
      || /\bprime cost\b|\bprovisional (sum|amount)\b|\bpc sum\b/.test(c.t)) {
    return { kind: 'excluded', reason: 'pc_or_provisional' }
  }
  if (unit === 'pct' || /\b(add|allow)\s+profit|\bprofit (on|to) item|contingenc/.test(`${path} | ${d}`)
      || (unit === 'other' && /^\d*\.?\d+$/.test(rawUnit))) {
    return { kind: 'excluded', reason: 'percentage' }
  }
  if (!(lineTotalRate(input) > 0)) return { kind: 'excluded', reason: 'unpriced' }

  // ── rules ──────────────────────────────────────────────────────────────────
  const rule = RULES.find(r => r.when(c))
  if (!rule) {
    if (input.quantityMode === 'lump_sum' || unit === 'sum' || unit === 'lot') return { kind: 'excluded', reason: 'lump_sum' }
    return { kind: 'none' }
  }
  const out = rule.extract(c)
  const attrs: Attrs = { ...out.attrs }
  if (!SCOPE_EXEMPT.has(rule.category)) set(attrs, 'scope', scopeOf(input))
  // A matched item priced "per lot/sum" is one of that item.
  const itemUnit: RateUnit | null = unit === 'sum' || unit === 'lot' ? 'no' : unit
  const missing = out.required.filter(k => !(k in attrs))
  if (!itemUnit || itemUnit === 'other') missing.push('unit')
  if (missing.length) {
    return { kind: 'partial', method: 'rule', category: rule.category, unit: itemUnit, attributes: attrs, missing }
  }
  return {
    kind: 'match', confidence: 'high', method: 'rule', category: rule.category, unit: itemUnit as RateUnit,
    attributes: attrs, assumed: out.assumed ?? [], signature: buildSignature(rule.category, itemUnit as RateUnit, attrs),
  }
}
