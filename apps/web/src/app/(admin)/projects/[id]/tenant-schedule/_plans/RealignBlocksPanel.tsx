'use client'

/**
 * "Re-align blocks to the drawing" (owner ask 2026-10-14): read the sheet's
 * tables again and move the existing (mostly hand-drawn) rectangles onto
 * their drawn borders, keeping every board link.
 *
 * StatusPlanWorkspace renders it in the side panel, beside Scan sheet, for an
 * editor on a line-diagram sheet that has at least one rectangle. The steps
 * (scan → preview → apply → undo) are lib/status-plans/realign-state.ts, a
 * pure reducer; this component only does the I/O and hands the canvas the
 * proposed outlines (`onProposals`) to draw dashed over the current ones.
 *
 * Nothing is written until Apply. The result is folded into the workspace's
 * shapes (`onShapes`), never router.refresh(). Undo is the same action with
 * the previous points and the new updated_at. A link the table disagrees with
 * is listed, never changed. A scan belongs to the sheet it started on: the
 * workspace keys the panel by sheet id, and a late answer is dropped.
 */
import { useEffect, useRef, useState } from 'react'
import { realignSummary, type MatchableNode } from '@esite/shared/status-plans'
import { extractPageText } from '@/lib/status-plans/extract-page-text'
import { realignShapesAction } from '@/actions/status-plan-realign.actions'
import {
  NO_LINES,
  initialRealignState,
  realignProposals,
  realignReducer,
  scanForRealign,
  type RealignEvent,
  type RealignMove,
  type RealignScan,
  type RealignState,
} from '@/lib/status-plans/realign-state'
import type { CanvasShape } from '@/lib/status-plans/types'

export interface RealignBlocksPanelProps {
  sheetId: string
  /** 1-based page of the sheet's file. */
  pageIndex: number
  pdfUrl: string | null
  isPdf: boolean
  nodes: MatchableNode[]
  /** This sheet's live shapes. */
  shapes: CanvasShape[]
  /** Stored shapes after an apply or an undo. */
  onShapes: (shapes: CanvasShape[]) => void
  /** Outlines to draw dashed on the canvas ([] when nothing is proposed). */
  onProposals: (outlines: number[][]) => void
}

const NO_ANSWER = 'The server did not answer. Reload to see where the blocks are.'
const muted = { fontSize: 12, color: 'var(--c-text-dim)', margin: '4px 0' } as const

function nodeTag(n: MatchableNode | undefined): string {
  return n?.code ?? n?.shop_number ?? n?.name ?? 'a board'
}

export function RealignBlocksPanel({ sheetId, pageIndex, pdfUrl, isPdf, nodes, shapes, onShapes, onProposals }: RealignBlocksPanelProps) {
  const [state, setState] = useState<RealignState>(initialRealignState)
  const stateRef = useRef(state)
  const onProposalsRef = useRef(onProposals)
  onProposalsRef.current = onProposals
  // Handed over in the same step as the state change (not from an effect), so
  // the canvas never shows outlines from a state the panel has left.
  const proposalKey = useRef('[]')
  const publish = (s: RealignState) => {
    const outlines = realignProposals(s)
    const key = JSON.stringify(outlines)
    if (key === proposalKey.current) return
    proposalKey.current = key
    onProposalsRef.current(outlines)
  }
  const send = (e: RealignEvent) => {
    const next = realignReducer(stateRef.current, e)
    if (next !== stateRef.current) {
      stateRef.current = next
      setState(next)
      publish(next)
    }
  }

  // A scan belongs to its sheet: a different sheet drops whatever is open.
  const currentSheet = useRef(sheetId)
  useEffect(() => {
    if (currentSheet.current === sheetId) return
    currentSheet.current = sheetId
    stateRef.current = initialRealignState
    setState(initialRealignState)
    publish(initialRealignState)
  }, [sheetId])
  // Leaving the sheet (unmount) clears the dashed outlines.
  useEffect(() => () => onProposalsRef.current([]), [])

  if (!isPdf) {
    return <section aria-label="Re-align blocks" style={{ marginTop: 8 }}><p style={muted}>{NO_LINES}</p></section>
  }

  async function scan() {
    send({ type: 'scan' })
    const run = stateRef.current.run
    const forSheet = sheetId
    const answer = (scanResult: RealignScan) => {
      if (currentSheet.current !== forSheet) return
      send({ type: 'scanned', run, scan: scanResult })
    }
    if (!pdfUrl) { answer({ kind: 'error', message: 'The drawing file could not be opened. Reload the page.' }); return }
    try {
      const page = await extractPageText({ url: pdfUrl }, pageIndex)
      if (!page.ok) { answer({ kind: 'error', message: page.error }); return }
      answer(scanForRealign({ items: page.items, rawItemCount: page.rawItemCount, lines: page.lines ?? [] }, shapes, nodes))
    } catch {
      answer({ kind: 'error', message: 'The drawing link has expired or could not be read — reload the page and try again.' })
    }
  }

  async function write(moves: RealignMove[], ok: RealignEvent['type'], failed: 'applyFailed' | 'undoFailed') {
    try {
      const res = await realignShapesAction({ sheetId, moves })
      if (currentSheet.current !== sheetId) return
      if (!res.ok) { send({ type: failed, error: res.error }); return }
      onShapes(res.data)
      send(ok === 'applied' ? { type: 'applied', shapes: res.data } : { type: 'undone' })
    } catch {
      send({ type: failed, error: NO_ANSWER })
    }
  }

  function apply() {
    const s = stateRef.current
    if (s.phase !== 'preview') return
    send({ type: 'apply' })
    void write(s.moves, 'applied', 'applyFailed')
  }

  function undo() {
    const s = stateRef.current
    if (s.phase !== 'applied') return
    send({ type: 'undo' })
    void write(s.undo, 'undone', 'undoFailed')
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const working = state.phase === 'scanning' || state.phase === 'applying' || state.phase === 'undoing'
  const message = 'message' in state ? state.message : null

  return (
    <section aria-label="Re-align blocks" style={{ marginTop: 8 }}>
      <button type="button" onClick={() => void scan()} disabled={working}>
        Re-align blocks to the drawing
      </button>
      {state.phase === 'scanning' && <p role="status" style={muted}>Reading the drawing&apos;s tables…</p>}
      {message && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{message}</p>}

      {(state.phase === 'preview' || state.phase === 'applying') && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, margin: '6px 0 4px' }}>{realignSummary(state.plan.summary)}</p>
          {state.plan.summary.move > 0 && <p style={muted}>The new outlines are drawn dashed on the drawing.</p>}
          {state.plan.results.some((r) => r.linkMismatch) && (
            <ul style={{ ...muted, paddingLeft: 16 }}>
              {state.plan.results.flatMap((r) => (r.linkMismatch ? [
                <li key={r.shapeId}>
                  {r.nodeId
                    ? `Linked to ${nodeTag(byId.get(r.nodeId))} but the table reads ${r.linkMismatch.tableTag}`
                    : `Not linked, but the table reads ${r.linkMismatch.tableTag}`}
                </li>,
              ] : []))}
            </ul>
          )}
          {state.plan.results.some((r) => r.linkMismatch) && (
            <p style={muted}>Links are not changed — fix them by hand if the table is right.</p>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={apply} disabled={state.phase === 'applying' || state.moves.length === 0}>Apply</button>
            <button type="button" onClick={() => send({ type: 'cancel' })} disabled={state.phase === 'applying'}>Cancel</button>
          </div>
        </div>
      )}

      {(state.phase === 'applied' || state.phase === 'undoing') && (
        <p style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{`Re-aligned ${state.count} ${state.count === 1 ? 'block' : 'blocks'}`}</span>
          <span aria-hidden>·</span>
          <button type="button" onClick={undo} disabled={state.phase === 'undoing'}>Undo</button>
        </p>
      )}
    </section>
  )
}
