import { describe, expect, it } from 'vitest'
import { parsePvgisTmyCsv, parsePvgisTmyJson } from './pvgis-tmy'

// Trimmed from the real response of
// https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=-26.2&lon=28.05&outputformat=json (fetched 2026-09-28).
const JSON_SAMPLE = {
  inputs: {
    location: { latitude: -26.2, longitude: 28.05, elevation: 1746.0, irradiance_time_offset: 0.0518 },
    meteo_data: { radiation_db: 'PVGIS-SARAH2', meteo_db: 'ERA5', year_min: 2005, year_max: 2020, use_horizon: true, horizon_db: 'DEM-calculated' },
  },
  outputs: {
    months_selected: [{ month: 1, year: 2005 }, { month: 2, year: 2019 }],
    tmy_hourly: [
      { 'time(UTC)': '20050101:0000', T2m: 19.99, RH: 71.57, 'G(h)': 0.0, 'Gb(n)': 0.0, 'Gd(h)': 0.0, 'IR(h)': 248.97, WS10m: 2.57, WD10m: 61.0, SP: 82144.0 },
      { 'time(UTC)': '20050101:0800', T2m: 23.32, RH: 61.4, 'G(h)': 848, 'Gb(n)': 736.75, 'Gd(h)': 205, 'IR(h)': 364.6, WS10m: 3.93, WD10m: 342, SP: 82435 },
      { 'time(UTC)': '20050101:0900', T2m: 24.22, RH: 58.2, 'G(h)': 989, 'Gb(n)': 807.48, 'Gd(h)': 212, 'IR(h)': 375.6, WS10m: 3.1, WD10m: 330, SP: 82403 },
    ],
  },
}

// Trimmed from the same query with outputformat=csv (CRLF line endings, as served).
const CSV_SAMPLE = [
  'Latitude (decimal degrees): -26.200',
  'Longitude (decimal degrees): 28.050',
  'Elevation (m): 1746.0',
  'Irradiance Time Offset (h): 0.0518',
  'month,year',
  '1,2005',
  '2,2019',
  'time(UTC),T2m,RH,G(h),Gb(n),Gd(h),IR(h),WS10m,WD10m,SP',
  '20050101:0000,19.99,71.57,0.0,-0.0,0.0,248.97,2.57,61.0,82144.0',
  '20050101:0800,23.32,61.4,848.0,736.75,205.0,364.6,3.93,342.0,82435.0',
  '20050101:0900,24.22,58.2,989.0,807.48,212.0,375.6,3.1,330.0,82403.0',
  '',
  'T2m: 2-m air temperature (degree Celsius)',
  'G(h): Global irradiance on the horizontal plane (W/m2)',
  '',
  'PVGIS (c) European Union, 2001-2026',
  '',
].join('\r\n')

describe('parsePvgisTmyJson', () => {
  it('reads the location block, the irradiance time offset and every hourly field', () => {
    const t = parsePvgisTmyJson(JSON_SAMPLE)
    expect(t).toMatchObject({ latitude: -26.2, longitude: 28.05, elevation: 1746, irradianceTimeOffsetH: 0.0518, radiationDb: 'PVGIS-SARAH2' })
    expect(t.rows).toHaveLength(3)
    expect(t.rows[1]).toEqual({ sourceYear: 2005, month: 1, day: 1, hourUtc: 8, t2m: 23.32, ghi: 848, dni: 736.75, dhi: 205, ws10m: 3.93, sp: 82435 })
  })

  it('refuses a body that is not a TMY response', () => {
    expect(() => parsePvgisTmyJson({ outputs: {} })).toThrow(/Not a PVGIS TMY JSON response/)
  })

  it('refuses a row with a missing field or a bad timestamp', () => {
    const noDni = structuredClone(JSON_SAMPLE)
    delete (noDni.outputs.tmy_hourly[0] as Record<string, unknown>)['Gb(n)']
    expect(() => parsePvgisTmyJson(noDni)).toThrow(/row 0: missing field Gb\(n\)/)
    const badTime = structuredClone(JSON_SAMPLE)
    badTime.outputs.tmy_hourly[2]!['time(UTC)'] = '2005-01-01 09:00'
    expect(() => parsePvgisTmyJson(badTime)).toThrow(/row 2: bad time\(UTC\)/)
  })
})

describe('parsePvgisTmyCsv', () => {
  it('reads the header block and stops at the legend', () => {
    const t = parsePvgisTmyCsv(CSV_SAMPLE)
    expect(t).toMatchObject({ latitude: -26.2, longitude: 28.05, elevation: 1746, irradianceTimeOffsetH: 0.0518 })
    expect(t.rows).toHaveLength(3)
    expect(t.rows[2]).toEqual({ sourceYear: 2005, month: 1, day: 1, hourUtc: 9, t2m: 24.22, ghi: 989, dni: 807.48, dhi: 212, ws10m: 3.1, sp: 82403 })
  })

  it('clamps the "-0.0" night irradiance PVGIS writes to +0', () => {
    const t = parsePvgisTmyCsv(CSV_SAMPLE)
    expect(Object.is(t.rows[0]!.dni, 0)).toBe(true)
  })

  it('JSON and CSV of the same response agree row for row', () => {
    expect(parsePvgisTmyCsv(CSV_SAMPLE).rows).toEqual(parsePvgisTmyJson(JSON_SAMPLE).rows)
  })

  it('refuses a non-numeric cell', () => {
    expect(() => parsePvgisTmyCsv(CSV_SAMPLE.replace('848.0', 'n/a'))).toThrow(/G\(h\) is not a number/)
  })
})
