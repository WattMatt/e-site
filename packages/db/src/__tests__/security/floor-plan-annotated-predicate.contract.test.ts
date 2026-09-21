/**
 * CONTRACT — cloud-sync's `isAnnotated()` must see every table that anchors
 * geometry to a drawing.
 *
 * WHY THIS EXISTS. `cloud-sync-project` auto-adopts a newer Dropbox file into
 * an existing drawing by updating `file_path` on the SAME `tenants.floor_plans`
 * row. Anything that stored pixel coordinates against that drawing keeps its
 * numbers and now points at different pixels. `isAnnotated()` is the only thing
 * standing between a silent adopt and a drawing whose markup has quietly slid.
 *
 * It was written as a HAND-MAINTAINED LIST of four places geometry might live
 * (drawing-level calibration, `rfi_annotations`, `qc_entry_photos`, snag pins),
 * and the schema then moved underneath it three times:
 *
 *   - `cable_schedule.route_segments` (00192) — a traced cable run.
 *   - `tenants.floor_plan_page_scales` (00199) — the scale for page 2+. This
 *     one is the sharp edge: `calibrateFloorPlanAction` deliberately leaves
 *     `floor_plans.pixels_per_meter` NULL when `pageIndex > 1`, so a run traced
 *     on page 2 of a multi-page PDF failed ALL FOUR tests and its drawing was
 *     eligible for silent adoption.
 *   - `tenants.floor_plan_zones` (00006) — `polygon JSONB`, older than the
 *     predicate itself.
 *
 * WHAT THIS TEST CATCHES. Not a regression of the three fixes (a deleted branch
 * is visible in review). The failure it is really here for is the NEXT table:
 * someone adds a fifth kind of drawing-anchored geometry and the predicate is
 * quietly blind again.
 *
 * WHY IT IS DERIVED FROM THE SCHEMA. A test that re-typed the list of tables
 * from the same intent that wrote `isAnnotated()` would be a MIRROR: valid by
 * construction, able to confirm its author's belief and nothing else. This
 * project has shipped that mistake four times (the latin1 PDF extractor, the
 * 1x1-PNG fixture, `00204`'s hand-written `@verify` mirror). So the list of
 * tables under test is READ OUT OF THE MIGRATION CORPUS, and a table escapes
 * only by being named in DECLARED_EXEMPT with a written reason. Ask the fixture
 * question — what would the input have to look like for this to fail? — and the
 * answer is "a new migration adding a floor-plan-anchored table", which is
 * exactly the event it exists to catch.
 *
 * PARSER LIMITATION, STATED SO IT IS NOT MISTAKEN FOR COVERAGE. Discovery is
 * textual over `CREATE TABLE` bodies with comments stripped; a table created
 * through `EXECUTE format(...)` with an interpolated name would be invisible.
 * No migration does that today, and the `analyser can actually fail` block
 * below goes red the moment discovery starts matching nothing.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../../../..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')
const SYNC_FN = join(REPO_ROOT, 'apps/edge-functions/supabase/functions/cloud-sync-project/index.ts')

/**
 * Tables that reference a drawing but store NO geometry against it, so adopting
 * a new file under them changes nothing. Each needs a reason, and the reason has
 * to survive being read aloud.
 */
const DECLARED_EXEMPT: Record<string, string> = {
  'tenants.floor_plan_versions':
    'The sync ledger itself — one row per file version seen in cloud storage. It records ' +
    'the adopt rather than being invalidated by it; treating it as annotation would freeze ' +
    'every synced drawing forever.',
}

/**
 * NOT a gap this test can see, recorded so nobody thinks it is covered.
 * `cable_schedule.route_history` carries drawing geometry inside an opaque
 * `snapshot` JSONB and has no column naming a floor plan, so discovery cannot
 * find it — correctly, since column-based discovery is what keeps this test
 * from being a mirror. The residual window is narrow and real: delete every leg
 * of a route, let the drawing adopt a new file, then Restore. The restored legs
 * land as `route_segments`, which IS covered from that point on.
 */

// ─── the artefact under test ──────────────────────────────────────────────

function stripSqlComments(sql: string): string {
  // Block comments blanked line-for-line so line numbers survive for humans.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '')
}

/** Every `schema.table` whose CREATE TABLE body mentions a floor plan. */
function discoverDrawingAnchoredTables(): Map<string, string> {
  const found = new Map<string, string>() // qualified name -> first migration that defines it
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+\.[a-z_]+)\s*\(/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      const qualified = m[1].toLowerCase()
      // Walk to the matching close paren so we read this table's body only.
      let depth = 0
      let i = m.index + m[0].length - 1
      const start = i
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++
        else if (sql[i] === ')') {
          depth--
          if (depth === 0) break
        }
      }
      const body = sql.slice(start, i)
      // A column that names a floor plan: an FK to it, `source_floor_plan_id`,
      // or a pin/zone column carrying coordinates (`floor_plan_pin`).
      if (/floor_plan/i.test(body) && !qualified.startsWith('tenants.floor_plans')) {
        if (!found.has(qualified)) found.set(qualified, file)
      }
    }
  }
  return found
}

/** The body of `isAnnotated()` in the deployed sync function. */
function isAnnotatedBody(): string {
  const src = readFileSync(SYNC_FN, 'utf8')
  const start = src.indexOf('async function isAnnotated(')
  expect(start, 'isAnnotated() not found in cloud-sync-project/index.ts').toBeGreaterThan(-1)
  // Read to the first line that closes the function at column 0.
  const after = src.slice(start)
  const end = after.indexOf('\n}\n')
  expect(end, 'could not find the end of isAnnotated()').toBeGreaterThan(-1)
  return after.slice(0, end)
}

function predicateQueries(body: string, qualified: string): boolean {
  const [schema, table] = qualified.split('.')
  if (!body.includes(`.from('${table}')`)) return false
  if (schema !== 'public' && !body.includes(`.schema('${schema}')`)) return false
  return true
}

// ─── the contract ─────────────────────────────────────────────────────────

describe('cloud-sync isAnnotated() covers every drawing-anchored table', () => {
  const discovered = discoverDrawingAnchoredTables()
  const body = isAnnotatedBody()

  it('queries, or explicitly exempts, every table that anchors geometry to a drawing', () => {
    const blind: string[] = []
    for (const [qualified, file] of discovered) {
      if (qualified in DECLARED_EXEMPT) continue
      if (!predicateQueries(body, qualified)) blind.push(`${qualified} (defined in ${file})`)
    }

    expect(
      blind,
      'These tables store geometry against a drawing but isAnnotated() cannot see them, so ' +
        'cloud-sync will silently adopt a new file underneath them. Either query the table in ' +
        'isAnnotated() (fail-closed: any query error counts as annotated) or add it to ' +
        'DECLARED_EXEMPT with a reason.\n  ' + blind.join('\n  '),
    ).toEqual([])
  })

  it('still reads the drawing-level calibration', () => {
    // The one check that is not a table lookup: a calibrated drawing is annotated.
    expect(body).toContain('pixels_per_meter')
  })

  it('fails closed on a query error', () => {
    // The contract is structural, not textual: every lookup must be able to
    // exit "annotated", and the ONLY way out the bottom is a single
    // `return false`. A new query added without its error guard breaks the
    // first assertion; an early `return false` shortcut breaks the second.
    const lookups = (body.match(/\.from\(/g) ?? []).length
    const annotated = (body.match(/return true/g) ?? []).length
    const notAnnotated = (body.match(/return false/g) ?? []).length
    expect(lookups, 'isAnnotated() performs no lookups — discovery is broken').toBeGreaterThan(3)
    expect(annotated, 'a lookup was added without a fail-closed guard').toBeGreaterThanOrEqual(lookups)
    expect(notAnnotated, 'isAnnotated() must have exactly one negative exit, at the end').toBe(1)
  })

  // ── the analyser can actually fail ──────────────────────────────────────
  // Without these, a discovery regex that silently matched nothing would make
  // every assertion above pass vacuously — the failure mode this whole file
  // exists to refuse.
  describe('analyser can actually fail', () => {
    it('discovers the tables we know are there', () => {
      for (const known of [
        'public.rfi_annotations',
        'projects.qc_entry_photos',
        'field.snags',
        'cable_schedule.route_segments',
        'tenants.floor_plan_page_scales',
        'tenants.floor_plan_zones',
        'tenants.floor_plan_versions',
      ]) {
        expect([...discovered.keys()], `discovery missed ${known}`).toContain(known)
      }
    })

    it('reads a non-trivial predicate body', () => {
      expect(body.length).toBeGreaterThan(400)
      expect(body).toContain('floor_plans')
    })

    it('would report a table the predicate does not query', () => {
      // A table that exists and is deliberately NOT in isAnnotated: proves the
      // coverage check discriminates rather than passing everything.
      expect(predicateQueries(body, 'tenants.floor_plan_versions')).toBe(false)
      expect(predicateQueries(body, 'public.rfi_annotations')).toBe(true)
    })

    it('every exemption names a real table and gives a reason', () => {
      for (const [qualified, reason] of Object.entries(DECLARED_EXEMPT)) {
        expect([...discovered.keys()], `${qualified} is exempted but no longer exists`).toContain(qualified)
        expect(reason.length, `${qualified} needs a real reason`).toBeGreaterThan(60)
      }
    })
  })
})
