import { HOURS_PER_YEAR, SAST_OFFSET_HOURS, dayOfYear0 } from '../time'
import type { PvgisTmy } from './pvgis-tmy'

/**
 * One reference year of weather on the engine time base (SAST hour index 0…8759).
 *
 * `sampleOffsetH` is where inside each SAST hour the irradiance was sampled (PVGIS
 * `irradiance_time_offset`): the value at index h belongs to instant h + sampleOffsetH.
 * The PV model places the sun at that instant, then re-centres power on the hour midpoint.
 */
export interface WeatherYear {
  latitude: number
  longitude: number
  elevation: number
  sampleOffsetH: number
  ghi: Float64Array
  dni: Float64Array
  dhi: Float64Array
  tAmb: Float64Array
  wind: Float64Array
  /** hPa */
  pressure: Float64Array
  /** Provenance, e.g. "PVGIS-SARAH2 TMY". */
  source: string
}

/** Minimum and maximum ambient temperature of the year — string sizing inputs (spec §3.3). */
export function temperatureExtremes(w: WeatherYear): { minC: number; maxC: number } {
  let minC = Number.POSITIVE_INFINITY
  let maxC = Number.NEGATIVE_INFINITY
  for (const t of w.tAmb) {
    if (t < minC) minC = t
    if (t > maxC) maxC = t
  }
  return { minC, maxC }
}

/**
 * PVGIS TMY rows (UTC, months drawn from different years) → the engine reference year:
 *  1. drop 29 February (spec §1.2);
 *  2. order by (month, day, hour) — never by source year;
 *  3. refuse anything that is not exactly one row per non-leap UTC hour;
 *  4. shift UTC → SAST by +2 h, wrapping 31 Dec 22:00–23:59 UTC to 1 Jan 00:00–02:00 SAST.
 */
export function tmyToReferenceYear(tmy: PvgisTmy, source = 'PVGIS TMY'): WeatherYear {
  const byUtcHour: (PvgisTmy['rows'][number] | undefined)[] = new Array(HOURS_PER_YEAR)
  for (const r of tmy.rows) {
    if (r.month === 2 && r.day === 29) continue
    if (!Number.isInteger(r.hourUtc) || r.hourUtc < 0 || r.hourUtc > 23) throw new Error(`bad UTC hour ${r.hourUtc}`)
    const u = dayOfYear0(r.month, r.day) * 24 + r.hourUtc
    if (byUtcHour[u]) throw new Error(`duplicate TMY hour ${r.month}/${r.day} ${r.hourUtc}:00 UTC`)
    byUtcHour[u] = r
  }
  for (let i = 0; i < HOURS_PER_YEAR; i++) {
    if (!byUtcHour[i]) throw new Error(`TMY is missing UTC hour index ${i} (day ${Math.floor(i / 24) + 1}, ${i % 24}:00 UTC)`)
  }

  const out = {
    ghi: new Float64Array(HOURS_PER_YEAR),
    dni: new Float64Array(HOURS_PER_YEAR),
    dhi: new Float64Array(HOURS_PER_YEAR),
    tAmb: new Float64Array(HOURS_PER_YEAR),
    wind: new Float64Array(HOURS_PER_YEAR),
    pressure: new Float64Array(HOURS_PER_YEAR),
  }
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const r = byUtcHour[(h - SAST_OFFSET_HOURS + HOURS_PER_YEAR) % HOURS_PER_YEAR]!
    out.ghi[h] = r.ghi
    out.dni[h] = r.dni
    out.dhi[h] = r.dhi
    out.tAmb[h] = r.t2m
    out.wind[h] = r.ws10m
    out.pressure[h] = r.sp / 100
  }
  return {
    latitude: tmy.latitude,
    longitude: tmy.longitude,
    elevation: tmy.elevation,
    sampleOffsetH: tmy.irradianceTimeOffsetH,
    source: tmy.radiationDb ? `${tmy.radiationDb} ${source}` : source,
    ...out,
  }
}
