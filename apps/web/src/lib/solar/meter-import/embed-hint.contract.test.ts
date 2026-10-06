// @vitest-environment node
/**
 * solar.meter_channels and solar.meters are linked by TWO foreign keys (meter_channels.meter_id and
 * meters.existing_pv_channel_id), so PostgREST refuses an un-hinted embed between them ("more than one
 * relationship was found"). That made every Solar meter import fail in production on its first file
 * (found 2026-10-05 by the meter-archive load); the fake repo in the unit tests could not see it.
 * Every embed between the two tables must name the foreign key.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '../../..')
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? (e === 'node_modules' ? [] : files(p)) : /\.tsx?$/.test(e) && !/\.test\./.test(e) ? [p] : []
  })
}

describe('meter_channels ↔ meters embeds name their foreign key', () => {
  it('no un-hinted embed in either direction', () => {
    const bad: string[] = []
    for (const f of files(SRC)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/from\('meter_channels'\)[^\n]*\bmeters\(/.test(line) || /from\('meters'\)[^\n]*\bmeter_channels\(/.test(line)) bad.push(`${f.slice(SRC.length + 1)}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })
})
