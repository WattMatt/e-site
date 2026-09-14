import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * THE INERT-GATE GUARD.
 *
 * `requireEffectiveRole` and `requireRoleForRevision` resolve to a RESULT
 * OBJECT — `{ ok: false, error }` or `{ ok: true, role }` — never a boolean.
 * An object is always truthy, so
 *
 *     const allowed = await requireEffectiveRole(supabase, projectId, ROLES)
 *     if (!allowed) return { error: 'no permission' }
 *
 * reads as a gate, type-checks, passes review, and gates NOTHING.
 *
 * Both gates that PR #180 added were written this way and shipped to
 * production on 2026-09-11 — the only two bare-truthiness call sites among
 * ~90. One of them was `calibrateFloorPlanAction`, whose own comment says
 * "this gate is the point of the action existing": with it inert, the sole
 * remaining check was RLS on `tenants.floor_plans`, which admits every org
 * member except `client_viewer`, so all 13 production contractors could
 * rewrite any drawing's scale.
 *
 * These assertions are source-level ON PURPOSE. The defect is invisible to a
 * runtime test of the action, because a unit test that mocks the helper can
 * mock a BOOLEAN the real helper can never return — which is exactly what
 * `cable-route.actions.test.ts` did, and why it passed while the gate was dead.
 */

const WEB_SRC = resolve(__dirname, '../..') // apps/web/src

/** Helpers in lib/auth/require-role.ts that resolve to a result object. */
const OBJECT_RESULT_HELPERS = ['requireEffectiveRole', 'requireRoleForRevision']

/**
 * Block comments go entirely (replaced by their own newlines so reported line
 * numbers still match the real file); whole-line `//` and doc-continuation `*`
 * lines are dropped. Anything else is left alone, so a `//` inside a string
 * cannot silently truncate a line and hide a real call site.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .split('\n')
    .map((l) => {
      const t = l.trimStart()
      return t.startsWith('//') || t.startsWith('*') ? '' : l
    })
    .join('\n')
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
}

type CallSite = { file: string; line: number; helper: string; bindings: string[]; text: string }

/**
 * Identifiers bound to a call's result. Two legitimate shapes exist:
 *   const guard = await requireEffectiveRole(...)            → ['guard']
 *   const [writeGate, manageGate] = await Promise.all([      → ['writeGate','manageGate']
 *     requireEffectiveRole(...), requireEffectiveRole(...),
 *   ])
 * The second puts the binding SEVERAL LINES ABOVE the call, so a line-local
 * match alone would report the QC report page as an inert gate when it is not.
 */
function bindingsFor(lines: string[], idx: number): string[] {
  const lhs = (line: string): string[] | null => {
    const m = line.match(/(?:const|let)\s+(\[[^\]]*\]|\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=/)
    if (!m) return null
    return [...m[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0])
  }
  const own = lhs(lines[idx] ?? '')
  if (own) return own
  // Walk back to the nearest assignment that opens this expression.
  for (let i = idx - 1; i >= Math.max(0, idx - 6); i--) {
    const found = lhs(lines[i] ?? '')
    if (found) return found
  }
  return []
}

function collectCallSites(): CallSite[] {
  const files: string[] = []
  walk(WEB_SRC, files)

  const found: CallSite[] = []
  for (const file of files) {
    if (file.endsWith('role-gate-call-sites.contract.test.ts')) continue
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      for (const helper of OBJECT_RESULT_HELPERS) {
        if (!line.includes(`${helper}(`)) continue
        // The helpers' own declarations are not call sites.
        if (new RegExp(`function\\s+${helper}\\s*\\(`).test(line)) continue
        found.push({
          file: file.slice(WEB_SRC.length + 1),
          line: i + 1,
          helper,
          bindings: bindingsFor(lines, i),
          text: line.trim(),
        })
      }
    })
  }
  return found
}

/** A call site is satisfied when its result is read via `.ok`. */
function readsOk(site: CallSite, lines: string[]): boolean {
  if (site.text.includes('.ok')) return true
  if (/(?:const|let)\s*\{[^}]*\bok\b/.test(site.text)) return true
  if (!site.bindings.length) return false
  // The consumer normally sits within a few lines; allow a window wide enough
  // for a Promise.all block to close before its results are read.
  const window = lines.slice(site.line, site.line + 12).join('\n')
  return site.bindings.some((b) => new RegExp(`\\b${b}\\.ok\\b`).test(window))
}

describe('role gate call sites', () => {
  const sites = collectCallSites()

  it('finds the call sites it is meant to police', () => {
    // Guards against a silently-vacuous pass: if the scan or the regex breaks,
    // every other assertion in this file would trivially succeed. The real
    // count was ~90 across apps/web/src when this test was written.
    expect(sites.length).toBeGreaterThan(40)
    expect(sites.some((s) => s.helper === 'requireEffectiveRole')).toBe(true)
  })

  it('never tests an object-returning role helper for bare truthiness', () => {
    const offenders: string[] = []
    const cache = new Map<string, string[]>()

    for (const site of sites) {
      const abs = join(WEB_SRC, site.file)
      if (!cache.has(abs)) cache.set(abs, stripComments(readFileSync(abs, 'utf8')).split('\n'))
      if (!readsOk(site, cache.get(abs)!)) {
        offenders.push(`${site.file}:${site.line} — ${site.text}`)
      }
    }

    expect(
      offenders,
      `These call sites never read \`.ok\`, so the gate is inert — an object is always truthy:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
