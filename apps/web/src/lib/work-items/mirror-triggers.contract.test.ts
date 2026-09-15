import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Structural contract for the work-item source mirrors (00199): the things
 * that were measured on production and cannot be re-learned by reading the
 * migration in review. Each test names the failure it guards; each was
 * proved to bite by mutating a scratch copy of the migration (Task 12 Step 8).
 *
 * The migration is located by CONTENT (the delete-to-void function it
 * defines), never by number.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')
const MIG_DIR = join(REPO_ROOT, 'apps/edge-functions/supabase/migrations')

function mirrorMigration(): { name: string; sql: string } {
  for (const n of readdirSync(MIG_DIR).sort()) {
    const sql = readFileSync(join(MIG_DIR, n), 'utf8')
    if (sql.includes('projects.void_work_item_on_source_delete')) return { name: n, sql }
  }
  throw new Error('no migration defines projects.void_work_item_on_source_delete')
}

/** Strip block and whole-line comments so prose ABOUT the bug does not read AS the bug. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*--.*$/gm, '')
}

const SOURCES = [
  ['rfis', 'projects.rfis'],
  ['snags', 'field.snags'],
  ['inspections', 'inspections.inspections'],
  ['qc_entries', 'projects.qc_entries'],
  ['site_diary_entries', 'projects.site_diary_entries'],
  ['site_forms', 'field.site_forms'],
] as const

describe('work-item source mirrors: structural contract', () => {
  const { name, sql } = mirrorMigration()
  const code = stripComments(sql)

  it('every delete-to-void trigger is BEFORE DELETE, never AFTER', () => {
    const triggers = [...code.matchAll(
      /CREATE TRIGGER\s+(\w+)\s+(BEFORE|AFTER)\s+DELETE\s+ON\s+([\w.]+)[\s\S]{0,200}?void_work_item_on_source_delete/gi,
    )]
    expect(triggers.length, 'expected six delete-to-void triggers').toBe(6)
    const wrong = triggers.filter((t) => t[2].toUpperCase() !== 'BEFORE')
      .map((t) => `${t[1]} ON ${t[3]} is ${t[2]} DELETE`)
    expect(
      wrong,
      `${name}: an AFTER DELETE trigger cannot void the item. The ON DELETE SET NULL ` +
      `referential action runs first, and work_items_source_required is re-evaluated on ` +
      `that update while the item is still open with no source — so the DELETE aborts ` +
      `with 23514 and deleting an RFI/snag/diary entry stops working. Measured, not theorised.`,
    ).toEqual([])
  })

  it('F7: every source has an _ins trigger and an _upd trigger with a WHEN clause', () => {
    for (const [prefix, table] of SOURCES) {
      const ins = new RegExp(
        `CREATE TRIGGER\\s+${prefix}_mirror_work_item_ins\\s+AFTER INSERT ON\\s+${table.replace('.', '\\.')}`, 'i')
      expect(code, `${prefix}: missing an AFTER INSERT trigger on ${table}`).toMatch(ins)

      const updMatch = code.match(new RegExp(
        `CREATE TRIGGER\\s+${prefix}_mirror_work_item_upd[\\s\\S]*?EXECUTE FUNCTION`, 'i'))
      expect(updMatch, `${prefix}: missing an AFTER UPDATE trigger on ${table}`).not.toBeNull()
      expect(
        updMatch![0],
        `${prefix}_mirror_work_item_upd must carry the §03 §1.2 WHEN predicate. ` +
        `PostgreSQL rejects WHEN(OLD…) on a trigger whose events include INSERT, which is ` +
        `why the declaration is split in two rather than dropped.`,
      ).toMatch(/\bWHEN\s*\(\s*OLD\./i)
      expect(
        updMatch![0],
        `${prefix}_mirror_work_item_upd must watch project_id: §15's rollout moves snags to ` +
        `KINGSWALK, and an item left on the old project keeps the wrong scope and people.`,
      ).toMatch(/OLD\.project_id\s+IS DISTINCT FROM\s+NEW\.project_id/i)
    }
  })

  it('every mirror trigger wrapper carries the pg_trigger_depth guard', () => {
    const fns = [...code.matchAll(
      /CREATE OR REPLACE FUNCTION\s+(projects\.mirror_\w+)\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g,
    )]
    expect(fns.length, 'expected the seven mirror trigger wrappers').toBe(7)
    const unguarded = fns
      .filter((f) => !/pg_trigger_depth\(\)\s*>\s*1/.test(f[2]))
      .map((f) => f[1])
    expect(unguarded, `unguarded mirror wrappers: ${unguarded.join(', ')}`).toEqual([])
  })

  it('the projection bodies are callable directly and carry NO depth guard', () => {
    const bodies = [...code.matchAll(
      /CREATE OR REPLACE FUNCTION\s+(projects\.project_\w+)\s*\(p_\w+ uuid\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/g,
    )]
    expect(bodies.length, 'expected six projects.project_<source>(uuid) bodies').toBe(6)
    const guarded = bodies.filter((b) => /pg_trigger_depth/.test(b[2])).map((b) => b[1])
    expect(
      guarded,
      `${guarded.join(', ')} must NOT carry a depth guard: the backfill calls these directly ` +
      `(at depth 0) precisely so it never UPDATEs a source row and never rewrites updated_at ` +
      `on ~40 live rows through their set_updated_at triggers.`,
    ).toEqual([])
  })

  it('the backfill never UPDATEs a source table', () => {
    const offenders = [
      ...code.matchAll(/UPDATE\s+(projects\.rfis|field\.snags|inspections\.inspections|projects\.qc_entries|projects\.site_diary_entries|field\.site_forms)\b/gi),
    ].map((m) => m[0])
    // The write-back legitimately updates rfis and snags; nothing else may.
    const illegal = offenders.filter((o) => !/projects\.rfis|field\.snags/i.test(o))
    expect(
      illegal,
      `${illegal.join(', ')}: every source table carries a BEFORE UPDATE set_updated_at ` +
      `trigger, so touching one rewrites live history. Project through projects.project_*().`,
    ).toEqual([])
  })

  it('the write-back function deliberately has NO depth guard', () => {
    const m = code.match(
      /CREATE OR REPLACE FUNCTION\s+projects\.work_item_assignment_writeback\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
    )
    expect(m, 'work_item_assignment_writeback not found').not.toBeNull()
    expect(
      /pg_trigger_depth/.test(m![1]),
      'A depth guard here silently loses the write-back: work_items.assignee_id names the ' +
      'resolved holder while rfis.assigned_to stays NULL and the RFI page renders nothing. ' +
      'Termination comes from the mirror wrappers, proved by mutation.',
    ).toBe(false)
  })

  it('the write-back skips closed and void records', () => {
    const m = code.match(
      /CREATE OR REPLACE FUNCTION\s+projects\.work_item_assignment_writeback\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
    )
    expect(
      m![1],
      '6 of 15 live RFIs are already closed. Stamping assigned_to on them makes the RFI page ' +
      'render an assignee nobody ever set — the as_left_status lesson.',
    ).toMatch(/NEW\.status IN \('closed','void'\)/)
  })

  it('the diary projection is gated on diary_delay_text, not on a non-empty box', () => {
    const m = code.match(
      /CREATE OR REPLACE FUNCTION\s+projects\.project_diary_action\s*\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
    )
    expect(m, 'projects.project_diary_action not found').not.toBeNull()
    expect(
      m![1],
      'All 6 of 6 live site_diary_entries delay values are negations (measured 2026-09-10). ' +
      'A COALESCE(NULLIF(TRIM(...))) predicate measures whether the box was filled in.',
    ).toMatch(/projects\.diary_delay_text\(/)
  })

  it('nothing in this migration attaches a trigger to structure.node_orders', () => {
    const offenders = [...code.matchAll(/CREATE TRIGGER\s+\w+[\s\S]{0,200}?ON\s+(structure\.node_orders)/gi)]
      .map((m) => m[0].split('\n')[0].trim())
    expect(
      offenders,
      'A(b): order_followup is created ONLY by the explicit chase control on an order line. ' +
      'A projection trigger here would put 440 live procurement rows into inboxes on day one.',
    ).toEqual([])
  })

  it('F8: the replaced transition guard exempts depth > 1 (never > 0) and freezes source_status', () => {
    const m = code.match(
      /CREATE OR REPLACE FUNCTION\s+projects\.work_items_transition_guard\s*\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/,
    )
    expect(m, 'the guard replacement (section C′) is missing — every mirror UPDATE in a signed-in session is refused without it').not.toBeNull()
    expect(m![1], '00196:1590-1605 prescribes pg_trigger_depth() > 1').toMatch(/pg_trigger_depth\(\)\s*>\s*1/)
    expect(
      /pg_trigger_depth\(\)\s*>\s*0/.test(m![1]),
      '> 0 exempts every direct client UPDATE (a top-level statement\'s trigger runs at depth 1) — the guard would be disabled',
    ).toBe(false)
    expect(m![1], 'source_status must join clause (a): from this migration the projection is its only writer').toMatch(/NEW\.source_status\s+IS DISTINCT FROM\s+OLD\.source_status/)
    // The mirror wrappers' guard must NOT be weakened to match.
    expect(code).not.toMatch(/mirror_\w+[\s\S]{0,400}?pg_trigger_depth\(\)\s*>\s*0/)
  })
})
