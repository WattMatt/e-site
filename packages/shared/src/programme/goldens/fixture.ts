/**
 * The golden fixture contract (goldens/README.md). P4's MS Project and P6 importers write fixtures in this shape
 * as `msp-*.json` / `p6-*.json`. A test and fixture contract: deliberately NOT exported from `programme/index.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CalendarDate, ProgrammeInput } from '../types'

export interface GoldenExpectation {
  es: CalendarDate
  ef: CalendarDate
  ls: CalendarDate
  lf: CalendarDate
  tf: number
}

export interface GoldenFixture {
  name: string
  source: 'hand' | 'msp' | 'p6'
  notes: string
  input: ProgrammeInput
  expected: Record<string, GoldenExpectation>
}

/** The folder holding the golden `*.json` files. */
export const GOLDENS_DIR = __dirname

/** Every fixture in every `*.json` file of `dir` (a file holds one fixture or an array), by file name order. */
export function loadGoldenFixtures(dir: string = GOLDENS_DIR): Array<{ file: string; fixture: GoldenFixture }> {
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(file => {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as GoldenFixture | GoldenFixture[]
    return (Array.isArray(raw) ? raw : [raw]).map(fixture => ({ file, fixture }))
  })
}
