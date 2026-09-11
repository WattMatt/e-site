import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Every server action that records a moment in PostHog must also record it in
 * public.product_events.
 *
 * This is the mechanism that stops call sites forgetting. trackServer already
 * marks the moments this codebase considers worth recording; without this
 * rule, a new action would get a PostHog line and no first-party row, and the
 * metric would quietly under-count with no error anywhere — the same shape as
 * a rejected notification type writing no row AND no error.
 *
 * Comments are stripped first: prose about the rule must not read as the rule.
 * (The snag contract test fired on a doc comment for exactly this reason.)
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')
const ACTIONS = join(REPO_ROOT, 'apps/web/src/actions')

function stripComments(src: string): string {
  // Blank block comments line-for-line so reported line numbers stay true.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

function actionFiles(): string[] {
  return readdirSync(ACTIONS)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(ACTIONS, f))
    .filter((f) => statSync(f).isFile())
}

describe('trackServer and emitProductEvent travel together', () => {
  const offenders: string[] = []
  for (const file of actionFiles()) {
    const src = stripComments(readFileSync(file, 'utf8'))
    const tracks = [...src.matchAll(/\btrackServer\s*\(/g)].length
    const emits = [...src.matchAll(/\bemitProductEvent\s*\(/g)].length
    if (tracks > 0 && emits < tracks) {
      offenders.push(`${file.replace(REPO_ROOT + '/', '')} — ${tracks} trackServer call(s), ${emits} emitProductEvent call(s)`)
    }
  }

  it('every trackServer call site has a matching emitProductEvent call', () => {
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([])
  })

  it('there is at least one trackServer call site to check — the suite is not vacuous', () => {
    const total = actionFiles().reduce(
      (n, f) => n + [...stripComments(readFileSync(f, 'utf8')).matchAll(/\btrackServer\s*\(/g)].length,
      0,
    )
    // Measured 2026-09-10: 10 call sites across FIVE files (rfi, snag,
    // project, supplier, onboarding).
    expect(total).toBeGreaterThanOrEqual(10)
  })
})
