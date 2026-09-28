import { describe, it, expect } from 'vitest'
import { parseMeterFile, type SeriesOutcome } from './parse-meter-file'
import { QUALITY } from './types'

const enc = (s: string) => new TextEncoder().encode(s)
async function series(text: string, fileName: string, options?: Parameters<typeof parseMeterFile>[0]['options']): Promise<SeriesOutcome> {
  const o = await parseMeterFile({ bytes: enc(text), fileName, options })
  if (o.kind !== 'series') throw new Error(`${o.kind}: ${JSON.stringify(o.report.errors)}`)
  return o
}
const codes = (o: SeriesOutcome, k: 'errors' | 'warnings') => o.report[k].map((i) => i.code)
const pad = (n: number) => String(n).padStart(2, '0')

describe('generic path: every choice is the user\'s', () => {
  const GENERIC = 'Timestamp;Import (kW)\n01/02/2025 00:30;12,5\n01/02/2025 01:00;\n01/02/2025 01:30;13,0\n01/02/2025 02:00;13,5\n01/02/2025 02:30;14,0\n'

  it('without confirmations: ambiguous date order, convention and unit are errors; decimal comma detected', async () => {
    const o = await series(GENERIC, 'export.csv')
    expect(o.format).toBe('generic')
    expect(o.report).toMatchObject({ delimiter: ';', decimalSeparator: ',', dateOrderAmbiguous: true })
    expect(codes(o, 'errors')).toEqual(expect.arrayContaining(['ambiguous_date_order', 'convention_required', 'unknown_unit']))
    expect(o.report.errors.find((e) => e.code === 'unknown_unit')?.message).toMatch(/suggests kW/)
    expect(o.channels[0].spec.sourceUnit).toBe('unknown')
  })

  it('with confirmations: DMY, interval-ending, kW → clean; a blank cell is NULL', async () => {
    const o = await series(GENERIC, 'export.csv', { dateOrder: 'DMY', tsConvention: 'end', units: { 'Import (kW)': 'kW' } })
    expect(o.report.errors).toEqual([])
    expect(o.report.tsConventionSource).toBe('user')
    expect(o.channels[0].readings[0]).toEqual({ tsEnd: Date.UTC(2025, 0, 31, 22, 30), value: 12.5, quality: QUALITY.OK })
    expect(o.channels[0].readings[1]).toMatchObject({ value: null, quality: QUALITY.MISSING })
  })

  it('MDY reads the same text as 2 January', async () => {
    const o = await series(GENERIC, 'export.csv', { dateOrder: 'MDY', tsConvention: 'end', units: { 'Import (kW)': 'kW' } })
    expect(o.channels[0].readings[0].tsEnd).toBe(Date.UTC(2025, 0, 1, 22, 30))
  })

  it('a day > 12 settles the order without asking', async () => {
    const o = await series('Time,kW\n12/02/2025 23:30,1\n13/02/2025 00:00,2\n13/02/2025 00:30,3\n', 'x.csv')
    expect(o.report).toMatchObject({ dateOrder: 'DMY', dateOrderAmbiguous: false })
    expect(codes(o, 'errors')).not.toContain('ambiguous_date_order')
  })

  it('a cumulative kWh register becomes interval power; the rollover is shown', async () => {
    const lines = [...Array(51).keys()].map((i) => {
      const d = new Date(Date.UTC(2025, 2, 10, 0, 30) + i * 1_800_000)
      const v = i < 30 ? 1000 + i * 2 : 5 + (i - 30) * 2
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())},${v}`
    })
    const o = await series(['Timestamp,Register (kWh)', ...lines].join('\n'), 'reg.csv', { tsConvention: 'end', units: { 'Register (kWh)': 'kWh' } })
    const c = o.channels[0]
    expect(c.isCumulative).toBe(true)
    expect(c.readings[1].value).toBe(4)
    expect(c.stats.rollovers).toBe(1)
    expect(codes(o, 'warnings')).toContain('rollover')
  })
})

describe('recognised formats: synthetic cases', () => {
  const aDay = (value: number) => {
    const rows = [...Array(48).keys()].map((i) => {
      const d = new Date(Date.UTC(2025, 2, 10, 0, 0) + i * 1_800_000)
      return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00,${value}`
    })
    return 'sep=,\r\n\r\ndate,p14\r\n' + rows.reverse().join('\r\n') + '\r\n'
  }

  it('an A file labelled p14 but carrying kWh: implied density out of band is the evidence', async () => {
    const o = await series(aDay(2.5), 'SITE SY, 1, TENANT-S1, 5000.csv')
    expect(o.report.impliedWPerM2).toMatchObject({ value: 0.5, areaM2: 5000, outOfBand: true })
    expect(codes(o, 'warnings')).toEqual(expect.arrayContaining(['implied_density_out_of_band', 'short_window']))
    expect(o.report.errors).toEqual([])
  })

  it('the user can override the table unit; it is recorded', async () => {
    const o = await series(aDay(2.5), 'SITE SY, 1, TENANT-S1, 5000.csv', { units: { p14: 'kWh' } })
    expect(o.channels[0].spec).toMatchObject({ sourceUnit: 'kWh', quantity: 'active_energy', unitFromTable: false })
    expect(o.channels[0].readings[0].value).toBe(5)
    expect(codes(o, 'warnings')).toContain('unit_overridden')
  })

  it('a PnP B file with a 24:00 row', async () => {
    const t = [
      '"pnpscada.com", "30000001"',
      '"P (per kW)", "Q (per kvar)", "S (per kVA)", "scalar sum S (per kVA)", "DATE", "TIME", "STATUS"',
      '10.0, 1.0, 10.05, 10.05, 2025-03-10, 23:00:00, Ok',
      '11.0, 1.0, 11.05, 11.05, 2025-03-10, 23:30:00, Ok',
      '12.0, 1.0, 12.04, 12.04, 2025-03-10, 24:00:00, Ok',
      '13.0, 1.0, 13.04, 13.04, 2025-03-11, 00:30:00, Ok',
    ].join('\r\n')
    const o = await series(t, 'SITE SY, , Meter 30000001, .csv')
    expect(o.report.twentyFourHundredRows).toBe(1)
    expect(o.report.identity.serialMismatch).toBe(false)
    expect(o.channels[0].readings.map((r) => [r.tsEnd, r.value])).toEqual([
      [Date.UTC(2025, 2, 10, 21, 0), 10], [Date.UTC(2025, 2, 10, 21, 30), 11],
      [Date.UTC(2025, 2, 10, 22, 0), 12], [Date.UTC(2025, 2, 10, 22, 30), 13],
    ])
  })

  it('more than 1 % unreadable timestamps is an error', async () => {
    const o = await parseMeterFile({ bytes: enc('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\nnot a date,3\r\n'), fileName: 'x.csv' })
    expect(o.report.errors.map((e) => e.code)).toContain('unparseable_timestamps')
  })

  it('.xls and .xlsx are routed, not parsed as text', async () => {
    const xls = await parseMeterFile({ bytes: enc('x'), fileName: 'SITE YA_Consolidation_Summary.xls' })
    expect(xls).toMatchObject({ kind: 'rejected', format: 'G' })
    expect(xls.report.errors[0].code).toBe('xls_not_supported')
    const xlsx = await parseMeterFile({ bytes: enc('x'), fileName: 'book.xlsx' })
    expect(xlsx.report.errors[0].code).toBe('workbook_file')
  })
})
