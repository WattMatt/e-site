/**
 * Test workbooks for the tender importer, built in memory with ExcelJS.
 *
 * MVL: a faithful copy of the values in "MVL_BOQ _Vanderbijlpark - Rev 3.xlsx"
 * (the priced BOQ MVL Electrical submitted for Sunbird Central, read from the
 * mailbox on 2026-10-05). Summary + Bill No 1–4, numeric hierarchical codes,
 * S/I sub-items, a PC row, a 5 % contingency, a parent row that carries its own
 * amount (2.1.4). Amount cells are written as formula cells with cached results
 * so the reader sees what Excel would have saved.
 *
 * WM: a synthetic workbook in WM's lettered layout (A1, C1.1 …) with a NOTES
 * sheet, a MAIN SUMMARY, a PS row, a RATE ONLY row and an un-priced tender
 * (blank rates) — the shape the Sunbird R-series tender files are expected to
 * take. Replace with the real R9 once it can be read.
 */
import ExcelJS from 'exceljs'

type Row = (string | number | null)[]

const F = (result: number) => ({ formula: 'X', result }) // cached formula result

function addRows(ws: ExcelJS.Worksheet, rows: Row[], amountCols: number[] = []) {
  for (const r of rows) {
    const values = r.map((v, i) =>
      amountCols.includes(i) && typeof v === 'number' ? (F(v) as unknown as ExcelJS.CellValue) : v,
    )
    ws.addRow(values)
  }
}

export const MVL_BILL_TOTALS = {
  '1': 327881.68,
  '2': 3204337.8750000005,
  '3': 166005,
  '4': 168517.14375000005,
} as const
export const MVL_SUBTOTAL = 3866741.6987500004
export const MVL_VAT = 580011.2548125001
export const MVL_TOTAL = 4446752.953562501

const HDR7: Row = ['ITEM', 'DESCRIPTION', null, 'UNIT', 'QTY', 'RATE Excl VAT', 'TOTAL Excl VAT']

const BILL1: Row[] = [
  ['BILLS OF QUANTITIES', null, null, null, null, null, '25/06/2026'],
  ['VANDERBIJLPARK INFRASTRUCTURE'],
  ['BUDGET ESTIMATE - SUPPLY CABLE FROM MUNIC SUBSTATION + 450M TO ERF 1 CE7'],
  HDR7,
  ['1', 'PRELIMINARY AND GENERAL'],
  [null, 'Contractor’s fixed-charge items  (SANS 1200A 8.3):'],
  [null, 'Contractual Requirements Establishment of Facilities on Site'],
  ['1.1', 'Establishment  of  facilities  for  Contractor  on  site', null, 'sum', 1, 11905.56, 11905.56],
  ['1.2', 'Special safety requirements by  Client', null, 'sum', 1, 5311.12, 5311.12],
  ['1.3', 'Name board', null, 'sum', 1, 1500, 1500],
  ['1.4', 'Removal of site establishment', null, 'sum', 1, 8960, 8960],
  ['1.5', 'Provide Performance Guarantee', null, 'sum', 1, 25605, 25605],
  ['1.6', 'Setting out of works', null, 'sum', 1, 3250, 3250],
  ['1.7', 'Cleaning of site upon completion.', null, 'sum', 1, 2550, 2550],
  ['1.8', 'Allow land surveyor to place pegs along cable route', null, 'sum', 1, 0, 0],
  [null, 'Contractor’s time related items  (SANS 1200A 8.4):'],
  [null, 'Contractual Requirements'],
  ['1.9', "The sum shall cover the Contactor's time-related costs of insurance", null, 'sum', 1, 0, 0],
  [null, 'Operation & maintenance of facilities'],
  ['1.10', 'Establishment of facilities for Contractor on site', null, 'sum', 1, 8950, 8950],
  ['1.11', 'Company & head office overhead costs', null, 'sum', 1, 81250, 81250],
  ['1.12', 'On-site Supervision', null, 'sum', 1, 166250, 166250],
  [null, 'Factory Inspections:', null, null, null, null, 0],
  ['1.13', 'Allow for expenses for factory visits for three Council representatives', null, 'sum', 1, 10500, 10500],
  [null, 'Drawings', null, null, null, null, 0],
  ['1.14', 'Allow for making a full set of as built drawings.', null, 'sum', 1, 1850, 1850],
  ['TOTAL FOR BILL NO. 1 - CARRIED FORWARD TO SUMMARY ', null, null, null, null, null, 327881.68],
]

const BILL2: Row[] = [
  ['BILLS OF QUANTITIES', null, null, null, null, null, '25/06/2026'],
  ['VANDERBIJLPARK INFRASTRUCTURE'],
  ['BILL NO 2'],
  HDR7,
  ['2.1', 'SUPPLY CABLE FROM MUNIC SUBSTATION + 650M TO ERF 1 CE7'],
  ['2.1.1', 'Excavate and Backfill for Linear Meter', null, 'm', 450],
  ['2.1.1.1', 'Excavate and Backfill 600mm Wide & 1400mm deep with 200mm Soft Soil Bedding'],
  ['2.1.1.2', 'Pickable Soil', null, 'm', 325, 119.20439999999998, 38741.42999999999],
  ['2.1.1.3', 'Soft Rock', null, 'm', 125, 164.39639999999997, 20549.549999999996],
  ['2.1.1.4', 'Hard Rock', null, 'm', null, null, 0],
  ['2.1.1.5', 'Chemical Blasting', null, 'm', null, null, 0],
  ['2.1.1.6', 'Import material for bedding', null, 'm³', 189, 236.5, 44698.5],
  ['2.1.1.7', 'Backfill & Compact to min 91% MOD ASHTO', null, 'm', 450, 35, 15750],
  ['2.1.2', 'Cross Cuts - 3m x 1.6m x 1.1m'],
  ['2.1.2.1', 'Crosscut, Backfill, Compact to min 91% MOD ASHTO', null, 'no', 3, 704.125, 2112.375],
  ['2.1.3', 'MV Cable 300mm² x 3 AL 11KV XLPE '],
  ['2.1.3.1', 'S - Supply', null, 'm', 450, 1148.1, 516644.99999999994],
  ['2.1.3.2', 'I - Install', null, 'm', 450, 49, 22050],
  ['2.1.3.3', 'T - End Glanded Terminated', null, 'no', 4, 7555.1, 30220.4],
  ['2.1.3.4', 'J - Joint', null, 'no', 1, 8759.1, 8759.1],
  ['2.1.3.5', 'Pot End Cable', null, 'no', 0, null, 0],
  ['2.1.4', 'Cable Marking Tape', null, 'm', 450, 1.6125, 725.625],
  ['2.1.4.1', 'S - Supply', null, 'm', 450, 2, 900],
  ['2.1.4.2', 'I - Install'],
  [null, 'Concrete Block Protection for Cables'],
  ['2.1.5', 'Cable Cover Slabs - 1.2m x 0.3m x 0.5m'],
  ['2.1.5.1', 'S - Supply', null, 'm', 50, 69.875, 3493.75],
  ['2.1.5.2', 'I - Install', null, 'm', 50, 15, 750],
  ['2.1.6', 'Cable Route Markers'],
  ['2.1.6.1', 'S - Supply', null, 'no', 5, 225.75, 1128.75],
  ['2.1.6.2', 'I - Install', null, 'no', 5, 45, 225],
  ['2.1.7', 'Road Crossings'],
  ['2.1.7.1', 'Horizontal Drilling - 4 x 110mm Sleeves - Estimate', null, 'PC', 1, 0, 0],
  ['2.1.7.2', 'Cut the tar road, excavate & compact & installation of 2 x 110mm sleeves', null, 'PC', 0, null, 0],
  ['2.1.8', 'Re-Instate Gardens & Walkways - PC Sum - +/-950m', null, 'Sum', 0, null, 0],
  ['2.1.11', 'Driveway Crossing'],
  ['2.1.11.1', '11 driveway crossing', null, 'no', 0, null, 0],
  ['2.1.11.2', 'Supply & Install sleeves', null, 'm', 0, null, 0],
  ['2.2', '11kV BMK (Metering type RMU Malaysian Switchgear (Municipality)'],
  [null, 'Refer to drawing no. 4892-1002 Rev G'],
  ['2.2.1', 'Supply 11,000 Volt Outdoor 11kV BMK', null, 'each', 1, 725032, 725032],
  ['2.2.2', 'Install 11,000 Volt Outdoor 11kV BMK', null, 'each', 1, 2850, 2850],
  ['2.2.3', 'Supply 11kV BMK Plinth', null, 'each', 1, 13824.400000000001, 13824.400000000001],
  ['2.2.4', 'Prepare Plinth Bed', null, 'each', 1, 655, 655],
  ['2.2.5', 'Install BMK Plinth', null, 'each', 1, 1050, 1050],
  ['2.2.6', 'Transport 11kV BMK Plinth & Unit', null, 'sum', 1, 19337.1, 19337.1],
  ['2.2.7', 'Earthing of Equipment ', null, 'each', 1, 8778.99, 8778.99],
  ['2.2.8', 'Commissioning 11kV BMK (Metering type RMU) Malaysian Switchgear'],
  ['2.2.9', 'Test & commission of call cables', null, 'Item', 1, 7363.75, 7363.75],
  ['2.2.10', 'Hand over of installation to supply authority', null, 'Item', 1, 1988.75, 1988.75],
  ['2.2.11', 'Allowance for BMK factory test to be completed on site', null, 'Item', 1, 5375, 5375],
  ['2.2.12', 'BMK test', null, 'Item', 1, 16226.05, 16226.05],
  ['2.2.13', 'Pressure testing', null, 'Item', 1, 2580, 2580],
  ['2.2.14', 'Isolation test of switching', null, 'Item', 1, 1349.13, 1349.13],
  ['2.3', '11kV BMK (Metering type RMU) TAMCO/Malaysian Switchgear Consumer'],
  [null, 'Refer to drawing no. 4892-1002 Rev G'],
  ['2.3.1', 'Supply 11,000 Volt Outdoor 11kV BMK', null, 'each', 1, 748679, 748679],
  ['2.3.2', 'Install 11,000 Volt Outdoor 11kV BMK', null, 'each', 1, 2850, 2850],
  ['2.3.3', 'Supply 11kV BMK Plinth', null, 'each', 1, 13824.400000000001, 13824.400000000001],
  ['2.3.4', 'Prepare Plinth Bed', null, 'each', 1, 655, 655],
  ['2.3.5', 'Install BMK Plinth', null, 'each', 1, 1050, 1050],
  ['2.3.6', 'Transport 11kV BMK Plinth & Unit', null, 'sum', 1, 19337.1, 19337.1],
  ['2.3.7', 'Earthing of Equipment ', null, 'each', 1, 8778.99, 8778.99],
  ['2.3.8', 'Commissioning 11kV BMK (Metering type RMU) TAMCO/Malaysian Consumer'],
  ['2.3.9', 'Test & commission of call cables', null, 'Item', 1, 7363.75, 7363.75],
  ['2.3.10', 'Hand over of installation to supply authority', null, 'Item', 1, 1988.75, 1988.75],
  ['2.3.11', 'Allowance for BMK factory test to be completed on site', null, 'Item', 1, 5375, 5375],
  ['2.3.12', 'BMK test', null, 'Item', 1, 16226.05, 16226.05],
  ['2.3.13', 'Pressure testing', null, 'Item', 1, 2580, 2580],
  ['2.3.14', 'Isolation test of switching', null, 'Item', 1, 1349.125, 1349.125],
  ['2.4', 'MUNIC SUBSTATION (ACTOM TYPE)'],
  [null, 'Refer to drawing no. 4892-1002 Rev G'],
  ['2.4.1', 'Supply 1 x 11kV CB to match existing', null, 'each', 1, 769691.64, 769691.64],
  ['2.4.2', 'Install 1 x 11kV CB to match existing', null, 'each', 1, 6850, 6850],
  ['2.4.3', 'Transport CB', null, 'each', 1, 28427.77, 28427.77],
  ['2.4.4', 'Pressure Testing & Commissioning', null, 'each', 1, 7740, 7740],
  ['2.4.5', 'Supply & Install Labels', null, 'lot', 1, 962.13, 962.13],
  ['2.4.6', 'Supply & Install 300mm² x 3 Al Cable Termination', null, 'no', 1, 7555.1, 7555.1],
  ['2.4.7', 'Hot Commissioning of equipment supplied excl all cable work', null, 'no', 1, 19947.22, 19947.22],
  ['2.4.8', 'Cold Commissioning of equipment supplied for Sat, normal office hours', null, 'no', 1, 19947.2, 19947.2],
  ['TOTAL FOR BILL NO 2 - CARRIED FORWARD TO SUMMARY', null, null, null, null, null, 3204337.8750000005],
]

const BILL3: Row[] = [
  ['BILLS OF QUANTITIES', null, null, null, null, null, '25/06/2026'],
  HDR7,
  ['3.1', 'Wayleaves', null, 'sum', 1, 28500, 28500],
  ['3.2', 'Scanning of cable route', null, 'sum', 1, 8500, 8500],
  ['3.3', 'OHS Requirements', null, 'lot', 1, 11400, 11400],
  ['3.4', 'Part Time Safety Officer', null, 'months', 2, 12000, 24000],
  ['3.5', 'Security ', null, 'months', 2, 24750, 49500],
  ['3.6', 'Insurance', null, 'sum', 1, 25605, 25605],
  ['3.7', 'Land Surveyor', null, 'sum', 1, 18500, 18500],
  ['TOTAL FOR BILL NO 3 - CARRIED FORWARD TO SUMMARY', null, null, null, null, null, 166005],
]

const BILL4: Row[] = [
  ['BILLS OF QUANTITIES', null, null, null, null, '25/06/2026'],
  ['ITEM', 'DESCRIPTION', null, 'UNIT', 'QTY', 'TOTAL Excl VAT'],
  ['4', 'Contingency'],
  ['4.1', 'Bills 2 - 3', null, 0.05, 1, 168517.14375000005],
  ['TOTAL FOR BILL NO 4 - CARRIED FORWARD TO SUMMARY', null, null, null, null, 168517.14375000005],
]

const SUMMARY: Row[] = [
  ['BILLS OF QUANTITIES FOR COST ESTIMATE ', null, null, null, '25/06/2026'],
  [null, null, null, null, 'REV 3'],
  ['VANDERBIJLPARK INFRASTRUCTURE'],
  ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'TOTAL'],
  [null, 'SUMMARY'],
  ['1', 'BILL NO. 1 :'],
  [null, "P&G's", null, 'Sum', 327881.68, 0],
  ['2', 'BILL NO. 2 :'],
  [null, 'ELECTRICAL RETICULATION ', null, 'Sum', 3204337.8750000005],
  ['3', 'BILL NO. 3 :'],
  [null, 'MISCELLANEOUS', null, 'Sum', 166005],
  ['4', 'BILL NO. 4 :', null, 'Sum', 168517.14375000005],
  [null, 'CONTINGENCY'],
  ['5', 'SUBTOTAL FOR ELECTRICAL SERVICES (EXCL. VAT)', null, null, 3866741.6987500004],
  ['6', 'VAT @ 15%', null, null, 580011.2548125001],
  ['7', 'TOTAL ', null, null, 4446752.953562501],
]

export interface MvlOptions {
  /** Add this many rand to item 3.4's amount (and nothing else) — a deliberate error. */
  driftOn34?: number
  /** Blank every rate and amount except PC/contingency rows (an issued tender copy). */
  unpriced?: boolean
}

export async function buildMvlWorkbook(opts: MvlOptions = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const strip = (rows: Row[], rateCol: number | null, amountCol: number): Row[] =>
    rows.map((r) => {
      const code = typeof r[0] === 'string' ? r[0] : ''
      if (/TOTAL/i.test(code)) return opts.unpriced ? r.map((v, i) => (i === amountCol ? null : v)) : r
      if (!opts.unpriced) return r
      const isFixed = r[3] === 'PC' || /PC Sum/i.test(String(r[1] ?? '')) || code.startsWith('4')
      if (isFixed) return r
      return r.map((v, i) => (i === amountCol || i === rateCol ? null : v))
    })

  const s = wb.addWorksheet('Summary')
  addRows(s, opts.unpriced ? SUMMARY.map((r) => r.map((v) => (typeof v === 'number' ? null : v))) : SUMMARY, [4])
  const b1 = wb.addWorksheet('Bill No 1')
  addRows(b1, strip(BILL1, 5, 6), [6])
  const b2 = wb.addWorksheet('Bill No 2')
  addRows(b2, strip(BILL2, 5, 6), [6])
  const b3 = wb.addWorksheet('Bill No 3')
  const bill3 = BILL3.map((r) =>
    r[0] === '3.4' && opts.driftOn34 ? [...r.slice(0, 6), (r[6] as number) + opts.driftOn34] : r,
  )
  addRows(b3, strip(bill3, 5, 6), [6])
  const b4 = wb.addWorksheet('Bill No 4')
  addRows(b4, strip(BILL4, null, 5), [5])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ─── WM lettered layout ─────────────────────────────────────────────────────

export interface WmOptions {
  /** Priced (PRE-PRICED INTERNAL) vs issued tender copy with blank rates. */
  priced?: boolean
  /** Change item C1.2's quantity (simulates a revision). */
  c12Qty?: number
  /** Drop item C1.3 (simulates a revision). */
  dropC13?: boolean
  /** Add an item C1.4 (simulates a revision). */
  addC14?: boolean
}

export async function buildWmWorkbook(opts: WmOptions = {}): Promise<Buffer> {
  const priced = opts.priced ?? false
  const wb = new ExcelJS.Workbook()
  const notes = wb.addWorksheet('NOTES TO TENDERER')
  notes.addRow(['1. Tenderers shall price every item.'])
  notes.addRow(['2. Provisional sums are fixed and may not be altered.'])

  const c12q = opts.c12Qty ?? 120
  const r = (q: number | null, rate: number) => (priced && q != null ? [rate, q * rate] : [null, null])
  const c11 = r(1, 85000)
  const c12 = r(c12q, 412.5)
  const c13 = r(4, 1999.99)
  const p1 = r(1, 45250)
  const billA = (p1[1] as number | null) ?? 0
  const psAmount = 50000
  const billC =
    ((c11[1] as number | null) ?? 0) +
    ((c12[1] as number | null) ?? 0) +
    (opts.dropC13 ? 0 : ((c13[1] as number | null) ?? 0)) +
    psAmount

  const ws1 = wb.addWorksheet('A - P&G')
  addRows(
    ws1,
    [
      ['SUNBIRD CENTRAL — ELECTRICAL INSTALLATION'],
      ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'],
      ['A', 'PRELIMINARY & GENERAL'],
      ['A1', 'Fixed charges'],
      ['A1.1', 'Site establishment', 'Sum', 1, ...p1],
      [null, 'Tenderers to note SANS 1200A applies.'],
      ['A1.2', 'Daywork labour rate — electrician', 'hr', 'RATE ONLY', priced ? 450 : null, null],
      ['TOTAL CARRIED TO MAIN SUMMARY', null, null, null, null, priced ? billA : null],
    ],
    [5],
  )

  const ws2 = wb.addWorksheet('C - Reticulation')
  const rows: Row[] = [
    ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'RATE', 'AMOUNT'],
    ['C', 'LV RETICULATION'],
    ['C1', 'Main boards'],
    ['C1.1', 'Main LV board MB1 complete as per drawing', 'No', 1, ...c11],
    ['C1.2', '95mm² 4c PVC SWA Cu cable, supply and install', 'm', c12q, ...c12],
  ]
  if (!opts.dropC13) rows.push(['C1.3', 'Cable terminations 95mm² 4c', 'No', 4, ...c13])
  if (opts.addC14) rows.push(['C1.4', 'Earth leakage relay', 'No', 2, ...r(2, 750)])
  rows.push(['C2', 'Provisional sums'])
  rows.push(['C2.1', 'Provisional sum for municipal connection fees', 'Sum', 1, null, psAmount])
  rows.push(['TOTAL CARRIED TO MAIN SUMMARY', null, null, null, null, priced ? billC : psAmount])
  addRows(ws2, rows, [5])

  const ms = wb.addWorksheet('MAIN SUMMARY')
  const sub = billA + billC
  addRows(
    ms,
    [
      ['MAIN SUMMARY'],
      ['ITEM', 'DESCRIPTION', 'AMOUNT'],
      ['A', 'PRELIMINARY & GENERAL', priced ? billA : null],
      ['C', 'LV RETICULATION', priced ? billC : psAmount],
      [null, 'SUB TOTAL', priced ? sub : null],
      [null, 'VAT @ 15%', priced ? sub * 0.15 : null],
      [null, 'TOTAL INCLUDING VAT', priced ? sub * 1.15 : null],
    ],
    [2],
  )
  return Buffer.from(await wb.xlsx.writeBuffer())
}
