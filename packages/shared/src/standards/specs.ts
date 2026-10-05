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

const SIZES_1_5_TO_400 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(v)
  return out
}

export const SANS_10142_1_SPECS: Record<string, TableSpec> = {
  '6.10': {
    clause: '6.10',
    title: 'Correction factors for ambient temperature',
    keyColumn: { key: 'ambient_c', label: 'Ambient temperature', unit: '°C', header: 1 },
    valueColumns: [
      { key: 'pvc_70c', label: 'General purpose PVC, 70 °C', unit: null, header: 2 },
      { key: 'rubber_85c', label: 'Rubber, 85 °C', unit: null, header: 3 },
      { key: 'rubber_150c', label: 'Rubber, 150 °C', unit: null, header: 4 },
    ],
    expectedKeys: range(10, 145, 5),
    spanned: { column: 'rubber_150c', from: 10, to: 85 },
    remark: 'Rubber 150 °C: one factor printed for the whole 10–85 °C band.',
  },
  '6.11': {
    clause: '6.11',
    title: 'Correction factors for soil temperature',
    keyColumn: { key: 'soil_temp_c', label: 'Soil temperature', unit: '°C', header: 1 },
    valueColumns: [
      { key: 'buried_direct_or_pipes', label: 'Buried directly or in pipes (70 °C conductor)', unit: null, header: 2 },
    ],
    expectedKeys: range(10, 40, 5),
  },
  '6.12': {
    clause: '6.12',
    title: 'Correction factors for thermal resistivity of soil',
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
    keyColumn: { key: 'n_cables', label: 'Number of cables in group', unit: null, header: 2 },
    valueColumns: [
      { key: 'direct_touching', label: 'Direct — touching', unit: null, header: 3 },
      { key: 'direct_150mm', label: 'Direct — 150 mm', unit: null, header: 4 },
      { key: 'direct_300mm', label: 'Direct — 300 mm', unit: null, header: 5 },
      { key: 'direct_450mm', label: 'Direct — 450 mm', unit: null, header: 6 },
      { key: 'direct_600mm', label: 'Direct — 600 mm', unit: null, header: 7 },
      { key: 'pipes_touching', label: 'Pipes — touching', unit: null, header: 8 },
      { key: 'pipes_300mm', label: 'Pipes — 300 mm', unit: null, header: 9 },
      { key: 'pipes_450mm', label: 'Pipes — 450 mm', unit: null, header: 10 },
      { key: 'pipes_600mm', label: 'Pipes — 600 mm', unit: null, header: 11 },
    ],
    expectedKeys: range(2, 12, 1),
    remark: 'Horizontal-spacing block only; the horizontal-and-vertical block is keyed by a drawing and is not extracted.',
  },
  '6.16': {
    clause: '6.16',
    title: 'Correction factors for depth of cables buried in the ground',
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
    title: 'Multicore PVC insulated armoured cables buried directly in the ground — current-carrying capacity',
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

/** The tables loaded into the reference model (owner decision D1, ranked list). */
export const LOADED_CLAUSES = ['6.13', '6.12', '6.10', '6.11', '6.16'] as const
