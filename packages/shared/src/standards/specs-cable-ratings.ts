/**
 * SANS 10142-1:2021 cable current ratings, volt drop and conductor impedance. STRUCTURE ONLY — column names, units, printed row keys and the
 * conditions to read. Every value comes out of the PDF at extraction time.
 */
import type { ColumnSpec, TableSpec } from './extract-table'
import { COND } from './conditions'

// ── PVC tables 6.2–6.5 (shared structure; no values) ────────────────────────

/** Printed row keys (conductor sizes, mm²) — structure, not values. */
const pvc_SIZES_CU_SINGLE = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000]
const pvc_SIZES_CU_MULTI = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const pvc_SIZES_AL_SINGLE = [50, 70, 95, 120, 150, 185, 240, 300, 380, 480, 600, 740, 960, 1200]

const pvc_SIZE_KEY = { key: 'size_mm2', label: 'Conductor cross-sectional area', unit: 'mm²', header: 1 } as const

/** Installation-method header groups as printed over the single-core current tables. */
const pvc_SC_M1 = 'Installation method 1 — in conduit in a thermally insulating wall'
const pvc_SC_M2 = 'Installation method 2 — in conduit on a wall or in trunking'
const pvc_SC_M3 = 'Installation method 3 — clipped direct'
const pvc_SC_M4 = 'Installation method 4 — on a perforated cable tray, horizontal or vertical'
const pvc_SC_M5 = 'Installation method 5 — in free air'

/** Columns 2–12 of the single-core PVC current tables (6.2(a) copper, 6.5(a) aluminium share the layout). */
const pvc_SINGLE_CORE_CURRENT: ColumnSpec[] = [
  { key: 'm1_2cable_a', label: 'Two cables, single-phase a.c. or d.c.', unit: 'A', header: 2, group: pvc_SC_M1 },
  { key: 'm1_3or4cable_a', label: 'Three or four cables, three-phase a.c.', unit: 'A', header: 3, group: pvc_SC_M1 },
  { key: 'm2_2cable_a', label: 'Two cables, single-phase a.c. or d.c.', unit: 'A', header: 4, group: pvc_SC_M2 },
  { key: 'm2_3or4cable_a', label: 'Three or four cables, three-phase a.c.', unit: 'A', header: 5, group: pvc_SC_M2 },
  { key: 'm3_2cable_a', label: 'Two cables, single-phase a.c. or d.c. (flat, touching)', unit: 'A', header: 6, group: pvc_SC_M3 },
  { key: 'm3_3or4cable_a', label: 'Three or four cables, three-phase a.c. (flat touching or trefoil)', unit: 'A', header: 7, group: pvc_SC_M3 },
  { key: 'm4_2cable_a', label: 'Two cables, single-phase a.c. or d.c. (flat, touching)', unit: 'A', header: 8, group: pvc_SC_M4 },
  { key: 'm4_3or4cable_a', label: 'Three or four cables, three-phase a.c. (flat touching or trefoil)', unit: 'A', header: 9, group: pvc_SC_M4 },
  { key: 'm5_horizontal_flat_a', label: 'Horizontal flat spaced — two cables 1-ph a.c./d.c. or three cables 3-ph a.c.', unit: 'A', header: 10, group: pvc_SC_M5 },
  { key: 'm5_vertical_flat_a', label: 'Vertical flat spaced — two cables 1-ph a.c./d.c. or three cables 3-ph a.c.', unit: 'A', header: 11, group: pvc_SC_M5 },
  { key: 'm5_trefoil_a', label: 'Trefoil — three cables, three-phase a.c.', unit: 'A', header: 12, group: pvc_SC_M5 },
]

/** Installation-method header groups as printed over the multicore unarmoured current table. */
const pvc_MC_M1 = 'Installation method 1 — in an insulating wall'
const pvc_MC_M2 = 'Installation method 2 — in conduit on a wall or ceiling, or in trunking'
const pvc_MC_M3 = 'Installation method 3 — clipped direct'
const pvc_MC_M46 = 'Installation method 4 (perforated cable tray) or method 6 (free air)'

const pvc_MULTICORE_CURRENT: ColumnSpec[] = [
  { key: 'm1_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 2, group: pvc_MC_M1 },
  { key: 'm1_3or4core_a', label: 'One three- or four-core cable, three-phase a.c.', unit: 'A', header: 3, group: pvc_MC_M1 },
  { key: 'm2_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 4, group: pvc_MC_M2 },
  { key: 'm2_3or4core_a', label: 'One three- or four-core cable, three-phase a.c.', unit: 'A', header: 5, group: pvc_MC_M2 },
  { key: 'm3_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 6, group: pvc_MC_M3 },
  { key: 'm3_3or4core_a', label: 'One three- or four-core cable, three-phase a.c.', unit: 'A', header: 7, group: pvc_MC_M3 },
  { key: 'm46_2core_a', label: 'One two-core cable, single-phase a.c. or d.c.', unit: 'A', header: 8, group: pvc_MC_M46 },
  { key: 'm46_3or4core_a', label: 'One three- or four-core cable, three-phase a.c.', unit: 'A', header: 9, group: pvc_MC_M46 },
]

// ── PVC volt-drop tables (b) ────────────────────────────────────────────────
// Up to 16 mm² one value per method is printed; from the "r x z" line on, each method prints r / x / z.
// The single value of the small sizes shares its key with the z sub-column. The d.c. column has no
// r/x/z split, so it keeps its main centre in the sub rows (keepMain).

/** The "r x z" sub-heading line. */
const pvc_RXZ_TRIGGER = /^\s*r(\s+[rxz])+\s*$/
const pvc_VD_UNIT = 'mV/A/m'

interface pvc_VdGroup { key: string; group: string }

/** Main columns: d.c. at column 2, then one column per method group from column 3. */
function pvc_vdMain(dcLabel: string, groups: pvc_VdGroup[]): ColumnSpec[] {
  return [
    { key: 'dc_mv', label: dcLabel, unit: pvc_VD_UNIT, header: 2 },
    ...groups.map((g, i) => ({ key: `${g.key}_z`, label: 'z', unit: pvc_VD_UNIT, header: i + 3, group: g.group })),
  ]
}

/** Sub columns: r, x, z per method group, in printed order along the "r x z" line. */
function pvc_vdSub(groups: pvc_VdGroup[]): ColumnSpec[] {
  return groups.flatMap((g, i) => (['r', 'x', 'z'] as const).map((s, j) => ({
    key: `${g.key}_${s}`,
    label: s === 'r' ? 'r (resistive)' : s === 'x' ? 'x (reactive)' : 'z (impedance)',
    unit: pvc_VD_UNIT,
    header: i * 3 + j + 1,
    group: g.group,
  })))
}

const pvc_1PH = 'Two cables, single-phase a.c.'
const pvc_3PH = 'Three or four cables, three-phase a.c.'
/** Columns 3–9 of the single-core volt-drop tables (6.2(b) copper, 6.5(b) aluminium). */
const pvc_SC_VD_GROUPS: pvc_VdGroup[] = [
  { key: '1ph_m12', group: `${pvc_1PH} — methods 1 and 2 (in conduit, in or on a wall)` },
  { key: '1ph_m34', group: `${pvc_1PH} — methods 3 and 4 (clipped direct or on trays, touching)` },
  { key: '1ph_m5', group: `${pvc_1PH} — method 5 (spaced)` },
  { key: '3ph_m12', group: `${pvc_3PH} — methods 1 and 2 (in conduit, in or on a wall)` },
  { key: '3ph_m345_trefoil', group: `${pvc_3PH} — methods 3, 4 and 5 (trefoil)` },
  { key: '3ph_m34_flat', group: `${pvc_3PH} — methods 3 and 4 (flat, touching)` },
  { key: '3ph_m5_flat', group: `${pvc_3PH} — method 5 (flat, spaced)` },
]
const pvc_SC_VD_MAIN = pvc_vdMain('Two cables, d.c.', pvc_SC_VD_GROUPS)
/**
 * The single-core r/x/z rows are packed tightly: the text layer places some values midway between two
 * sub-labels, so a row printing exactly one value per sub-column is read in printed order.
 */
const pvc_SC_VD_SUB = { trigger: pvc_RXZ_TRIGGER, columns: pvc_vdSub(pvc_SC_VD_GROUPS), keepMain: ['dc_mv'], byOrderWhenComplete: true }

/** The units row ("mm2  mV/A/m …") — its cells sit where the values do. */
const pvc_UNITS_ROW = /^\s*mm2(\s+mV\/A\/m)+\s*$/

/** Columns 3–4 of the multicore volt-drop tables (6.3(b) unarmoured, 6.4(b) armoured). */
const pvc_MC_VD_GROUPS: pvc_VdGroup[] = [
  { key: '2core_1ph', group: 'Two-core cable, single-phase a.c.' },
  { key: '3or4core_3ph', group: 'Three- or four-core cable, three-phase a.c.' },
]

const pvc_MC_VD_MAIN = pvc_vdMain('Two-core cable, d.c.', pvc_MC_VD_GROUPS)
const pvc_MC_VD_SUB = { trigger: pvc_RXZ_TRIGGER, columns: pvc_vdSub(pvc_MC_VD_GROUPS), keepMain: ['dc_mv'] }

export const CABLE_RATING_SPECS: Record<string, TableSpec> = {
  '6.3(b)': {
    clause: '6.3(b)',
    title: 'Multicore PVC insulated cables, unarmoured — voltage drop per ampere per metre, copper',
    topic: 'volt_drop',
    conditions: [COND.operatingTemp],
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_MC_VD_MAIN,
    subColumns: pvc_MC_VD_SUB,
    expectedKeys: pvc_SIZES_CU_MULTI,
    remark: 'Single-phase values include the return path. From 25 mm² the r / x / z components are printed.',
  },
  '6.4(b)': {
    clause: '6.4(b)',
    title: 'Multicore PVC insulated armoured cables — voltage drop per ampere per metre, copper',
    topic: 'volt_drop',
    conditions: [COND.operatingTemp],
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_MC_VD_MAIN,
    subColumns: pvc_MC_VD_SUB,
    expectedKeys: pvc_SIZES_CU_MULTI.slice(1),
    remark: 'Single-phase values include the return path. From 25 mm² the r / x / z components are printed.',
  },
  '6.2(b)': {
    clause: '6.2(b)',
    title: 'Single-core PVC insulated cables, unarmoured — voltage drop per ampere per metre, copper',
    topic: 'volt_drop',
    conditions: [COND.operatingTemp],
    pages: 'all',
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_SC_VD_MAIN,
    subColumns: pvc_SC_VD_SUB,
    centresRow: pvc_UNITS_ROW,
    expectedKeys: pvc_SIZES_CU_SINGLE,
    remark: 'Single-phase values include the return path. From 25 mm² the r / x / z components are printed.',
  },
  '6.5(b)': {
    clause: '6.5(b)',
    title: 'Single-core PVC insulated cables, unarmoured — voltage drop per ampere per metre, aluminium',
    topic: 'volt_drop',
    conditions: [COND.operatingTemp],
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_SC_VD_MAIN,
    subColumns: pvc_SC_VD_SUB,
    expectedKeys: pvc_SIZES_AL_SINGLE,
    remark: 'Single-phase values include the return path. Every printed size carries r / x / z components.',
  },
  '6.2(a)': {
    clause: '6.2(a)',
    title: 'Single-core PVC insulated cables, unarmoured — current-carrying capacity, copper',
    topic: 'cable_ratings',
    conditions: [COND.ambientTemp, COND.operatingTemp],
    pages: 'all',
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_SINGLE_CORE_CURRENT,
    expectedKeys: pvc_SIZES_CU_SINGLE,
  },
  '6.3(a)': {
    clause: '6.3(a)',
    title: 'Multicore PVC insulated cables, unarmoured — current-carrying capacity, copper',
    topic: 'cable_ratings',
    conditions: [COND.ambientTemp, COND.operatingTemp],
    pages: 'all',
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_MULTICORE_CURRENT,
    expectedKeys: pvc_SIZES_CU_MULTI,
  },
  '6.5(a)': {
    clause: '6.5(a)',
    title: 'Single-core PVC insulated cables, unarmoured — current-carrying capacity, aluminium',
    topic: 'cable_ratings',
    conditions: [COND.ambientTemp, COND.operatingTemp],
    keyColumn: pvc_SIZE_KEY,
    valueColumns: pvc_SINGLE_CORE_CURRENT,
    expectedKeys: pvc_SIZES_AL_SINGLE,
  },
}
