// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMeterFile, type MeterParseOutcome } from '@esite/shared/meter-data'
import { archiveSiteKey, kindFromLabel, logLabel, planArchive, serialKey, summarise, type ArchiveFile } from './plan'

const CORPUS = join(__dirname, '../../../../../../packages/shared/src/meter-data/__fixtures__/corpus')
const LP = join(__dirname, '../../../../../../packages/shared/src/load-profile/__fixtures__')
const parse = async (dir: string, name: string, as = name): Promise<MeterParseOutcome> =>
  parseMeterFile({ bytes: new Uint8Array(readFileSync(join(dir, name))), fileName: as })
const file = async (site: string, dir: string, name: string, as = name): Promise<ArchiveFile> => ({ site, fileName: as, outcome: await parse(dir, name, as) })

describe('kindFromLabel', () => {
  it.each([
    ['SOLAR PLANT 240', 'solar'], ['Solar PV1', 'solar'], ['GENERATOR METER', 'generator'], ['CHECK 1', 'check'],
    ['BULK METER', 'bulk'], ['LOCAL MAIN', 'bulk'], ['SHOP 107 VACANT', 'vacant'], ['Meter 36339844', 'unknown'],
    ['E9001', 'unknown'], ['DB-26', 'unknown'], ['TENANT-23', 'tenant'], ['Common Area Lights', 'common'], [null, 'unknown'],
  ] as const)('%s → %s', (label, kind) => expect(kindFromLabel(label, 1)).toBe(kind))
  it('several serials make a virtual meter', () => expect(kindFromLabel('LOCAL MAIN', 3)).toBe('virtual'))
})

describe('planArchive', () => {
  it('format A loads once; the same body again in the same site is a duplicate; across sites it loads nowhere', async () => {
    const a = await file('SITE YA', CORPUS, 'SITE YA, , BULK METER, .csv')
    const sameSiteCopy = await file('SITE YA', CORPUS, 'SITE YA, , BULK METER, .csv', 'SITE YA, , BULK METER, (2).csv')
    const plan = planArchive([sameSiteCopy, a], new Map())
    expect(plan[0].fileName).toBe('SITE YA, , BULK METER, .csv') // the original, not the "(2)" copy
    expect(plan[0]).toMatchObject({ action: 'load', kind: 'bulk', label: 'BULK METER', channels: [{ sourceColumn: 'p14', isPrimary: true }] })
    expect(plan[1]).toMatchObject({ action: 'skip', reason: 'duplicate_body' })

    const otherSite = await file('SITE ZZ', CORPUS, 'SITE YA, , BULK METER, .csv', 'SITE ZZ, , BULK, .csv')
    const crossed = planArchive([a, otherSite], new Map())
    expect(crossed.map((d) => d.action === 'skip' && d.reason)).toEqual(['cross_site_duplicate', 'cross_site_duplicate'])
  })

  it('format B loads only when the downloader log puts its serial at this site, with its kVA channel', async () => {
    const b = await file('SITE PM', CORPUS, 'SITE PM, , Meter 31599070, .csv')
    const serial = b.outcome.kind === 'series' ? b.outcome.sourceSerials[0] : ''
    // The fixture's filename names 31599070 but line 1 holds another serial: the mis-filing the review found.
    expect(planArchive([b], new Map([[serial, 'SITEPM']]))[0]).toMatchObject({ action: 'skip', reason: 'pnp_filename_serial_mismatch' })
    const renamed = { ...b, fileName: 'SITE PM, , SHOP 1, .csv', outcome: await parse(CORPUS, 'SITE PM, , Meter 31599070, .csv', 'SITE PM, , SHOP 1, .csv') }
    expect(planArchive([renamed], new Map([[serial, 'SITEPM']]))[0]).toMatchObject({
      action: 'load', channels: [{ sourceColumn: 'P (per kW)', isPrimary: true }, { sourceColumn: 'S (per kVA)', isPrimary: false }],
    })
    expect(planArchive([renamed], new Map([[serial, 'KURUMAN']]))[0]).toMatchObject({ action: 'skip', reason: 'pnp_serial_not_this_site' })
    expect(planArchive([renamed], new Map())[0]).toMatchObject({ action: 'skip', reason: 'pnp_serial_unknown' })
  })

  it('format C and the B2 extract load (C has no serial check; B2 is a B file)', async () => {
    const c = await file('SITE TZ', CORPUS, 'SITE TZ, , 01A TENANT-95, .csv')
    expect(planArchive([c], new Map())[0]).toMatchObject({ action: 'load', kind: 'tenant', channels: [{ sourceColumn: 'P1 (kWh)' }, { sourceColumn: 'S (kVAh)' }] })
    const b2 = await file('SITE PK', LP, 'SITE PK, , Meter 39990001, .csv')
    expect(planArchive([b2], new Map([['39990001', 'SITEPK']]))[0]).toMatchObject({ action: 'load', kind: 'unknown' })
  })

  it('refuses what is not load: escaped copy, log, register, water, daily-only, empty', async () => {
    const plan = planArchive([
      await file('X', CORPUS, 'RP - TENANT-06 525.csv'),
      await file('X', CORPUS, 'SITE KM, , E9002, .csv'),
      await file('X', CORPUS, 'SITE BC, , BC1 - TENANT-92, .csv'),
      await file('X', CORPUS, 'SITE PM, , Meter 39631688, .csv'),
      await file('X', CORPUS, 'SITE EQ, , DB 37, .csv'),
    ], new Map([['36291073', 'X']]))
    expect(plan.map((d) => (d.action === 'skip' ? d.reason : 'load')).sort()).toEqual(['daily_only', 'not_meter_data', 'not_meter_data', 'not_meter_data', 'water'].sort())
  })

  it('summarises loads, skips by reason and the readings to write', async () => {
    const a = await file('SITE YA', CORPUS, 'SITE YA, , BULK METER, .csv')
    const s = summarise(planArchive([a, await file('SITE YA', CORPUS, 'SITE EQ, , DB 37, .csv')], new Map()))
    expect(s).toMatchObject({ files: 2, load: 1, skip: 1, reasons: { not_meter_data: 1 } })
    expect(s.readings).toBeGreaterThan(0)
  })

  it('serials match without leading zeros (file "01180385" = log "1180385")', async () => {
    const b = await parse(CORPUS, 'SITE PM, , Meter 31599070, .csv', 'SITE PM, , SHOP 1, .csv')
    if (b.kind !== 'series') throw new Error('series expected')
    const padded = { ...b, sourceSerials: b.sourceSerials.map((x) => `0${x}`) }
    const plan = planArchive([{ site: 'SITE PM', fileName: 'SITE PM, , SHOP 1, .csv', outcome: padded }], new Map([[serialKey(b.sourceSerials[0]), 'SITEPM']]))
    expect(plan[0].action).toBe('load')
  })

  it('a PnP body copied into other sites loads at the site its serial belongs to; the misfiled copies are skipped', async () => {
    const own = await file('SITE PM', CORPUS, 'SITE PM, , Meter 31599070, .csv', 'SITE PM, , SHOP 1, .csv')
    const copy = await file('SITE KM', CORPUS, 'SITE PM, , Meter 31599070, .csv', 'SITE KM, , SHOP 9, .csv')
    const serial = own.outcome.kind === 'series' ? own.outcome.sourceSerials[0] : ''
    const plan = planArchive([copy, own], new Map([[serialKey(serial), 'SITEPM']]))
    expect(plan.find((d) => d.site === 'SITE PM')).toMatchObject({ action: 'load' })
    expect(plan.find((d) => d.site === 'SITE KM')).toMatchObject({ action: 'skip', reason: 'pnp_serial_not_this_site' })
  })

  it('site keys forgive the log\'s "Spuare" typo', () => {
    expect(archiveSiteKey('Thabazimbi Spuare')).toBe(archiveSiteKey('THABAZIMBI'))
  })

  it('a PnP meter takes its label and kind from the downloader log, not the (unreliable) filename', async () => {
    const own = await file('SITE PM', CORPUS, 'SITE PM, , Meter 31599070, .csv', 'SITE PM, , SHOP 1, .csv')
    const serial = own.outcome.kind === 'series' ? own.outcome.sourceSerials[0] : ''
    const plan = planArchive([own], new Map([[serialKey(serial), 'SITEPM']]), new Map([[serialKey(serial), 'E0385 ; Solar 1 ; Site PM Mall ; Site PM']]))
    expect(plan[0]).toMatchObject({ action: 'load', label: 'E0385 · Solar 1', kind: 'solar' })
  })

  it('logLabel keeps what precedes the mall', () => {
    expect(logLabel('ATM Capitec ; DB -1.3 ; Town Square Mall', 'TOWN SQUARE')).toBe('ATM Capitec · DB -1.3')
    expect(logLabel('E0385 ; Solar 1 ; Rustenburg Mall ; Rustenburg', 'RUSTENBURG MALL')).toBe('E0385 · Solar 1')
    expect(logLabel('Shop 12 ; Somewhere Else', 'PARKDENE')).toBe('Shop 12')
    expect(logLabel(undefined, 'X')).toBeNull()
  })

  it('a PnP meter gets no shop or area from its (unreliable) filename, and carries its serial for linking', async () => {
    const own = await file('SITE PM', CORPUS, 'SITE PM, , Meter 31599070, .csv', 'SITE PM, 12, SHOP 1, 235.csv')
    const serial = own.outcome.kind === 'series' ? own.outcome.sourceSerials[0] : ''
    const d = planArchive([own], new Map([[serialKey(serial), 'SITEPM']]))[0]
    expect(d).toMatchObject({ action: 'load', shopNo: null, areaM2: null, pnpSerial: serialKey(serial) })
  })
  it('a numbered copy with different data keeps its number in the label', async () => {
    const copy = await file('SITE YA', CORPUS, 'SITE YA, SHOP 050, TENANT-23, 3000.csv', 'SITE YA, SHOP 050, TENANT-23, 3000 (2).csv')
    expect(planArchive([copy], new Map())[0]).toMatchObject({ action: 'load', label: 'TENANT-23 (2)', areaM2: 3000 })
  })
  it('cross-site duplicates compare exact folders: RUSTENBURG MALL and RUSTENBURG PLAZA are two sites', async () => {
    const a = await file('RUSTENBURG MALL', CORPUS, 'SITE YA, , BULK METER, .csv')
    const b = await file('RUSTENBURG PLAZA', CORPUS, 'SITE YA, , BULK METER, .csv')
    expect(planArchive([a, b], new Map()).map((d) => d.action === 'skip' && d.reason)).toEqual(['cross_site_duplicate', 'cross_site_duplicate'])
  })
})
