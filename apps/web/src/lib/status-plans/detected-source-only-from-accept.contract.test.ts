import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Contract test: a shape is saved with `source: 'detected'` from exactly one
 * place, and that place is the person pressing Accept on a suggested outline.
 *
 * The floor-plan label detection feature suggests a flood-fill outline for each
 * shop label. The spec's anti-goal is one of those outlines being persisted
 * without a person accepting it. The only call of `createStatusPlanShapeAction`
 * that passes `source: 'detected'` is `acceptSuggestion` in `ShopsPanel.tsx`
 * (the click handler behind the Accept button). A second call site, in any
 * other file or any other function, would be a path that can save a detected
 * outline without that click, so it fails here.
 *
 * Unit tests of ShopsPanel cannot see this: they prove Accept saves, not that
 * nothing else does. So this scans the source.
 */

// apps/web/src/lib/status-plans → apps/web/src
const WEB_SRC = resolve(__dirname, '../..')
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|build|__fixtures__)(\/|$)/
const CODE_EXT = /\.(ts|tsx)$/
const TEST_FILE = /\.test\.(ts|tsx)$/

const CALL = 'createStatusPlanShapeAction('
const DETECTED = /source\s*:\s*(['"`])detected\1/
const ALLOWED_FILE_SUFFIX = '_plans/ShopsPanel.tsx'
const ALLOWED_FUNCTION = 'acceptSuggestion'

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (SKIP_DIR.test(full.split('\\').join('/'))) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.test(full) && !TEST_FILE.test(full)) out.push(full)
  }
}

/**
 * Strip comments so prose about the call doesn't read as the call. Block
 * comments keep their newlines and whole-line `//` and `*` lines are blanked,
 * so line numbers in the result match the real file. (Same approach as
 * snag-photo-type.contract.test.ts: a `//` after code is left alone, so a URL
 * in a string can't truncate a line.)
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

/** Text from just after the call's `(` to its matching `)`, or a generous window. */
function argumentText(src: string, openParenEnd: number): string {
  let depth = 1
  for (let i = openParenEnd; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return src.slice(openParenEnd, i)
  }
  return src.slice(openParenEnd, openParenEnd + 2000)
}

/** The nearest `function name` declaration above `index`, or null. */
function enclosingFunction(src: string, index: number): string | null {
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)/g
  let name: string | null = null
  for (const m of src.slice(0, index).matchAll(re)) name = m[1]!
  return name
}

interface Site { file: string; line: number; fn: string | null }

function collectDetectedCalls(): Site[] {
  const files: string[] = []
  walk(WEB_SRC, files)

  const sites: Site[] = []
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'))
    let from = 0
    for (;;) {
      const at = src.indexOf(CALL, from)
      if (at === -1) break
      from = at + CALL.length
      // Skip the declaration `export async function createStatusPlanShapeAction(`.
      if (/\bfunction\s+$/.test(src.slice(Math.max(0, at - 20), at))) continue
      if (!DETECTED.test(argumentText(src, at + CALL.length))) continue
      sites.push({
        file: file.slice(WEB_SRC.length + 1).split('\\').join('/'),
        line: src.slice(0, at).split('\n').length,
        fn: enclosingFunction(src, at),
      })
    }
  }
  return sites
}

const describeSite = (s: Site) => `${s.file}:${s.line} in ${s.fn ?? '(no enclosing function)'}`

describe("a detected outline is saved only from Accept (source: 'detected' contract)", () => {
  it('finds the Accept call (the scan is actually working, not vacuous)', () => {
    expect(collectDetectedCalls().length).toBeGreaterThan(0)
  })

  it("exactly one createStatusPlanShapeAction call passes source: 'detected'", () => {
    const sites = collectDetectedCalls()
    expect(
      sites.length,
      "createStatusPlanShapeAction({ source: 'detected' }) must be called from exactly one place, " +
        `the Accept handler. Found ${sites.length}: ${sites.map(describeSite).join('; ')}`,
    ).toBe(1)
  })

  it('that call is in ShopsPanel.tsx, inside acceptSuggestion', () => {
    const offenders = collectDetectedCalls().filter(
      (s) => !s.file.endsWith(ALLOWED_FILE_SUFFIX) || s.fn !== ALLOWED_FUNCTION,
    )
    expect(
      offenders.map(describeSite),
      `A detected outline may be saved only by ${ALLOWED_FUNCTION}() in ...${ALLOWED_FILE_SUFFIX}, ` +
        'after a person presses Accept. These call sites save one some other way:',
    ).toEqual([])
  })
})
