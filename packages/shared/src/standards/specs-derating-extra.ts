/**
 * SANS 10142-1:2021 derating tables beyond the core five. STRUCTURE ONLY — column names, units, printed row keys and the
 * conditions to read. Every value comes out of the PDF at extraction time.
 */
import type { ConditionSpec, OrderedRow, TableSpec } from './extract-table'

const N_CIRCUITS = 'Number of circuits or multicore cables'
const CIRCUIT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20]

/** Rows of table 6.14 in printed order (both pages). `near` checks the label printed beside or just above the values. */
const GROUPING_ROWS: OrderedRow[] = [
  { key: 'enclosed_or_bunched', label: 'Enclosed or bunched and clipped to a non-metallic surface (methods 1, 2, 3)', near: /bunched and clipped/ },
  { key: 'clipped_single_layer_touching', label: 'Single layer clipped to a non-metallic surface, touching (method 3)', near: /clipped to\s+Touching/ },
  { key: 'clipped_single_layer_spaced', label: 'Single layer clipped to a non-metallic surface, spaced (method 3)', near: /\(method 3\)\s+Spaced/ },
  { key: 'tray_multicore_1_touching', label: 'Multicore, perforated tray or rack, one tray, touching (method 4)', near: /multicore,\s+Touching/ },
  { key: 'tray_multicore_1_spaced', label: 'Multicore, perforated tray or rack, one tray, spaced (method 4)', near: /horizontal\s+Spaced/ },
  { key: 'tray_multicore_2_touching', label: 'Multicore, perforated trays or racks, two trays, touching (method 4)', near: /Two racks or two\s+Touching/ },
  { key: 'tray_multicore_2_spaced', label: 'Multicore, perforated trays or racks, two trays, spaced (method 4)', near: /^\s*trays\s+Spaced\s+b\s*$/ },
  { key: 'tray_multicore_3_touching', label: 'Multicore, perforated trays or racks, three trays, touching (method 4)', near: /Three racks or three\s+Touching/ },
  { key: 'tray_multicore_3_spaced', label: 'Multicore, perforated trays or racks, three trays, spaced (method 4)', near: /^\s*trays\s+Spacedb/ },
  { key: 'tray_single_core_1_horizontal', label: 'Single-core touching, perforated tray or rack, one tray, horizontal (method 4)', near: /single-\s+Horizontal/ },
  { key: 'tray_single_core_1_vertical', label: 'Single-core touching, perforated tray or rack, one tray, vertical (method 4)', near: /touching\s+Vertical/ },
  { key: 'tray_single_core_2_horizontal', label: 'Single-core touching, perforated trays or racks, two trays, horizontal (method 4)', near: /Two racks or two\s*$/ },
  { key: 'tray_single_core_3_horizontal', label: 'Single-core touching, perforated trays or racks, three trays, horizontal (method 4)', near: /Three racks or three\s*$/ },
  { key: 'ladder_multicore_1', label: 'Multicore touching on ladder supports, one ladder (method 6)', near: /on ladder supports/ },
  { key: 'ladder_multicore_2', label: 'Multicore touching on ladder supports, two ladders (method 6)', near: /Two racks or two\s*$/ },
  { key: 'ladder_multicore_3', label: 'Multicore touching on ladder supports, three ladders (method 6)', near: /Three racks or three\s*$/ },
]

/** The temperature the concentric-cable ratings are given at ("Current rating at 30 °C"). */
const RATING_AT: ConditionSpec = {
  key: 'ambient_c',
  label: 'Ambient temperature of the rating',
  unit: '°C',
  match: /Current rating at\s+([\d,]+)\s*°C/,
}

export const DERATING_EXTRA_SPECS: Record<string, TableSpec> = {
  '6.14': {
    clause: '6.14',
    title: 'Correction factors for groups of circuits or multicore cables in air',
    topic: 'derating',
    // ORDERED: the key is a multi-line label, not read; header 0 keeps it out of the column layout.
    keyColumn: { key: 'arrangement', label: 'Installation arrangement', unit: null, header: 0, type: 'text' },
    valueColumns: CIRCUIT_COUNTS.map((n, i) => ({ key: `n_${n}`, label: String(n), unit: null, header: i + 1, group: N_CIRCUITS })),
    // The "2 3 4 … 20" row sits directly above the values on both pages.
    centresRow: /^\s*2\s+3\s+4\s+5\s+6\s+7\s+8\s+9\s+10\s+12\s+14\s+16\s+18\s+20\s*$/,
    rows: GROUPING_ROWS,
    // Every value line prints all 14 cells (a dash where not applicable).
    minCells: CIRCUIT_COUNTS.length,
    pages: 'all',
    remark: 'Multiplies the single-circuit ratings of tables 6.1–6.6. "Spaced" is defined in the printed footnote; a dash means no factor is given.',
  },
  '6.17': {
    clause: '6.17',
    title: 'Correction factors for neutral imbalance',
    topic: 'derating',
    keyColumn: { key: 'neutral_pct', label: 'Neutral current as a percentage of phase current', unit: '%', header: 1 },
    valueColumns: [{ key: 'factor', label: 'Correction factor', unit: null, header: 2 }],
    expectedKeys: [0, 25, 50, 75],
  },
  '6.18': {
    clause: '6.18',
    title: 'Correction factors for harmonic currents in multiphase circuits with neutral',
    topic: 'derating',
    keyColumn: { key: 'third_harmonic_pct', label: 'Third harmonic content of phase current', unit: '%', header: 1, kind: 'band' },
    valueColumns: [
      { key: 'by_phase_current', label: 'Size selected on phase current', unit: null, header: 2, group: 'Correction factors' },
      { key: 'by_neutral_current', label: 'Size selected on zero-sequence neutral current', unit: null, header: 3, group: 'Correction factors' },
    ],
    expectedTextKeys: ['0–15', '15–33', '33–45', '>45'],
    remark: 'A dash means that basis does not apply in that band.',
  },
  '6.19': {
    clause: '6.19',
    title: 'Correction factors for direct solar radiation',
    topic: 'derating',
    keyColumn: { key: 'size_band_mm2', label: 'Conductor cross-sectional area', unit: 'mm²', header: 1, kind: 'band' },
    valueColumns: [
      { key: 'coastal_1000wm2', label: '1 000 W/m² (coastal)', unit: null, header: 2, group: 'Solar radiation' },
      { key: 'highveld_1250wm2', label: '1 250 W/m² (highveld)', unit: null, header: 3, group: 'Solar radiation' },
    ],
    expectedTextKeys: ['1.5–10', '16–35', '50–95', '120–185', '240–400'],
  },
  '6.20': {
    clause: '6.20',
    title: 'Current rating for concentric cables',
    topic: 'cable_ratings',
    conditions: [RATING_AT],
    keyColumn: { key: 'size_mm2', label: 'Conductor size', unit: 'mm²', header: 1 },
    valueColumns: [
      { key: 'in_air_sun_a', label: 'In air (direct sunlight)', unit: 'A', header: 2 },
      { key: 'in_ground_a', label: 'In ground', unit: 'A', header: 3 },
    ],
    expectedKeys: [4, 10, 16],
  },
}
