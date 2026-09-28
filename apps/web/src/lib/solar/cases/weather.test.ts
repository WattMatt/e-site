// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { jhbTmyCsv } from './__fixtures__/weather'

const h = vi.hoisted(() => ({ put: vi.fn(async () => {}), remove: vi.fn(async () => {}), get: vi.fn() }))
vi.mock('./storage', async (orig) => ({ ...(await orig<typeof import('./storage')>()), putGzipText: h.put, removeObject: h.remove, getGzipText: h.get }))

import { getOrFetchWeather, loadWeatherYear, roundCoord, PVGIS_TMY_URL, parseGsaPvout } from './weather'

// PVGIS and GSA are NEVER called here: every fetch is a vi.fn serving the stored fixtures.
const ORG = 'o1', U = 'u1'
const gsa = JSON.parse(readFileSync(resolve(__dirname, '__fixtures__/gsa-lta-jhb.json'), 'utf8'))
const okFetch = () => vi.fn(async (url: string) => url.includes('re.jrc.ec.europa.eu')
  ? new Response(jhbTmyCsv(), { status: 200 })
  : new Response(JSON.stringify(gsa), { status: 200 }))

beforeEach(() => vi.clearAllMocks())

describe('getOrFetchWeather', () => {
  it('rounds to 0.01° and returns the cached row without any network call', async () => {
    const row = { id: 'w1', organisation_id: ORG, source: 'pvgis_tmy', lat_round: -26.2, lng_round: 28.05 }
    const { client } = fakeSupabase({ tables: { 'solar.weather_datasets': [row] } })
    const fetchImpl = okFetch()
    const r = await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2012, lng: 28.0478, userId: U, fetchImpl, rateLimitFn: () => true })
    expect(r).toEqual({ ok: true, dataset: row, cached: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches the verbatim PVGIS CSV, stores it gzipped, records GSA, inserts the row', async () => {
    const { client, calls } = fakeSupabase({})
    const fetchImpl = okFetch()
    const r = await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl, rateLimitFn: () => true })
    expect(r.ok).toBe(true)
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(PVGIS_TMY_URL(-26.2, 28.05))
    expect(h.put).toHaveBeenCalledWith(client, 'solar-weather', expect.stringMatching(/^o1\/[0-9a-f-]{36}\.csv\.gz$/), jhbTmyCsv())
    const ins = callsTo(calls, 'solar.weather_datasets', 'insert')[0]!.payload as Record<string, unknown>
    expect(parseGsaPvout(gsa)).toBe(1788.2)
    expect(ins).toMatchObject({ organisation_id: ORG, source: 'pvgis_tmy', lat_round: -26.2, lng_round: 28.05, fetched_by: U, gsa_pvout_kwh_per_kwp: 1788.2 })
    expect(ins.content_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rate-limits per organisation BEFORE calling PVGIS', async () => {
    const { client } = fakeSupabase({})
    const fetchImpl = okFetch()
    const rl = vi.fn(() => false)
    const r = await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl, rateLimitFn: rl })
    expect(rl).toHaveBeenCalledWith('solar-weather:o1', 5, 600_000)
    expect(r).toEqual({ ok: false, status: 429, error: 'Weather fetches are limited to 5 per 10 minutes for your organisation — try again shortly.' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('PVGIS down / refused / unreadable → a sentence, nothing stored', async () => {
    const { client } = fakeSupabase({})
    for (const [f, msg] of [
      [vi.fn(async () => { throw new Error('ECONNRESET') }), 'PVGIS did not respond — try again later.'],
      [vi.fn(async () => new Response('busy', { status: 529 })), 'PVGIS refused the request (HTTP 529) — try again later.'],
      [vi.fn(async () => new Response('garbage', { status: 200 })), 'PVGIS returned data E-Site could not read.'],
    ] as const) {
      const r = await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl: f as never, rateLimitFn: () => true })
      expect(r).toEqual({ ok: false, status: 502, error: msg })
    }
    expect(h.put).not.toHaveBeenCalled()
  })

  it('GSA failure never blocks the weather (null value)', async () => {
    const { client, calls } = fakeSupabase({})
    const fetchImpl = vi.fn(async (url: string) => url.includes('re.jrc') ? new Response(jhbTmyCsv()) : new Response('no', { status: 500 }))
    const r = await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl, rateLimitFn: () => true })
    expect(r.ok).toBe(true)
    expect((callsTo(calls, 'solar.weather_datasets', 'insert')[0]!.payload as { gsa_pvout_kwh_per_kwp: unknown }).gsa_pvout_kwh_per_kwp).toBeNull()
  })

  it('an insert failure removes the stored object and returns a sentence', async () => {
    const { client } = fakeSupabase({ writes: { 'solar.weather_datasets:insert': { error: { code: '23514', message: 'check' } } } })
    const r = await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl: okFetch(), rateLimitFn: () => true })
    expect(r).toEqual({ ok: false, status: 502, error: 'The weather could not be saved — try again.' })
    expect(h.remove).toHaveBeenCalledWith(client, 'solar-weather', expect.stringMatching(/^o1\//))
  })

  it('a concurrent fetch that won the unique key: our object is removed and theirs returned', async () => {
    const theirs = { id: 'w9', organisation_id: ORG, source: 'pvgis_tmy', lat_round: -26.2, lng_round: 28.05 }
    let inserted = false
    const { client } = fakeSupabase({ writes: { 'solar.weather_datasets:insert': { error: { code: '23505', message: 'dup' } } } })
    const after = fakeSupabase({ tables: { 'solar.weather_datasets': [theirs] } }).client
    const svc = { schema: (s: string) => ({ from: (t: string) => {
      if (inserted && t === 'weather_datasets') return after.schema(s).from(t)
      const b = client.schema(s).from(t)
      const orig = b.insert
      b.insert = (p: unknown) => { inserted = true; return orig(p) }
      return b
    } }) }
    const r = await getOrFetchWeather({ svc: svc as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl: okFetch(), rateLimitFn: () => true })
    expect(r).toEqual({ ok: true, dataset: theirs, cached: true })
    expect(h.remove).toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('roundCoord', () => { expect(roundCoord(-26.2049)).toBe(-26.2); expect(roundCoord(28.055)).toBe(28.06) })
  it('parseGsaPvout returns null when the value is absent or not positive', () => {
    expect(parseGsaPvout({ annual: { data: {} } })).toBeNull()
    expect(parseGsaPvout({ annual: { data: { PVOUT_csi: -1 } } })).toBeNull()
    expect(parseGsaPvout(null)).toBeNull()
  })
  it('loadWeatherYear parses the stored CSV into an 8760 SAST year', async () => {
    h.get.mockResolvedValueOnce(jhbTmyCsv())
    const w = await loadWeatherYear({} as never, { storage_path: 'o/w.csv.gz', radiation_db: 'PVGIS-SARAH2' })
    expect(w.ghi).toHaveLength(8760)
    expect(w.source).toBe('PVGIS TMY (PVGIS-SARAH2)')
  })
})
