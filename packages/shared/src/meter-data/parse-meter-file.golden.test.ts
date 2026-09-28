import { describe, it, expect } from 'vitest'
import { isPublicHoliday } from '../lib/jbcc/sa-public-holidays'
import { applyScaleCorrection } from './artefacts'
import { parseMeterFile, type MeterParseOutcome, type SeriesOutcome } from './parse-meter-file'
import { siteKey } from './register'
import { utcMsToSast } from './timestamps'
import { isUsable, QUALITY, type NormalisedChannel } from './types'
import { fixture } from './__fixtures__/load'

const parse = (id: string) => {
  const f = fixture(id)
  return parseMeterFile({ bytes: f.bytes, fileName: f.fileName })
}
async function series(id: string): Promise<SeriesOutcome> {
  const o = await parse(id)
  if (o.kind !== 'series') throw new Error(`${id}: ${o.kind} ${JSON.stringify(o.report.errors)}`)
  return o
}
const ch = (o: SeriesOutcome, col: string): NormalisedChannel => {
  const c = o.channels.find((x) => x.spec.sourceColumn === col)
  if (!c) throw new Error(`no channel ${col}: ${o.channels.map((x) => x.spec.sourceColumn).join(', ')}`)
  return c
}
const codes = (o: MeterParseOutcome, kind: 'errors' | 'warnings') => o.report[kind].map((i) => i.code)

/** Mean of usable values whose interval STARTS on a SAST weekday that is not a public holiday. */
function weekdayMean(c: NormalisedChannel): number {
  const vals = c.readings
    .filter((r) => isUsable(r))
    .filter((r) => {
      const s = utcMsToSast(r.tsEnd - c.intervalMin * 60_000)
      const d = new Date(Date.UTC(s.year, s.month - 1, s.day))
      const w = d.getUTCDay()
      return w >= 1 && w <= 5 && !isPublicHoliday(d)
    })
    .map((r) => r.value as number)
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

describe('format A', () => {
  it('canonical A: kW not kWh; interval-beginning labels stored at their end; rows re-sorted', async () => {
    const o = await series('a-bulk')
    expect(o.report).toMatchObject({ format: 'A', rowOrder: 'descending', intervalMin: 30, tsConvention: 'begin', tsConventionSource: 'format', dataRows: 672, dateOrder: 'DMY' })
    expect(o.report.errors).toEqual([])
    const p = ch(o, 'p14')
    expect(p.spec).toMatchObject({ quantity: 'active_power', direction: 'import', sourceUnit: 'kW' })
    expect(p.stats).toMatchObject({ slots: 672, present: 672, completeness: 1 })
    expect(p.readings[0].tsEnd).toBe(Date.UTC(2025, 2, 9, 22, 30))     // label 10/03/2025 00:00 SAST, + 30 min
    expect(p.readings[671].tsEnd).toBe(Date.UTC(2025, 2, 23, 22, 0))   // label 23/03 23:30 → 24/03 00:00 SAST
    expect(weekdayMean(p)).toBeCloseTo(197.7471, 3)                    // WM's client path showed 2× this
    expect(o.primaryColumn).toBe('p14')
  })

  it('reconciliation inputs: the "bulk" meter ≈ one anchor tenant ≈ the check meter', async () => {
    const bulk = ch(await series('a-bulk'), 'p14').stats.sumUsable
    expect(ch(await series('a-tenant'), 'p14').stats.sumUsable / bulk).toBeCloseTo(1.0418, 3)
    expect(ch(await series('a-check'), 'p14').stats.sumUsable / bulk).toBeCloseTo(1.0019, 3)
  })

  it('implied W/m² uses the filename area (3000 m²) and stays inside 2–150', async () => {
    const o = await series('a-tenant')
    expect(o.report.impliedWPerM2).toMatchObject({ areaM2: 3000, outOfBand: false })
    expect(o.report.impliedWPerM2?.value).toBeCloseTo(69.62, 1)
  })

  it('named-power header (generator)', async () => {
    const o = await series('a-generator')
    expect(ch(o, 'Generator Total Power').spec).toMatchObject({ quantity: 'active_power', sourceUnit: 'kW' })
    expect(o.report.dataRows).toBe(663)
    expect(ch(o, 'Generator Total Power').stats.sumUsable).toBeCloseTo(114.86, 2)
  })

  it('PV on the import channel; the "240" plant peaks higher than the "360" (labels look swapped)', async () => {
    const p240 = ch(await series('a-pv-240'), 'p14').stats.maxUsable
    const p360 = ch(await series('a-pv-360'), 'p14').stats.maxUsable
    expect(p240).toBeCloseTo(356.78, 2)
    expect(p360).toBeCloseTo(255.28, 2)
  })

  it('multi-channel PV: generation on p14, p23 ≈ 0, "Solar Total Power" is p14 one interval later', async () => {
    const o = await series('a-pv-multi')
    expect(o.channels.map((c) => [c.spec.sourceColumn, c.spec.quantity, c.spec.direction])).toEqual([
      ['p14', 'active_power', 'import'], ['p23', 'active_power', 'export'], ['Solar Total Power', 'active_power', 'import'],
    ])
    expect(o.report.rowOrder).toBe('ascending')
    expect(ch(o, 'p23').stats.sumUsable).toBeCloseTo(1.02, 2)
    // Measured on the fixture rows: 671 pairs with p14[t] and STP[t+30min] both non-zero, 662 equal.
    // One unequal pair (p14 0.1 / STP −0.07 at 11/03 18:30) drops out because −0.07 is a tiny
    // negative clamped to 0, so the share over normalised readings is 662/670.
    expect(o.report.laggedChannels).toEqual([{ column: 'Solar Total Power', reference: 'p14', share: expect.closeTo(662 / 670, 9) }])
    expect(o.primaryColumn).toBe('p14')
    expect(codes(o, 'warnings')).toContain('lagged_channel')
  })

  it('reactive channels are kept (q12 / q34 → kvar)', async () => {
    const o = await series('a-reactive')
    expect(o.channels.map((c) => [c.spec.sourceColumn, c.spec.quantity, c.spec.direction, c.storedUnit])).toEqual([
      ['p14', 'active_power', 'import', 'kW'], ['p23', 'active_power', 'export', 'kW'],
      ['q12', 'reactive_power', 'import', 'kvar'], ['q34', 'reactive_power', 'export', 'kvar'],
    ])
  })

  it('voltage and current channels; negatives are only judged on load quantities', async () => {
    const o = await series('a-volts-amps')
    expect(o.report.dataRows).toBe(398)
    expect(ch(o, 'u_l2').spec).toMatchObject({ quantity: 'voltage', phase: 'l2', sourceUnit: 'V' })
    expect(ch(o, 'i_l1').spec).toMatchObject({ quantity: 'current', phase: 'l1', sourceUnit: 'A' })
    expect(ch(o, 'u_l2').stats.tinyNegatives + ch(o, 'u_l2').stats.largeNegatives).toBe(0)
  })

  it('hourly a14 energy with ±59,000 register artefacts: 8 spikes, 4 of them negative', async () => {
    const o = await series('a-energy-resets')
    const a = ch(o, 'a14')
    expect(a.spec).toMatchObject({ quantity: 'active_energy', sourceUnit: 'kWh' })
    expect(o.report.intervalMin).toBe(60)
    expect(a.stats).toMatchObject({ spikes: 8, resetPairs: 4 })
    expect(codes(o, 'warnings')).toEqual(expect.arrayContaining(['spikes', 'reset_pairs']))
  })

  it('W-scale segment: one level shift of 159 intervals, correctable by ÷ 1000', async () => {
    const o = await series('a-level-shift')
    const p = ch(o, 'p14')
    expect(p.levelShifts).toEqual([{ startTsEnd: Date.UTC(2024, 9, 6, 1, 0), endTsEnd: Date.UTC(2024, 9, 9, 8, 0), count: 159, medianValue: expect.any(Number) }])
    expect(codes(o, 'warnings')).toContain('level_shift')
    const fixed = applyScaleCorrection(p.readings, p.levelShifts[0])
    expect(Math.max(...fixed.filter(isUsable).map((r) => r.value as number))).toBeLessThan(1000)
  })

  it('hourly a14 with one +26,356 spike and one −1,710.82 isolated negative (shown, excluded)', async () => {
    const o = await series('a-hourly-negative')
    const a = ch(o, 'a14')
    expect(o.report).toMatchObject({ intervalMin: 60, rowOrder: 'unordered' })
    expect(a.stats).toMatchObject({ spikes: 1, resetPairs: 0, largeNegatives: 1, tinyNegatives: 0 })
    const neg = a.readings.find((r) => r.value === -1710.82)
    expect(neg?.quality).toBe(QUALITY.NEGATIVE)
    expect(isUsable(neg!)).toBe(false)
  })

  it('a −0.002 sentinel is clamped to 0 with quality 3 and stays usable', async () => {
    const p = ch(await series('a-tiny-negative'), 'p14')
    expect(p.stats.tinyNegatives).toBe(1)
    const r = p.readings.find((x) => x.tsEnd === Date.UTC(2024, 5, 9, 4, 30))   // label 09/06/2024 06:00 SAST + 30 min
    expect(r).toEqual({ tsEnd: Date.UTC(2024, 5, 9, 4, 30), value: 0, quality: QUALITY.NEGATIVE })
    expect(isUsable(r!)).toBe(true)
  })

  it('"sep=," only: rejected as empty', async () => {
    const o = await parse('a-empty')
    expect(o).toMatchObject({ kind: 'rejected', format: 'empty' })
    expect(codes(o, 'errors')).toEqual(['empty_file'])
  })

  it('7-day replacement file: short-window warning', async () => {
    const o = await series('a-short')
    expect(codes(o, 'warnings')).toContain('short_window')
    expect(o.report.spanDays).toBeGreaterThan(6)
    expect(o.report.spanDays).toBeLessThan(8)
  })

  it('water (Volume) is refused as load', async () => {
    const o = await parse('a-water')
    expect(o).toMatchObject({ kind: 'rejected', format: 'A' })
    expect(codes(o, 'errors')).toEqual(['water_channel'])
  })

  it('identical data at two sites has the same body hash', async () => {
    const [x, y] = [await series('a-vacant-1'), await series('a-vacant-2')]
    expect(x.bodySha256).toBe(y.bodySha256)
    expect(x.filename.siteHint).not.toBe(y.filename.siteHint)
  })
})

describe('format D (escaped copy)', () => {
  it('is rejected, and its unescaped body hashes equal to its main-folder twin', async () => {
    const d = await parse('d-escaped')
    expect(d).toMatchObject({ kind: 'rejected', format: 'D' })
    expect(codes(d, 'errors')).toEqual(['escaped_copy'])
    expect(d.kind === 'rejected' && d.bodySha256).toBe((await series('a-twin-of-d')).bodySha256)
  })
})

describe('format B (PnP power)', () => {
  it('three serials → virtual; Calc zeros are missing, not zero load', async () => {
    const o = await series('b-virtual-calc')
    expect(o.format).toBe('B')
    expect(o.sourceSerials).toHaveLength(3)
    expect(o.report.identity.virtual).toBe(true)
    expect(o.channels.map((c) => c.spec.sourceColumn)).toEqual(['P1 (per kW)', 'Q1 (per kvar)', 'P2 (per kW)', 'S (per kVA)', 'scalar sum S (per kVA)'])
    expect(o.report.tsConvention).toBe('end')
    expect(ch(o, 'P1 (per kW)').readings[0]).toEqual({ tsEnd: Date.UTC(2025, 8, 30, 22, 30), value: null, quality: QUALITY.MISSING })
    expect(o.report).toMatchObject({ calcShare: 1, calcZeroShare: 1 })
    expect(codes(o, 'errors')).toContain('low_completeness')
    expect(codes(o, 'warnings')).toContain('calc_padding')
  })

  it('mis-filed: the filename serial is not the meter; the same line-1 serial sits at another mall', async () => {
    const o = await series('b-misfiled')
    expect(o.report.identity.serialMismatch).toBe(true)
    expect(o.report.identity.filenameSerial).toMatch(/^3\d{7}$/)
    expect(o.sourceSerials).toHaveLength(1)
    expect(o.sourceSerials[0]).not.toBe(o.report.identity.filenameSerial)
    expect(codes(o, 'warnings')).toContain('serial_mismatch')
    expect((await series('b-shared-body-1')).sourceSerials).toEqual(o.sourceSerials)

    const log = await parse('e-log')
    if (log.kind !== 'register') throw new Error('e-log should be a register')
    const row = log.rows.find((r) => r.serial === o.sourceSerials[0])
    expect(row?.mallName).toBe('SITE PD')
    expect(siteKey(row!.mallName!)).not.toBe(siteKey(o.filename.siteHint!))
  })

  it('one series filed under two names at two malls: equal body hash', async () => {
    const [a, b] = [await series('b-shared-body-1'), await series('b-shared-body-2')]
    expect(a.bodySha256).toBe(b.bodySha256)
    expect(a.filename.label).not.toBe(b.filename.label)
  })

  it('half-hourly vs daily: daily files are coverage only', async () => {
    expect((await series('b-halfhourly')).report.intervalMin).toBe(30)
    const d = await series('b-daily')
    expect(d.report).toMatchObject({ intervalMin: 1440, dailyInterval: true, dataRows: 14 })
    expect(d.channels.every((c) => c.coverageOnly)).toBe(true)
    expect(codes(d, 'warnings')).toContain('daily_interval')
  })

  it('seven serials → virtual; 308 of 672 rows are Calc (estimated)', async () => {
    const o = await series('b-seven-serials')
    expect(o.sourceSerials).toHaveLength(7)
    expect(o.report.identity.virtual).toBe(true)
    expect(o.report.calcShare).toBeCloseTo(308 / 672, 6)
    expect(ch(o, 'P (per kW)').stats.estimated).toBeGreaterThan(0)
  })
})

describe('format C (PnP energy)', () => {
  it('kWh per 30 min → kW (× 2); weekday mean ≈ 16.6 kW, not 8.3', async () => {
    const o = await series('c-energy')
    expect(o.report).toMatchObject({ format: 'C', tsConvention: 'end', intervalMin: 30, rowOrder: 'ascending' })
    const p = ch(o, 'P1 (kWh)')
    expect(p.spec).toMatchObject({ quantity: 'active_energy', sourceUnit: 'kWh' })
    expect(p.storedUnit).toBe('kW')
    expect(p.readings[0].tsEnd).toBe(Date.UTC(2025, 2, 9, 22, 30))
    expect(weekdayMean(p)).toBeCloseTo(16.5766, 3)
    expect(ch(o, 'S (kVA)').spec).toMatchObject({ quantity: 'apparent_power', sourceUnit: 'kVA' })
    expect(o.primaryColumn).toBe('P1 (kWh)')
  })
  it('second sample: one interior half-hour absent → one NULL slot', async () => {
    const p = ch(await series('c-energy-2'), 'P1 (kWh)')
    expect(p.stats).toMatchObject({ slots: 672, present: 671 })
    expect(weekdayMean(p)).toBeCloseTo(75.1223, 3)
  })
})

describe('registers and artefacts', () => {
  it('E log → serial register', async () => {
    const o = await parse('e-log')
    expect(o).toMatchObject({ kind: 'register', format: 'E' })
    expect(codes(o, 'errors')).toEqual(['download_log'])
  })
  it('F derived column → rejected', async () => {
    const o = await parse('f-derived')
    expect(o).toMatchObject({ kind: 'rejected', format: 'F' })
    expect(codes(o, 'errors')).toEqual(['derived_file'])
  })
})
