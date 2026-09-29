// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Functional spec §7.3 / dev plan P4 verification: "Every KPI on every tab traced to one case_runs row
 * (test asserts no client-side computation of displayed results)". A 'use client' file may import TYPES
 * from the engine or the case model, never runtime: no simulateCase / runFinancials / buildRunOutputs /
 * runStoredFinancials / buildFinanceInput / capexTotals / applyRateCard in the browser. The server-only
 * Solar case libs (lib/solar/cases/*) are likewise type-only from a client file.
 */
const ROOT = resolve(__dirname, '../../')
const DIRS = ['app/(admin)/projects/[id]/solar', 'app/(admin)/settings/solar', 'components/solar']
// Phase 7: '@esite/shared/solar-operations' re-exports the SPA-based downtime detector, so a client file
// takes runtime values only from its engine-free '/client' subpath (a different specifier, so allowed).
// The server-only Operations libs (lib/solar/operations/*) are type-only from a client file too.
const FORBIDDEN_MODULES = ['@esite/shared/solar-engine', '@esite/shared/solar-cases', '@esite/shared/tariffs/ingest', '@esite/shared/solar-operations']
const FORBIDDEN_PREFIXES = ['@/lib/solar/cases/', '@/lib/solar/operations/']
const forbidden = (mod: string) => FORBIDDEN_MODULES.includes(mod) || FORBIDDEN_PREFIXES.some((p) => mod.startsWith(p))

function files(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(files(p))
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

export function runtimeImportsOf(src: string): string[] {
  const bad: string[] = []
  const re = /^\s*import\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const [, typeOnly, clause, mod] = m
    if (!forbidden(mod!)) continue
    if (typeOnly) continue
    const c = clause!.trim()
    const inner = c.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
    if (c.startsWith('{') && inner.every((s) => s.startsWith('type '))) continue
    bad.push(`${mod}: ${c}`)
  }
  // Re-exports and dynamic imports pull runtime into the client bundle too.
  const other = /(?:^\s*export\s+(?!type\b)[^;'"]*?\bfrom|\bimport\s*\()\s*['"]([^'"]+)['"]/gm
  for (let m = other.exec(src); m; m = other.exec(src)) if (forbidden(m[1]!)) bad.push(`${m[1]}: ${m[0].trim()}`)
  // A bare side-effect import (`import '@esite/shared/solar-engine'`) is runtime as well.
  const bare = /^\s*import\s*['"]([^'"]+)['"]/gm
  for (let m = bare.exec(src); m; m = bare.exec(src)) if (forbidden(m[1]!)) bad.push(`${m[1]}: side-effect import`)
  return bad
}

describe('no Solar result is computed in the browser', () => {
  const clientFiles = DIRS.flatMap((d) => files(join(ROOT, d))).filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')))

  it('finds the client components (the scan is not vacuous)', () => {
    expect(clientFiles.length).toBeGreaterThanOrEqual(10)
    for (const name of ['RunResults.tsx', 'CaseEditor.tsx', 'CompareView.tsx', 'AnnualChart.tsx', 'LineChart.tsx']) {
      expect(clientFiles.some((f) => f.endsWith(name)), name).toBe(true)
    }
  })

  it.each(clientFiles.map((f) => [f.slice(ROOT.length + 1), f]))('%s imports only types from the engine/case model', (_n, f) => {
    expect(runtimeImportsOf(readFileSync(f, 'utf8'))).toEqual([])
  })

  it('the detector can fail (mutation guard)', () => {
    expect(runtimeImportsOf(`import { simulateCase } from '@esite/shared/solar-engine'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import { type DayType, capexTotals } from '@esite/shared/solar-cases'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import * as cases from '@esite/shared/solar-cases'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import {\n  capexTotals,\n} from '@esite/shared/solar-cases'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import { loadYieldPageData } from '@/lib/solar/cases/page-data'`)).toHaveLength(1)
    expect(runtimeImportsOf(`export { simulateCase } from '@esite/shared/solar-engine'`)).toHaveLength(1)
    expect(runtimeImportsOf(`const m = await import('@esite/shared/solar-cases')`)).toHaveLength(1)
    expect(runtimeImportsOf(`import '@esite/shared/solar-engine'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import type { DayType } from '@esite/shared/solar-cases'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import { type DayType } from '@esite/shared/solar-cases'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import type { RunView } from '@/lib/solar/cases/page-data'`)).toHaveLength(0)
    expect(runtimeImportsOf(`export type { DayType } from '@esite/shared/solar-cases'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import { num } from '@/components/solar/format'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import { detectDowntimeCandidates } from '@esite/shared/solar-operations'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import { loadOperationsView } from '@/lib/solar/operations/data'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import type { IrradiationRecord } from '@esite/shared/solar-operations'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import type { OperationsView } from '@/lib/solar/operations/data'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import { monthLabel } from '@esite/shared/solar-operations/client'`)).toHaveLength(0)
  })
})
