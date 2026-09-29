import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { manifest } from './__fixtures__/load'
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

const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex')

/** Finds a fixture's WHOLE source file in the corpus from its pseudonymous manifest reference
 *  ("site-<12 hex>/<16 hex of sha256(relative path)>.<format>"), so no real path is committed;
 *  the content sha256 in the manifest proves it is the same file. */
function sourceOf(id: string): string {
  const entry = manifest().find((m) => m.id === id)
  if (!entry) throw new Error(`no fixture ${id}`)
  const [siteRef, fileRef] = entry.source.split('/')
  const root = DIR as string
  for (const site of readdirSync(root, { withFileTypes: true })) {
    if (!site.isDirectory() || `site-${sha(site.name).slice(0, 12)}` !== siteRef) continue
    const walk = (dir: string): string | null => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { const r = walk(p); if (r) return r; continue }
        const rel = relative(root, p).split('\\').join('/')
        if (`${sha(rel).slice(0, 16)}.${entry.format}` === fileRef) return rel
      }
      return null
    }
    const rel = walk(join(root, site.name))
    if (rel) {
      if (sha(readFileSync(join(root, rel))) !== entry.sourceSha256) throw new Error(`${id}: source content changed`)
      return rel
    }
  }
  throw new Error(`${id}: source not found in METER_CORPUS_DIR`)
}

async function whole(id: string) {
  const rel = sourceOf(id)
  const bytes = new Uint8Array(readFileSync(join(DIR as string, rel)))
  const o = await parseMeterFile({ bytes, fileName: rel.split('/').pop() as string })
  if (o.kind !== 'series') throw new Error(`${id}: ${o.kind}`)
  return o
}

describe.skipIf(!DIR)('corpus smoke test (METER_CORPUS_DIR = the 006. METER CSV folder)', () => {
  it('a-bulk source (A bulk meter), whole file: text-sorted rows, weekday mean ≈ 194 kW (as-is/10), not 388', async () => {
    const o = await whole('a-bulk')
    expect(o.report.rowOrder).toBe('unordered')
    const m = weekdayMean(o.channels[0])
    expect(m).toBeGreaterThan(180)
    expect(m).toBeLessThan(210)
  }, 60_000)

  it('c-energy source (C tenant), whole file: weekday mean ≈ 17 kW (as-is/10), not 8.4', async () => {
    const o = await whole('c-energy')
    const m = weekdayMean(o.channels.find((c) => c.spec.sourceColumn === 'P1 (kWh)') as NormalisedChannel)
    expect(m).toBeGreaterThan(15)
    expect(m).toBeLessThan(19)
  }, 60_000)
})
