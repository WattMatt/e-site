/**
 * What to read out of SANS 10142-1, table by table. A spec holds structure
 * only — column names, units, the row keys the table must have — never a
 * value: values come out of the PDF at extraction time, each with its page.
 *
 * The same specs read the 2017 (Ed 2) and 2021 (Ed 3.1) editions: the
 * extractor refuses a table whose layout or row set differs, so a change
 * between editions surfaces as an error rather than as a silent misread.
 */
import type { TableSpec } from './extract-table'
import { COND } from './conditions'
import { CABLE_RATING_SPECS } from './specs-cable-ratings'
import { CABLE_RATING_SPECS_2 } from './specs-cable-ratings-2'
import { PROTECTION_SPECS } from './specs-protection'
import { DERATING_EXTRA_SPECS } from './specs-derating-extra'
import { XA_SPECS } from './specs-xa'

const DIRECT = 'Buried directly in the ground — centre-line spacing'
const PIPES = 'In pipes buried in the ground — centre-line spacing'


const SIZES_1_5_TO_400 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(v)
  return out
}

const CORE_SPECS: Record<string, TableSpec> = {
  '6.10': {
    clause: '6.10',
    title: 'Correction factors for ambient temperature',
    topic: 'derating',
    keyColumn: { key: 'ambient_c', label: 'Ambient temperature', unit: '°C', header: 1 },
    valueColumns: [
      { key: 'pvc_70c', label: 'General purpose PVC, 70 °C', unit: null, header: 2 },
      { key: 'rubber_85c', label: 'Rubber, 85 °C', unit: null, header: 3 },
      { key: 'rubber_150c', label: 'Rubber, 150 °C', unit: null, header: 4 },
    ],
    expectedKeys: range(10, 145, 5),
    spanned: { column: 'rubber_150c', from: 10, to: 85 },
    remark: 'Rubber 150 °C: the standard prints one factor for a band of ambient temperatures.',
  },
  '6.11': {
    clause: '6.11',
    title: 'Correction factors for soil temperature',
    topic: 'derating',
    conditions: [COND.maxConductorTemp],
    keyColumn: { key: 'soil_temp_c', label: 'Soil temperature', unit: '°C', header: 1 },
    valueColumns: [
      { key: 'buried_direct_or_pipes', label: 'Buried directly or in pipes', unit: null, header: 2 },
    ],
    expectedKeys: range(10, 40, 5),
  },
  '6.12': {
    clause: '6.12',
    title: 'Correction factors for thermal resistivity of soil',
    topic: 'derating',
    keyColumn: { key: 'resistivity_kmw', label: 'Thermal resistivity of soil', unit: 'K·m/W', header: 1 },
    valueColumns: [
      { key: 'buried_direct', label: 'Buried directly in the ground', unit: null, header: 2 },
      { key: 'in_pipes', label: 'In pipes buried in the ground', unit: null, header: 3 },
    ],
    expectedKeys: [0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
  },
  '6.13': {
    clause: '6.13',
    title: 'Correction factors for grouping of cables buried in the ground — horizontal spacing',
    topic: 'derating',
    keyColumn: { key: 'n_cables', label: 'Number of cables in group', unit: null, header: 2 },
    valueColumns: [
      { key: 'direct_touching', label: 'Touching', unit: null, header: 3, group: DIRECT },
      { key: 'direct_150mm', label: '150 mm', unit: null, header: 4, group: DIRECT },
      { key: 'direct_300mm', label: '300 mm', unit: null, header: 5, group: DIRECT },
      { key: 'direct_450mm', label: '450 mm', unit: null, header: 6, group: DIRECT },
      { key: 'direct_600mm', label: '600 mm', unit: null, header: 7, group: DIRECT },
      { key: 'pipes_touching', label: 'Touching', unit: null, header: 8, group: PIPES },
      { key: 'pipes_300mm', label: '300 mm', unit: null, header: 9, group: PIPES },
      { key: 'pipes_450mm', label: '450 mm', unit: null, header: 10, group: PIPES },
      { key: 'pipes_600mm', label: '600 mm', unit: null, header: 11, group: PIPES },
    ],
    expectedKeys: range(2, 12, 1),
    remark: 'Horizontal-spacing block only; the horizontal-and-vertical block is keyed by a drawing and is not extracted.',
  },
  '6.16': {
    clause: '6.16',
    title: 'Correction factors for depth of cables buried in the ground',
    topic: 'derating',
    keyColumn: { key: 'depth_m', label: 'Depth', unit: 'm', header: 1 },
    valueColumns: [
      { key: 'buried_direct', label: 'Buried directly in the ground', unit: null, header: 2 },
      { key: 'in_pipes', label: 'In pipes buried in the ground', unit: null, header: 3 },
    ],
    expectedKeys: [0.5, 0.6, 0.8, 1.0, 1.25, 1.5],
  },
  // Read for the audit's cross-check of the legacy PVC copper table; not loaded.
  '6.4(a)': {
    clause: '6.4(a)',
    title: 'Multicore PVC insulated armoured cables — current-carrying capacity, copper',
    topic: 'cable_ratings',
    conditions: [COND.ambientTemp, COND.operatingTemp],
    keyColumn: { key: 'size_mm2', label: 'Conductor cross-sectional area', unit: 'mm²', header: 1 },
    valueColumns: [
      { key: 'clipped_2core_a', label: 'Method 3 — two-core', unit: 'A', header: 2 },
      { key: 'clipped_3or4core_a', label: 'Method 3 — three/four-core', unit: 'A', header: 3 },
      { key: 'tray_air_2core_a', label: 'Method 4/6 — two-core', unit: 'A', header: 4 },
      { key: 'tray_air_3or4core_a', label: 'Method 4/6 — three/four-core', unit: 'A', header: 5 },
    ],
    expectedKeys: SIZES_1_5_TO_400,
  },
  '6.8': {
    clause: '6.8',
    title: 'Multicore PVC insulated armoured cables buried directly in the ground — current-carrying capacity, copper',
    topic: 'cable_ratings',
    conditions: [COND.soilTemp, COND.maxConductorTemp, COND.burialDepth, COND.soilResistivity],
    keyColumn: { key: 'size_mm2', label: 'Nominal conductor size', unit: 'mm²', header: 1 },
    valueColumns: [
      { key: 'buried_2core_a', label: 'Buried — two-core', unit: 'A', header: 2 },
      { key: 'buried_3or4core_a', label: 'Buried — three/four-core', unit: 'A', header: 3 },
      { key: 'duct_2core_a', label: 'Pipes/ducts — two-core', unit: 'A', header: 4 },
      { key: 'duct_3or4core_a', label: 'Pipes/ducts — three/four-core', unit: 'A', header: 5 },
    ],
    expectedKeys: SIZES_1_5_TO_400,
  },
}

/** Every SANS 10142-1:2021 table the pipeline reads. Group files hold structure only. */
export const SANS_10142_1_SPECS: Record<string, TableSpec> = {
  ...CORE_SPECS,
  ...CABLE_RATING_SPECS,
  ...CABLE_RATING_SPECS_2,
  ...PROTECTION_SPECS,
  ...DERATING_EXTRA_SPECS,
}

/** The superseded 2017 edition: only the derating tables loaded on 2026-10-05 (same layouts). */
export const SANS_10142_1_2017_SPECS: Record<string, TableSpec> = Object.fromEntries(
  ['6.10', '6.11', '6.12', '6.13', '6.16', '6.4(a)', '6.8'].map((c) => [c, CORE_SPECS[c]]),
)

/** SANS 10400-XA:2021 tables. */
export const SANS_10400_XA_SPECS: Record<string, TableSpec> = XA_SPECS

/** The tables the audit reads but the loader does not load (compared with legacy data only). */
export const AUDIT_ONLY = new Set<string>()
