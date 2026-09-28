import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPublicHoliday } from '../lib/jbcc/sa-public-holidays'
import { parseMeterFile } from './parse-meter-file'
import { utcMsToSast } from './timestamps'
import { isUsable, type NormalisedChannel } from './types'

const DIR = process.env.METER_CORPUS_DIR

function weekdayMean(c: NormalisedChannel): number {
  const v = c.readings.filter(isUsable).filter((r) => {
    const s = utcMsToSast(r.tsEnd - c.intervalMin * 60_000)
    const d = new Date(Date.UTC(s.year, s.month - 1, s.day))
    return d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !isPublicHoliday(d)
  }).map((r) => r.value as number)
  return v.reduce((a, b) => a + b, 0) / v.length
}

async function whole(rel: string) {
  const bytes = new Uint8Array(readFileSync(join(DIR as string, rel)))
  const o = await parseMeterFile({ bytes, fileName: rel.split('/').pop() as string })
  if (o.kind !== 'series') throw new Error(`${rel}: ${o.kind}`)
  return o
}

describe.skipIf(!DIR)('corpus smoke test (METER_CORPUS_DIR = the 006. METER CSV folder)', () => {
  it('YARONA BULK METER, whole file: text-sorted rows, weekday mean ≈ 194 kW (as-is/10), not 388', async () => {
    const o = await whole('YARONA/YARONA, , BULK METER, .csv')
    expect(o.report.rowOrder).toBe('unordered')
    const m = weekdayMean(o.channels[0])
    expect(m).toBeGreaterThan(180)
    expect(m).toBeLessThan(210)
  }, 60_000)

  it('THABAZIMBI 01A Panarottis (C), whole file: weekday mean ≈ 17 kW (as-is/10), not 8.4', async () => {
    const o = await whole('THABAZIMBI/THABAZIMBI, , 01A Panarottis, .csv')
    const m = weekdayMean(o.channels.find((c) => c.spec.sourceColumn === 'P1 (kWh)') as NormalisedChannel)
    expect(m).toBeGreaterThan(15)
    expect(m).toBeLessThan(19)
  }, 60_000)
})
