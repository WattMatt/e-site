/**
 * Pre-population of a site form from what the project already knows.
 *
 * Pure mapping, no I/O, so the rules are unit-testable and identical wherever
 * they run. The caller gathers the sources; this decides what they mean.
 *
 * TWO RULES GOVERN WHAT GETS FILLED.
 *
 * 1. Only map a source field onto a form field when they mean the SAME thing.
 *    `supplies.design_load_a` is a design load, not a protective-device rating;
 *    putting it in "protective device rating" would not be pre-population, it
 *    would be fabrication, and on a legal record a plausible wrong number is
 *    worse than a blank. Where no honest source exists the field stays empty.
 *
 * 2. Never fill anything that only exists by being checked on site. That is
 *    every "as verified" description, the isolation checklist, all test
 *    readings, alternative supplies, handover state and every signature. The
 *    form exists precisely because the project record is often wrong; filling
 *    those from the record would defeat the document.
 *
 * `description_as_found` IS filled — that is literally what the record says,
 * which is the question that field asks. Its sibling `description_as_verified`
 * is deliberately left blank and is `required`, so an electrician cannot
 * submit without stating what each circuit actually feeds.
 */

/** Where a prefilled value came from, recorded per response. */
export type PrefillSource =
  | 'project'
  | 'organisation'
  | 'user'
  | 'structure_node'
  | 'cable_schedule'
  | 'system'

export interface PrefillProject {
  name: string | null
  code: string | null
  client_name: string | null
  address: string | null
  city: string | null
  province: string | null
}

export interface PrefillOrganisation {
  name: string | null
  /** The two spellings both exist on `public.organisations`. */
  registration_no: string | null
  registration_number: string | null
}

export interface PrefillNode {
  code: string | null
  name: string | null
  shop_number: string | null
  shop_name: string | null
  incomer_breaker_a: number | null
  incomer_pole_config: string | null
}

/** The supply that feeds this board, from the current cable-schedule revision. */
export interface PrefillFeed {
  fromBoardCode: string | null
  voltage_v: number | null
  section: string | null
}

/** One board fed BY this board — a candidate circuit row. */
export interface PrefillDownstream {
  code: string | null
  name: string | null
  size_mm2: number | null
  cores: string | null
  armour: string | null
}

export interface PrefillSources {
  project: PrefillProject | null
  organisation: PrefillOrganisation | null
  userFullName: string | null
  node: PrefillNode | null
  feed: PrefillFeed | null
  downstream: PrefillDownstream[]
  formNo: string | null
  /** ISO date, passed in so the mapper stays deterministic. */
  todayISO: string
}

export interface PrefillResponse {
  sectionId: string
  fieldId: string
  valueText?: string | null
  valueNumber?: number | null
  source: PrefillSource
}

const txt = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

/** 400 -> '400_v'; anything unrecognised -> 'other'. */
function voltageToken(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null
  if (v === 230) return '230_v'
  if (v === 400) return '400_v'
  if (v === 525) return '525_v'
  return 'other'
}

/**
 * '3P+N' -> '3'. Only the unambiguous cases; an unrecognised config yields
 * null rather than a guess, because phase count drives a registration-scope
 * gate (a single-phase tester may not work on a three-phase installation).
 */
export function polesToPhases(cfg: string | null): string | null {
  const c = txt(cfg)?.toUpperCase().replace(/\s/g, '')
  if (!c) return null
  if (/^3P(\+N)?$/.test(c) || c === '4P' || c === 'TP' || c === 'TPN') return '3'
  if (/^2P(\+N)?$/.test(c)) return '2'
  if (/^1P(\+N)?$/.test(c) || c === 'SP' || c === 'SPN') return '1'
  return null
}

/** '4c' / '4' -> '4'. Only the values the template's dropdown accepts. */
function coresToken(cores: string | null): string | null {
  const c = txt(cores)?.toLowerCase().replace(/[^0-9]/g, '')
  if (!c) return null
  return ['2', '3', '4', '5'].includes(c) ? c : 'other'
}

/** Armoured cable is the one cable type the schedule states unambiguously. */
function cableTypeToken(armour: string | null): string | null {
  const a = txt(armour)?.toLowerCase()
  if (!a) return null
  if (a === 'none' || a === 'unarmoured' || a === 'n/a') return null
  return 'swa'
}

export function buildPrefill(s: PrefillSources): PrefillResponse[] {
  const out: PrefillResponse[] = []
  const put = (
    sectionId: string,
    fieldId: string,
    value: string | number | null,
    source: PrefillSource,
  ) => {
    if (value === null || value === undefined || value === '') return
    out.push(
      typeof value === 'number'
        ? { sectionId, fieldId, valueNumber: value, source }
        : { sectionId, fieldId, valueText: value, source },
    )
  }

  // ── Section 1: project & site identification ──────────────────────────────
  put('project_site', 'record_number', txt(s.formNo), 'system')
  if (s.project) {
    put('project_site', 'project_name', txt(s.project.name), 'project')
    put('project_site', 'project_number', txt(s.project.code), 'project')
    put('project_site', 'client_employer', txt(s.project.client_name), 'project')
    put('project_site', 'site_building_name', txt(s.project.name), 'project')
    const addr = [s.project.address, s.project.city, s.project.province]
      .map(txt)
      .filter(Boolean)
      .join(', ')
    put('project_site', 'physical_address', addr || null, 'project')
  }
  if (s.node) {
    const shop = [txt(s.node.shop_number), txt(s.node.shop_name)].filter(Boolean).join(' — ')
    put('project_site', 'tenant_unit_shop_no', shop || null, 'structure_node')
  }

  // ── Section 2: board identification ───────────────────────────────────────
  if (s.node) {
    put('db_identification', 'db_reference', txt(s.node.code), 'structure_node')
    put('db_identification', 'db_description', txt(s.node.name), 'structure_node')
    // The protective device on the supply TO this board. Note the board's own
    // main switch rating is deliberately NOT filled from this: they are often
    // the same device seen from either end, and often not.
    put(
      'db_identification',
      'upstream_device_rating',
      typeof s.node.incomer_breaker_a === 'number' ? s.node.incomer_breaker_a : null,
      'structure_node',
    )
    put('db_identification', 'phases', polesToPhases(s.node.incomer_pole_config), 'structure_node')
  }
  if (s.feed) {
    // SANS 6.6.1.21(a) says to verify the fed-from label rather than copy it.
    // We fill the schedule's answer so the electrician has something to check
    // AGAINST, which is the point of an as-found value.
    put('db_identification', 'db_fed_from', txt(s.feed.fromBoardCode), 'cable_schedule')
    put('db_identification', 'nominal_voltage', voltageToken(s.feed.voltage_v), 'cable_schedule')
  }

  // ── Section 3: personnel ──────────────────────────────────────────────────
  put('personnel', 'date_of_work', txt(s.todayISO), 'system')
  put('personnel', 'electrician_name', txt(s.userFullName), 'user')
  if (s.organisation) {
    put('personnel', 'electrical_contractor', txt(s.organisation.name), 'organisation')
    put(
      'personnel',
      'electrical_contractor_registration_no',
      txt(s.organisation.registration_no) ?? txt(s.organisation.registration_number),
      'organisation',
    )
  }

  // ── Section 5: circuits fed by this board ─────────────────────────────────
  // Identity and conductor data only. `action_taken`, the pass/fail
  // confirmations and `description_as_verified` are all required and all left
  // blank: they describe what was done and what was found, which no record can
  // supply.
  s.downstream.forEach((d, i) => {
    const k = (sub: string) => `circuits[${i}].${sub}`
    put('circuits_affected', k('way_no'), String(i + 1), 'cable_schedule')
    put('circuits_affected', k('circuit_ref'), txt(d.code), 'cable_schedule')
    put('circuits_affected', k('description_as_found'), txt(d.name) ?? txt(d.code), 'cable_schedule')
    put(
      'circuits_affected',
      k('conductor_size_phase'),
      typeof d.size_mm2 === 'number' ? d.size_mm2 : null,
      'cable_schedule',
    )
    put('circuits_affected', k('number_of_cores'), coresToken(d.cores), 'cable_schedule')
    put('circuits_affected', k('cable_type'), cableTypeToken(d.armour), 'cable_schedule')
  })

  return out
}
