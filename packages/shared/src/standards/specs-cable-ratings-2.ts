/**
 * SANS 10142-1:2021 aluminium PVC cable ratings (6.6–6.8), rubber flexible
 * cables (6.9) and conductor impedance (D.1). STRUCTURE ONLY — column names,
 * units, printed row keys and the conditions to read. Every value comes out of
 * the PDF at extraction time.
 *
 * Tables the extractor cannot yet read faithfully are kept in
 * CABLE_RATING_SPECS_2_BLOCKED with the reason; the extractor refuses them
 * (it throws), so they must not be wired into the loaded set.
 */
import type { ColumnSpec, ConditionSpec, TableSpec } from './extract-table'
import { COND } from './conditions'

const SIZES_16_TO_300 = [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300]
const SIZES_25_TO_400 = [25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]

const SIZE_KEY = { key: 'size_mm2', label: 'Conductor cross-sectional area', unit: 'mm²', header: 1 } as const

const M1 = 'Installation method 1 (enclosed in an insulating wall)'
const M2 = 'Installation method 2 (enclosed in conduit on a wall or ceiling, or in trunking)'
const M3 = 'Installation method 3 (clipped direct)'
const M46 = 'Installation method 4 (perforated cable tray) or 6 (free air)'
const BURIED = 'Cables buried in the ground'
const DUCTS = 'Cables in pipes or ducts buried in the ground'
const R_AC = 'Conductor resistance R for a.c. circuits'
const X_AC = 'Conductor reactance X for a.c. circuits'
const R_DC = 'Conductor resistance R for d.c. circuits'
const AC_1PH = 'Two-core cable, single-phase a.c.'
const AC_3PH = 'Three-core or four-core cable, three-phase a.c.'

/** r / x / z sub-columns of the volt-drop (b) tables, from 25 mm² ("r x z r x z" line). */
const RXZ_TRIGGER = /^\s*r(\s+[rxz])+\s*$/
const RXZ_COLUMNS: ColumnSpec[] = [
  { key: 'ac_1ph_r_mv', label: 'r', unit: 'mV/A/m', header: 1, group: AC_1PH },
  { key: 'ac_1ph_x_mv', label: 'x', unit: 'mV/A/m', header: 2, group: AC_1PH },
  { key: 'ac_1ph_z_mv', label: 'z', unit: 'mV/A/m', header: 3, group: AC_1PH },
  { key: 'ac_3ph_r_mv', label: 'r', unit: 'mV/A/m', header: 4, group: AC_3PH },
  { key: 'ac_3ph_x_mv', label: 'x', unit: 'mV/A/m', header: 5, group: AC_3PH },
  { key: 'ac_3ph_z_mv', label: 'z', unit: 'mV/A/m', header: 6, group: AC_3PH },
]

/**
 * 6.6(b) / 6.7(b): same layout. 16 mm² prints one value per group (stored as z); from 25 mm² r/x/z.
 * The d.c. column sits LEFT of the "r x z" line, so it is kept at its main centre (keepMain).
 */
const alVoltDrop = (clause: string, title: string): TableSpec => ({
  clause,
  title,
  topic: 'volt_drop',
  conditions: [COND.operating70],
  keyColumn: SIZE_KEY,
  valueColumns: [
    { key: 'dc_2core_mv', label: 'Two-core cable, d.c.', unit: 'mV/A/m', header: 2 },
    { key: 'ac_1ph_z_mv', label: 'z', unit: 'mV/A/m', header: 3, group: AC_1PH },
    { key: 'ac_3ph_z_mv', label: 'z', unit: 'mV/A/m', header: 4, group: AC_3PH },
  ],
  // The d.c. column keeps its main centre in the r/x/z rows; a single dash across a group nulls that group.
  subColumns: { trigger: RXZ_TRIGGER, columns: RXZ_COLUMNS, keepMain: ['dc_2core_mv'] },
  expectedKeys: SIZES_16_TO_300,
})

export const CABLE_RATING_SPECS_2: Record<string, TableSpec> = {
  '6.7(a)': {
    clause: '6.7(a)',
    title: 'Multicore PVC insulated armoured cables (SANS 1507) — current-carrying capacity, aluminium',
    topic: 'cable_ratings',
    conditions: [COND.ambient30, COND.operating70],
    keyColumn: SIZE_KEY,
    valueColumns: [
      { key: 'clipped_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 2, group: M3 },
      { key: 'clipped_3or4core_a', label: 'One three/four-core cable, three-phase a.c.', unit: 'A', header: 3, group: M3 },
      { key: 'tray_air_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 4, group: M46 },
      { key: 'tray_air_3or4core_a', label: 'One three/four-core cable, three-phase a.c.', unit: 'A', header: 5, group: M46 },
    ],
    expectedKeys: SIZES_16_TO_300,
  },
  '6.8/AL': {
    clause: '6.8',
    codeSuffix: 'AL',
    pages: 'continuation',
    title: 'Multicore PVC insulated armoured cables buried directly in the ground — current-carrying capacity, aluminium',
    topic: 'cable_ratings',
    // Soil temperature and maximum conductor temperature are printed only on the copper (heading) page;
    // the continuation page carries the footnoted installation conditions.
    conditions: [COND.burialDepth, COND.soilResistivity],
    keyColumn: { key: 'size_mm2', label: 'Nominal conductor size', unit: 'mm²', header: 1 },
    valueColumns: [
      { key: 'buried_2core_a', label: 'Two-core', unit: 'A', header: 2, group: BURIED },
      { key: 'buried_3or4core_a', label: 'Three-core or four-core', unit: 'A', header: 3, group: BURIED },
      { key: 'duct_2core_a', label: 'Two-core', unit: 'A', header: 4, group: DUCTS },
      { key: 'duct_3or4core_a', label: 'Three-core or four-core', unit: 'A', header: 5, group: DUCTS },
    ],
    expectedKeys: SIZES_25_TO_400,
    remark: 'Aluminium page of Table 6.8. Soil 25 °C / max conductor 70 °C are printed on the copper page (6.8).',
  },
  '6.9(a)': {
    clause: '6.9(a)',
    // 'first' only: the (concluded) page reprints the 400/500/630 rows, which 'all' would refuse as repeats.
    pages: 'first',
    title: 'Rubber and silicone-rubber insulated flexible cables (SANS 1574-5) — current-carrying capacity, copper',
    topic: 'cable_ratings',
    conditions: [COND.ambient30, COND.operating70],
    keyColumn: SIZE_KEY,
    valueColumns: [
      { key: 'dc_or_1ph_2core_a', label: 'D.C. or single-phase a.c., one two-core cable', unit: 'A', header: 2 },
      { key: 'three_phase_a', label: 'Three-phase a.c., one three/four/five-core cable', unit: 'A', header: 3 },
      { key: 'two_single_core_touching_a', label: 'Single-phase a.c. or d.c., two single-core cables touching', unit: 'A', header: 4 },
    ],
    // As printed in Ed 3.1: no rows between 95 and 400 mm².
    expectedKeys: [4, 6, 10, 16, 25, 35, 50, 70, 95, 400, 500, 630],
    remark: 'Free-air ratings. Reeling-drum reduction factors (NOTE 2) are not part of the table and are not read.',
  },
  '6.6(b)': alVoltDrop('6.6(b)', 'Multicore PVC insulated cables, unarmoured (SANS 1507) — voltage drop, aluminium'),
  '6.7(b)': alVoltDrop('6.7(b)', 'Multicore PVC insulated armoured cables (SANS 1507) — voltage drop, aluminium'),
  'D.1': {
    clause: 'D.1',
    title: 'Impedance of 600/1 000 V conductors (SANS 1507)',
    topic: 'volt_drop',
    conditions: [COND.ambient30, COND.operating70],
    keyColumn: { key: 'size_mm2', label: 'Nominal cross-sectional area of conductor', unit: 'mm²', header: 1 },
    valueColumns: [
      { key: 'r_ac_cu_ohm_km', label: 'Copper', unit: 'Ω/km', header: 2, group: R_AC },
      { key: 'r_ac_al_ohm_km', label: 'Aluminium', unit: 'Ω/km', header: 3, group: R_AC },
      { key: 'x_ac_cu_ohm_km', label: 'Copper', unit: 'Ω/km', header: 4, group: X_AC },
      { key: 'x_ac_al_ohm_km', label: 'Aluminium', unit: 'Ω/km', header: 5, group: X_AC },
      { key: 'r_dc_cu_ohm_km', label: 'Copper', unit: 'Ω/km', header: 6, group: R_DC },
      { key: 'r_dc_al_ohm_km', label: 'Aluminium', unit: 'Ω/km', header: 7, group: R_DC },
    ],
    expectedKeys: [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000],
  },
}

/** Conductor temperature of 6.9(b), printed in its NOTE ("based on a conductor operating temperature of 85 °C"). */
const VD_NOTE_TEMP: ConditionSpec = {
  key: 'conductor_operating_c',
  label: 'Conductor operating temperature (volt-drop basis)',
  unit: '°C',
  match: /based on a conductor operating temperature\s+of\s+([\d,]+)\s*°C/,
}

/**
 * Specs the extractor REFUSES on the 2021 PDF (it throws; nothing is guessed).
 * Kept so they can be wired once the engine gap is closed. Not for loading.
 */
export const CABLE_RATING_SPECS_2_BLOCKED: Record<string, { spec: TableSpec; blocked: string }> = {
  '6.6(a)': {
    blocked: 'PDF p109: the 120 and 150 mm² rows come out of pdftotext one token per line (a vertical run), so neither row has a key on its value line.',
    spec: {
      clause: '6.6(a)',
      title: 'Multicore PVC insulated cables, unarmoured (SANS 1507) — current-carrying capacity, aluminium',
      topic: 'cable_ratings',
      conditions: [COND.ambient30, COND.operating70],
      keyColumn: SIZE_KEY,
      valueColumns: [
        { key: 'm1_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 2, group: M1 },
        { key: 'm1_3or4core_a', label: 'One three/four-core cable, three-phase a.c.', unit: 'A', header: 3, group: M1 },
        { key: 'm2_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 4, group: M2 },
        { key: 'm2_3or4core_a', label: 'One three/four-core cable, three-phase a.c.', unit: 'A', header: 5, group: M2 },
        { key: 'clipped_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 6, group: M3 },
        { key: 'clipped_3or4core_a', label: 'One three/four-core cable, three-phase a.c.', unit: 'A', header: 7, group: M3 },
        { key: 'tray_air_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 8, group: M46 },
        { key: 'tray_air_3or4core_a', label: 'One three/four-core cable, three-phase a.c.', unit: 'A', header: 9, group: M46 },
      ],
      expectedKeys: SIZES_16_TO_300,
    },
  },
  '6.9(b)': {
    blocked: 'PDF p116: the 25–95 mm² r/x/z values are broken into digit fragments across lines; p117 (concluded) prints no "r x z" line, so its sub-column values have no centres; dashes there are hyphens under a group.',
    spec: {
      clause: '6.9(b)',
      pages: 'all',
      title: 'Rubber and silicone-rubber insulated flexible cables (SANS 1574-5) — voltage drop, copper',
      topic: 'volt_drop',
      conditions: [VD_NOTE_TEMP],
      keyColumn: SIZE_KEY,
      valueColumns: [
        { key: 'dc_2core_mv', label: 'One two-core or two single-core cables, d.c.', unit: 'mV/A/m', header: 2 },
        { key: 'ac_1ph_z_mv', label: 'z', unit: 'mV/A/m', header: 3, group: AC_1PH },
        { key: 'ac_3ph_z_mv', label: 'z', unit: 'mV/A/m', header: 4, group: 'Three-phase a.c. (one three/four/five-core cable)' },
        { key: 'touching_1ph_z_mv', label: 'z', unit: 'mV/A/m', header: 5, group: 'Two single-core cables touching, single-phase a.c.' },
      ],
      subColumns: {
        trigger: RXZ_TRIGGER,
        columns: [
          ...RXZ_COLUMNS.slice(0, 3),
          { key: 'ac_3ph_r_mv', label: 'r', unit: 'mV/A/m', header: 4, group: 'Three-phase a.c. (one three/four/five-core cable)' },
          { key: 'ac_3ph_x_mv', label: 'x', unit: 'mV/A/m', header: 5, group: 'Three-phase a.c. (one three/four/five-core cable)' },
          { key: 'ac_3ph_z_mv', label: 'z', unit: 'mV/A/m', header: 6, group: 'Three-phase a.c. (one three/four/five-core cable)' },
          { key: 'touching_1ph_r_mv', label: 'r', unit: 'mV/A/m', header: 7, group: 'Two single-core cables touching, single-phase a.c.' },
          { key: 'touching_1ph_x_mv', label: 'x', unit: 'mV/A/m', header: 8, group: 'Two single-core cables touching, single-phase a.c.' },
          { key: 'touching_1ph_z_mv', label: 'z', unit: 'mV/A/m', header: 9, group: 'Two single-core cables touching, single-phase a.c.' },
        ],
      },
      expectedKeys: [4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630],
    },
  },
}
