/**
 * SANS 10400-XA:2021 energy tables. STRUCTURE ONLY — column names, units, printed row keys and the
 * conditions to read. Every value comes out of the PDF at extraction time.
 */
import type { ColumnSpec, OrderedRow, TableSpec } from './extract-table'
import { COND } from './conditions'

void COND

/** The energy zones as printed in the zone row of Table 2, left to right. */
const ZONES = ['1', '2', '3', '4', '5', '5H', '6', '7'] as const

const zoneColumns: ColumnSpec[] = ZONES.map((z, i) => ({
  key: `zone_${z.toLowerCase()}`,
  label: `Energy zone ${z}`,
  unit: 'VA/m²',
  header: i + 1,
  group: 'Energy zones',
}))

/** A class-code line printed on its own ("A3"), above the row's value line. */
const code = (c: string): RegExp => new RegExp(`^\\s*${c}\\s*$`)

/**
 * Table 2 rows in printed order. A3 and G1 are each printed twice (two kinds of
 * building in the same class), so the keys carry a suffix; the label says which.
 */
const TABLE_2_ROWS: OrderedRow[] = [
  { key: 'A1', label: 'A1 — entertainment and public assembly', near: code('A1') },
  { key: 'A2', label: 'A2 — theatrical and indoor sport', near: code('A2') },
  { key: 'A3_other', label: 'A3 — places of instruction (other than schools)', near: /other than primary or secondary schools/ },
  { key: 'A3_schools', label: 'A3 — places of instruction (schools)', near: /school children/ },
  { key: 'A4', label: 'A4 — worship', near: code('A4') },
  { key: 'E2', label: 'E2 — hospital', near: code('E2') },
  { key: 'E3', label: 'E3 — other institutional (residential)', near: code('E3') },
  { key: 'F1', label: 'F1 — large shop', near: code('F1') },
  { key: 'F2', label: 'F2 — small shop', near: code('F2') },
  { key: 'F3', label: "F3 — wholesaler's store", near: code('F3') },
  { key: 'G1_large', label: 'G1 — offices (large multi-storey buildings)', near: /multi-storey/ },
  { key: 'G1_park', label: 'G1 — offices (office park / campus blocks)', near: /office park/ },
  { key: 'H1', label: 'H1 — hotel', near: code('H1') },
  { key: 'H2', label: 'H2 — dormitory', near: code('H2') },
  { key: 'H3', label: 'H3 — domestic residence', near: code('H3') },
  { key: 'H4', label: 'H4 — dwelling house', near: code('H4') },
  { key: 'H5', label: 'H5 — hospitality (small guest accommodation)', near: code('H5') },
]

export const XA_SPECS: Record<string, TableSpec> = {
  '2': {
    clause: '2',
    title: 'Maximum annual demand intensity per building classification for each energy zone',
    topic: 'building_energy',
    pages: 'all',
    // The zone row "1 2 3 4 5 5H 6 7" gives the column centres.
    centresRow: /^\s*1\s+2\s+3\s+4\s+5\s+5H\s+6\s+7\s*$/,
    // The class-of-occupancy column has no centre in the zone row; rows are ORDERED.
    keyColumn: { key: 'occupancy', label: 'Class of occupancy', unit: null, header: 0, kind: 'text' },
    valueColumns: zoneColumns,
    rows: TABLE_2_ROWS,
    minCells: ZONES.length,
    remark: 'A3 and G1 each appear twice (two building types per class); energy zones per figure 1 and annex C.',
  },
  '12': {
    clause: '12',
    title: 'Maximum lighting power density for the class of occupancy',
    topic: 'building_energy',
    pages: 'all',
    keyColumn: { key: 'occupancy', label: 'Occupancy classification', unit: null, header: 1, kind: 'text' },
    valueColumns: [
      { key: 'description', label: 'Occupancy description', unit: null, header: 2, type: 'text' },
      { key: 'lpd_w_m2', label: 'Maximum lighting power density', unit: 'W/m²', header: 3 },
    ],
    expectedTextKeys: ['A1', 'A2', 'A3', 'A4', 'C1', 'C2', 'E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'G1', 'H1', 'H2', 'H3', 'H4', 'H5'],
  },
}
