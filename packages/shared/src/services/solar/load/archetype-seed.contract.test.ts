import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOAD_ARCHETYPES } from './archetypes'

const DIR = join(__dirname, '../../../../../../apps/edge-functions/supabase/migrations')

function seedRows(): Array<{ code: string; version: number; name: string; profiles: unknown; operating: unknown; seasonal: unknown }> {
  const file = readdirSync(DIR).find((f) => f.endsWith('_solar_meter_data.sql'))
  if (!file) throw new Error('solar meter data migration not found')
  const sql = readFileSync(join(DIR, file), 'utf8')
  const re = /\('([a-z_0-9]+)', (\d+), '([^']*)',\s*'([^']*)'::jsonb,\s*'([^']*)'::jsonb,\s*'([^']*)'::jsonb\)/g
  const out = []
  for (const m of sql.matchAll(re)) {
    out.push({ code: m[1], version: Number(m[2]), name: m[3], profiles: JSON.parse(m[4]), operating: JSON.parse(m[5]), seasonal: JSON.parse(m[6]) })
  }
  return out
}

describe('solar.load_archetypes seed == LOAD_ARCHETYPES', () => {
  it('same codes, versions, names, profiles, operating hours and seasonal multipliers', () => {
    const rows = seedRows()
    expect(rows).toHaveLength(LOAD_ARCHETYPES.length)
    for (const a of LOAD_ARCHETYPES) {
      const r = rows.find((x) => x.code === a.code)
      expect(r, a.code).toBeDefined()
      expect(r).toEqual({
        code: a.code, version: a.version, name: a.name,
        profiles: { weekday: [...a.profiles.weekday], saturday: [...a.profiles.saturday], sunday: [...a.profiles.sunday], holiday: [...a.profiles.holiday] },
        operating: {
          weekday: a.operating.weekday ? [...a.operating.weekday] : null, saturday: a.operating.saturday ? [...a.operating.saturday] : null,
          sunday: a.operating.sunday ? [...a.operating.sunday] : null, holiday: a.operating.holiday ? [...a.operating.holiday] : null,
        },
        seasonal: [...a.seasonal],
      })
    }
  })
})
