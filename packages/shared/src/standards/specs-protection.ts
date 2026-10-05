/**
 * SANS 10142-1:2021 earthing and protection tables. STRUCTURE ONLY — column names, units, printed row keys and the
 * conditions to read. Every value comes out of the PDF at extraction time.
 *
 * 6.28(a)/(b) are left-aligned grids: values are placed by where they START (anchor 'start'), with the
 * centres taken from the first device row, which prints every column (dashes included) and is read as data.
 */
import type { ConditionSpec, TableSpec } from './extract-table'

/** Instantaneous trip setting as a multiple of rated current, read from the table heading (6.28(a) prints it with a lower-case l). */
const TRIP_MULTIPLE: ConditionSpec = {
  key: 'trip_multiple_of_in',
  label: 'Instantaneous tripping current as a multiple of rated current',
  unit: '× In',
  match: /[Il]m\s*=\s*([\d,]+)\s*×\s*[Il]n/,
}

/** Phase-to-earth-conductor size ratio the table is computed for, read from the column heading. */
const M_RATIO: ConditionSpec = {
  key: 'm_ratio',
  label: 'Ratio of phase to earth continuity conductor size (m)',
  unit: null,
  match: /\(m\s*=\s*([\d,]+)\)/,
}

const PHASE_SIZES = 'Copper phase conductor size — maximum earth continuity conductor length'

/** Value columns for one size each, in printed order from `firstHeader`. */
function sizeColumns(sizes: number[], firstHeader: number, requiredFrom: number): TableSpec['valueColumns'] {
  return sizes.map((s, i) => ({
    key: `len_${String(s).replace('.', '_')}mm2_m`,
    label: `${String(s).replace('.', ',')} mm²`,
    unit: 'm',
    header: firstHeader + i,
    group: PHASE_SIZES,
    // Left-hand cells are left blank on the rows for larger devices; right-hand columns are printed on every row.
    ...(firstHeader + i < requiredFrom ? { sparse: true } : {}),
  }))
}

const SIZES_A = [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300]
const SIZES_B = [16, 25, 35, 50, 70, 95, 120, 150]

export const PROTECTION_SPECS: Record<string, TableSpec> = {
  '6.25': {
    clause: '6.25',
    title: 'Minimum cross-sectional area of protective conductors',
    topic: 'earthing_protection',
    // ORDERED: each row is a size range of the phase conductor S; the range is matched by `near`, not read.
    keyColumn: { key: 'phase_size_range', label: 'Phase conductor size S', unit: 'mm²', header: 1, type: 'text' },
    // The value is a rule in S or a fixed size, kept as printed text. Its x is the 4th token of the first rule line.
    valueColumns: [{ key: 'min_pe_size', label: 'Minimum protective conductor size Sp', unit: 'mm²', header: 4, type: 'text' }],
    // The first rule line (S up to 16 mm²) gives the positions: key, relation sign, bound, value. It is also data.
    centresRow: /^\s*S\s+≤\s+16\s+\S+\s*$/,
    centresRowIsData: true,
    rows: [
      { key: 'le_16', label: 'S ≤ 16 mm²', near: /^\s*S\s+≤\s+16\b/ },
      { key: '16_35', label: '16 mm² < S ≤ 35 mm²', near: /^\s*16\s+<S\s+≤\s+35\b/ },
      { key: '35_400', label: '35 mm² < S ≤ 400 mm²', near: /^\s*35\s+<S\s+≤\s+400\b/ },
      { key: '400_800', label: '400 mm² < S ≤ 800 mm²', near: /^\s*400\s+<S\s+≤\s+800\b/ },
      { key: 'gt_800', label: 'S > 800 mm²', near: /^\s*S\s+>\s+800\b/ },
    ],
    minCells: 1,
    remark: 'Value is either a fixed size in mm² or an expression in S, the phase conductor size.',
  },
  '6.27': {
    clause: '6.27',
    title: 'Maximum protection rating for small conductors',
    topic: 'earthing_protection',
    keyColumn: { key: 'size_mm2', label: 'Nominal conductor size', unit: 'mm²', header: 2 },
    valueColumns: [
      { key: 'max_protection_a', label: 'Maximum protection rating', unit: 'A', header: 1 },
    ],
    expectedKeys: [1, 1.5, 2.5],
    remark: 'PVC insulated cables, in the absence of detailed operating data (6.7.2.1).',
  },
  '8.1': {
    clause: '8.1',
    title: 'Maximum resistance of earth continuity conductor and neutral',
    topic: 'earthing_protection',
    keyColumn: { key: 'device_rating_a', label: 'Rated current of protective device', unit: 'A', header: 1 },
    valueColumns: [
      { key: 'max_resistance_ohm', label: 'Maximum resistance of earth continuity path', unit: 'Ω', header: 2 },
    ],
    expectedKeys: [6, 10, 16, 20, 25, 32, 40, 45, 50, 63],
    remark: 'Final circuits above 63 A: use table 6.28.',
  },
  '6.28(a)': {
    clause: '6.28(a)',
    title: 'Maximum length of copper earth continuity conductors equal in size to the phase conductor',
    topic: 'earthing_protection',
    conditions: [TRIP_MULTIPLE, M_RATIO],
    keyColumn: { key: 'device_rating_a', label: 'Rated current of protective device', unit: 'A', header: 1 },
    valueColumns: sizeColumns(SIZES_A, 2, 16),
    // The 1 A row prints all 18 columns: it gives the positions and is read as data. The lookahead
    // skips the "1 2 3 … 18" column-number row, which has the same shape.
    centresRow: /^(?!\s*1\s+2\s+3\s)\s*1(?:\s+(?:\d+|-)){17}\s*$/,
    centresRowIsData: true,
    anchor: 'start',
    expectedKeys: [1, 2, 3, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 225, 250, 300, 320, 350, 400, 500],
    remark: 'Select the smallest size whose length is at least the circuit length; "-" means the size is not applicable.',
  },
  '6.28(b)': {
    clause: '6.28(b)',
    title: 'Maximum length of copper earth continuity conductors at half the phase conductor size',
    topic: 'earthing_protection',
    conditions: [TRIP_MULTIPLE, M_RATIO],
    keyColumn: { key: 'device_rating_a', label: 'Rated current of protective device', unit: 'A', header: 1 },
    valueColumns: sizeColumns(SIZES_B, 2, 7),
    // The 100 A row prints all 9 columns: it gives the positions and is read as data.
    centresRow: /^\s*100(?:\s+\d+){8}\s*$/,
    centresRowIsData: true,
    anchor: 'start',
    expectedKeys: [100, 125, 140, 160, 200, 225, 250, 300, 320, 350, 400, 500],
    remark: 'Columns are the phase conductor size; the earth continuity conductor is half of it.',
  },
}
