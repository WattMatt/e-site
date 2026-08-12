import { describe, it, expect } from 'vitest'
import { buildPrefill, polesToPhases, type PrefillSources } from './prefill'
import template from './templates/termination-and-making-safe.json'

const empty: PrefillSources = {
  project: null,
  organisation: null,
  userFullName: null,
  node: null,
  feed: null,
  downstream: [],
  formNo: null,
  todayISO: '2026-08-12',
}

const full: PrefillSources = {
  project: {
    name: '(643) KINGSWALK',
    code: '636',
    client_name: 'Kingswalk Property Holdings',
    address: '12 Kingswalk Ave',
    city: 'Pretoria',
    province: 'Gauteng',
  },
  organisation: { name: 'WM Consulting', registration_no: 'EC-12345', registration_number: null },
  userFullName: 'P. Nkosi',
  node: {
    code: 'DB-01',
    name: 'Shop 4 board',
    shop_number: 'S4',
    shop_name: 'Woolworths',
    incomer_breaker_a: 80,
    incomer_pole_config: '3P+N',
  },
  feed: { fromBoardCode: 'MAIN BOARD 2.2', voltage_v: 400, section: 'NORMAL' },
  downstream: [
    { code: 'DB-01A', name: 'Shop 4 lighting', size_mm2: 35, cores: '4c', armour: 'SWA' },
    { code: 'DB-01B', name: null, size_mm2: null, cores: null, armour: 'none' },
  ],
  formNo: 'TMS-636-2026-0007',
  todayISO: '2026-08-12',
}

const find = (rows: ReturnType<typeof buildPrefill>, section: string, field: string) =>
  rows.find((r) => r.sectionId === section && r.fieldId === field)

describe('buildPrefill — what it fills', () => {
  const rows = buildPrefill(full)

  it('fills project identity', () => {
    expect(find(rows, 'project_site', 'project_name')?.valueText).toBe('(643) KINGSWALK')
    expect(find(rows, 'project_site', 'project_number')?.valueText).toBe('636')
    expect(find(rows, 'project_site', 'client_employer')?.valueText).toBe(
      'Kingswalk Property Holdings',
    )
  })

  it('joins the address from its parts', () => {
    expect(find(rows, 'project_site', 'physical_address')?.valueText).toBe(
      '12 Kingswalk Ave, Pretoria, Gauteng',
    )
  })

  it('fills board identity and the upstream device rating', () => {
    expect(find(rows, 'db_identification', 'db_reference')?.valueText).toBe('DB-01')
    expect(find(rows, 'db_identification', 'db_description')?.valueText).toBe('Shop 4 board')
    expect(find(rows, 'db_identification', 'upstream_device_rating')?.valueNumber).toBe(80)
  })

  it('fills fed-from and voltage from the cable schedule', () => {
    expect(find(rows, 'db_identification', 'db_fed_from')?.valueText).toBe('MAIN BOARD 2.2')
    expect(find(rows, 'db_identification', 'nominal_voltage')?.valueText).toBe('400_v')
  })

  it('fills personnel and contractor registration', () => {
    expect(find(rows, 'personnel', 'electrician_name')?.valueText).toBe('P. Nkosi')
    expect(find(rows, 'personnel', 'electrical_contractor')?.valueText).toBe('WM Consulting')
    expect(find(rows, 'personnel', 'electrical_contractor_registration_no')?.valueText).toBe(
      'EC-12345',
    )
    expect(find(rows, 'personnel', 'date_of_work')?.valueText).toBe('2026-08-12')
  })

  it('creates one circuit row per downstream board, numbered from 1', () => {
    expect(find(rows, 'circuits_affected', 'circuits[0].circuit_ref')?.valueText).toBe('DB-01A')
    expect(find(rows, 'circuits_affected', 'circuits[0].way_no')?.valueText).toBe('1')
    expect(find(rows, 'circuits_affected', 'circuits[1].circuit_ref')?.valueText).toBe('DB-01B')
    expect(find(rows, 'circuits_affected', 'circuits[1].way_no')?.valueText).toBe('2')
  })

  it('fills circuit conductor data from the schedule', () => {
    expect(find(rows, 'circuits_affected', 'circuits[0].conductor_size_phase')?.valueNumber).toBe(35)
    expect(find(rows, 'circuits_affected', 'circuits[0].number_of_cores')?.valueText).toBe('4')
    expect(find(rows, 'circuits_affected', 'circuits[0].cable_type')?.valueText).toBe('swa')
  })

  it('records where every value came from', () => {
    expect(find(rows, 'project_site', 'project_name')?.source).toBe('project')
    expect(find(rows, 'db_identification', 'db_fed_from')?.source).toBe('cable_schedule')
    expect(find(rows, 'personnel', 'electrician_name')?.source).toBe('user')
    expect(find(rows, 'db_identification', 'db_reference')?.source).toBe('structure_node')
  })
})

describe('buildPrefill — what it must NEVER fill', () => {
  const rows = buildPrefill(full)
  const filled = new Set(rows.map((r) => `${r.sectionId}:${r.fieldId}`))

  it('never fills the as-verified circuit description', () => {
    // Its whole purpose is to differ from the as-found label. Filling it from
    // the record would assert a verification nobody performed.
    expect(filled.has('circuits_affected:circuits[0].description_as_verified')).toBe(false)
  })

  it('never fills what was done to a circuit', () => {
    for (const sub of ['action_taken', 'termination_method', 'clear_break_made',
                       'conductor_labelled_dead', 'proved_dead_at_point_of_work']) {
      expect(filled.has(`circuits_affected:circuits[0].${sub}`)).toBe(false)
    }
  })

  it('never fills alternative supplies — the most safety-critical field on the form', () => {
    expect(filled.has('db_identification:alternative_supplies')).toBe(false)
  })

  it('never fills any isolation, test or handover answer', () => {
    for (const key of rows.map((r) => r.sectionId)) {
      expect(['safe_isolation', 'lock_register', 'proving_dead', 'electrical_tests',
              'handover_status', 'hazards_defects', 'declarations',
              'labelling_reinstatement', 'earthing_adequacy']).not.toContain(key)
    }
  })

  it('never fills the board main switch rating from the upstream device', () => {
    expect(filled.has('db_identification:main_switch_rating')).toBe(false)
  })
})

describe('buildPrefill — absent and malformed sources', () => {
  it('fills only the date of work when nothing else is known', () => {
    // today's date is a safe, obvious default the electrician can change;
    // everything else has no source, so nothing else is asserted.
    expect(buildPrefill(empty)).toEqual([
      { sectionId: 'personnel', fieldId: 'date_of_work', valueText: '2026-08-12', source: 'system' },
    ])
  })

  it('omits a field rather than writing an empty string', () => {
    const rows = buildPrefill({
      ...empty,
      project: { name: '  ', code: null, client_name: null, address: null, city: null, province: null },
    })
    expect(rows.filter((r) => r.sectionId === 'project_site')).toEqual([])
  })

  it('skips conductor data the schedule does not have', () => {
    const rows = buildPrefill(full)
    expect(find(rows, 'circuits_affected', 'circuits[1].conductor_size_phase')).toBeUndefined()
    expect(find(rows, 'circuits_affected', 'circuits[1].number_of_cores')).toBeUndefined()
    // 'none' armour is an answer, not a cable type
    expect(find(rows, 'circuits_affected', 'circuits[1].cable_type')).toBeUndefined()
  })

  it('falls back to the board code when a downstream board has no name', () => {
    const rows = buildPrefill(full)
    expect(find(rows, 'circuits_affected', 'circuits[1].description_as_found')?.valueText).toBe('DB-01B')
  })

  it('uses the second registration spelling when the first is absent', () => {
    const rows = buildPrefill({
      ...empty,
      organisation: { name: 'X', registration_no: null, registration_number: 'REG-9' },
    })
    expect(find(rows, 'personnel', 'electrical_contractor_registration_no')?.valueText).toBe('REG-9')
  })
})

describe('polesToPhases', () => {
  it.each([['3P+N', '3'], ['3P', '3'], ['TPN', '3'], ['1P+N', '1'], ['SP', '1'], ['2P', '2']])(
    '%s -> %s',
    (input, expected) => expect(polesToPhases(input)).toBe(expected),
  )

  it('returns null rather than guessing on an unrecognised config', () => {
    // Phase count drives a registration-scope gate: a single-phase tester may
    // not work on a three-phase installation. A wrong guess would either block
    // a legitimate submission or wave through an unlawful one.
    expect(polesToPhases('weird')).toBeNull()
    expect(polesToPhases(null)).toBeNull()
    expect(polesToPhases('')).toBeNull()
  })
})

describe('every prefilled field exists in the template', () => {
  it('maps only to real field ids with compatible types', () => {
    const byId = new Map<string, { type: string; options?: string[] }>()
    for (const s of (template as any).sections) {
      for (const f of s.fields ?? []) {
        byId.set(`${s.section_id}:${f.field_id}`, f)
        for (const sub of f.fields ?? []) byId.set(`${s.section_id}:${f.field_id}[].${sub.field_id}`, sub)
      }
    }
    const unknown: string[] = []
    const badOption: string[] = []
    for (const r of buildPrefill(full)) {
      const key = r.fieldId.replace(/\[(\d+)\]/, '[]')
      const def = byId.get(`${r.sectionId}:${key}`)
      if (!def) { unknown.push(`${r.sectionId}:${r.fieldId}`); continue }
      // A dropdown value that is not one of its options renders as blank.
      if (def.type === 'dropdown' && r.valueText && def.options && !def.options.includes(r.valueText)) {
        badOption.push(`${r.sectionId}:${r.fieldId} = ${r.valueText}`)
      }
    }
    expect(unknown).toEqual([])
    expect(badOption).toEqual([])
  })
})
