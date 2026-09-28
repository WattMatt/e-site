# Solar Phase 4b — Part 3: Server (storage, weather, tariff, run context, routes, actions, XLSX)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-4b-0-index.md` first; Parts 1–2 must be done.

**Goal:** The gated server surface: fetch/cache weather, resolve the study's tariff (read-only), assemble a run context, execute a run into an immutable row + CSV, cancel, export, save/select/delete cases, save and run financials, maintain the equipment catalogue, download XLSX.

**Architecture:** `apps/web/src/lib/solar/cases/*` hold the server logic (service client used ONLY after the caller's gate passed, and only where RLS cannot express the operation: finishing a run, the service-only buckets, the weather cache, reading org settings for a non-admin). User-scoped writes (case CRUD, run INSERT, financials) go through the caller's session so the 00215 policies decide. Routes and actions are thin: gate → lib → audit/event → JSON.

**Tech Stack:** Next.js 15 route handlers (`runtime='nodejs'`, `maxDuration=60`), server actions, `node:zlib`, exceljs, vitest with `fakeSupabase`.

**Run web tests with:** `cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter web test -- <path>`

Shared test helper used below (create it in Task 14): `apps/web/src/lib/solar/cases/__fixtures__/weather.ts`.

---

### Task 14: `lt` in the Supabase fake; storage helpers; weather fixture helper

**Files:**
- Modify: `apps/web/src/test/fake-supabase.ts` (Filter type, `matches`, builder)
- Create: `apps/web/src/lib/solar/cases/storage.ts`
- Create: `apps/web/src/lib/solar/cases/__fixtures__/weather.ts`
- Test: `apps/web/src/lib/solar/cases/storage.test.ts`

- [ ] **Step 1: Add `lt` to the fake.** In `apps/web/src/test/fake-supabase.ts`:
  - `type Filter = ['eq' | 'neq' | 'in' | 'gte' | 'lt', string, unknown]`
  - in `matches`, add a branch before the final `in` branch: `: op === 'lt' ? String(row[col] ?? '') < String(val)`
  - in the builder object, after `gte`: `lt: (c: string, v: unknown) => { state.filters.push(['lt', c, v]); return b },`
  - update the header comment: "SELECTs filter … by eq / neq / in / gte / lt (string order)".

- [ ] **Step 2: Failing test** `storage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { getGzipText, putGzipText, runCsvPath, weatherPath, RUNS_BUCKET } from './storage'

function fakeStorage() {
  const objects = new Map<string, Buffer>()
  const bucket = (b: string) => ({
    upload: vi.fn(async (p: string, body: Buffer, opts: { contentType: string; upsert: boolean }) => {
      if (opts.contentType !== 'application/gzip') return { error: { message: 'bad type' } }
      objects.set(`${b}/${p}`, body); return { error: null }
    }),
    download: vi.fn(async (p: string) => {
      const o = objects.get(`${b}/${p}`)
      return o ? { data: new Blob([o]), error: null } : { data: null, error: { message: 'not found' } }
    }),
    remove: vi.fn(async () => ({ error: null })),
  })
  return { client: { storage: { from: bucket } }, objects }
}

describe('solar storage', () => {
  it('gzip round-trips text', async () => {
    const { client, objects } = fakeStorage()
    await putGzipText(client as never, RUNS_BUCKET, 'o/p/c/r.csv.gz', 'hello,world\n')
    expect(objects.get('solar-runs/o/p/c/r.csv.gz')).toEqual(gzipSync(Buffer.from('hello,world\n')))
    await expect(getGzipText(client as never, RUNS_BUCKET, 'o/p/c/r.csv.gz')).resolves.toBe('hello,world\n')
  })
  it('a missing object is an error with a sentence', async () => {
    const { client } = fakeStorage()
    await expect(getGzipText(client as never, RUNS_BUCKET, 'nope')).rejects.toThrow('stored file not found')
  })
  it('paths are org-first', () => {
    expect(runCsvPath('o', 'p', 'c', 'r')).toBe('o/p/c/r.csv.gz')
    expect(weatherPath('o', 'd')).toBe('o/d.csv.gz')
  })
})
```

- [ ] **Step 3: Run — FAIL.** **Step 4: Implement** `storage.ts`:

```ts
import 'server-only'
/**
 * The two Phase 4b buckets are SERVICE-ONLY (00215: no storage.objects policy for authenticated).
 * Call these only with the service client and only after the caller's Solar gate has passed.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export const RUNS_BUCKET = 'solar-runs'
export const WEATHER_BUCKET = 'solar-weather'
export type SolarBucket = typeof RUNS_BUCKET | typeof WEATHER_BUCKET

export const runCsvPath = (orgId: string, projectId: string, caseId: string, runId: string) => `${orgId}/${projectId}/${caseId}/${runId}.csv.gz`
export const weatherPath = (orgId: string, datasetId: string) => `${orgId}/${datasetId}.csv.gz`

export async function putGzipText(svc: AnyClient, bucket: SolarBucket, path: string, text: string): Promise<void> {
  const { error } = await svc.storage.from(bucket).upload(path, gzipSync(Buffer.from(text, 'utf8')), { contentType: 'application/gzip', upsert: false })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
}

export async function getGzipText(svc: AnyClient, bucket: SolarBucket, path: string): Promise<string> {
  const { data, error } = await svc.storage.from(bucket).download(path)
  if (error || !data) throw new Error('stored file not found')
  return gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8')
}

export async function removeObject(svc: AnyClient, bucket: SolarBucket, path: string): Promise<void> {
  const { error } = await svc.storage.from(bucket).remove([path])
  if (error) console.error('[solar-storage] remove failed', { bucket, path, message: error.message })
}
```

- [ ] **Step 5: Weather fixture helper** `apps/web/src/lib/solar/cases/__fixtures__/weather.ts` (test-only; reads 4a's verbatim PVGIS response — no network):

```ts
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const DIR = resolve(__dirname, '../../../../../../../packages/shared/src/services/solar/__fixtures__/pvgis')

/** The verbatim PVGIS 5.2 TMY CSV response for Johannesburg (sha-pinned in 4a's pvgis.ts). */
export function jhbTmyCsv(): string {
  return gunzipSync(readFileSync(resolve(DIR, 'tmy_jhb.csv.gz'))).toString('utf8')
}
```
Verify the relative path once: `node -e "console.log(require('fs').existsSync(require('path').resolve('apps/web/src/lib/solar/cases/__fixtures__','../../../../../../../packages/shared/src/services/solar/__fixtures__/pvgis/tmy_jhb.csv.gz')))"` from `$W` prints `true`.

- [ ] **Step 6: Run — PASS; commit** ("feat(solar): service-only storage helpers for runs and weather").

---

### Task 15: Weather — PVGIS TMY + GSA, per-org cache, rate limit

**Files:**
- Create: `apps/web/src/lib/solar/cases/weather.ts`
- Create: `apps/web/src/lib/solar/cases/__fixtures__/gsa-lta-jhb.json`
- Test: `apps/web/src/lib/solar/cases/weather.test.ts`

- [ ] **Step 1: Capture ONE real GSA response as a fixture** (a one-off by the implementer, never in tests):

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b
curl -sS 'https://api.globalsolaratlas.info/data/lta?loc=-26.2,28.05' -o apps/web/src/lib/solar/cases/__fixtures__/gsa-lta-jhb.json
node -e "const j=require('./apps/web/src/lib/solar/cases/__fixtures__/gsa-lta-jhb.json'); console.log(j?.annual?.data?.PVOUT_csi ?? j?.annual?.data?.PVOUT_specific ?? JSON.stringify(j).slice(0,400))"
```
Expected: a number around 1,600–1,900 (kWh/kWp/yr). If the key path differs, set `GSA_PVOUT_PATHS` in Step 3 to the path that holds it, and re-run. If the endpoint needs a key or refuses, write `{"annual":{"data":{}}}` as the fixture, keep the parser (it returns null), and raise it in the final report — the GSA check then shows "unavailable" (it never blocks a run).

- [ ] **Step 2: Failing test** `weather.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { jhbTmyCsv } from './__fixtures__/weather'

const h = vi.hoisted(() => ({ put: vi.fn(async () => {}), remove: vi.fn(async () => {}), get: vi.fn() }))
vi.mock('./storage', async (orig) => ({ ...(await orig<typeof import('./storage')>()), putGzipText: h.put, removeObject: h.remove, getGzipText: h.get }))

import { getOrFetchWeather, loadWeatherYear, roundCoord, PVGIS_TMY_URL, parseGsaPvout } from './weather'

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
    expect(fetchImpl.mock.calls[0]![0]).toBe(PVGIS_TMY_URL(-26.2, 28.05))
    expect(h.put).toHaveBeenCalledWith(client, 'solar-weather', expect.stringMatching(/^o1\/[0-9a-f-]{36}\.csv\.gz$/), jhbTmyCsv())
    const ins = callsTo(calls, 'solar.weather_datasets', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ organisation_id: ORG, source: 'pvgis_tmy', lat_round: -26.2, lng_round: 28.05, fetched_by: U, gsa_pvout_kwh_per_kwp: parseGsaPvout(gsa) })
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
    await getOrFetchWeather({ svc: client as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl, rateLimitFn: () => true })
    expect((callsTo(calls, 'solar.weather_datasets', 'insert')[0]!.payload as { gsa_pvout_kwh_per_kwp: unknown }).gsa_pvout_kwh_per_kwp).toBeNull()
  })

  it('a concurrent fetch that won the unique key: our object is removed and theirs returned', async () => {
    const theirs = { id: 'w9', organisation_id: ORG, source: 'pvgis_tmy', lat_round: -26.2, lng_round: 28.05 }
    let inserted = false
    const { client } = fakeSupabase({ writes: { 'solar.weather_datasets:insert': { error: { code: '23505', message: 'dup' } } } })
    const svc = { ...client, schema: (s: string) => ({ from: (t: string) => {
      const b = client.schema(s).from(t)
      if (t === 'weather_datasets') { const orig = b.insert; b.insert = (p: unknown) => { inserted = true; return orig(p) } }
      return b
    } }) }
    const tablesAfter = fakeSupabase({ tables: { 'solar.weather_datasets': [theirs] } }).client
    const svc2 = { ...svc, schema: (s: string) => ({ from: (t: string) => (inserted && t === 'weather_datasets' ? tablesAfter.schema(s).from(t) : svc.schema(s).from(t)) }) }
    const r = await getOrFetchWeather({ svc: svc2 as never, orgId: ORG, lat: -26.2, lng: 28.05, userId: U, fetchImpl: okFetch(), rateLimitFn: () => true })
    expect(r).toEqual({ ok: true, dataset: theirs, cached: true })
    expect(h.remove).toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('roundCoord', () => { expect(roundCoord(-26.2049)).toBe(-26.2); expect(roundCoord(28.055)).toBe(28.06) })
  it('loadWeatherYear parses the stored CSV into an 8760 SAST year', async () => {
    h.get.mockResolvedValueOnce(jhbTmyCsv())
    const w = await loadWeatherYear({} as never, { storage_path: 'o/w.csv.gz', radiation_db: 'PVGIS-SARAH2' })
    expect(w.ghi).toHaveLength(8760)
    expect(w.source).toBe('PVGIS TMY (PVGIS-SARAH2)')
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `weather.ts`:

```ts
import 'server-only'
/**
 * PVGIS TMY fetch (functional spec §7.2 Weather; engine spec §1.2 UTC→SAST happens in the engine's
 * tmyToReferenceYear) and the Global Solar Atlas sanity value. Server-side only, AFTER the caller's
 * role + level check (03 §5 point 3), rate-limited per organisation, cached per org at 0.01°.
 * The PVGIS response is stored VERBATIM (CSV) so it can be re-parsed and audited later.
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePvgisTmyCsv, sha256Hex, tmyToReferenceYear, type WeatherYear } from '@esite/shared/solar-engine'
import { rateLimit } from '@/lib/rate-limit'
import { getGzipText, putGzipText, removeObject, weatherPath, WEATHER_BUCKET } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export const roundCoord = (v: number) => Math.round(v * 100) / 100
export const PVGIS_TMY_URL = (lat: number, lng: number) =>
  `https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}&outputformat=csv`
export const GSA_LTA_URL = (lat: number, lng: number) => `https://api.globalsolaratlas.info/data/lta?loc=${lat.toFixed(2)},${lng.toFixed(2)}`
export const WEATHER_RATE_LIMIT = { limit: 5, windowMs: 600_000 } as const
const GSA_PVOUT_PATHS: ReadonlyArray<readonly string[]> = [['annual', 'data', 'PVOUT_csi'], ['annual', 'data', 'PVOUT_specific']]

export interface WeatherDatasetRow {
  id: string; organisation_id: string; source: string; lat_round: number; lng_round: number
  radiation_db?: string | null; elevation_m?: number | null; storage_path?: string; content_sha256?: string
  gsa_pvout_kwh_per_kwp?: number | null; fetched_at?: string
}
export type GetWeatherResult =
  | { ok: true; dataset: WeatherDatasetRow; cached: boolean }
  | { ok: false; status: 429 | 502; error: string }

export function parseGsaPvout(json: unknown): number | null {
  for (const path of GSA_PVOUT_PATHS) {
    let v: unknown = json
    for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 10) / 10
  }
  return null
}

async function fetchGsaPvout(fetchImpl: FetchLike, lat: number, lng: number): Promise<number | null> {
  try {
    const res = await fetchImpl(GSA_LTA_URL(lat, lng), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    return parseGsaPvout(await res.json())
  } catch {
    return null
  }
}

async function cachedRow(svc: AnyClient, orgId: string, lat: number, lng: number): Promise<WeatherDatasetRow | null> {
  const { data } = await svc.schema('solar').from('weather_datasets').select('*')
    .eq('organisation_id', orgId).eq('source', 'pvgis_tmy').eq('lat_round', lat).eq('lng_round', lng).maybeSingle()
  return (data as WeatherDatasetRow | null) ?? null
}

export async function getOrFetchWeather(a: {
  svc: AnyClient; orgId: string; lat: number; lng: number; userId: string
  fetchImpl?: FetchLike; rateLimitFn?: (key: string, limit: number, windowMs: number) => boolean
}): Promise<GetWeatherResult> {
  const lat = roundCoord(a.lat), lng = roundCoord(a.lng)
  const existing = await cachedRow(a.svc, a.orgId, lat, lng)
  if (existing) return { ok: true, dataset: existing, cached: true }

  const allow = (a.rateLimitFn ?? rateLimit)(`solar-weather:${a.orgId}`, WEATHER_RATE_LIMIT.limit, WEATHER_RATE_LIMIT.windowMs)
  if (!allow) return { ok: false, status: 429, error: 'Weather fetches are limited to 5 per 10 minutes for your organisation — try again shortly.' }

  const fetchImpl = a.fetchImpl ?? fetch
  let text: string
  try {
    const res = await fetchImpl(PVGIS_TMY_URL(lat, lng), { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return { ok: false, status: 502, error: `PVGIS refused the request (HTTP ${res.status}) — try again later.` }
    text = await res.text()
  } catch (e) {
    console.error('[solar-weather] PVGIS fetch failed', { orgId: a.orgId, lat, lng, err: String(e) })
    return { ok: false, status: 502, error: 'PVGIS did not respond — try again later.' }
  }
  let tmy: ReturnType<typeof parsePvgisTmyCsv>
  try {
    tmy = parsePvgisTmyCsv(text)
  } catch (e) {
    console.error('[solar-weather] PVGIS response unreadable', { orgId: a.orgId, lat, lng, err: String(e) })
    return { ok: false, status: 502, error: 'PVGIS returned data E-Site could not read.' }
  }

  const id = randomUUID()
  const path = weatherPath(a.orgId, id)
  await putGzipText(a.svc, WEATHER_BUCKET, path, text)
  const gsa = await fetchGsaPvout(fetchImpl, lat, lng)
  const row = {
    id, organisation_id: a.orgId, source: 'pvgis_tmy', lat_round: lat, lng_round: lng,
    radiation_db: tmy.radiationDb, elevation_m: tmy.elevation, storage_path: path, content_sha256: sha256Hex(text),
    gsa_pvout_kwh_per_kwp: gsa, meta: { pvgis_url: PVGIS_TMY_URL(lat, lng), gsa_url: GSA_LTA_URL(lat, lng) }, fetched_by: a.userId,
  }
  const { data, error } = await a.svc.schema('solar').from('weather_datasets').insert(row).select('*')
  if (error) {
    await removeObject(a.svc, WEATHER_BUCKET, path)
    if (error.code === '23505') {
      const winner = await cachedRow(a.svc, a.orgId, lat, lng)
      if (winner) return { ok: true, dataset: winner, cached: true }
    }
    console.error('[solar-weather] insert failed', { orgId: a.orgId, code: error.code })
    return { ok: false, status: 502, error: 'The weather could not be saved — try again.' }
  }
  return { ok: true, dataset: (Array.isArray(data) ? data[0] : data) as WeatherDatasetRow, cached: false }
}

export async function loadWeatherYear(svc: AnyClient, row: { storage_path: string; radiation_db?: string | null }): Promise<WeatherYear> {
  const text = await getGzipText(svc, WEATHER_BUCKET, row.storage_path)
  return tmyToReferenceYear(parsePvgisTmyCsv(text), `PVGIS TMY${row.radiation_db ? ` (${row.radiation_db})` : ''}`)
}
```

Check once: `grep -n "export function tmyToReferenceYear" packages/shared/src/services/solar/weather/reference-year.ts` shows the `source` parameter is used verbatim as `WeatherYear.source`; the `loadWeatherYear` test asserts it.

- [ ] **Step 4: Run — PASS; commit** ("feat(solar): PVGIS TMY + GSA weather cache, per-org rate limit").

---

### Task 16: Study tariff (read-only; named reasons)

**Files:**
- Create: `apps/web/src/lib/solar/cases/tariff.ts`
- Test: `apps/web/src/lib/solar/cases/tariff.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { resolveStudyTariff, TARIFF_REASONS, calendarFromRows, ssegFromRow } from './tariff'

const P = 'p1'
const tables = {
  'solar.studies': [{ project_id: P, tariff_id: 't1', nmd_kva: 500 }],
  'tariffs.tariff': [{ id: 't1', tariff_year_id: 'y1', name: 'Business Flat', category: 'commercial', metering: 'conventional', structure: 'flat', export_tariff_id: null }],
  'tariffs.charge': [{ tariff_id: 't1', component: 'energy', season: 'all', tou: 'all', unit: 'c_per_kWh', amount_excl_vat: 250, vat_basis: 'stated_excl', extraction_method: 'manual', source_locator: {} }],
  'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'L', financial_year: '2025/26', state: 'published' }],
  'tariffs.licensee': [{ id: 'L', name: 'City Power' }],
  'tariffs.tou_calendar': [{ id: 'cal', licensee_id: 'L', valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'assumed_eskom' }],
  'tariffs.tou_window': [{ calendar_id: 'cal', season: 'low', day_type: 'weekday', start_minute: 420, end_minute: 600, period: 'peak' }],
  'tariffs.holiday_rule': [{ calendar_id: 'cal', treated_as: 'sunday' }],
  'tariffs.sseg_rule': [],
  'projects.public_holidays': [{ d: '2025-01-01' }, { d: '2025-12-25' }, { d: '2026-01-01' }],
}

describe('resolveStudyTariff', () => {
  it('builds the calculator from the pinned published tariff, its calendar and the holidays of the reference year', async () => {
    const build = vi.fn(() => ({ monthlyBills: () => [] }))
    const r = await resolveStudyTariff(fakeSupabase({ tables }).client as never, P, { build })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tariffRef).toEqual({ tariffId: 't1', tariffName: 'Business Flat', financialYear: '2025/26', licenseeName: 'City Power' })
    const [tariff, calendar, holidays, opts] = build.mock.calls[0] as unknown as [{ name: string; charges: unknown[] }, unknown, Set<string>, Record<string, unknown>]
    expect(tariff.name).toBe('Business Flat')
    expect(tariff.charges).toHaveLength(1)
    expect(calendar).toEqual({ highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'assumed_eskom',
      windows: [{ season: 'low', dayType: 'weekday', startMinute: 420, endMinute: 600, period: 'peak' }] })
    expect([...holidays].sort()).toEqual(['2025-01-01', '2025-12-25'])
    expect(opts).toMatchObject({ year: 2025, sseg: null, exportTariff: null, powerFactor: 0.95 })
  })

  it('a base without the tariff_id column (Phase 2b not merged) → not pinned', async () => {
    const client = { schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column studies.tariff_id does not exist' } }) }) }) }) }) }
    await expect(resolveStudyTariff(client as never, P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPinned })
  })

  it('NULL pin, unpublished year, no calendar → the matching sentence', async () => {
    const t = (over: Record<string, unknown[]>) => fakeSupabase({ tables: { ...tables, ...over } }).client as never
    await expect(resolveStudyTariff(t({ 'solar.studies': [{ project_id: P, tariff_id: null }] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPinned })
    await expect(resolveStudyTariff(t({ 'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'L', financial_year: '2025/26', state: 'in_review' }] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.notPublished })
    await expect(resolveStudyTariff(t({ 'tariffs.tou_calendar': [] }), P)).resolves.toEqual({ ok: false, reason: TARIFF_REASONS.noCalendar })
  })
})

describe('row mappers', () => {
  it('ssegFromRow maps the Net-Billing rule', () => {
    expect(ssegFromRow({ crediting: 'net_billing_tou', carry_forward: 'within_financial_year', fy_end_month: 3, cap_rule: 'kwh_per_tou_period', offsets: 'energy_only', forfeit_on_ownership_change: true, max_kva: '1000', requires_tou: true, requires_bidirectional_meter: true, locator: { pages: '7-12' } }))
      .toEqual({ crediting: 'net_billing_tou', carryForward: 'within_financial_year', fyEndMonth: 3, capRule: 'kwh_per_tou_period', offsets: 'energy_only', forfeitOnOwnershipChange: true, maxKva: 1000, requiresTou: true, requiresBidirectionalMeter: true, locator: { pages: '7-12' } })
  })
  it('calendarFromRows without a holiday rule → holidayTreatedAs null', () => {
    expect(calendarFromRows({ high_season_months: [6], source: 'published' }, [], null).holidayTreatedAs).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `tariff.ts`:

```ts
import 'server-only'
/**
 * The study's pinned tariff as an engine BillCalculator — READ-ONLY. Pinning (solar.studies.tariff_id,
 * TOU calendars) is Phase 2b; until it is on the base the select fails with 42703/PGRST204 and every
 * path returns a named reason, so Run financials is disabled with a sentence instead of guessing.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBillCalculator, DEFAULT_REFERENCE_YEAR, type SsegRule, type Tariff, type TouCalendar, type TariffBillCalculator } from '@esite/shared'
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import { SOLAR_ENGINE_DEFAULTS, type BillCalculator } from '@esite/shared/solar-engine'
import { toEngineBillCalculator, type TariffRef } from '@esite/shared/solar-cases'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const TARIFF_REASONS = {
  notPinned: 'No tariff is pinned for this study — pin one on the Tariff tab.',
  notPublished: 'The pinned tariff’s year is not published.',
  noCalendar: 'There is no TOU calendar for this supply authority yet.',
  unreadable: 'The pinned tariff could not be read — try again.',
} as const

export type StudyTariff =
  | { ok: true; calc: BillCalculator; calendar: TouCalendar; holidays: Set<string>; tariffRef: TariffRef; year: number }
  | { ok: false; reason: string }

export function ssegFromRow(r: Row): SsegRule {
  return {
    crediting: r.crediting as SsegRule['crediting'], carryForward: r.carry_forward as SsegRule['carryForward'],
    fyEndMonth: Number(r.fy_end_month), capRule: r.cap_rule as SsegRule['capRule'], offsets: 'energy_only',
    forfeitOnOwnershipChange: Boolean(r.forfeit_on_ownership_change), maxKva: Number(r.max_kva),
    requiresTou: Boolean(r.requires_tou), requiresBidirectionalMeter: Boolean(r.requires_bidirectional_meter),
    locator: (r.locator ?? {}) as Record<string, string>,
  }
}

export function calendarFromRows(cal: Row, windows: Row[], rule: Row | null): TouCalendar {
  return {
    highSeasonMonths: (cal.high_season_months as number[]) ?? [],
    windows: windows.map((w) => ({
      season: w.season as TouCalendar['windows'][number]['season'], dayType: w.day_type as TouCalendar['windows'][number]['dayType'],
      startMinute: Number(w.start_minute), endMinute: Number(w.end_minute), period: w.period as TouCalendar['windows'][number]['period'],
    })),
    holidayTreatedAs: rule ? (rule.treated_as as 'saturday' | 'sunday') : null,
    source: cal.source as TouCalendar['source'],
  }
}

type Build = (t: Tariff, c: TouCalendar, h: ReadonlySet<string>, o: Parameters<typeof createBillCalculator>[3]) => TariffBillCalculator

async function loadTariff(svc: AnyClient, id: string): Promise<{ row: Row; tariff: Tariff } | null> {
  const t = svc.schema('tariffs')
  const { data: row } = await t.from('tariff').select('*').eq('id', id).maybeSingle()
  if (!row) return null
  const { data: charges } = await t.from('charge').select('*').eq('tariff_id', id)
  return { row: row as Row, tariff: tariffFromRows(row as Row, (charges ?? []) as Row[]) }
}

export async function resolveStudyTariff(svc: AnyClient, projectId: string, opts: { year?: number; build?: Build } = {}): Promise<StudyTariff> {
  const year = opts.year ?? DEFAULT_REFERENCE_YEAR
  const { data: study, error } = await svc.schema('solar').from('studies').select('tariff_id, nmd_kva').eq('project_id', projectId).maybeSingle()
  if (error) {
    const missingColumn = error.code === '42703' || error.code === 'PGRST204' || /tariff_id/.test(error.message ?? '')
    return { ok: false, reason: missingColumn ? TARIFF_REASONS.notPinned : TARIFF_REASONS.unreadable }
  }
  const tariffId = (study as Row | null)?.tariff_id as string | null | undefined
  if (!tariffId) return { ok: false, reason: TARIFF_REASONS.notPinned }

  const t = svc.schema('tariffs')
  const main = await loadTariff(svc, tariffId)
  if (!main) return { ok: false, reason: TARIFF_REASONS.unreadable }
  const { data: y } = await t.from('tariff_year').select('id, licensee_id, financial_year, state').eq('id', main.row.tariff_year_id as string).maybeSingle()
  if (!y) return { ok: false, reason: TARIFF_REASONS.unreadable }
  if ((y as Row).state !== 'published') return { ok: false, reason: TARIFF_REASONS.notPublished }
  const licenseeId = (y as Row).licensee_id as string
  const { data: lic } = await t.from('licensee').select('name').eq('id', licenseeId).maybeSingle()

  const { data: cals } = await t.from('tou_calendar').select('id, valid_from, valid_to, high_season_months, source').eq('licensee_id', licenseeId)
  const cal = ((cals ?? []) as Row[])
    .filter((c) => String(c.valid_from) <= `${year}-12-31` && (c.valid_to === null || String(c.valid_to) >= `${year}-01-01`))
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)))[0]
  if (!cal) return { ok: false, reason: TARIFF_REASONS.noCalendar }
  const [{ data: windows }, { data: rule }, { data: hol }, { data: sseg }] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', cal.id as string),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', cal.id as string).maybeSingle(),
    svc.schema('projects').from('public_holidays').select('d').gte('d', `${year}-01-01`).lt('d', `${year + 1}-01-01`),
    t.from('sseg_rule').select('*').eq('tariff_year_id', (y as Row).id as string).maybeSingle(),
  ])
  const calendar = calendarFromRows(cal, (windows ?? []) as Row[], (rule as Row | null) ?? null)
  const holidays = new Set(((hol ?? []) as Row[]).map((r) => String(r.d)))
  const exportTariff = main.row.export_tariff_id ? (await loadTariff(svc, main.row.export_tariff_id as string))?.tariff ?? null : null
  const nmd = (study as Row).nmd_kva
  const build: Build = opts.build ?? createBillCalculator
  const inner = build(main.tariff, calendar, holidays, {
    year, sseg: sseg ? ssegFromRow(sseg as Row) : null, exportTariff,
    powerFactor: SOLAR_ENGINE_DEFAULTS.load.powerFactor,
    ...(nmd !== null && nmd !== undefined ? { demandForMonth: () => ({ nmdKva: Number(nmd) }) } : {}),
  })
  return {
    ok: true, calc: toEngineBillCalculator(inner), calendar, holidays, year,
    tariffRef: { tariffId, tariffName: main.tariff.name, financialYear: String((y as Row).financial_year), licenseeName: String((lic as Row | null)?.name ?? '') },
  }
}
```
The fake's `tables` for `solar.studies` includes `nmd_kva: 500`, so the test's `opts` also carries `demandForMonth` — `toMatchObject` ignores it.

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): read-only study tariff resolution with named reasons").

---

### Task 17: Run context (study + case + site load + weather + tariff → BuildResult + current hash)

**Files:**
- Create: `apps/web/src/lib/solar/cases/run-context.ts`
- Test: `apps/web/src/lib/solar/cases/run-context.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { defaultCaseConfig, BUILD_REASONS } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ tariff: vi.fn() }))
vi.mock('./tariff', () => ({ resolveStudyTariff: h.tariff }))
import { loadRunContext, loadStudyInputs, contextForCase } from './run-context'

const P = 'p1', S = 's1', C = 'c1', ORG = 'o1', W = '22222222-2222-4222-8222-222222222222'
const cfg = (() => {
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  return { ...c, pv: { ...c.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy', datasetId: W } }
})()
const tables = {
  'solar.studies': [{ id: S, project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05, export_mode: 'net_billing', export_limit_kw: null, nmd_kva: 500, load_basis: 'S1', reference_year: 2025, selected_case_id: null, updated_at: 'T0' }],
  'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1' }],
  'solar.site_load': [{ study_id: S, basis: 'S1', reference_year: 2025, series: new Array(8760).fill(100) }],
  'solar.weather_datasets': [{ id: W, organisation_id: ORG, source: 'pvgis_tmy', storage_path: 'o1/w.csv.gz', fetched_at: '2026-09-28T00:00:00Z', gsa_pvout_kwh_per_kwp: 1700 }],
}

describe('loadRunContext', () => {
  it('assembles a buildable context and its current hash', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    const r = await loadRunContext(fakeSupabase({ tables }).client as never, P, C)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ctx.build.ok).toBe(true)
    expect(r.ctx.currentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.ctx.weather?.id).toBe(W)
    expect(r.ctx.touPeriods).toBeNull()
  })

  it('no study / unknown case / corrupt config → 404/404/422 sentences', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'x' })
    await expect(loadRunContext(fakeSupabase({ tables: { ...tables, 'solar.studies': [] } }).client as never, P, C)).resolves.toEqual({ ok: false, status: 404, error: 'Save Site & Supply first.' })
    await expect(loadRunContext(fakeSupabase({ tables }).client as never, P, 'nope')).resolves.toEqual({ ok: false, status: 404, error: 'Case not found.' })
    const bad = { ...tables, 'solar.cases': [{ ...tables['solar.cases'][0], config: { version: 99 } }] }
    await expect(loadRunContext(fakeSupabase({ tables: bad }).client as never, P, C)).resolves.toEqual({ ok: false, status: 422, error: 'This case’s saved configuration is invalid — open it, check each section and save it again.' })
  })

  it('a weather id that no longer resolves in the org is treated as "no weather" (never trusted)', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'x' })
    const r = await loadRunContext(fakeSupabase({ tables: { ...tables, 'solar.weather_datasets': [] } }).client as never, P, C)
    expect(r.ok && r.ctx.build).toEqual({ ok: false, reasons: [BUILD_REASONS.noWeather] })
    expect(r.ok && r.ctx.currentHash).toBeNull()
  })

  it('study inputs are loaded once and reused per case', async () => {
    h.tariff.mockResolvedValue({ ok: false, reason: 'x' })
    const svc = fakeSupabase({ tables }).client as never
    const shared = await loadStudyInputs(svc, P)
    expect(shared).not.toBeNull()
    const ctx = await contextForCase(svc, shared!, tables['solar.cases'][0] as never)
    expect(ctx.ok && ctx.ctx.build.ok).toBe(true)
    expect(h.tariff).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `run-context.ts`:

```ts
import 'server-only'
/**
 * Everything a run needs, loaded with the SERVICE client — callers must have passed the Solar gate for
 * this project first. The same function feeds the Stale banner (currentHash) and the run itself, so the
 * two can never disagree about what "current inputs" means.
 * If Task 0 Step 4 found an integration adapter that turns solar.site_load into CaseInput load, call it
 * in `loadStudyInputs` instead of reading `series` directly; keep the returned shape.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inputsHash, type TouPeriod } from '@esite/shared/solar-engine'
import { buildCaseInput, engineTouPeriods, parseCaseConfig, type BuildResult, type CaseConfig, type StudyExportMode } from '@esite/shared/solar-cases'
import { resolveStudyTariff, type StudyTariff } from './tariff'
import type { WeatherDatasetRow } from './weather'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface StudyRow {
  id: string; project_id: string; organisation_id: string; latitude: number | null; longitude: number | null
  export_mode: StudyExportMode | null; export_limit_kw: number | null; nmd_kva: number | null
  load_basis: string | null; reference_year: number | null; selected_case_id: string | null; updated_at: string
}
export interface CaseRow { id: string; study_id: string; project_id: string; name: string; pv_source: string; config: unknown; updated_at: string }

export interface StudyInputs {
  study: StudyRow
  siteLoad: { series: number[]; basis: string; referenceYear: number } | null
  tariff: StudyTariff
  touPeriods: TouPeriod[] | null
}
export interface RunContext extends StudyInputs {
  caseRow: CaseRow
  config: CaseConfig
  weather: WeatherDatasetRow | null
  build: BuildResult
  currentHash: string | null
}
export type RunContextResult = { ok: true; ctx: RunContext } | { ok: false; status: 404 | 422; error: string }

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function loadStudyInputs(svc: AnyClient, projectId: string): Promise<StudyInputs | null> {
  const { data: s } = await svc.schema('solar').from('studies')
    .select('id, project_id, organisation_id, latitude, longitude, export_mode, export_limit_kw, nmd_kva, load_basis, reference_year, selected_case_id, updated_at')
    .eq('project_id', projectId).maybeSingle()
  if (!s) return null
  const study = { ...(s as StudyRow), latitude: n((s as StudyRow).latitude), longitude: n((s as StudyRow).longitude), export_limit_kw: n((s as StudyRow).export_limit_kw), nmd_kva: n((s as StudyRow).nmd_kva) }
  let siteLoad: StudyInputs['siteLoad'] = null
  if (study.load_basis && study.reference_year) {
    const { data: sl } = await svc.schema('solar').from('site_load').select('series, basis, reference_year')
      .eq('study_id', study.id).eq('basis', study.load_basis).eq('reference_year', study.reference_year).maybeSingle()
    if (sl) siteLoad = { series: ((sl as { series: unknown[] }).series ?? []).map(Number), basis: String((sl as Record<string, unknown>).basis), referenceYear: Number((sl as Record<string, unknown>).reference_year) }
  }
  const tariff = await resolveStudyTariff(svc, projectId)
  const touPeriods = tariff.ok ? engineTouPeriods(tariff.calendar, tariff.holidays, tariff.year) : null
  return { study, siteLoad, tariff, touPeriods }
}

export async function contextForCase(svc: AnyClient, shared: StudyInputs, caseRow: CaseRow): Promise<RunContextResult> {
  const parsed = parseCaseConfig(caseRow.config)
  if (!parsed.ok) return { ok: false, status: 422, error: 'This case’s saved configuration is invalid — open it, check each section and save it again.' }
  let config = parsed.config
  let weather: WeatherDatasetRow | null = null
  if (config.weather.datasetId) {
    const { data } = await svc.schema('solar').from('weather_datasets').select('*')
      .eq('id', config.weather.datasetId).eq('organisation_id', shared.study.organisation_id).maybeSingle()
    weather = (data as WeatherDatasetRow | null) ?? null
    if (!weather) config = { ...config, weather: { ...config.weather, datasetId: null } }
  }
  const build = buildCaseInput({
    config,
    study: { exportMode: shared.study.export_mode, exportLimitKw: shared.study.export_limit_kw },
    siteLoad: shared.siteLoad,
    touPeriods: shared.touPeriods,
  })
  return { ok: true, ctx: { ...shared, caseRow, config: parsed.config, weather, build, currentHash: build.ok ? inputsHash(build.input) : null } }
}

export async function loadRunContext(svc: AnyClient, projectId: string, caseId: string): Promise<RunContextResult> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return { ok: false, status: 404, error: 'Save Site & Supply first.' }
  const { data: c } = await svc.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at')
    .eq('id', caseId).eq('project_id', projectId).maybeSingle()
  if (!c) return { ok: false, status: 404, error: 'Case not found.' }
  return contextForCase(svc, shared, c as CaseRow)
}
```

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): run context shared by the run and the Stale banner").

---

### Task 18: Execute a run

**Files:**
- Create: `apps/web/src/lib/solar/cases/run-case.ts`
- Test: `apps/web/src/lib/solar/cases/run-case.test.ts`

- [ ] **Step 1: Failing test** (real engine on the Johannesburg fixture; context, weather file and storage are mocked):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { parsePvgisTmyCsv, tmyToReferenceYear, ENGINE_VERSION, inputsHash } from '@esite/shared/solar-engine'
import { buildCaseInput, defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import { jhbTmyCsv } from './__fixtures__/weather'

const h = vi.hoisted(() => ({ ctx: vi.fn(), weather: vi.fn(), put: vi.fn(async () => {}), remove: vi.fn(async () => {}) }))
vi.mock('./run-context', () => ({ loadRunContext: h.ctx }))
vi.mock('./weather', () => ({ loadWeatherYear: h.weather }))
vi.mock('./storage', async (o) => ({ ...(await o<typeof import('./storage')>()), putGzipText: h.put, removeObject: h.remove }))
import { executeCaseRun } from './run-case'

const P = 'p1', C = 'c1', ORG = 'o1', U = 'u1', W = '22222222-2222-4222-8222-222222222222'
function ctx() {
  const c0 = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 200, acKw: 160 })
  const config = { ...c0, pv: { ...c0.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy' as const, datasetId: W } }
  const build = buildCaseInput({ config, study: { exportMode: 'net_billing', exportLimitKw: null }, siteLoad: { series: new Array(8760).fill(80), basis: 'S1', referenceYear: 2025 }, touPeriods: null })
  return {
    ok: true, ctx: {
      study: { id: 's1', project_id: P, organisation_id: ORG, nmd_kva: 300, load_basis: 'S1', reference_year: 2025 },
      siteLoad: { series: [], basis: 'S1', referenceYear: 2025 }, tariff: { ok: false, reason: 'x' }, touPeriods: null,
      caseRow: { id: C, config }, config, weather: { id: W, storage_path: 'o1/w.csv.gz', fetched_at: '2026-09-28T00:00:00Z', gsa_pvout_kwh_per_kwp: 1750 },
      build, currentHash: build.ok ? inputsHash(build.input) : null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ctx.mockResolvedValue(ctx())
  h.weather.mockResolvedValue(tmyToReferenceYear(parsePvgisTmyCsv(jhbTmyCsv()), 'PVGIS TMY (PVGIS-SARAH2)'))
})

describe('executeCaseRun', () => {
  it('inserts the running row through the USER session, finishes it through the SERVICE client, stores the CSV', async () => {
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [{ id: 'r1' }] } } })
    const out = await executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: true, runId: 'r1', status: 'succeeded' })
    const ins = callsTo(user.calls, 'solar.case_runs', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ case_id: C, engine_version: ENGINE_VERSION, weather_dataset_id: W, tariff_ref: null })
    expect(ins.inputs_hash).toBe(ctx().ctx.currentHash)
    expect(h.put).toHaveBeenCalledWith(svc.client, 'solar-runs', `${ORG}/${P}/${C}/r1.csv.gz`, expect.stringMatching(/^hour,start_sast,/))
    const upd = callsTo(svc.calls, 'solar.case_runs', 'update')
    // [0] closes timed-out runs; [1] finishes this one, conditioned on still running
    expect(upd[0]!.payload).toMatchObject({ status: 'failed' })
    expect(upd[0]!.filters).toEqual(expect.arrayContaining([['eq', 'case_id', C], ['eq', 'status', 'running']]))
    expect(upd[1]!.payload).toMatchObject({ status: 'succeeded', hourly_path: `${ORG}/${P}/${C}/r1.csv.gz` })
    expect(upd[1]!.filters).toEqual(expect.arrayContaining([['eq', 'id', 'r1'], ['eq', 'status', 'running']]))
    const outputs = (upd[1]!.payload as { outputs: { kpis: { dcKwp: number }; provenance: { gsaPvoutKwhPerKwp: number } } }).outputs
    expect(outputs.kpis.dcKwp).toBe(200)
    expect(outputs.provenance.gsaPvoutKwhPerKwp).toBe(1750)
  })

  it('inputs that cannot be built → 422 with every reason, nothing inserted', async () => {
    h.ctx.mockResolvedValue({ ok: true, ctx: { ...ctx().ctx, build: { ok: false, reasons: ['A.', 'B.'] } } })
    const user = fakeSupabase({})
    const out = await executeCaseRun({ user: user.client as never, svc: fakeSupabase({}).client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: false, status: 422, error: 'A. B.' })
    expect(callsTo(user.calls, 'solar.case_runs', 'insert')).toHaveLength(0)
  })

  it('a run already in progress → 409; a View user refused by RLS → 403', async () => {
    const svc = fakeSupabase({}).client as never
    const dup = fakeSupabase({ writes: { 'solar.case_runs:insert': { error: { code: '23505', message: 'dup' } } } })
    await expect(executeCaseRun({ user: dup.client as never, svc, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 409, error: 'A run of this case is already in progress.' })
    const rls = fakeSupabase({ writes: { 'solar.case_runs:insert': { error: { code: '42501', message: 'rls' } } } })
    await expect(executeCaseRun({ user: rls.client as never, svc, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 403, error: 'You need Edit access to run a case.' })
  })

  it('cancelled while running: the final update finds 0 rows → CSV removed, 409', async () => {
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [] } } })
    await expect(executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U }))
      .resolves.toEqual({ ok: false, status: 409, error: 'The run was cancelled.', runId: 'r1' })
    expect(h.remove).toHaveBeenCalledWith(svc.client, 'solar-runs', `${ORG}/${P}/${C}/r1.csv.gz`)
  })

  it('an engine/weather failure is recorded on the row as a sentence (diagnostics in the first deploy)', async () => {
    h.weather.mockRejectedValueOnce(new Error('stored file not found'))
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({})
    const out = await executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: false, status: 500, error: 'The run failed: stored file not found', runId: 'r1' })
    const fail = callsTo(svc.calls, 'solar.case_runs', 'update').at(-1)!
    expect(fail.payload).toEqual({ status: 'failed', error: 'The run failed: stored file not found' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `run-case.ts`:

```ts
import 'server-only'
/**
 * One run, end to end (functional spec §7.2 Run). The running row is INSERTed through the caller's
 * session (00215 RLS: Solar Edit); the result is written by the service client, which is the only
 * role allowed to UPDATE a run, and only while it is running (freeze trigger). Every failure is kept
 * on the row with a sentence and logged with the run id.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, simulateCase } from '@esite/shared/solar-engine'
import { buildRunOutputs, encodeHourlyCsv, hourlyFromResult, RUN_TIMEOUT_MS } from '@esite/shared/solar-cases'
import { humanSolarError } from '@/lib/solar/errors'
import { loadRunContext } from './run-context'
import { loadWeatherYear } from './weather'
import { putGzipText, removeObject, runCsvPath, RUNS_BUCKET } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export type RunOutcome =
  | { ok: true; runId: string; status: 'succeeded' }
  | { ok: false; status: number; error: string; runId?: string }

export async function executeCaseRun(a: { user: AnyClient; svc: AnyClient; projectId: string; caseId: string; userId: string; now?: () => number }): Promise<RunOutcome> {
  const now = a.now ?? Date.now
  const runs = () => a.svc.schema('solar').from('case_runs')
  // A run killed at maxDuration stays 'running' forever; close it so the unique running index frees up.
  await runs().update({ status: 'failed', error: 'The run timed out (no result after 90 s).' })
    .eq('case_id', a.caseId).eq('status', 'running').lt('started_at', new Date(now() - RUN_TIMEOUT_MS).toISOString())

  const loaded = await loadRunContext(a.svc, a.projectId, a.caseId)
  if (!loaded.ok) return { ok: false, status: loaded.status, error: loaded.error }
  const ctx = loaded.ctx
  if (!ctx.build.ok) return { ok: false, status: 422, error: ctx.build.reasons.join(' ') }
  const input = ctx.build.input

  const { data, error } = await a.user.schema('solar').from('case_runs').insert({
    case_id: a.caseId, engine_version: ENGINE_VERSION, inputs: input, inputs_hash: ctx.currentHash,
    config_snapshot: ctx.config, weather_dataset_id: ctx.weather!.id, tariff_ref: ctx.tariff.ok ? ctx.tariff.tariffRef : null,
  }).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, error: 'A run of this case is already in progress.' }
    if (error.code === '42501') return { ok: false, status: 403, error: 'You need Edit access to run a case.' }
    return { ok: false, status: 500, error: humanSolarError(error) }
  }
  const runId = (Array.isArray(data) ? data[0]?.id : (data as { id?: string } | null)?.id) as string
  const path = runCsvPath(ctx.study.organisation_id, a.projectId, a.caseId, runId)

  try {
    const year = await loadWeatherYear(a.svc, ctx.weather!)
    const result = simulateCase(input, { id: ctx.weather!.id, year })
    if (result.inputsHash !== ctx.currentHash) throw new Error('the inputs changed while the run was being prepared')
    const outputs = buildRunOutputs(result, input, {
      weatherFetchedAt: ctx.weather!.fetched_at ?? null,
      gsaPvoutKwhPerKwp: ctx.weather!.gsa_pvout_kwh_per_kwp === null || ctx.weather!.gsa_pvout_kwh_per_kwp === undefined ? null : Number(ctx.weather!.gsa_pvout_kwh_per_kwp),
      tariffRef: ctx.tariff.ok ? ctx.tariff.tariffRef : null,
      touPeriods: ctx.touPeriods,
      nmdKva: ctx.study.nmd_kva,
      loadBasis: ctx.siteLoad?.basis ?? '',
      loadReferenceYear: ctx.siteLoad?.referenceYear ?? 0,
    })
    await putGzipText(a.svc, RUNS_BUCKET, path, encodeHourlyCsv(hourlyFromResult(result)))
    const { data: done } = await runs().update({ status: 'succeeded', outputs, hourly_path: path })
      .eq('id', runId).eq('status', 'running').select('id')
    if (!Array.isArray(done) || done.length === 0) {
      await removeObject(a.svc, RUNS_BUCKET, path)
      return { ok: false, status: 409, error: 'The run was cancelled.', runId }
    }
    return { ok: true, runId, status: 'succeeded' }
  } catch (e) {
    const sentence = `The run failed: ${e instanceof Error ? e.message : 'unexpected error'}`
    console.error('[solar-run] failed', { runId, caseId: a.caseId, projectId: a.projectId, err: String(e) })
    await runs().update({ status: 'failed', error: sentence }).eq('id', runId).eq('status', 'running')
    return { ok: false, status: 500, error: sentence, runId }
  }
}
```

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): execute a case run into an immutable stored run").

---

### Task 19: Routes — run, cancel, export

**Files:**
- Create: `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/run/route.ts` (+ `route.test.ts`)
- Create: `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/cancel/route.ts` (+ `route.test.ts`)
- Create: `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/runs/[runId]/export/route.ts` (+ `route.test.ts`)

- [ ] **Step 1: Failing tests.**

`run/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const h = vi.hoisted(() => ({ gate: vi.fn(), exec: vi.fn(), rl: vi.fn(() => true), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), reval: vi.fn(), createClient: vi.fn(async () => ({ tag: 'user' })), svc: vi.fn(() => ({ tag: 'svc' })) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.svc }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/cases/run-case', () => ({ executeCaseRun: h.exec }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rl }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.reval }))
import { POST, runtime, maxDuration } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222'
const call = (p = P, c = C) => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: p, caseId: c }) })

beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' }) })

describe('POST …/cases/[caseId]/run', () => {
  it('declares nodejs and 60 s', () => { expect(runtime).toBe('nodejs'); expect(maxDuration).toBe(60) })
  it('gates Solar Edit FIRST', async () => {
    h.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: 'Solar access required' }, { status: 403 }) })
    const res = await call()
    expect(res.status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith({ tag: 'user' }, P, 'edit')
    expect(h.exec).not.toHaveBeenCalled()
  })
  it('refuses a malformed id', async () => { expect((await call('nope')).status).toBe(400) })
  it('429 past the per-user limit', async () => {
    h.rl.mockReturnValueOnce(false)
    const res = await call()
    expect(res.status).toBe(429)
    expect(h.rl).toHaveBeenCalledWith('solar-run:u1', 10, 60_000)
  })
  it('success → 200, audit + product event + revalidate', async () => {
    h.exec.mockResolvedValue({ ok: true, runId: 'r1', status: 'succeeded' })
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ runId: 'r1', status: 'succeeded' })
    expect(h.exec).toHaveBeenCalledWith({ user: { tag: 'user' }, svc: { tag: 'svc' }, projectId: P, caseId: C, userId: 'u1' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'case_run', objectRef: { caseId: C, runId: 'r1' } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_case_run' })
  })
  it('failure → its status and sentence; no product event', async () => {
    h.exec.mockResolvedValue({ ok: false, status: 422, error: 'Build the site load on the Load tab first.' })
    const res = await call()
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Build the site load on the Load tab first.' })
    expect(h.emit).not.toHaveBeenCalled()
  })
})
```

`cancel/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn(), svc: { current: null as unknown }, audit: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})), createServiceClient: () => h.svc.current }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
import { POST } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222', R = '33333333-3333-4333-8333-333333333333'
const call = () => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: P, caseId: C }) })
beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' }) })

// Case-level: the browser that pressed Run does not know the run id until the POST returns.
describe('POST …/cases/[caseId]/cancel', () => {
  it('flips only the running run of this case and project', async () => {
    const f = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [{ id: R }] } } }); h.svc.current = f.client
    expect((await call()).status).toBe(200)
    const u = callsTo(f.calls, 'solar.case_runs', 'update')[0]!
    expect(u.payload).toEqual({ status: 'cancelled' })
    expect(u.filters).toEqual([['eq', 'case_id', C], ['eq', 'project_id', P], ['eq', 'status', 'running']])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'case_run_cancelled', objectRef: { caseId: C, runId: R } })
  })
  it('a finished run → 409 sentence', async () => {
    h.svc.current = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [] } } }).client
    const res = await call()
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'This run has already finished.' })
  })
})
```

`export/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { encodeHourlyCsv } from '@esite/shared/solar-cases'

const h = vi.hoisted(() => ({ gate: vi.fn(), user: { current: null as unknown }, get: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => h.user.current), createServiceClient: () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/cases/storage', async (o) => ({ ...(await o<typeof import('@/lib/solar/cases/storage')>()), getGzipText: h.get }))
import { GET } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222', R = '33333333-3333-4333-8333-333333333333'
const series = () => { const z = () => new Float64Array(8760).fill(1); return { load: z(), pvAc: z(), selfUse: z(), import: z(), export: z(), curtail: z(), soc: z(), importPvOnly: z(), exportPvOnly: z() } }
const run = { id: R, case_id: C, project_id: P, status: 'succeeded', hourly_path: 'o/p/c/r.csv.gz', outputs: { monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 1, loadKwh: 2, importBeforeKwh: 2, importKwh: 1, exportKwh: 0, maxDemandBeforeKw: 3, maxDemandAfterKw: 2, touImportBefore: null, touImportAfter: null })) } }
const call = (q: string) => GET(new Request(`http://x/?${q}`), { params: Promise.resolve({ id: P, caseId: C, runId: R }) })

beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'view', userId: 'u1' }); h.user.current = fakeSupabase({ tables: { 'solar.case_runs': [run] } }).client })

describe('GET …/runs/[runId]/export', () => {
  it('gates View (read) and reads the run through the caller’s session', async () => {
    h.get.mockResolvedValue(encodeHourlyCsv(series()))
    await call('kind=hourly')
    expect(h.gate).toHaveBeenCalledWith(h.user.current, P, 'view')
  })
  it('hourly → the decompressed 8760 CSV as an attachment', async () => {
    h.get.mockResolvedValue(encodeHourlyCsv(series()))
    const res = await call('kind=hourly')
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="solar-run-33333333-hourly\.csv"/)
    expect((await res.text()).split('\n')).toHaveLength(8762)
  })
  it('monthly → CSV from the stored outputs (no recomputation)', async () => {
    const res = await call('kind=monthly')
    expect((await res.text()).split('\n')[1]).toBe('1,1.000,2.000,2.000,1.000,0.000,3.000,2.000,,,,,,')
    expect(h.get).not.toHaveBeenCalled()
  })
  it('slice → JSON rows for up to 31 whole days; refuses more', async () => {
    h.get.mockResolvedValue(encodeHourlyCsv(series()))
    const ok = await call('kind=slice&from=0&to=1')
    expect((await ok.json()).rows).toHaveLength(48)
    expect((await call('kind=slice&from=0&to=40')).status).toBe(400)
  })
  it('unknown / unfinished run → 404', async () => {
    h.user.current = fakeSupabase({ tables: { 'solar.case_runs': [{ ...run, status: 'running' }] } }).client
    expect((await call('kind=hourly')).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`run/route.ts`:
```ts
/**
 * POST /api/projects/[id]/solar/cases/[caseId]/run — functional spec §7.2 Run.
 * Gate: Solar Edit (requireSolarLevelAPI; app/api/* is outside (admin)/layout.tsx). Rate: 10/min/user.
 * The run executes synchronously; a run past maxDuration is closed as timed out by the next run.
 */
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { executeCaseRun } from '@/lib/solar/cases/run-case'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'

export const runtime = 'nodejs'
export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params
  if (!UUID.test(id) || !UUID.test(caseId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase as never, id, 'edit')
  if (!gate.ok) return gate.response
  if (!rateLimit(`solar-run:${gate.userId}`, 10, 60_000)) return NextResponse.json({ error: 'Too many runs — wait a minute and try again.' }, { status: 429 })

  const out = await executeCaseRun({ user: supabase as never, svc: createServiceClient() as never, projectId: id, caseId, userId: gate.userId })
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.runId ? { runId: out.runId } : {}) }, { status: out.status })
  await recordSolarAudit({ projectId: id, actorId: gate.userId, verb: 'case_run', objectRef: { caseId, runId: out.runId } })
  await emitProductEvent({ actorId: gate.userId, projectId: id, event: 'solar_case_run' })
  revalidatePath(`/projects/${id}/solar`, 'layout')
  return NextResponse.json({ runId: out.runId, status: out.status })
}
```
Note: the failure test expects `{ error }` only (no runId) because its mock returns no runId.

`cancel/route.ts`:
```ts
/**
 * POST /api/projects/[id]/solar/cases/[caseId]/cancel — spec §7.2 Cancel (while running). Case-level:
 * at most one run per case can be running (00215 case_runs_one_running). Gate: Solar Edit.
 * Service client: only it may UPDATE a run, and the freeze trigger allows only running → terminal.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { recordSolarAudit } from '@/lib/solar/audit'

export const runtime = 'nodejs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params
  if (!UUID.test(id) || !UUID.test(caseId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const gate = await requireSolarLevelAPI((await createClient()) as never, id, 'edit')
  if (!gate.ok) return gate.response
  const svc = createServiceClient() as unknown as { schema: (s: string) => { from: (t: string) => any } } // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = await svc.schema('solar').from('case_runs').update({ status: 'cancelled' })
    .eq('case_id', caseId).eq('project_id', id).eq('status', 'running').select('id')
  if (error) return NextResponse.json({ error: 'The run could not be cancelled — try again.' }, { status: 500 })
  if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ error: 'This run has already finished.' }, { status: 409 })
  const runId = data[0].id as string
  await recordSolarAudit({ projectId: id, actorId: gate.userId, verb: 'case_run_cancelled', objectRef: { caseId, runId } })
  return NextResponse.json({ status: 'cancelled', runId })
}
```

`export/route.ts`:
```ts
/**
 * GET …/runs/[runId]/export?kind=hourly|monthly|slice&from=&to=
 * Gate: Solar View. The run row is read through the CALLER's session (00215 case_runs_select), so a
 * caller who cannot see the run gets 404; the file is then read with the service client (the bucket
 * has no user policy). Everything served is the stored result — nothing is recomputed.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { getGzipText, RUNS_BUCKET } from '@/lib/solar/cases/storage'
import { decodeHourlyCsv, monthlyCsv, sliceHourlyDays, type CaseRunOutputs } from '@esite/shared/solar-cases'

export const runtime = 'nodejs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const csv = (text: string, name: string) => new Response(text, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' } })

export async function GET(req: Request, { params }: { params: Promise<{ id: string; caseId: string; runId: string }> }) {
  const { id, caseId, runId } = await params
  if (![id, caseId, runId].every((v) => UUID.test(v))) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase as never, id, 'view')
  if (!gate.ok) return gate.response
  const { data: run } = await (supabase as never as { schema: (s: string) => { from: (t: string) => any } }) // eslint-disable-line @typescript-eslint/no-explicit-any
    .schema('solar').from('case_runs').select('id, case_id, project_id, status, hourly_path, outputs')
    .eq('id', runId).eq('case_id', caseId).eq('project_id', id).maybeSingle()
  if (!run || run.status !== 'succeeded') return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const stem = `solar-run-${runId.slice(0, 8)}`
  if (kind === 'monthly') return csv(monthlyCsv(run.outputs as CaseRunOutputs), `${stem}-monthly.csv`)
  if (kind !== 'hourly' && kind !== 'slice') return NextResponse.json({ error: 'kind must be hourly, monthly or slice' }, { status: 400 })
  const text = await getGzipText(createServiceClient() as never, RUNS_BUCKET, run.hourly_path as string)
  if (kind === 'hourly') return csv(text, `${stem}-hourly.csv`)
  const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'))
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 364 || to < from || to - from > 30) {
    return NextResponse.json({ error: 'from/to must be whole days 0–364, at most 31 days' }, { status: 400 })
  }
  return NextResponse.json({ rows: sliceHourlyDays(decodeHourlyCsv(text), from, to) }, { headers: { 'cache-control': 'private, max-age=300' } })
}
```

- [ ] **Step 3: Run the three route tests — PASS; commit** ("feat(solar): run, cancel and export routes").

---

### Task 20: Case actions — create / duplicate / rename / delete / select / save / fetch weather

**Files:**
- Create: `apps/web/src/actions/solar-cases.actions.ts`
- Test: `apps/web/src/actions/solar-cases.actions.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), svc: { current: null as unknown }, requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}),
  emit: vi.fn(async () => {}), revalidate: vi.fn(), weather: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: () => h.svc.current }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/cases/weather', () => ({ getOrFetchWeather: h.weather }))
import {
  createSolarCaseAction, duplicateSolarCaseAction, renameSolarCaseAction, deleteSolarCaseAction,
  setSelectedSolarCaseAction, saveSolarCaseAction, fetchSolarWeatherAction,
} from './solar-cases.actions'

const P = 'p1', S = 's1', ORG = 'o1', U = 'u1', C = 'c1'
const STALE = 'Someone else changed this — reload to see their version.'
const cfg = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
const study = { id: S, project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05, updated_at: 'T0' }
const MOD = '11111111-1111-4111-8111-111111111111'

function setup(user: Partial<FakeOptions> = {}, svc: Partial<FakeOptions> = {}) {
  const u = fakeSupabase({ userId: U, ...user, tables: { 'solar.studies': [study], ...(user.tables ?? {}) } })
  const s = fakeSupabase({ ...svc, tables: { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: { soiling_pct: 3 } } }], ...(svc.tables ?? {}) } })
  h.createClient.mockResolvedValue(u.client); h.svc.current = s.client
  return { u, s }
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('createSolarCaseAction', () => {
  it('re-checks Edit and snapshots the ORG defaults (read with the service client — org_settings is admin-only)', async () => {
    const { u } = setup({ writes: { 'solar.cases:insert': { data: [{ id: C, updated_at: 'T1' }] } } })
    const r = await createSolarCaseAction({ projectId: P, name: ' Base ', start: { kind: 'manual', dcKwp: 500, acKw: 400 } })
    expect(r).toEqual({ ok: true, caseId: C })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', u.client)
    const ins = callsTo(u.calls, 'solar.cases', 'insert')[0]!.payload as { study_id: string; name: string; pv_source: string; config: typeof cfg }
    expect(ins).toMatchObject({ study_id: S, name: 'Base', pv_source: 'manual' })
    expect(ins.config.losses.soilingPct).toBe(3)
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'case_created', objectRef: { caseId: C } })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_case_created' })
  })
  it('From layout is refused until the Layout tab ships', async () => {
    setup()
    await expect(createSolarCaseAction({ projectId: P, name: 'L', start: { kind: 'layout', layoutId: 'x' } })).resolves.toEqual({ error: 'From layout arrives with the Layout tab — use Manual for now.' })
  })
  it('blank name, bad size, duplicate name, no study → sentences', async () => {
    setup()
    expect(await createSolarCaseAction({ projectId: P, name: '  ', start: { kind: 'manual', dcKwp: 1, acKw: 1 } })).toEqual({ fieldErrors: { name: 'Enter a name' } })
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 0, acKw: 1 } })).toEqual({ fieldErrors: { dcKwp: 'DC size must be greater than 0 kWp' } })
    setup({ writes: { 'solar.cases:insert': { error: { code: '23505', message: 'dup' } } } })
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 1, acKw: 1 } })).toEqual({ fieldErrors: { name: 'A case with this name already exists' } })
    setup({ tables: { 'solar.studies': [] } })
    h.createClient.mockResolvedValue(fakeSupabase({ userId: U }).client)
    expect(await createSolarCaseAction({ projectId: P, name: 'A', start: { kind: 'manual', dcKwp: 1, acKw: 1 } })).toEqual({ error: 'Save Site & Supply first.' })
  })
})

describe('duplicateSolarCaseAction', () => {
  it('copies the config under the first free "(copy)" name; copies financials only if the caller can read them', async () => {
    const { u } = setup({
      tables: { 'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', config: cfg }, { id: 'c2', study_id: S, project_id: P, name: 'Base (copy)', config: cfg }], 'solar.case_financials': [] },
      writes: { 'solar.cases:insert': { data: [{ id: 'c3', updated_at: 'T1' }] } },
    })
    const r = await duplicateSolarCaseAction({ projectId: P, caseId: C })
    expect(r).toEqual({ ok: true, caseId: 'c3' })
    expect((callsTo(u.calls, 'solar.cases', 'insert')[0]!.payload as { name: string }).name).toBe('Base (copy 2)')
    expect(callsTo(u.calls, 'solar.case_financials', 'insert')).toHaveLength(0)
  })
})

describe('rename / delete / select', () => {
  it('rename is stale-guarded', async () => {
    const { u } = setup({ writes: { 'solar.cases:update': { data: [] } } })
    expect(await renameSolarCaseAction({ projectId: P, caseId: C, name: 'New', expectedUpdatedAt: 'T0' })).toEqual({ error: STALE })
    expect(callsTo(u.calls, 'solar.cases', 'update')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'id', C], ['eq', 'project_id', P], ['eq', 'updated_at', 'T0']]))
  })
  it('deleting the selected case is a sentence (FK 23503)', async () => {
    setup({ writes: { 'solar.cases:delete': { error: { code: '23503', message: 'fk' } } } })
    expect(await deleteSolarCaseAction({ projectId: P, caseId: C })).toEqual({ error: 'This is the selected case — choose another selected case first.' })
  })
  it('delete succeeds and is audited', async () => {
    setup({ writes: { 'solar.cases:delete': { data: [{ id: C }] } } })
    expect(await deleteSolarCaseAction({ projectId: P, caseId: C })).toEqual({ ok: true })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: U, verb: 'case_deleted', objectRef: { caseId: C } })
  })
  it('select: only a case with a completed run (23514) and stale-guarded on the study', async () => {
    setup({ writes: { 'solar.studies:update': { error: { code: '23514', message: 'x' } } } })
    expect(await setSelectedSolarCaseAction({ projectId: P, caseId: C, expectedUpdatedAt: 'T0' })).toEqual({ error: 'Only a case with a completed run can be selected.' })
    setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T9' }] } } })
    expect(await setSelectedSolarCaseAction({ projectId: P, caseId: C, expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T9' })
  })
})

describe('saveSolarCaseAction', () => {
  it('validates, re-derives equipment snapshots from the catalogue (client values are not trusted), stale-guards', async () => {
    const forged = { ...cfg, pv: { ...cfg.pv, module: { equipmentId: MOD, make: 'X', model: 'Y', pmaxW: 999, gammaPmaxPctPerC: 0 } } }
    const { u } = setup(
      { writes: { 'solar.cases:update': { data: [{ updated_at: 'T2' }] } } },
      { tables: { 'solar.equipment': [{ id: MOD, organisation_id: null, kind: 'module', make: 'Generic', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 } }] } },
    )
    const r = await saveSolarCaseAction({ projectId: P, caseId: C, config: forged, expectedUpdatedAt: 'T1' })
    expect(r).toEqual({ ok: true, updatedAt: 'T2' })
    const saved = (callsTo(u.calls, 'solar.cases', 'update')[0]!.payload as { config: typeof cfg }).config
    expect(saved.pv.module).toEqual({ equipmentId: MOD, make: 'Generic', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 })
  })
  it('unknown equipment id → field error; invalid config → field errors; nothing written', async () => {
    const { u } = setup()
    const r1 = await saveSolarCaseAction({ projectId: P, caseId: C, config: { ...cfg, pv: { ...cfg.pv, module: { equipmentId: MOD, make: 'X', model: 'Y', pmaxW: 1, gammaPmaxPctPerC: 0 } } }, expectedUpdatedAt: 'T1' })
    expect(r1).toEqual({ fieldErrors: { 'pv.module': 'Pick the module again — it is not in your catalogue' } })
    const r2 = await saveSolarCaseAction({ projectId: P, caseId: C, config: { ...cfg, pv: { ...cfg.pv, dcKwp: -1 } }, expectedUpdatedAt: 'T1' })
    expect('fieldErrors' in r2 && Object.keys(r2.fieldErrors)).toContain('pv.dcKwp')
    expect(callsTo(u.calls, 'solar.cases', 'update')).toHaveLength(0)
  })
})

describe('fetchSolarWeatherAction', () => {
  it('needs Edit and coordinates; passes the study org to the per-org cache', async () => {
    setup()
    h.weather.mockResolvedValue({ ok: true, cached: false, dataset: { id: 'w1', fetched_at: 'T', radiation_db: 'PVGIS-SARAH2', lat_round: -26.2, lng_round: 28.05, gsa_pvout_kwh_per_kwp: 1700 } })
    const r = await fetchSolarWeatherAction({ projectId: P })
    expect(r).toEqual({ ok: true, dataset: { id: 'w1', fetchedAt: 'T', radiationDb: 'PVGIS-SARAH2', latRound: -26.2, lngRound: 28.05, gsaPvoutKwhPerKwp: 1700, cached: false } })
    expect(h.weather).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, lat: -26.2, lng: 28.05, userId: U }))
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_weather_fetched' })
  })
  it('no coordinates → sentence, no fetch', async () => {
    setup({ tables: { 'solar.studies': [{ ...study, latitude: null }] } })
    expect(await fetchSolarWeatherAction({ projectId: P })).toEqual({ error: 'Set the site coordinates on Site & Supply first.' })
    expect(h.weather).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `solar-cases.actions.ts`:

```ts
'use server'
/**
 * Yield & Scenarios case actions (functional spec §7.1–7.2). Each re-checks the Solar level itself and
 * writes through the caller's session (00215 RLS + bind triggers decide). The service client is used
 * only to read org_settings (owner/admin-only by RLS, but every Edit user's new case needs the org
 * defaults), the equipment catalogue for snapshots, and the weather cache.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings } from '@esite/shared'
import { defaultCaseConfig, parseCaseConfig, moduleSnapshot, inverterSnapshot, batterySnapshot, type CaseConfig } from '@esite/shared/solar-cases'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { getOrFetchWeather } from '@/lib/solar/cases/weather'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export type CaseStart = { kind: 'manual'; dcKwp: number; acKw: number } | { kind: 'copy'; fromCaseId: string } | { kind: 'layout'; layoutId: string }
export type CaseActionResult = { ok: true; caseId: string } | { error: string } | { fieldErrors: Record<string, string> }

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}
const done = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

async function studyOf(supabase: AnyClient, projectId: string): Promise<Row | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id, organisation_id, latitude, longitude, updated_at').eq('project_id', projectId).maybeSingle()
  return (data as Row | null) ?? null
}

async function insertCase(supabase: AnyClient, studyId: string, name: string, config: CaseConfig): Promise<{ id: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { data, error } = await supabase.schema('solar').from('cases').insert({ study_id: studyId, name, pv_source: 'manual', config }).select('id, updated_at')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A case with this name already exists' } } : { error: humanSolarError(error) }
  return { id: (Array.isArray(data) ? data[0]?.id : (data as Row | null)?.id) as string }
}

export async function createSolarCaseAction(input: { projectId: string; name: string; start: CaseStart }): Promise<CaseActionResult> {
  const { projectId } = input
  const { supabase, userId } = await session(projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = String(input.name ?? '').trim()
  if (!name) return { fieldErrors: { name: 'Enter a name' } }
  if (name.length > 120) return { fieldErrors: { name: 'Keep the name under 120 characters' } }
  const start = input.start
  if (!start || typeof start !== 'object') return { error: 'Choose how to start the case.' }
  if (start.kind === 'layout') return { error: 'From layout arrives with the Layout tab — use Manual for now.' }
  const study = await studyOf(supabase, projectId)
  if (!study) return { error: 'Save Site & Supply first.' }

  let config: CaseConfig
  if (start.kind === 'manual') {
    if (!(Number(start.dcKwp) > 0)) return { fieldErrors: { dcKwp: 'DC size must be greater than 0 kWp' } }
    if (!(Number(start.acKw) > 0)) return { fieldErrors: { acKw: 'AC size must be greater than 0 kW' } }
    const svc = createServiceClient() as unknown as AnyClient
    const { data: os } = await svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', study.organisation_id as string).maybeSingle()
    config = defaultCaseConfig(readSolarOrgSettings((os as Row | null)?.settings ?? null), { dcKwp: Number(start.dcKwp), acKw: Number(start.acKw) })
  } else {
    const { data: src } = await supabase.schema('solar').from('cases').select('config').eq('id', start.fromCaseId).eq('project_id', projectId).maybeSingle()
    const parsed = parseCaseConfig((src as Row | null)?.config)
    if (!parsed.ok) return { error: 'The case to copy could not be read.' }
    config = parsed.config
  }
  const ins = await insertCase(supabase, study.id as string, name, config)
  if (!('id' in ins)) return ins
  if (start.kind === 'copy') {
    // Financials copy only when the caller can READ them (RLS: solar_can_see_money); otherwise nothing.
    const { data: fin } = await supabase.schema('solar').from('case_financials').select('config').eq('case_id', start.fromCaseId)
    const row = Array.isArray(fin) ? (fin[0] as Row | undefined) : undefined
    if (row) await supabase.schema('solar').from('case_financials').insert({ case_id: ins.id, config: row.config })
  }
  await recordSolarAudit({ projectId, actorId: userId, verb: 'case_created', objectRef: { caseId: ins.id } })
  await emitProductEvent({ actorId: userId, projectId, event: 'solar_case_created' })
  done(projectId)
  return { ok: true, caseId: ins.id }
}

export async function duplicateSolarCaseAction(input: { projectId: string; caseId: string }): Promise<CaseActionResult> {
  const { supabase } = await session(input.projectId)
  const { data: src } = await supabase.schema('solar').from('cases').select('name, study_id').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  if (!src) return { error: 'Case not found.' }
  const { data: all } = await supabase.schema('solar').from('cases').select('name').eq('study_id', (src as Row).study_id as string)
  const taken = new Set(((all ?? []) as Row[]).map((r) => String(r.name).trim().toLowerCase()))
  const base = `${String((src as Row).name)} (copy`
  let name = `${base})`
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i})`
  return createSolarCaseAction({ projectId: input.projectId, name, start: { kind: 'copy', fromCaseId: input.caseId } })
}

export async function renameSolarCaseAction(input: { projectId: string; caseId: string; name: string; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase, userId } = await session(input.projectId)
  const name = String(input.name ?? '').trim()
  if (!name) return { fieldErrors: { name: 'Enter a name' } }
  const { data, error } = await supabase.schema('solar').from('cases').update({ name })
    .eq('id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A case with this name already exists' } } : { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_renamed', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

export async function deleteSolarCaseAction(input: { projectId: string; caseId: string }): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  // Proposals (Phase 6) will add "referenced by an issued proposal" here and as a DB guard.
  const { data, error } = await supabase.schema('solar').from('cases').delete().eq('id', input.caseId).eq('project_id', input.projectId).select('id')
  if (error) return { error: error.code === '23503' ? 'This is the selected case — choose another selected case first.' : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was deleted — reload to see the current cases.' }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_deleted', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true }
}

export async function setSelectedSolarCaseAction(input: { projectId: string; caseId: string | null; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  const { data, error } = await supabase.schema('solar').from('studies').update({ selected_case_id: input.caseId })
    .eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23514' ? 'Only a case with a completed run can be selected.' : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_selected', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

export async function saveSolarCaseAction(input: { projectId: string; caseId: string; config: unknown; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase, userId } = await session(input.projectId)
  const parsed = parseCaseConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  let config = parsed.config
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Save Site & Supply first.' }
  const svc = createServiceClient() as unknown as AnyClient
  const org = study.organisation_id as string

  // Snapshots are re-derived from the catalogue: a client cannot submit its own temperature coefficient.
  const ids = [config.pv.module?.equipmentId, config.pv.inverter?.equipmentId, config.battery.unit?.equipmentId].filter((v): v is string => Boolean(v))
  if (ids.length > 0) {
    const { data: rows } = await svc.schema('solar').from('equipment').select('id, organisation_id, kind, make, model, specs').in('id', ids)
    const usable = new Map(((rows ?? []) as Row[]).filter((r) => r.organisation_id === null || r.organisation_id === org).map((r) => [r.id as string, r]))
    const pick = (id: string | undefined, kind: string) => (id ? usable.get(id) : undefined)?.kind === kind ? usable.get(id!) : undefined
    if (config.pv.module) {
      const r = pick(config.pv.module.equipmentId, 'module')
      if (!r) return { fieldErrors: { 'pv.module': 'Pick the module again — it is not in your catalogue' } }
      config = { ...config, pv: { ...config.pv, module: moduleSnapshot(r as never) } }
    }
    if (config.pv.inverter) {
      const r = pick(config.pv.inverter.equipmentId, 'inverter')
      if (!r) return { fieldErrors: { 'pv.inverter': 'Pick the inverter again — it is not in your catalogue' } }
      config = { ...config, pv: { ...config.pv, inverter: inverterSnapshot(r as never) } }
    }
    if (config.battery.unit) {
      const r = pick(config.battery.unit.equipmentId, 'battery')
      if (!r) return { fieldErrors: { 'battery.unit': 'Pick the battery again — it is not in your catalogue' } }
      config = { ...config, battery: { ...config.battery, unit: batterySnapshot(r as never) } }
    }
  }
  if (config.weather.datasetId) {
    const { data: w } = await svc.schema('solar').from('weather_datasets').select('id').eq('id', config.weather.datasetId).eq('organisation_id', org).maybeSingle()
    if (!w) return { fieldErrors: { 'weather.datasetId': 'Fetch the weather again — that dataset is not available' } }
  }
  const { data, error } = await supabase.schema('solar').from('cases').update({ config, config_version: config.version })
    .eq('id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_saved', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

export interface WeatherDatasetView { id: string; fetchedAt: string; radiationDb: string | null; latRound: number; lngRound: number; gsaPvoutKwhPerKwp: number | null; cached: boolean }

export async function fetchSolarWeatherAction(input: { projectId: string }): Promise<{ ok: true; dataset: WeatherDatasetView } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study || study.latitude === null || study.longitude === null || study.latitude === undefined) return { error: 'Set the site coordinates on Site & Supply first.' }
  const r = await getOrFetchWeather({ svc: createServiceClient() as never, orgId: study.organisation_id as string, lat: Number(study.latitude), lng: Number(study.longitude), userId })
  if (!r.ok) return { error: r.error }
  const d = r.dataset
  if (!r.cached) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'weather_fetched', objectRef: { datasetId: d.id } })
    await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_weather_fetched' })
  }
  return { ok: true, dataset: {
    id: d.id, fetchedAt: String(d.fetched_at ?? ''), radiationDb: (d.radiation_db ?? null) as string | null,
    latRound: Number(d.lat_round), lngRound: Number(d.lng_round),
    gsaPvoutKwhPerKwp: d.gsa_pvout_kwh_per_kwp === null || d.gsa_pvout_kwh_per_kwp === undefined ? null : Number(d.gsa_pvout_kwh_per_kwp),
    cached: r.cached,
  } }
}
```
`fakeSupabase` supports `.in(...)`; the equipment lookup above uses it.

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): case, selection and weather actions").

---

### Task 21: Financials — save, apply rate card, run from stored energy; XLSX

**Files:**
- Create: `apps/web/src/lib/solar/cases/financials.ts` (+ `financials.test.ts`)
- Create: `apps/web/src/lib/solar/cases/xlsx.ts` (+ `xlsx.test.ts`)
- Create: `apps/web/src/actions/solar-financials.actions.ts` (+ `solar-financials.actions.test.ts`)
- Create: `apps/web/src/app/api/projects/[id]/solar/cases/[caseId]/financials/xlsx/route.ts` (+ `route.test.ts`)

- [ ] **Step 1: Failing test** `financials.test.ts` (stored hourly CSV + a stub tariff; no network, no re-simulation):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { defaultCaseConfig, defaultFinanceConfig, encodeHourlyCsv } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import { ENGINE_VERSION } from '@esite/shared/solar-engine'

const h = vi.hoisted(() => ({ tariff: vi.fn(), get: vi.fn() }))
vi.mock('./tariff', () => ({ resolveStudyTariff: h.tariff }))
vi.mock('./storage', async (o) => ({ ...(await o<typeof import('./storage')>()), getGzipText: h.get }))
import { executeFinancialsRun, FIN_RUN_REASONS } from './financials'

const P = 'p1', C = 'c1', R = 'r1'
const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 100, acKw: 80 })
const fin = { ...defaultFinanceConfig(s), capex: [{ id: 'a', category: 'modules', description: 'PV', qty: 100_000, unit: 'Wp', rateZar: 12, qualifies12b: true, source: 'manual' }] }
const hourly = () => { const z = (v: number) => new Float64Array(8760).fill(v); return { load: z(50), pvAc: z(15), selfUse: z(15), import: z(35), export: z(0), curtail: z(0), soc: z(0), importPvOnly: z(35), exportPvOnly: z(0) } }
const run = { id: R, case_id: C, status: 'succeeded', hourly_path: 'o/p/c/r.csv.gz', config_snapshot: cfg, started_at: '2026-09-28T10:00:00Z',
  outputs: { kpis: { dcKwp: 100, acKw: 80, annualAcKwh: 131_400, deliveredKwh: 131_400 } } }
const calc = { monthlyBills: (f: { importKwh: Float64Array }) => Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalZar: f.importKwh.reduce((a, v) => a + v, 0) * 2 / 12, exportCreditUsedZar: 0 })) }

beforeEach(() => {
  vi.clearAllMocks()
  h.get.mockResolvedValue(encodeHourlyCsv(hourly()))
  h.tariff.mockResolvedValue({ ok: true, calc, tariffRef: { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' } })
})

describe('executeFinancialsRun', () => {
  it('prices the latest succeeded run’s stored series and records an immutable result through the caller’s session', async () => {
    const user = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [{ case_id: C, config: fin }] }, writes: { 'solar.case_run_financials:insert': { data: [{ id: 'f1' }] } } })
    const out = await executeFinancialsRun({ user: user.client as never, svc: {} as never, projectId: P, caseId: C })
    expect(out).toEqual({ ok: true, id: 'f1' })
    const ins = callsTo(user.calls, 'solar.case_run_financials', 'insert')[0]!.payload as Record<string, any>
    expect(ins).toMatchObject({ case_run_id: R, engine_version: ENGINE_VERSION, tariff_ref: { tariffId: 't1' } })
    expect(ins.fin_inputs_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(ins.results.year1Bills.beforeZar).toBeCloseTo(50 * 8760 * 2, 3)
    expect(ins.results.year1Bills.afterZar).toBeCloseTo(35 * 8760 * 2, 3)
    expect(ins.results.capex.exclVatZar).toBe(1_200_000)
    expect(ins.results.finance.models[0].model).toBe('cash')
  })
  it('no succeeded run / no saved financials / no tariff → the named sentence (422)', async () => {
    const empty = fakeSupabase({ tables: { 'solar.case_runs': [], 'solar.case_financials': [] } }).client as never
    await expect(executeFinancialsRun({ user: empty, svc: {} as never, projectId: P, caseId: C })).resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.noRun })
    const noFin = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [] } }).client as never
    await expect(executeFinancialsRun({ user: noFin, svc: {} as never, projectId: P, caseId: C })).resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.noFinancials })
    h.tariff.mockResolvedValueOnce({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    const ok = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [{ case_id: C, config: fin }] } }).client as never
    await expect(executeFinancialsRun({ user: ok, svc: {} as never, projectId: P, caseId: C })).resolves.toEqual({ ok: false, status: 422, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `financials.ts`:

```ts
import 'server-only'
/**
 * Run financials (functional spec §8): pure computation on the STORED run — the latest succeeded run's
 * hourly CSV and KPIs, the case config snapshot the run used, the saved financials and the study's
 * tariff. Writes one immutable solar.case_run_financials row through the caller's session (money RLS).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, inputsHash } from '@esite/shared/solar-engine'
import { buildFinanceInput, capexTotals, decodeHourlyCsv, parseCaseConfig, parseFinanceConfig, runStoredFinancials, type CaseRunOutputs } from '@esite/shared/solar-cases'
import { humanSolarError } from '@/lib/solar/errors'
import { resolveStudyTariff } from './tariff'
import { getGzipText, RUNS_BUCKET } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export const FIN_RUN_REASONS = {
  noRun: 'Run the case on Yield & Scenarios first.',
  noFinancials: 'Save the financials first.',
  badFinancials: 'The saved financials are invalid — review each section and save again.',
  badRun: 'The run’s stored configuration could not be read — re-run the case.',
} as const

export type FinRunOutcome = { ok: true; id: string } | { ok: false; status: number; error: string }

export async function latestSucceededRun(user: AnyClient, caseId: string): Promise<Row | null> {
  const { data } = await user.schema('solar').from('case_runs').select('id, case_id, status, hourly_path, config_snapshot, outputs, started_at')
    .eq('case_id', caseId).eq('status', 'succeeded').order('started_at', { ascending: false }).limit(1)
  return (Array.isArray(data) ? (data[0] as Row | undefined) : undefined) ?? null
}

/** The hash that makes a stored financial result current: finance input + tariff + the run it priced. */
export const finInputsHash = (input: unknown, tariffRef: unknown, runId: string) => inputsHash({ input, tariffRef, runId })

export async function executeFinancialsRun(a: { user: AnyClient; svc: AnyClient; projectId: string; caseId: string }): Promise<FinRunOutcome> {
  const run = await latestSucceededRun(a.user, a.caseId)
  if (!run) return { ok: false, status: 422, error: FIN_RUN_REASONS.noRun }
  const { data: finRows } = await a.user.schema('solar').from('case_financials').select('config').eq('case_id', a.caseId)
  const finRow = Array.isArray(finRows) ? (finRows[0] as Row | undefined) : undefined
  if (!finRow) return { ok: false, status: 422, error: FIN_RUN_REASONS.noFinancials }
  const fin = parseFinanceConfig(finRow.config)
  if (!fin.ok) return { ok: false, status: 422, error: FIN_RUN_REASONS.badFinancials }
  const cfg = parseCaseConfig(run.config_snapshot)
  if (!cfg.ok) return { ok: false, status: 422, error: FIN_RUN_REASONS.badRun }
  const kpis = (run.outputs as CaseRunOutputs).kpis
  const built = buildFinanceInput(fin.fin, cfg.config, { dcKwp: kpis.dcKwp, acKw: kpis.acKw })
  if (!built.ok) return { ok: false, status: 422, error: built.reasons.join(' ') }
  const tariff = await resolveStudyTariff(a.svc, a.projectId)
  if (!tariff.ok) return { ok: false, status: 422, error: tariff.reason }

  try {
    const hourly = decodeHourlyCsv(await getGzipText(a.svc, RUNS_BUCKET, run.hourly_path as string))
    const result = runStoredFinancials({ hourly, year1PvKwh: kpis.annualAcKwh, year1DeliveredKwh: kpis.deliveredKwh }, built.input, tariff.calc)
    const results = { version: 1, capex: capexTotals(fin.fin.capex, kpis.dcKwp), ...result }
    const { data, error } = await a.user.schema('solar').from('case_run_financials').insert({
      case_run_id: run.id, engine_version: ENGINE_VERSION, fin_inputs: { finance: built.input, config: fin.fin },
      fin_inputs_hash: finInputsHash(built.input, tariff.tariffRef, run.id as string), tariff_ref: tariff.tariffRef, results,
    }).select('id')
    if (error) return { ok: false, status: error.code === '42501' ? 403 : 500, error: error.code === '42501' ? 'You need Edit + financials access to run financials.' : humanSolarError(error) }
    return { ok: true, id: (Array.isArray(data) ? data[0]?.id : (data as Row | null)?.id) as string }
  } catch (e) {
    console.error('[solar-financials] failed', { caseId: a.caseId, runId: run.id, err: String(e) })
    return { ok: false, status: 500, error: `Financials could not be computed: ${e instanceof Error ? e.message : 'unexpected error'}` }
  }
}
```

- [ ] **Step 3: Failing test** `xlsx.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildFinancialsWorkbook } from './xlsx'

const row = {
  created_at: '2026-09-28T10:00:00Z', engine_version: '0.1.0',
  tariff_ref: { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' },
  fin_inputs: { config: { analysis: { years: 2, discountRatePct: 11 }, opex: { insurancePctOfCapex: 0.5 } }, finance: {} },
  results: {
    capex: { exclVatZar: 1_000_000, vatZar: 150_000, inclVatZar: 1_150_000, zarPerWp: 10, byCategory: { modules: 1_000_000 } },
    year1Bills: { beforeZar: 900_000, afterZar: 700_000, afterPvOnlyZar: 700_000, exportCreditUsedZar: 0 },
    finance: { lcoeZarPerKwh: 0.9, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_000_000, npvZar: 123_456.78, irr: 0.18, simplePaybackYears: 5.1, discountedPaybackYears: 7.2,
      rows: [{ year: 1, energyKwh: 100, billBeforeZar: 900, billAfterZar: 700, savingZar: 200, opexZar: 10, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 190, cumulativeZar: -999_810 }] }] }] },
    tornado: { model: 'cash', view: 'owner', baseNpvZar: 123_456.78, swing: 0.2, bars: [{ variable: 'capex', lowNpvZar: 300_000, highNpvZar: -50_000, spreadZar: 350_000 }] },
  },
}

describe('buildFinancialsWorkbook', () => {
  it('has every assumption, the capex, one cashflow sheet per model/view, and the tornado', async () => {
    const buf = await buildFinancialsWorkbook({ projectName: 'KINGSWALK', caseName: 'Base', row, capexLines: [{ category: 'modules', description: 'PV', qty: 100_000, unit: 'Wp', rateZar: 10 }] })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Assumptions', 'Capex', 'Cash - owner', 'Sensitivity'])
    const a = wb.getWorksheet('Assumptions')!
    const keys = a.getColumn(1).values as unknown[]
    expect(keys).toEqual(expect.arrayContaining(['analysis.years', 'analysis.discountRatePct', 'opex.insurancePctOfCapex', 'Tariff', 'Engine version']))
    const cf = wb.getWorksheet('Cash - owner')!
    expect(cf.getRow(1).values).toEqual(expect.arrayContaining(['Year', 'Net (R)', 'Cumulative (R)']))
    expect(cf.getCell('B2').value).toBe(1)
    expect(wb.getWorksheet('Sensitivity')!.getCell('A2').value).toBe('Capex')
  })
})
```

- [ ] **Step 4: Implement** `xlsx.ts`:

```ts
import 'server-only'
/** Download XLSX (functional spec §8): every assumption + the year table per finance model/view, from the STORED result. */
import ExcelJS from 'exceljs'

type Json = Record<string, unknown>
const MODEL_LABEL: Record<string, string> = { cash: 'Cash', debt: 'Debt', ppa: 'PPA', lease: 'Lease' }
const TORNADO_LABEL: Record<string, string> = { capex: 'Capex', tariffEscalation: 'Tariff escalation', yield: 'Yield', discountRate: 'Discount rate', exportRate: 'Export rate' }

function flatten(o: unknown, prefix = ''): Array<[string, string | number | boolean | null]> {
  if (o === null || typeof o !== 'object') return [[prefix, o as string | number | boolean | null]]
  if (Array.isArray(o)) return [[prefix, JSON.stringify(o)]]
  return Object.entries(o as Json).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
}

export async function buildFinancialsWorkbook(a: {
  projectName: string; caseName: string
  row: { created_at: string; engine_version: string; tariff_ref: Json; fin_inputs: Json; results: Json }
  capexLines: Array<{ category: string; description: string; qty: number; unit: string; rateZar: number }>
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site Solar'
  const r = a.row.results as any // eslint-disable-line @typescript-eslint/no-explicit-any

  const as = wb.addWorksheet('Assumptions')
  as.columns = [{ header: 'Assumption', key: 'k', width: 42 }, { header: 'Value', key: 'v', width: 28 }]
  as.addRow({ k: 'Project', v: a.projectName })
  as.addRow({ k: 'Case', v: a.caseName })
  as.addRow({ k: 'Computed at', v: a.row.created_at })
  as.addRow({ k: 'Engine version', v: a.row.engine_version })
  const t = a.row.tariff_ref as { tariffName?: string; financialYear?: string; licenseeName?: string }
  as.addRow({ k: 'Tariff', v: `${t.licenseeName ?? ''} — ${t.tariffName ?? ''} (${t.financialYear ?? ''})` })
  as.addRow({ k: 'Year-1 bill before (R excl. VAT)', v: r.year1Bills.beforeZar })
  as.addRow({ k: 'Year-1 bill after (R excl. VAT)', v: r.year1Bills.afterZar })
  as.addRow({ k: 'LCOE (R/kWh)', v: r.finance.lcoeZarPerKwh })
  for (const [k, v] of flatten((a.row.fin_inputs as Json).config)) as.addRow({ k, v })

  const cx = wb.addWorksheet('Capex')
  cx.columns = [{ header: 'Category', key: 'c', width: 24 }, { header: 'Description', key: 'd', width: 40 }, { header: 'Qty', key: 'q', width: 12 }, { header: 'Unit', key: 'u', width: 8 }, { header: 'Rate (R)', key: 'r', width: 14 }, { header: 'Amount (R excl. VAT)', key: 'a', width: 20 }]
  for (const l of a.capexLines) cx.addRow({ c: l.category, d: l.description, q: l.qty, u: l.unit, r: l.rateZar, a: l.qty * l.rateZar })
  cx.addRow({})
  cx.addRow({ d: 'Total excl. VAT', a: r.capex.exclVatZar })
  cx.addRow({ d: 'VAT', a: r.capex.vatZar })
  cx.addRow({ d: 'Total incl. VAT', a: r.capex.inclVatZar })
  cx.addRow({ d: 'R/Wp (capex ÷ DC Wp)', a: r.capex.zarPerWp })

  for (const m of r.finance.models) {
    for (const v of m.views) {
      const ws = wb.addWorksheet(`${MODEL_LABEL[m.model] ?? m.model} - ${v.view}`.slice(0, 31))
      // Column A holds the KPI labels below the table; the year table starts in column B.
      ws.addRow([undefined, 'Year', 'Energy (kWh)', 'Bill before (R)', 'Bill after (R)', 'Saving (R)', 'Opex (R)', 'Replacements (R)', 'Tax (R)', 'Finance (R)', 'Net (R)', 'Cumulative (R)'])
      for (let c = 2; c <= 12; c++) ws.getColumn(c).width = 16
      for (const row of v.rows) ws.addRow([undefined, row.year, row.energyKwh, row.billBeforeZar, row.billAfterZar, row.savingZar, row.opexZar, row.replacementZar, row.taxZar, row.financeZar, row.netZar, row.cumulativeZar])
      ws.addRow([])
      ws.addRow([undefined, 'NPV (R)', v.npvZar])
      ws.addRow([undefined, 'IRR', v.irr])
      ws.addRow([undefined, 'Simple payback (years)', v.simplePaybackYears])
      ws.addRow([undefined, 'Discounted payback (years)', v.discountedPaybackYears])
    }
  }

  const sn = wb.addWorksheet('Sensitivity')
  sn.columns = [{ header: 'Variable (±20 %)', width: 22 }, { header: 'NPV at −20 % (R)', width: 18 }, { header: 'NPV at +20 % (R)', width: 18 }, { header: 'Spread (R)', width: 16 }]
  for (const b of r.tornado.bars) sn.addRow([TORNADO_LABEL[b.variable] ?? b.variable, b.lowNpvZar, b.highNpvZar, b.spreadZar])

  return Buffer.from(await wb.xlsx.writeBuffer())
}
```

- [ ] **Step 5: Failing test + implement** `solar-financials.actions.ts`.

Test `solar-financials.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ createClient: vi.fn(), svc: { current: null as unknown }, lvl: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), reval: vi.fn(), exec: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: () => h.svc.current }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.lvl }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.reval }))
vi.mock('@/lib/solar/cases/financials', () => ({ executeFinancialsRun: h.exec }))
import { saveSolarFinancialsAction, applySolarRateCardAction, runSolarFinancialsAction } from './solar-financials.actions'

const P = 'p1', C = 'c1', ORG = 'o1', U = 'u1'
const s = solarOrgSettingDefaults()
const fin = defaultFinanceConfig(s)
beforeEach(() => { vi.clearAllMocks(); h.lvl.mockResolvedValue('edit_financials') })
const setup = (tables: Record<string, unknown[]> = {}, writes = {}, svcTables: Record<string, unknown[]> = {}) => {
  const u = fakeSupabase({ userId: U, tables: tables as never, writes })
  h.createClient.mockResolvedValue(u.client); h.svc.current = fakeSupabase({ tables: svcTables as never }).client
  return u
}

describe('solar financials actions', () => {
  it('every action needs Edit + financials', async () => {
    setup()
    h.lvl.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: null })).rejects.toThrow('REDIRECT')
    expect(h.lvl).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
  })
  it('first save inserts, later saves are stale-guarded', async () => {
    const u = setup({}, { 'solar.case_financials:insert': { data: [{ updated_at: 'T1' }] } })
    expect(await saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: null })).toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(u.calls, 'solar.case_financials', 'insert')[0]!.payload).toEqual({ case_id: C, config: fin, config_version: 1 })
    setup({}, { 'solar.case_financials:update': { data: [] } })
    expect(await saveSolarFinancialsAction({ projectId: P, caseId: C, config: fin, expectedUpdatedAt: 'T1' })).toEqual({ error: 'Someone else changed this — reload to see their version.' })
  })
  it('invalid config → field errors', async () => {
    setup()
    const r = await saveSolarFinancialsAction({ projectId: P, caseId: C, config: { ...fin, models: { ...fin.models, cash: { enabled: false } } }, expectedUpdatedAt: null })
    expect(r).toEqual({ fieldErrors: { models: 'Choose at least one finance model' } })
  })
  it('apply rate card: org settings read with the service client; missing rates named', async () => {
    const cfg = defaultCaseConfig(s, { dcKwp: 50, acKw: 40 })
    setup({ 'solar.cases': [{ id: C, project_id: P, organisation_id: ORG, config: cfg }] }, {}, { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: {} } }] })
    expect(await applySolarRateCardAction({ projectId: P, caseId: C, config: fin })).toEqual({ error: 'Set these on Settings → Solar → Rate card first: PV system, up to 100 kWp (R/Wp).' })
    setup({ 'solar.cases': [{ id: C, project_id: P, organisation_id: ORG, config: cfg }] }, {}, { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: { rc_pv_r_per_wp_small: 12 } } }] })
    const ok = await applySolarRateCardAction({ projectId: P, caseId: C, config: fin })
    expect('ok' in ok && ok.config.capex).toEqual([expect.objectContaining({ id: 'rc-pv', qty: 50_000, rateZar: 12 })])
  })
  it('run → audit + product event on success; the lib’s sentence on failure', async () => {
    setup()
    h.exec.mockResolvedValueOnce({ ok: true, id: 'f1' })
    expect(await runSolarFinancialsAction({ projectId: P, caseId: C })).toEqual({ ok: true, id: 'f1' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: P, event: 'solar_financials_run' })
    h.exec.mockResolvedValueOnce({ ok: false, status: 422, error: 'Run the case on Yield & Scenarios first.' })
    expect(await runSolarFinancialsAction({ projectId: P, caseId: C })).toEqual({ error: 'Run the case on Yield & Scenarios first.' })
  })
})
```

Implement `solar-financials.actions.ts`:
```ts
'use server'
/** Financials tab actions (functional spec §8). Edit + financials only; money tables written through the caller's session. */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings } from '@esite/shared'
import { applyRateCard, parseCaseConfig, parseFinanceConfig, type CaseFinanceConfig } from '@esite/shared/solar-cases'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { executeFinancialsRun } from '@/lib/solar/cases/financials'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

export async function saveSolarFinancialsAction(input: { projectId: string; caseId: string; config: unknown; expectedUpdatedAt: string | null }): Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase, userId } = await session(input.projectId)
  const parsed = parseFinanceConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const t = () => supabase.schema('solar').from('case_financials')
  const res = input.expectedUpdatedAt === null
    ? await t().insert({ case_id: input.caseId, config: parsed.fin, config_version: parsed.fin.version }).select('updated_at')
    : await t().update({ config: parsed.fin, config_version: parsed.fin.version }).eq('case_id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (res.error) return { error: res.error.code === '23505' ? STALE_MESSAGE : humanSolarError(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'financials_saved', objectRef: { caseId: input.caseId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: res.data[0]!.updated_at as string }
}

/** Fills rate-card lines into the given (unsaved) config; the user reviews and presses Save. */
export async function applySolarRateCardAction(input: { projectId: string; caseId: string; config: unknown }): Promise<{ ok: true; config: CaseFinanceConfig } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase } = await session(input.projectId)
  const parsed = parseFinanceConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const { data: c } = await supabase.schema('solar').from('cases').select('config, organisation_id').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  const cfg = parseCaseConfig((c as Row | null)?.config)
  if (!c || !cfg.ok) return { error: 'Case not found.' }
  const { data: os } = await (createServiceClient() as unknown as AnyClient).schema('solar').from('org_settings').select('settings').eq('organisation_id', (c as Row).organisation_id as string).maybeSingle()
  const settings = readSolarOrgSettings((os as Row | null)?.settings ?? null)
  const b = cfg.config.battery
  const r = applyRateCard(parsed.fin, settings, { dcKwp: cfg.config.pv.dcKwp, acKw: cfg.config.pv.acKw, batteryKwh: b.enabled ? b.usableKwh : 0 })
  if (!r.ok) return { error: `Set these on Settings → Solar → Rate card first: ${r.missing.join(', ')}.` }
  return { ok: true, config: r.fin }
}

export async function runSolarFinancialsAction(input: { projectId: string; caseId: string }): Promise<{ ok: true; id: string } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  const out = await executeFinancialsRun({ user: supabase, svc: createServiceClient() as unknown as AnyClient, projectId: input.projectId, caseId: input.caseId })
  if (!out.ok) return { error: out.error }
  if (userId) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'financials_run', objectRef: { caseId: input.caseId, financialsId: out.id } })
    await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_financials_run' })
  }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id: out.id }
}
```
Note: `fakeSupabase` rows for `solar.cases` include `organisation_id` (bound by 00215's trigger in reality).

- [ ] **Step 6: XLSX route** `…/financials/xlsx/route.ts` + test.

Test:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn(), user: { current: null as unknown }, build: vi.fn(async () => Buffer.from('xlsx')) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => h.user.current) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/cases/xlsx', () => ({ buildFinancialsWorkbook: h.build }))
import { GET } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222'
const call = () => GET(new Request('http://x'), { params: Promise.resolve({ id: P, caseId: C }) })
beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'edit_financials', userId: 'u1' }) })

describe('GET …/financials/xlsx', () => {
  it('needs Edit + financials', async () => {
    h.user.current = fakeSupabase({}).client
    h.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({}, { status: 403 }) })
    expect((await call()).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith(h.user.current, P, 'edit_financials')
  })
  it('404 before financials were run; otherwise an xlsx attachment built from the stored row', async () => {
    h.user.current = fakeSupabase({ tables: { 'solar.cases': [{ id: C, project_id: P, name: 'Base' }], 'projects.projects': [{ id: P, name: 'KW' }], 'solar.case_run_financials': [] } }).client
    expect((await call()).status).toBe(404)
    const row = { case_id: C, created_at: 'T', engine_version: '0.1.0', tariff_ref: {}, fin_inputs: { config: { capex: [] } }, results: {} }
    h.user.current = fakeSupabase({ tables: { 'solar.cases': [{ id: C, project_id: P, name: 'Base' }], 'projects.projects': [{ id: P, name: 'KW' }], 'solar.case_run_financials': [row] } }).client
    const res = await call()
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="KW - Base - financials.xlsx"')
    expect(h.build).toHaveBeenCalledWith({ projectName: 'KW', caseName: 'Base', row, capexLines: [] })
  })
})
```

Route:
```ts
/** GET …/cases/[caseId]/financials/xlsx — Edit + financials; the latest stored financial result, read under money RLS. */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { buildFinancialsWorkbook } from '@/lib/solar/cases/xlsx'

export const runtime = 'nodejs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const safe = (s: string) => s.replace(/[^\w .()-]+/g, '_').slice(0, 80)

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params
  if (!UUID.test(id) || !UUID.test(caseId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = (await createClient()) as any // eslint-disable-line @typescript-eslint/no-explicit-any
  const gate = await requireSolarLevelAPI(supabase, id, 'edit_financials')
  if (!gate.ok) return gate.response
  const [{ data: c }, { data: p }, { data: rows }] = await Promise.all([
    supabase.schema('solar').from('cases').select('id, name').eq('id', caseId).eq('project_id', id).maybeSingle(),
    supabase.schema('projects').from('projects').select('name').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('case_run_financials').select('case_id, created_at, engine_version, tariff_ref, fin_inputs, results')
      .eq('case_id', caseId).order('created_at', { ascending: false }).limit(1),
  ])
  const row = Array.isArray(rows) ? rows[0] : null
  if (!c || !row) return NextResponse.json({ error: 'Run financials first.' }, { status: 404 })
  const buf = await buildFinancialsWorkbook({ projectName: p?.name ?? '', caseName: c.name, row, capexLines: row.fin_inputs?.config?.capex ?? [] })
  return new Response(new Uint8Array(buf), { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${safe(`${p?.name ?? 'Project'} - ${c.name} - financials`)}.xlsx"`,
    'cache-control': 'private, no-store',
  } })
}
```

- [ ] **Step 7: Run all four test files — PASS; commit** ("feat(solar): financials save/rate card/run from stored energy, XLSX download").

---

### Task 22: Equipment catalogue actions (add / edit / retire / CSV import)

**Files:**
- Create: `apps/web/src/actions/solar-equipment.actions.ts`
- Test: `apps/web/src/actions/solar-equipment.actions.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { EQUIPMENT_CSV_HEADER } from '@esite/shared/solar-cases'

const h = vi.hoisted(() => ({ ctx: vi.fn(), role: vi.fn(), createClient: vi.fn(), emit: vi.fn(async () => {}), reval: vi.fn() }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.ctx }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.role }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.reval }))
import { saveSolarEquipmentAction, retireSolarEquipmentAction, importSolarEquipmentCsvAction } from './solar-equipment.actions'

const ORG = 'o1', U = 'u1'
beforeEach(() => { vi.clearAllMocks(); h.ctx.mockResolvedValue({ organisationId: ORG, userId: U }); h.role.mockResolvedValue({ ok: true }) })

describe('equipment actions', () => {
  it('owner/admin of the ACTIVE org only (requireRole .ok)', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({}).client)
    h.role.mockResolvedValueOnce({ ok: false })
    expect(await saveSolarEquipmentAction({ id: null, kind: 'battery', make: 'A', model: 'B', specs: { usableKwh: 1, powerKw: 1, rtePct: 90 }, expectedUpdatedAt: null }))
      .toEqual({ error: 'Only an organisation owner or admin can change the equipment catalogue.' })
  })
  it('add validates specs by kind and writes into the active org', async () => {
    const f = fakeSupabase({ writes: { 'solar.equipment:insert': { data: [{ id: 'e1', updated_at: 'T1' }] } } }); h.createClient.mockResolvedValue(f.client)
    expect(await saveSolarEquipmentAction({ id: null, kind: 'module', make: 'A', model: 'B', specs: { pmaxW: -5, gammaPmaxPctPerC: -0.3 }, expectedUpdatedAt: null })).toMatchObject({ fieldErrors: { pmaxW: expect.any(String) } })
    expect(await saveSolarEquipmentAction({ id: null, kind: 'module', make: ' A ', model: 'B', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.3 }, expectedUpdatedAt: null })).toEqual({ ok: true, id: 'e1', updatedAt: 'T1' })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')[0]!.payload).toEqual({ organisation_id: ORG, kind: 'module', make: 'A', model: 'B', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.3 }, source: 'manual' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: U, projectId: null, organisationId: ORG, event: 'solar_equipment_saved' })
  })
  it('duplicate make/model → field error; edit is stale-guarded; retire sets retired_at', async () => {
    h.createClient.mockResolvedValue(fakeSupabase({ writes: { 'solar.equipment:insert': { error: { code: '23505', message: 'dup' } } } }).client)
    expect(await saveSolarEquipmentAction({ id: null, kind: 'battery', make: 'A', model: 'B', specs: { usableKwh: 1, powerKw: 1, rtePct: 90 }, expectedUpdatedAt: null })).toEqual({ fieldErrors: { model: 'This make and model is already in the catalogue' } })
    h.createClient.mockResolvedValue(fakeSupabase({ writes: { 'solar.equipment:update': { data: [] } } }).client)
    expect(await saveSolarEquipmentAction({ id: 'e1', kind: 'battery', make: 'A', model: 'B', specs: { usableKwh: 1, powerKw: 1, rtePct: 90 }, expectedUpdatedAt: 'T0' })).toEqual({ error: 'Someone else changed this — reload to see their version.' })
    const f = fakeSupabase({ writes: { 'solar.equipment:update': { data: [{ id: 'e1' }] } } }); h.createClient.mockResolvedValue(f.client)
    expect(await retireSolarEquipmentAction({ id: 'e1' })).toEqual({ ok: true })
    const u = callsTo(f.calls, 'solar.equipment', 'update')[0]!
    expect(Object.keys(u.payload as object)).toEqual(['retired_at'])
    expect(u.filters).toEqual(expect.arrayContaining([['eq', 'id', 'e1'], ['eq', 'organisation_id', ORG]]))
  })
  it('CSV import: all-or-nothing on parse errors; inserts valid rows; reports duplicates as skipped', async () => {
    const f = fakeSupabase({}); h.createClient.mockResolvedValue(f.client)
    const H = EQUIPMENT_CSV_HEADER.join(',')
    const bad = await importSolarEquipmentCsvAction({ text: `${H}\nturbine,A,B` + ','.repeat(EQUIPMENT_CSV_HEADER.length - 3) })
    expect(bad).toEqual({ errors: [{ line: 2, message: 'kind must be module, inverter or battery' }] })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')).toHaveLength(0)
    const row = EQUIPMENT_CSV_HEADER.map((c) => ({ kind: 'battery', make: 'A', model: 'B', usableKwh: '10', powerKw: '5', rtePct: '90' } as Record<string, string>)[c] ?? '').join(',')
    const ok = await importSolarEquipmentCsvAction({ text: `${H}\n${row}` })
    expect(ok).toEqual({ ok: true, added: 1, skipped: 0 })
    expect(callsTo(f.calls, 'solar.equipment', 'insert')[0]!.payload).toMatchObject({ organisation_id: ORG, source: 'csv' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement:**

```ts
'use server'
/**
 * Equipment catalogue (functional spec §11): Add, Edit, Retire (never delete — cases reference it),
 * Import from CSV. PAN/OND import deferred (D-19). Owner/admin of the ACTIVE org (the catalogue lives
 * in /settings/solar); 00215's equipment_*_authz policies (solar.library_orgs('admin')) decide in the DB.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { EQUIPMENT_KINDS, parseEquipmentCsv, parseEquipmentSpecs, type EquipmentKind } from '@esite/shared/solar-cases'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const NOT_ADMIN = 'Only an organisation owner or admin can change the equipment catalogue.'
const MAX_CSV_BYTES = 512 * 1024

async function gate() {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' as const }
  const supabase = (await createClient()) as unknown as AnyClient
  const r = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!r.ok) return { error: NOT_ADMIN }
  return { ctx, supabase }
}

export async function saveSolarEquipmentAction(input: { id: string | null; kind: EquipmentKind; make: string; model: string; specs: unknown; expectedUpdatedAt: string | null }):
  Promise<{ ok: true; id: string; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate()
  if ('error' in g) return { error: g.error! }
  if (!EQUIPMENT_KINDS.includes(input.kind)) return { fieldErrors: { kind: 'Choose module, inverter or battery' } }
  const make = String(input.make ?? '').trim(), model = String(input.model ?? '').trim()
  if (!make) return { fieldErrors: { make: 'Enter the make' } }
  if (!model) return { fieldErrors: { model: 'Enter the model' } }
  const specs = parseEquipmentSpecs(input.kind, input.specs)
  if (!specs.ok) return { fieldErrors: specs.errors }
  const t = () => g.supabase.schema('solar').from('equipment')
  const res = input.id === null
    ? await t().insert({ organisation_id: g.ctx.organisationId, kind: input.kind, make, model, specs: specs.specs, source: 'manual' }).select('id, updated_at')
    : await t().update({ make, model, specs: specs.specs }).eq('id', input.id).eq('organisation_id', g.ctx.organisationId).eq('updated_at', input.expectedUpdatedAt ?? '').select('id, updated_at')
  if (res.error) return res.error.code === '23505' ? { fieldErrors: { model: 'This make and model is already in the catalogue' } } : { error: humanSolarError(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
  await emitProductEvent({ actorId: g.ctx.userId, projectId: null, organisationId: g.ctx.organisationId, event: 'solar_equipment_saved' })
  revalidatePath('/settings/solar/equipment')
  return { ok: true, id: res.data[0]!.id as string, updatedAt: res.data[0]!.updated_at as string }
}

export async function retireSolarEquipmentAction(input: { id: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate()
  if ('error' in g) return { error: g.error! }
  const { data, error } = await g.supabase.schema('solar').from('equipment').update({ retired_at: new Date().toISOString() })
    .eq('id', input.id).eq('organisation_id', g.ctx.organisationId).select('id')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was retired — platform rows cannot be retired, and the row may have moved on.' }
  revalidatePath('/settings/solar/equipment')
  return { ok: true }
}

export async function importSolarEquipmentCsvAction(input: { text: string }):
  Promise<{ ok: true; added: number; skipped: number } | { errors: Array<{ line: number; message: string }> } | { error: string }> {
  const g = await gate()
  if ('error' in g) return { error: g.error! }
  const text = String(input.text ?? '')
  if (text.length > MAX_CSV_BYTES) return { error: 'The file is larger than 512 KB.' }
  const parsed = parseEquipmentCsv(text)
  if (parsed.errors.length > 0) return { errors: parsed.errors }
  let added = 0, skipped = 0
  for (const r of parsed.rows) {
    const { error } = await g.supabase.schema('solar').from('equipment')
      .insert({ organisation_id: g.ctx.organisationId, kind: r.kind, make: r.make, model: r.model, specs: r.specs, source: 'csv' })
    if (!error) added++
    else if (error.code === '23505') skipped++
    else return { error: `Stopped at ${r.make} ${r.model}: ${humanSolarError(error)} (${added} added before it).` }
  }
  if (added > 0) await emitProductEvent({ actorId: g.ctx.userId, projectId: null, organisationId: g.ctx.organisationId, event: 'solar_equipment_saved' })
  revalidatePath('/settings/solar/equipment')
  return { ok: true, added, skipped }
}
```
Note the fake echoes an insert with no `.select()` as success (`error: null`), so the import test counts 1 added.

- [ ] **Step 3: Run — PASS; run the full web suite; commit** ("feat(solar): equipment catalogue actions and CSV import").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter web test 2>&1 | tail -4 && pnpm --filter web type-check 2>&1 | tail -5
```
