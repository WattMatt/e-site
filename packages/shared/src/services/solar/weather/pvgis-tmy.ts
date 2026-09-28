/**
 * Parser for the PVGIS 5.2 `tmy` endpoint (JSON and CSV output formats).
 *
 * Documented fields per hourly row: `time(UTC)` as `YYYYMMDD:HHMM`, `T2m` (°C), `RH` (%),
 * `G(h)` GHI, `Gb(n)` DNI, `Gd(h)` DHI (W/m²), `IR(h)` (W/m²), `WS10m` (m/s), `WD10m` (°),
 * `SP` (Pa). The location block carries `irradiance_time_offset` (hours): the irradiance
 * of a row stamped HH:00 UTC was sampled at HH:00 + offset.
 *
 * Fetching is a server concern (Phase 4b). This module only turns the response into rows.
 */

export interface PvgisTmyRow {
  /** Year the TMY took this month from (TMY months come from different years). */
  sourceYear: number
  month: number
  day: number
  hourUtc: number
  t2m: number
  ghi: number
  dni: number
  dhi: number
  ws10m: number
  /** Surface pressure, Pa. */
  sp: number
}

export interface PvgisTmy {
  latitude: number
  longitude: number
  elevation: number
  irradianceTimeOffsetH: number
  radiationDb: string | null
  rows: PvgisTmyRow[]
}

const REQUIRED = ['time(UTC)', 'T2m', 'G(h)', 'Gb(n)', 'Gd(h)', 'WS10m', 'SP'] as const

function num(v: unknown, field: string, i: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) throw new Error(`PVGIS TMY row ${i}: ${field} is not a number (${String(v)})`)
  return n
}

/** PVGIS writes `-0.0` and tiny negatives at night; irradiance is clamped at zero. */
function irr(v: unknown, field: string, i: number): number {
  return Math.max(0, num(v, field, i))
}

function parseStamp(stamp: unknown, i: number) {
  const m = typeof stamp === 'string' ? /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/.exec(stamp.trim()) : null
  if (!m) throw new Error(`PVGIS TMY row ${i}: bad time(UTC) ${String(stamp)}`)
  return { sourceYear: +m[1]!, month: +m[2]!, day: +m[3]!, hourUtc: +m[4]! }
}

function toRow(rec: Record<string, unknown>, i: number): PvgisTmyRow {
  for (const k of REQUIRED) {
    if (!(k in rec)) throw new Error(`PVGIS TMY row ${i}: missing field ${k}`)
  }
  return {
    ...parseStamp(rec['time(UTC)'], i),
    t2m: num(rec['T2m'], 'T2m', i),
    ghi: irr(rec['G(h)'], 'G(h)', i),
    dni: irr(rec['Gb(n)'], 'Gb(n)', i),
    dhi: irr(rec['Gd(h)'], 'Gd(h)', i),
    ws10m: Math.max(0, num(rec['WS10m'], 'WS10m', i)),
    sp: num(rec['SP'], 'SP', i),
  }
}

export function parsePvgisTmyJson(body: unknown): PvgisTmy {
  const b = body as {
    inputs?: {
      location?: { latitude?: number; longitude?: number; elevation?: number; irradiance_time_offset?: number }
      meteo_data?: { radiation_db?: string }
    }
    outputs?: { tmy_hourly?: Record<string, unknown>[] }
  }
  const loc = b?.inputs?.location
  const rows = b?.outputs?.tmy_hourly
  if (!loc || !Array.isArray(rows)) throw new Error('Not a PVGIS TMY JSON response (inputs.location / outputs.tmy_hourly)')
  return {
    latitude: num(loc.latitude, 'latitude', -1),
    longitude: num(loc.longitude, 'longitude', -1),
    elevation: num(loc.elevation, 'elevation', -1),
    irradianceTimeOffsetH: loc.irradiance_time_offset == null ? 0 : num(loc.irradiance_time_offset, 'irradiance_time_offset', -1),
    radiationDb: b.inputs?.meteo_data?.radiation_db ?? null,
    rows: rows.map(toRow),
  }
}

export function parsePvgisTmyCsv(text: string): PvgisTmy {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const header = (label: string): number | null => {
    const line = lines.find((l) => l.startsWith(label))
    if (!line) return null
    return num(line.slice(line.indexOf(':') + 1), label, -1)
  }
  const latitude = header('Latitude')
  const longitude = header('Longitude')
  const elevation = header('Elevation')
  if (latitude == null || longitude == null || elevation == null) {
    throw new Error('Not a PVGIS TMY CSV response (missing Latitude/Longitude/Elevation header)')
  }
  const headIdx = lines.findIndex((l) => l.startsWith('time(UTC),'))
  if (headIdx < 0) throw new Error('PVGIS TMY CSV: no time(UTC) header row')
  const cols = lines[headIdx]!.split(',').map((c) => c.trim())
  const rows: PvgisTmyRow[] = []
  for (let i = headIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!/^\d{8}:\d{4},/.test(line)) break // the legend block after the data starts with a blank line
    const cells = line.split(',')
    const rec: Record<string, unknown> = {}
    cols.forEach((c, j) => (rec[c] = cells[j]))
    rows.push(toRow(rec, rows.length))
  }
  return {
    latitude,
    longitude,
    elevation,
    irradianceTimeOffsetH: header('Irradiance Time Offset') ?? 0,
    radiationDb: null,
    rows,
  }
}
