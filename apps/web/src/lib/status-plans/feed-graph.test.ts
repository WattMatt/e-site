// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { MAIN_BOARD_PALETTE } from '@esite/shared/status-plans'
import { fakeClient, queued, opsOf } from './__fixtures__/fake-client'
import { loadProjectFeedGraph, pickFeedRevision, planFeedFrom, type RevisionRow } from './feed-graph'

const rev = (id: string, status: string, issued: string | null, created: string): RevisionRow =>
  ({ id, code: id.toUpperCase(), status, issued_at: issued, created_at: created })

describe('pickFeedRevision', () => {
  it('the latest ISSUED revision, even when a newer DRAFT exists', () => {
    const rows = [
      rev('r1', 'SUPERSEDED', '2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z'),
      rev('r2', 'ISSUED', '2026-08-01T00:00:00Z', '2026-07-01T00:00:00Z'),
      rev('r3', 'DRAFT', null, '2026-10-01T00:00:00Z'),
    ]
    expect(pickFeedRevision(rows)?.id).toBe('r2')
  })
  it('an ISSUED row without issued_at sorts after one with it', () => {
    const rows = [rev('a', 'ISSUED', null, '2026-09-01T00:00:00Z'), rev('b', 'ISSUED', '2026-06-01T00:00:00Z', '2026-05-01T00:00:00Z')]
    expect(pickFeedRevision(rows)?.id).toBe('b')
  })
  it('no ISSUED revision: the newest by created_at, whatever its status', () => {
    const rows = [rev('a', 'SUPERSEDED', null, '2026-01-01T00:00:00Z'), rev('b', 'DRAFT', null, '2026-03-01T00:00:00Z')]
    expect(pickFeedRevision(rows)?.id).toBe('b')
  })
  it('none at all: null', () => {
    expect(pickFeedRevision([])).toBeNull()
  })
})

describe('loadProjectFeedGraph', () => {
  const revisions = [rev('rev-1', 'SUPERSEDED', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), rev('rev-2', 'ISSUED', '2026-09-01T00:00:00Z', '2026-08-01T00:00:00Z')]

  it('reads the chosen revision\'s supplies (paged) and the project\'s live main boards', async () => {
    const { client, calls } = fakeClient(queued({
      'cable_schedule.revisions:select': [{ data: revisions }],
      'cable_schedule.supplies:select': [{ data: [
        { id: 's1', from_node_id: 'mb', to_node_id: 'db1' },
        { id: 's2', from_node_id: null, to_node_id: 'mb' },     // fed from a source: no edge
        { id: 's3', from_node_id: 'mb', to_node_id: null },
      ] }],
      'structure.nodes:select': [{ data: [
        { id: 'mb', kind: 'main_board', code: 'MB-1.1', name: 'MAIN BOARD 1.1' },
        { id: 'mb2', kind: 'main_board', code: null, name: 'MAIN BOARD 2.1' },
        { id: 'db1', kind: 'tenant_db', code: 'DB-1', name: null },   // a fake that ignores the kind filter must not make it a board
      ] }],
    }))
    const g = await loadProjectFeedGraph(client, 'p1')
    expect(g).toEqual({
      ok: true, revisionId: 'rev-2', revisionCode: 'REV-2',
      edges: [{ from: 'mb', to: 'db1' }],
      boards: [{ id: 'mb', name: 'MB-1.1' }, { id: 'mb2', name: 'MAIN BOARD 2.1' }],
    })
    expect(opsOf(calls, 'cable_schedule.revisions')).toContainEqual(['eq', ['project_id', 'p1']])
    const sup = opsOf(calls, 'cable_schedule.supplies')
    expect(sup).toContainEqual(['eq', ['revision_id', 'rev-2']])
    expect(sup).toContainEqual(['order', ['id']])
    expect(sup).toContainEqual(['range', [0, 999]])
    const nodes = opsOf(calls, 'structure.nodes')
    expect(nodes).toContainEqual(['eq', ['project_id', 'p1']])
    expect(nodes).toContainEqual(['eq', ['kind', 'main_board']])
    expect(nodes).toContainEqual(['is', ['deleted_at', null]])
  })

  it('pages supplies past the 1 000-row cap', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}`, from_node_id: 'mb', to_node_id: `d${i}` }))
    const { client, calls } = fakeClient(queued({
      'cable_schedule.revisions:select': [{ data: revisions }],
      'cable_schedule.supplies:select': [{ data: page1 }, { data: [{ id: 's1000', from_node_id: 'mb', to_node_id: 'd1000' }] }],
      'structure.nodes:select': [{ data: [{ id: 'mb', kind: 'main_board', code: 'MB', name: null }] }],
    }))
    const g = await loadProjectFeedGraph(client, 'p1')
    expect(g.ok && g.edges.length).toBe(1001)
    expect(calls.filter((c) => c.table === 'cable_schedule.supplies')).toHaveLength(2)
  })

  it('no revision: says so and reads no supplies', async () => {
    const { client, calls } = fakeClient(queued({ 'cable_schedule.revisions:select': [{ data: [] }] }))
    expect(await loadProjectFeedGraph(client, 'p1')).toEqual({ ok: false, reason: 'no_revision' })
    expect(calls.map((c) => c.table)).not.toContain('cable_schedule.supplies')
  })

  it('any read error is "unreadable", never an empty graph', async () => {
    const revErr = fakeClient(queued({ 'cable_schedule.revisions:select': [{ error: { message: 'permission denied' } }] }))
    expect(await loadProjectFeedGraph(revErr.client, 'p1')).toEqual({ ok: false, reason: 'unreadable' })
    const supErr = fakeClient(queued({
      'cable_schedule.revisions:select': [{ data: revisions }],
      'cable_schedule.supplies:select': [{ error: { message: 'timeout' } }],
      'structure.nodes:select': [{ data: [] }],
    }))
    expect(await loadProjectFeedGraph(supErr.client, 'p1')).toEqual({ ok: false, reason: 'unreadable' })
    const thrown = { schema: () => { throw new Error('boom') } }
    expect(await loadProjectFeedGraph(thrown, 'p1')).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('planFeedFrom', () => {
  it('colours the boards by sorted name and answers every node', () => {
    const feed = planFeedFrom({
      ok: true, revisionId: 'r', revisionCode: 'Rev 2',
      edges: [{ from: 'mb2', to: 'db1' }, { from: 'mb1', to: 'db1' }, { from: 'mb1', to: 'db2' }],
      boards: [{ id: 'mb2', name: 'MB 2.1' }, { id: 'mb1', name: 'MB 1.1' }],
    }, ['db1', 'db2', 'db3'])
    expect(feed).toEqual({
      state: 'ok',
      revisionCode: 'Rev 2',
      boards: [{ id: 'mb1', name: 'MB 1.1', colour: MAIN_BOARD_PALETTE[0] }, { id: 'mb2', name: 'MB 2.1', colour: MAIN_BOARD_PALETTE[1] }],
      byNode: { db1: { boardId: 'mb1', also: ['mb2'] }, db2: { boardId: 'mb1', also: [] }, db3: null },
    })
  })
  it('a failed read, no revision or no main boards is "unavailable" with a sentence — never every shop grey', () => {
    expect(planFeedFrom({ ok: false, reason: 'unreadable' }, ['db1'])).toEqual({
      state: 'unavailable',
      reason: 'Main board view unavailable — the cable schedule could not be read.',
      omission: 'the cable schedule could not be read',
    })
    expect(planFeedFrom({ ok: false, reason: 'no_revision' }, ['db1'])).toMatchObject({ state: 'unavailable', reason: 'Main board view unavailable — no cable schedule is visible to you on this project.', omission: 'no cable schedule is visible to you on this project' })
    expect(planFeedFrom({ ok: true, revisionId: 'r', revisionCode: 'Rev 1', edges: [], boards: [] }, ['db1']))
      .toMatchObject({ state: 'unavailable', omission: 'the cable schedule has no main boards' })
  })
})
