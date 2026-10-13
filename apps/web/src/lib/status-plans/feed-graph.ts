/**
 * The feed graph for "Floor plan by main board" (spec 2026-10-13 §1).
 *
 * structure.nodes.parent_node_id is NULL everywhere, so the feed path is the cable
 * schedule's supplies (from_node_id → to_node_id) in ONE revision: the latest ISSUED,
 * else the latest by created_at. Read through the CALLER's session — RLS and site scope
 * on cable_schedule are the gate; a role that cannot see the schedule gets "unavailable",
 * never a picture of every shop in grey. Supplies are paged (readAll): a schedule can
 * pass PostgREST's 1 000-row cap. Never throws.
 */
import {
  boardColours, compareBoardNames, feedsFor,
  type FeedBoard, type FeedEdge,
} from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'
import type { PlanFeed } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RevisionRow {
  id: string
  code: string
  status: string
  issued_at: string | null
  created_at: string
}

export type FeedGraph =
  | { ok: true; revisionId: string; revisionCode: string; edges: FeedEdge[]; boards: FeedBoard[] }
  | { ok: false; reason: 'no_revision' | 'unreadable' }

type Unavailable = 'no_revision' | 'unreadable' | 'no_boards'

const FEED_UNAVAILABLE: Record<Unavailable, string> = {
  unreadable: 'Main board view unavailable — the cable schedule could not be read.',
  no_revision: 'Main board view unavailable — no cable schedule is visible to you on this project.',
  no_boards: 'Main board view unavailable — the cable schedule has no main boards.',
}
const FEED_OMISSION: Record<Unavailable, string> = {
  unreadable: 'the cable schedule could not be read',
  no_revision: 'no cable schedule is visible to you on this project',
  no_boards: 'the cable schedule has no main boards',
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

/** Latest ISSUED (issued_at, then created_at; a missing issued_at last), else the newest revision. */
export function pickFeedRevision(rows: readonly RevisionRow[]): RevisionRow | null {
  const issued = rows
    .filter((r) => r.status === 'ISSUED')
    .sort((a, b) => desc(a.issued_at ?? '', b.issued_at ?? '') || desc(a.created_at, b.created_at))
  if (issued[0]) return issued[0]
  return [...rows].sort((a, b) => desc(a.created_at, b.created_at))[0] ?? null
}

/** What the legend calls a main board: its code, else its name. */
function boardName(n: { code: string | null; name: string | null }): string {
  return n.code?.trim() || n.name?.trim() || 'Main board'
}

export async function loadProjectFeedGraph(client: unknown, projectId: string): Promise<FeedGraph> {
  const db = client as any
  try {
    const { data: revs, error: revErr } = await db.schema('cable_schedule').from('revisions')
      .select('id, code, status, issued_at, created_at').eq('project_id', projectId)
    if (revErr) return { ok: false, reason: 'unreadable' }
    const rev = pickFeedRevision((revs ?? []) as RevisionRow[])
    if (!rev) return { ok: false, reason: 'no_revision' }

    const [supplies, nodes] = await Promise.all([
      readAll<{ id: string; from_node_id: string | null; to_node_id: string | null }>((from, to) =>
        db.schema('cable_schedule').from('supplies').select('id, from_node_id, to_node_id')
          .eq('revision_id', rev.id).order('id').range(from, to)),
      readAll<{ id: string; kind: string; code: string | null; name: string | null }>((from, to) =>
        db.schema('structure').from('nodes').select('id, kind, code, name')
          .eq('project_id', projectId).eq('kind', 'main_board').is('deleted_at', null).order('id').range(from, to)),
    ])
    if ('error' in supplies || 'error' in nodes) return { ok: false, reason: 'unreadable' }

    const edges: FeedEdge[] = supplies.data
      .filter((s) => s.from_node_id && s.to_node_id)
      .map((s) => ({ from: s.from_node_id!, to: s.to_node_id! }))
    const boards: FeedBoard[] = nodes.data
      .filter((n) => n.kind === 'main_board')
      .map((n) => ({ id: n.id, name: boardName(n) }))
    return { ok: true, revisionId: rev.id, revisionCode: rev.code, edges, boards }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** The graph as the floor plan and the PDFs use it: board colours fixed, every node answered. */
export function planFeedFrom(g: FeedGraph, nodeIds: readonly string[]): PlanFeed {
  const reason: Unavailable | null = !g.ok ? g.reason : g.boards.length === 0 ? 'no_boards' : null
  if (reason || !g.ok) {
    const r = reason ?? 'unreadable'
    return { state: 'unavailable', reason: FEED_UNAVAILABLE[r], omission: FEED_OMISSION[r] }
  }
  const colours = boardColours(g.boards)
  const matches = feedsFor(g.edges, g.boards, nodeIds)
  return {
    state: 'ok',
    revisionCode: g.revisionCode,
    boards: [...g.boards].sort(compareBoardNames).map((b) => ({ id: b.id, name: b.name, colour: colours[b.id]! })),
    byNode: Object.fromEntries(nodeIds.map((id) => {
      const m = matches[id]
      return [id, m ? { boardId: m.boardId, also: m.also } : null]
    })),
  }
}
