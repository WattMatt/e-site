/**
 * The grid's gestures, each run through the REAL `applyOps` and the engine: an op shape the
 * database would refuse fails here, not in production.
 */
import { describe, expect, it } from 'vitest'
import {
  applyOps, outlineRows, rowsToProgrammeInput, scheduleProgramme,
  type ActivityRow, type ProgrammeOp, type ProgrammeState,
} from '@esite/shared/programme'
import { activityRow, calendarRow, dependencyRow, programmeRow } from '@/lib/programme/test-fixtures'
import {
  addOps, deleteOps, indentOps, moveOps, outdentOps, LOE_NO_CHILDREN, MILESTONE_NO_CHILDREN,
} from './grid-ops'

type Row = Record<string, unknown>
const stateOf = (activities: Row[], dependencies: Row[] = []): ProgrammeState => ({
  programme: programmeRow(), calendars: [calendarRow('SITE')], exceptions: [],
  activities, dependencies, codeTypes: [], codeValues: [], activityCodes: [],
  fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
}) as unknown as ProgrammeState

/** Applies the ops for real, schedules the result, and returns the outline as `depth:name`. */
function accept(state: ProgrammeState, ops: ProgrammeOp[]): { outline: string[]; next: ProgrammeState } {
  const next = applyOps(state, ops)
  const sched = scheduleProgramme(rowsToProgrammeInput(next))
  expect(sched.issues.filter((i) => i.severity === 'error')).toEqual([])
  const byId = new Map(next.activities.map((a) => [a.id, a]))
  const outline = outlineRows(next.activities, new Set()).map((r) => `${r.depth}:${byId.get(r.id)!.name}`)
  return { outline, next }
}
const acts = (s: ProgrammeState) => s.activities as ActivityRow[]
const typeOf = (s: ProgrammeState, id: string) => s.activities.find((a) => a.id === id)!.type
const sel = (...ids: string[]) => new Set(ids)
const flat = (...names: string[]) => names.map((n, i) => activityRow(n, { sort_order: i + 1 }))
const kid = (id: string, parent: string, sort: number, over: Row = {}) => activityRow(id, { parent_id: parent, sort_order: sort, ...over })
const summary = (id: string, sort: number, over: Row = {}) => activityRow(id, { sort_order: sort, type: 'summary', original_duration: 0, ...over })

describe('indentOps', () => {
  it('puts the row under its previous sibling, which becomes a summary', () => {
    const s = stateOf(flat('A', 'B', 'C'))
    const r = indentOps(acts(s), sel('B'))
    expect(r.error).toBeNull()
    const { outline, next } = accept(s, r.ops)
    expect(outline).toEqual(['0:A', '1:B', '0:C'])
    expect(typeOf(next, 'A')).toBe('summary')
  })

  it('a block indents together and keeps its order', () => {
    const s = stateOf(flat('A', 'B', 'C'))
    expect(accept(s, indentOps(acts(s), sel('B', 'C')).ops).outline).toEqual(['0:A', '1:B', '1:C'])
  })

  it('the first row cannot indent; a block that includes it does nothing at all', () => {
    const s = stateOf(flat('A', 'B', 'C'))
    expect(indentOps(acts(s), sel('A'))).toEqual({ ops: [], error: null })
    expect(indentOps(acts(s), sel('A', 'B'))).toEqual({ ops: [], error: null })
  })

  it('is refused under a milestone or a level-of-effort row, with a sentence', () => {
    for (const type of ['finish_milestone', 'start_milestone']) {
      const s = stateOf([activityRow('M', { sort_order: 1, type, original_duration: 0 }), activityRow('B', { sort_order: 2 })])
      expect(indentOps(acts(s), sel('B'))).toEqual({ ops: [], error: MILESTONE_NO_CHILDREN })
    }
    const s = stateOf([activityRow('L', { sort_order: 1, type: 'level_of_effort' }), activityRow('B', { sort_order: 2 })])
    expect(indentOps(acts(s), sel('B'))).toEqual({ ops: [], error: LOE_NO_CHILDREN })
    expect(MILESTONE_NO_CHILDREN).toBe("A milestone can't have sub-activities.")
    expect(LOE_NO_CHILDREN).toBe("A level-of-effort activity can't have sub-activities.")
  })

  it('a task with a duration becomes a summary the engine accepts', () => {
    const s = stateOf([activityRow('A', { sort_order: 1, original_duration: 3 }), activityRow('B', { sort_order: 2 })])
    const { next } = accept(s, indentOps(acts(s), sel('B')).ops)
    expect(typeOf(next, 'A')).toBe('summary')
  })
})

describe('outdentOps (MS Project rule: the row keeps its place)', () => {
  it('A>{B,C,D}, outdent C → A>{B}, C>{D}; the visual order is unchanged', () => {
    const s = stateOf([summary('A', 1), kid('B', 'A', 1), kid('C', 'A', 2), kid('D', 'A', 3)])
    const r = outdentOps(acts(s), sel('C'))
    expect(r.error).toBeNull()
    const { outline, next } = accept(s, r.ops)
    expect(outline).toEqual(['0:A', '1:B', '0:C', '1:D'])
    expect(typeOf(next, 'C')).toBe('summary')
    expect(typeOf(next, 'A')).toBe('summary')
  })

  it('following siblings join after the row\'s own children', () => {
    const s = stateOf([summary('A', 1), summary('B', 1, { parent_id: 'A' }), kid('X', 'B', 1), kid('C', 'A', 2)])
    expect(accept(s, outdentOps(acts(s), sel('B')).ops).outline).toEqual(['0:A', '0:B', '1:X', '1:C'])
  })

  it('the last child out turns an emptied summary back into a task of at least one day', () => {
    const s = stateOf([summary('A', 1), kid('B', 'A', 1), activityRow('Z', { sort_order: 2 })])
    const { outline, next } = accept(s, outdentOps(acts(s), sel('B')).ops)
    expect(outline).toEqual(['0:A', '0:B', '0:Z'])
    const a = next.activities.find((x) => x.id === 'A')!
    expect(a.type).toBe('task')
    expect(a.original_duration).toBeGreaterThanOrEqual(1)
  })

  it('a block outdents together and keeps its order', () => {
    const s = stateOf([summary('A', 1), kid('B', 'A', 1), kid('C', 'A', 2), kid('D', 'A', 3)])
    expect(accept(s, outdentOps(acts(s), sel('B', 'C')).ops).outline).toEqual(['0:A', '0:B', '0:C', '1:D'])
  })

  it('a top-level row does nothing', () => {
    const s = stateOf(flat('A', 'B'))
    expect(outdentOps(acts(s), sel('B'))).toEqual({ ops: [], error: null })
  })

  it('a milestone with following siblings is refused (they would become its children)', () => {
    const s = stateOf([summary('A', 1), kid('M', 'A', 1, { type: 'finish_milestone', original_duration: 0 }), kid('D', 'A', 2)])
    expect(outdentOps(acts(s), sel('M'))).toEqual({ ops: [], error: MILESTONE_NO_CHILDREN })
  })

  it('a milestone that is the last child outdents fine', () => {
    const s = stateOf([summary('A', 1), kid('B', 'A', 1), kid('M', 'A', 2, { type: 'finish_milestone', original_duration: 0 })])
    expect(accept(s, outdentOps(acts(s), sel('M')).ops).outline).toEqual(['0:A', '1:B', '0:M'])
  })
})

describe('moveOps', () => {
  it('down, up, and a block up', () => {
    const s = stateOf(flat('A', 'B', 'C'))
    expect(accept(s, moveOps(acts(s), sel('A'), 'down')).outline).toEqual(['0:B', '0:A', '0:C'])
    expect(accept(s, moveOps(acts(s), sel('C'), 'up')).outline).toEqual(['0:A', '0:C', '0:B'])
    expect(accept(s, moveOps(acts(s), sel('B', 'C'), 'up')).outline).toEqual(['0:B', '0:C', '0:A'])
    expect(moveOps(acts(s), sel('A'), 'up')).toEqual([])
  })
})

describe('addOps', () => {
  it('a task below the anchor and a milestone at the end are both accepted', () => {
    const s = stateOf(flat('A', 'B'))
    expect(accept(s, addOps(acts(s), 'A', 'task', 'k1')).outline).toEqual(['0:A', '0:New task', '0:B'])
    const m = accept(s, addOps(acts(s), null, 'milestone', 'k2'))
    expect(m.outline).toEqual(['0:A', '0:B', '0:New milestone'])
    expect(m.next.activities.find((a) => a.name === 'New milestone')!.type).toBe('finish_milestone')
  })

  it('a task under a summary stays its sibling', () => {
    const s = stateOf([summary('P', 1), kid('K', 'P', 1)])
    expect(accept(s, addOps(acts(s), 'K', 'task', 'k1')).outline).toEqual(['0:P', '1:K', '1:New task'])
  })
})

describe('deleteOps', () => {
  it('a summary goes with its children, children first, links and all', () => {
    const s = stateOf([summary('P', 1), kid('K', 'P', 1), activityRow('Z', { sort_order: 2 })], [dependencyRow('D1', 'K', 'Z')])
    const { outline, next } = accept(s, deleteOps(acts(s), sel('P')))
    expect(outline).toEqual(['0:Z'])
    expect(next.dependencies).toEqual([])
  })

  it('deleting the last child turns its summary back into a task', () => {
    const s = stateOf([summary('P', 1), kid('K', 'P', 1)])
    const ops = deleteOps(acts(s), sel('K'))
    expect(ops).toContainEqual({ op: 'upsert_activity', id: 'P', fields: { type: 'task', original_duration: 1 } })
    const { next } = accept(s, ops)
    expect(typeOf(next, 'P')).toBe('task')
  })

  it('deleting one of two children leaves the summary alone', () => {
    const s = stateOf([summary('P', 1), kid('K1', 'P', 1), kid('K2', 'P', 2)])
    expect(accept(s, deleteOps(acts(s), sel('K1'))).outline).toEqual(['0:P', '1:K2'])
  })
})

describe('large selections (5,000 activities, 2,000 selected)', () => {
  const N = 5000
  const name = (i: number) => `R${String(i).padStart(4, '0')}`
  const parentOf = (ops: ProgrammeOp[]) => {
    const m = new Map<string, unknown>()
    for (const o of ops) if (o.op === 'upsert_activity' && 'id' in o && o.fields.parent_id !== undefined) m.set(o.id as string, o.fields.parent_id)
    return m
  }
  const timed = <T,>(f: () => T): { out: T; ms: number } => { const t = performance.now(); const out = f(); return { out, ms: performance.now() - t } }

  it('indent: every selected odd row goes under the row before it, all in one gesture', () => {
    const rows = Array.from({ length: N }, (_, i) => activityRow(name(i), { sort_order: i + 1 }))
    const selected = new Set(Array.from({ length: 2000 }, (_, k) => name(2 * k + 1)))
    const { out, ms } = timed(() => indentOps(rows as unknown as ActivityRow[], selected))
    expect(out.error).toBeNull()
    const parents = parentOf(out.ops)
    expect(parents.size).toBe(2000)
    for (let k = 0; k < 2000; k++) expect(parents.get(name(2 * k + 1))).toBe(name(2 * k))
    if (process.env.PERF_STRICT) expect(ms).toBeLessThan(150)
  })

  it('outdent: 2,000 children of one summary come out, each taking the next one as its child', () => {
    const rows = [summary('P', 1), ...Array.from({ length: N - 1 }, (_, i) => kid(name(i), 'P', i + 1))]
    const selected = new Set(Array.from({ length: 2000 }, (_, k) => name(2 * k + 1)))
    const { out, ms } = timed(() => outdentOps(rows as unknown as ActivityRow[], selected))
    expect(out.error).toBeNull()
    const parents = parentOf(out.ops)
    for (let k = 0; k < 2000; k++) {
      expect(parents.get(name(2 * k + 1))).toBe(null)
      // the unselected row after each outdented one becomes its child
      expect(parents.get(name(2 * k + 2))).toBe(name(2 * k + 1))
    }
    // the last outdented row also takes every row after the block
    expect(parents.get(name(N - 2))).toBe(name(3999))
    if (process.env.PERF_STRICT) expect(ms).toBeLessThan(150)
  })
})
