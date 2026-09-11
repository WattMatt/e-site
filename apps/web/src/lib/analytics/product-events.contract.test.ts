import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Every server-side module that records a moment in PostHog must also record
 * it in public.product_events.
 *
 * This is the mechanism that stops call sites forgetting. trackServer already
 * marks the moments this codebase considers worth recording; without this
 * rule, a new caller would get a PostHog line and no first-party row, and the
 * metric would quietly under-count with no error anywhere — the same shape as
 * a rejected notification type writing no row AND no error.
 *
 * Scope: every .ts/.tsx under apps/web/src, not only actions/, so a route
 * handler or a lib helper that starts calling trackServer is caught too.
 * Excluded: test files, and lib/analytics.ts (the definition of trackServer).
 *
 * The count is PER FILE, not per function: a file with two trackServer calls
 * and two emitProductEvent calls passes even if both emits sit in one
 * function. That is deliberate — a per-function rule needs a parser — and the
 * reviewer, not this test, checks that each emit sits beside its track.
 *
 * Comments are stripped first: prose about the rule must not read as the rule.
 * (The snag contract test fired on a doc comment for exactly this reason.)
 * Trailing `//` comments are stripped too; `://` is kept so a URL survives.
 */
const SRC = resolve(__dirname, '../..') // apps/web/src
const REPO_ROOT = resolve(SRC, '../../..')
const EXCLUDED = new Set([join(SRC, 'lib/analytics.ts')])

function stripComments(src: string): string {
  // Blank block comments line-for-line so reported line numbers stay true.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
    if (EXCLUDED.has(path)) continue
    out.push(path)
  }
  return out.sort()
}

function countCalls(src: string, name: string): number {
  return [...src.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))].length
}

describe('trackServer and emitProductEvent travel together', () => {
  const offenders: string[] = []
  for (const file of sourceFiles()) {
    const src = stripComments(readFileSync(file, 'utf8'))
    const tracks = countCalls(src, 'trackServer')
    const emits = countCalls(src, 'emitProductEvent')
    if (tracks > 0 && emits < tracks) {
      offenders.push(`${relative(REPO_ROOT, file)} — ${tracks} trackServer call(s), ${emits} emitProductEvent call(s)`)
    }
  }

  it('every trackServer call site has a matching emitProductEvent call', () => {
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([])
  })

  it('there is at least one trackServer call site to check — the suite is not vacuous', () => {
    const total = sourceFiles().reduce(
      (n, f) => n + countCalls(stripComments(readFileSync(f, 'utf8')), 'trackServer'),
      0,
    )
    // Measured 2026-09-10: 10 call sites across FIVE files (rfi, snag,
    // project, supplier, onboarding), all under actions/.
    expect(total).toBeGreaterThanOrEqual(10)
  })
})
