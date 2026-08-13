// @vitest-environment node
/**
 * Contract: every report kind the codebase writes into projects.reports must
 * declare a read policy — either gated (REPORT_KIND_READ_ROLES) or explicitly
 * open (OPEN_READ_REPORT_KINDS).
 *
 * Without this, a new kind silently inherits the role-blind read described in
 * report-kind-access.ts: reports_select gates only on project access, so any
 * project member could list and download it. This test turns that from an
 * oversight into a deliberate, recorded decision.
 *
 * Verified to fail by adding a `kind: 'leaky_new_report'` writer — it names the
 * file and the kind.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPORT_KIND_READ_ROLES,
  OPEN_READ_REPORT_KINDS,
  hasDeclaredReadPolicy,
} from './report-kind-access'

const SRC_ROOT = path.resolve(__dirname, '../..')

/**
 * Blank comments so a `kind:` mentioned in prose is not treated as a writer.
 * Block comments are blanked line-for-line to preserve line numbers in failures
 * (the same technique the snag photo_type contract test needed after PR #159).
 */
function stripComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
  return out
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      walk(full, acc)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

/** Kinds written to projects.reports, as {kind, file} pairs. */
function findWrittenKinds(): Array<{ kind: string; file: string }> {
  const found: Array<{ kind: string; file: string }> = []
  for (const file of walk(SRC_ROOT)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    if (!src.includes("from('reports')")) continue

    // Every writer names the kind within the insert payload that follows the
    // .from('reports') call; scan forward from each occurrence.
    let idx = src.indexOf("from('reports')")
    while (idx !== -1) {
      const window = src.slice(idx, idx + 2000)
      const m = window.match(/kind:\s*'([a-z_]+)'/) ?? window.match(/\.eq\('kind',\s*'([a-z_]+)'\)/)
      if (m) found.push({ kind: m[1], file: path.relative(SRC_ROOT, file) })
      idx = src.indexOf("from('reports')", idx + 1)
    }
  }
  return found
}

describe('report kind read policy contract', () => {
  it('finds the known report writers (guards the scanner itself)', () => {
    const kinds = new Set(findWrittenKinds().map((f) => f.kind))
    // If this fails the scanner has stopped seeing writers — fix the scanner,
    // do not relax the assertion, or the contract below becomes vacuous.
    for (const expected of ['tenant_schedule', 'qc', 'snag', 'valuation', 'inspection', 'site_form']) {
      expect(kinds, `scanner lost sight of the '${expected}' writer`).toContain(expected)
    }
  })

  it('every written kind declares a read policy', () => {
    const undeclared = findWrittenKinds().filter((f) => !hasDeclaredReadPolicy(f.kind))
    expect(
      undeclared,
      `Report kinds written with no declared read policy:\n` +
        undeclared.map((u) => `  • '${u.kind}' in ${u.file}`).join('\n') +
        `\n\nAdd each to REPORT_KIND_READ_ROLES (gated) or OPEN_READ_REPORT_KINDS ` +
        `(open to project members) in report-kind-access.ts, and mirror any gated ` +
        `kind into public.report_kind_is_sensitive() in migration 00183.`,
    ).toEqual([])
  })

  it('a kind is not both gated and open', () => {
    const both = Object.keys(REPORT_KIND_READ_ROLES).filter((k) => OPEN_READ_REPORT_KINDS.includes(k))
    expect(both, `kinds listed as both gated and open: ${both.join(', ')}`).toEqual([])
  })

  it('gates equipment_materials and valuation on org write roles', () => {
    expect(REPORT_KIND_READ_ROLES.equipment_materials).toEqual(['owner', 'admin', 'project_manager'])
    expect(REPORT_KIND_READ_ROLES.valuation).toEqual(['owner', 'admin', 'project_manager'])
  })

  it('keeps the SQL sensitive-kind list in step with the TypeScript map', () => {
    const migration = fs.readFileSync(
      path.resolve(
        SRC_ROOT,
        '../../edge-functions/supabase/migrations/00183_report_notes_summary_and_kind_read_gate.sql',
      ),
      'utf8',
    )
    const m = migration.match(/SELECT _kind IN \(([^)]*)\)/)
    expect(m, 'report_kind_is_sensitive() not found in migration 00183').toBeTruthy()
    const sqlKinds = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    expect(sqlKinds).toEqual(Object.keys(REPORT_KIND_READ_ROLES).sort())
  })
})
