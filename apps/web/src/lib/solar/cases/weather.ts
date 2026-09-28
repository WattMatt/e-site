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
// Verified against a captured response (2026-09-28): annual.data.PVOUT_csi, kWh/kWp.
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
