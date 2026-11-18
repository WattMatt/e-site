import { describe, expect, it } from 'vitest'
import { applyOps, ACT_FIELDS, type ProgrammeOp, type ProgrammeState } from '../persistence/ops'
import { activityRow, calendarRow, dependencyRow, programmeRow } from '../persistence/fixtures'
import { diffToOps } from './diff'

const base = (over: Partial<ProgrammeState> = {}): ProgrammeState => ({
  programme: programmeRow(), calendars: [calendarRow('SITE')], exceptions: [],
  activities: [], dependencies: [], codeTypes: [], codeValues: [], activityCodes: [],
  fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [], ...over,
})
const keys = () => { let n = 0; return () => `k${++n}` }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Writable view of non-tombstoned rows with ids replaced by names, so rows created under new ids compare. */
function view(s: ProgrammeState) {
  const live = s.activities.filter((a) => !a.is_tombstoned)
  const nameOf = new Map(live.map((a) => [a.id, a.name]))
  const acts = live.map((a) => {
    const o: Record<string, unknown> = {}
    for (const f of ACT_FIELDS) o[f] = a[f]
    o.parent_id = a.parent_id === null ? null : nameOf.get(a.parent_id)
    return o
  }).sort((x, y) => String(x.name).localeCompare(String(y.name)))
  const deps = s.dependencies.map((d) => [nameOf.get(d.pred_id), nameOf.get(d.succ_id), d.type, d.lag, d.lag_unit, d.lag_calendar].join('|')).sort()
  const p = s.programme
  return { acts, deps, prog: [p.name, p.data_date, p.project_start, JSON.stringify(p.options), p.default_calendar_id] }
}

describe('diffToOps: shape', () => {
  it('no change, no ops', () => {
    const s = base({ activities: [activityRow('A')] })
    expect(diffToOps(s, clone(s), keys())).toEqual([])
  })
  it('emits only changed writable fields, never cache columns', () => {
    const from = base({ activities: [activityRow('A', { name: 'A' })] })
    const to = clone(from)
    to.activities[0].name = 'Renamed'
    to.activities[0].early_start = '2026-04-01'
    to.activities[0].is_critical = true
    expect(diffToOps(from, to, keys())).toEqual([{ op: 'upsert_activity', id: 'A', fields: { name: 'Renamed' } }])
  })
  it('new rows carry a non-blank key from newKey and are created parents-first', () => {
    const from = base()
    const to = base({ activities: [
      activityRow('c', { name: 'child', parent_id: 'p' }), activityRow('p', { name: 'parent', type: 'summary', original_duration: 0 }),
    ], dependencies: [dependencyRow('d', 'p', 'c')] })
    const ops = diffToOps(from, to, keys())
    const creates = ops.filter((o) => o.op === 'upsert_activity')
    expect(creates.map((o) => (o as { fields: { name: string } }).fields.name)).toEqual(['parent', 'child'])
    for (const o of ops) if ('key' in o) expect((o as { key: string }).key.trim()).not.toBe('')
    expect((creates[1] as { fields: { parent_id: string } }).fields.parent_id).toBe((creates[0] as { key: string }).key)
    expect(view(applyOps(from, ops))).toEqual(view(to))
  })
  it('orders dependency deletes before activity deletes, children before parents', () => {
    const from = base({
      activities: [activityRow('P', { type: 'summary', original_duration: 0 }), activityRow('C', { parent_id: 'P' }), activityRow('K')],
      dependencies: [dependencyRow('d', 'C', 'K')],
    })
    const ops = diffToOps(from, base(), keys())
    expect(ops.map((o) => o.op)).toEqual(['delete_dependency', 'delete_activity', 'delete_activity', 'delete_activity'])
    const dels = ops.filter((o) => o.op === 'delete_activity').map((o) => (o as { id: string }).id)
    expect(dels.indexOf('C')).toBeLessThan(dels.indexOf('P'))
  })
  it('re-parent swap (parent and child trade places) applies without a cycle', () => {
    const from = base({ activities: [activityRow('A', { name: 'A' }), activityRow('B', { name: 'B', parent_id: 'A' })] })
    const to = clone(from)
    to.activities[0].parent_id = 'B'
    to.activities[1].parent_id = null
    expect(view(applyOps(from, diffToOps(from, to, keys())))).toEqual(view(to))
  })
  it('set_programme only for changed programme fields', () => {
    const from = base()
    const to = clone(from)
    to.programme.name = 'New name'
    to.programme.data_date = '2026-04-01'
    to.programme.project_finish = '2027-01-01'
    expect(diffToOps(from, to, keys())).toEqual([{ op: 'set_programme', fields: { name: 'New name', data_date: '2026-04-01' } }])
  })
  it('updates a changed link by id', () => {
    const from = base({ activities: [activityRow('A'), activityRow('B')], dependencies: [dependencyRow('d', 'A', 'B')] })
    const to = clone(from)
    to.dependencies[0].lag = 2
    to.dependencies[0].type = 'SS'
    expect(diffToOps(from, to, keys())).toEqual([{ op: 'upsert_dependency', id: 'd', type: 'SS', lag: 2 }])
  })
})

describe('diffToOps: tombstones', () => {
  it('a tombstoned row in `from` that is live in `to` is RESTORED under its own id, then updated, then re-linked', () => {
    const from = base({ activities: [activityRow('A', { name: 'A', is_tombstoned: true }), activityRow('B', { name: 'B' })] })
    const to = base({ activities: [activityRow('A', { name: 'A renamed' }), activityRow('B', { name: 'B' })], dependencies: [dependencyRow('d', 'B', 'A')] })
    const ops = diffToOps(from, to, keys())
    expect(ops.map((o) => o.op)).toEqual(['restore_activity', 'upsert_activity', 'upsert_dependency'])
    expect(ops[0]).toEqual({ op: 'restore_activity', id: 'A' })
    expect(ops[1]).toEqual({ op: 'upsert_activity', id: 'A', fields: { name: 'A renamed' } })
    const out = applyOps(from, ops)
    expect(view(out)).toEqual(view(to))
    expect(out.activities.filter((a) => a.name.startsWith('A'))).toHaveLength(1)
  })
  it('undo of a delete restores an activity with external_uid and field-update history under the same id', () => {
    const live = base({
      activities: [activityRow('A', { name: 'A', external_uid: 'X-1' }), activityRow('B', { name: 'B' })],
      dependencies: [dependencyRow('d', 'A', 'B')], fieldUpdateActivityIds: ['A'],
    })
    const deleted = applyOps(live, diffToOps(live, base({ activities: [activityRow('B', { name: 'B' })], fieldUpdateActivityIds: ['A'] }), keys()))
    expect(deleted.activities.find((a) => a.id === 'A')?.is_tombstoned).toBe(true)
    const undone = applyOps(deleted, diffToOps(deleted, live, keys()))
    const a = undone.activities.filter((x) => x.external_uid === 'X-1')
    expect(a).toHaveLength(1)
    expect(a[0].id).toBe('A')
    expect(a[0].is_tombstoned).toBe(false)
    expect(view(undone)).toEqual(view(live))
  })
  it('restores a deleted parent before its deleted child', () => {
    const from = base({ activities: [activityRow('P', { name: 'P', type: 'summary', original_duration: 0, is_tombstoned: true }),
      activityRow('C', { name: 'C', parent_id: 'P', is_tombstoned: true })] })
    const to = base({ activities: [activityRow('C', { name: 'C', parent_id: 'P' }), activityRow('P', { name: 'P', type: 'summary', original_duration: 0 })] })
    const ops = diffToOps(from, to, keys())
    expect(ops.map((o) => (o as { id: string }).id)).toEqual(['P', 'C'])
    expect(view(applyOps(from, ops))).toEqual(view(to))
  })
  it('link updates precede link creates (no transient duplicate)', () => {
    const from = base({ activities: [activityRow('A'), activityRow('B')], dependencies: [dependencyRow('d1', 'A', 'B')] })
    const to = clone(from)
    to.dependencies = [dependencyRow('d3', 'A', 'B'), { ...dependencyRow('d1', 'A', 'B'), type: 'SS' }]
    expect(view(applyOps(from, diffToOps(from, to, keys())))).toEqual(view(to))
  })
  it('deleting a row with history tombstones it; a tombstone in both sides is untouched', () => {
    const from = base({ activities: [activityRow('A'), activityRow('T', { is_tombstoned: true })], baselineActivityIds: ['A'] })
    const to = base({ activities: [activityRow('T', { is_tombstoned: true })] })
    const out = applyOps(from, diffToOps(from, to, keys()))
    expect(view(out)).toEqual(view(to))
    expect(out.activities.find((a) => a.id === 'A')?.is_tombstoned).toBe(true)
  })
  it('a row tombstoned in `to` but live in `from` becomes a delete', () => {
    const from = base({ activities: [activityRow('A')] })
    const to = base({ activities: [activityRow('A', { is_tombstoned: true })] })
    expect(diffToOps(from, to, keys())).toEqual([{ op: 'delete_activity', id: 'A' }])
  })
})

// --- property: 100 seeded random edits ---------------------------------------------------
function rng(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function seedState(r: () => number): ProgrammeState {
  const n = 4 + Math.floor(r() * 5)
  const acts = []
  for (let i = 0; i < n; i++) {
    const parent = i > 0 && r() < 0.4 ? `a${Math.floor(r() * i)}` : null
    acts.push(activityRow(`a${i}`, { name: `Act ${i}`, parent_id: parent, original_duration: 1 + Math.floor(r() * 9), sort_order: i + 1 }))
  }
  const deps = []
  for (let i = 1; i < n; i++) if (r() < 0.6) deps.push(dependencyRow(`d${i}`, `a${Math.floor(r() * i)}`, `a${i}`))
  return base({ activities: acts, dependencies: deps })
}

/** One random edit of `s` (add, delete, move, re-parent, link, unlink, rename); returns the edited copy. */
function edit(s: ProgrammeState, r: () => number, serial: number): ProgrammeState {
  const t = clone(s)
  const live = t.activities.filter((a) => !a.is_tombstoned)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const descendantOf = (id: string, anc: string): boolean => {
    let cur: string | null = id
    while (cur) { if (cur === anc) return true; cur = t.activities.find((a) => a.id === cur)?.parent_id ?? null }
    return false
  }
  const kind = Math.floor(r() * 7)
  if (kind === 0 || live.length < 2) { // add
    const parent = live.length > 0 && r() < 0.5 ? pick(live).id : null
    t.activities.push(activityRow(`n${serial}`, { name: `New ${serial}`, parent_id: parent, original_duration: 1 + Math.floor(r() * 5), sort_order: 100 + serial }))
  } else if (kind === 1) { // delete (leaf only, as the UI does; its links go with it)
    const leaf = live.filter((a) => !live.some((x) => x.parent_id === a.id))
    const gone = pick(leaf).id
    t.activities = t.activities.filter((a) => a.id !== gone)
    t.dependencies = t.dependencies.filter((d) => d.pred_id !== gone && d.succ_id !== gone)
  } else if (kind === 2) { // move (sort order / duration)
    const a = pick(live)
    a.sort_order = Math.floor(r() * 50)
    a.original_duration = Math.floor(r() * 12)
  } else if (kind === 3) { // re-parent without a cycle
    const a = pick(live)
    const cands = live.filter((x) => !descendantOf(x.id, a.id))
    a.parent_id = r() < 0.3 ? null : pick(cands).id
  } else if (kind === 4) { // link
    const p = pick(live), q = pick(live)
    const dup = t.dependencies.some((d) => d.pred_id === p.id && d.succ_id === q.id && d.type === 'FS')
    if (p.id !== q.id && !dup) t.dependencies.push(dependencyRow(`nd${serial}`, p.id, q.id, { lag: Math.floor(r() * 4) }))
  } else if (kind === 5) { // unlink
    if (t.dependencies.length > 0) { const gone = pick(t.dependencies).id; t.dependencies = t.dependencies.filter((d) => d.id !== gone) }
  } else { // rename
    pick(live).name = `Renamed ${serial}`
  }
  return t
}

describe('diffToOps property: applyOps(from, diff(from, to)) equals to on every writable field', () => {
  for (let seed = 1; seed <= 100; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed)
      const from = seedState(r)
      if (seed % 2 === 1) { from.baselineActivityIds = from.activities.map((a) => a.id); from.activities.forEach((a, i) => { if (i % 2 === 0) a.external_uid = `X${i}` }) }
      let to = from
      const steps = 1 + Math.floor(r() * 5)
      for (let i = 0; i < steps; i++) to = edit(to, r, seed * 10 + i)
      if (r() < 0.3) to.programme.name = `Prog ${seed}`
      const nextKey = keys() // one counter for the whole trip: a key becomes a row id, so reuse would collide
      const ops: ProgrammeOp[] = diffToOps(from, to, nextKey)
      const out = applyOps(from, ops)
      expect(view(out)).toEqual(view(to))
      // and the reverse trip (undo) lands back on `from`
      const back = applyOps(out, diffToOps(out, from, nextKey))
      expect(view(back)).toEqual(view(from))
      // with history (odd seeds) a delete tombstones, so the undo restores the SAME id
      if (seed % 2 === 1) for (const a of from.activities) if (to.activities.some((x) => x.id === a.id) === false) {
        expect(back.activities.find((x) => x.id === a.id)?.is_tombstoned).toBe(false)
      }
    })
  }
})
