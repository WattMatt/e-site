'use client'

/**
 * Detect blocks — the review panel for distribution-schematic status plans
 * (spec §5, slice 3). StatusPlanWorkspace renders it in ShapePanel's `extra`
 * slot; `onAccepted` / `onFocus` come from that client component, never from
 * page.tsx (server → client props must be JSON).
 *
 * Nothing is written until a person clicks. Accepted shapes are handed back
 * through onAccepted and folded into the workspace's shapes state (no
 * router.refresh()). A proposal whose outline fails pointsError (a zero-area
 * box) is flagged and never offered for saving; the server action refuses it
 * too.
 */
import { useMemo, useState } from 'react'
import {
  detectedTagFor,
  detectionSummary,
  normaliseTag,
  pointsError,
  runDetection,
  type Box,
  type DetectionOutcome,
  type MatchableNode,
  type ReviewRow,
} from '@esite/shared/status-plans'
import { extractPageText } from '@/lib/status-plans/extract-page-text'
import { acceptDetectedBlocksAction } from '@/actions/status-plan-detection.actions'
import type { CanvasShape } from '@/lib/status-plans/types'

export type DetectNode = MatchableNode
export interface DetectExistingShape { id: string; points: number[]; nodeId: string | null }

export interface DetectBlocksPanelProps {
  planId: string
  /** 1-based, the plan's page. */
  pageIndex: number
  pdfUrl: string | null
  isPdf: boolean
  nodes: DetectNode[]
  /** The workspace's LIVE shapes, so a re-run leaves accepted blocks out. */
  existingShapes: DetectExistingShape[]
  canEdit: boolean
  onAccepted: (shapes: CanvasShape[]) => void
  onFocus?: (box: Box) => void
}

const NO_ANSWER = 'The server did not answer. Nothing was added; try again.'

function nodeLabel(n: DetectNode): string {
  const tag = n.code ?? n.shop_number ?? '—'
  return n.name ? `${tag} · ${n.name}` : tag
}

function rowLabel(r: ReviewRow): string {
  return r.block.tag ?? r.block.name ?? 'block without a tag'
}

const muted = { fontSize: 12, color: 'var(--c-text-dim)', margin: '4px 0' } as const
const sectionTitle = { fontSize: 12, fontWeight: 600, margin: '10px 0 4px' } as const
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--c-border)', fontSize: 12 } as const

export function DetectBlocksPanel({
  planId, pageIndex, pdfUrl, isPdf, nodes, existingShapes, canEdit, onAccepted, onFocus,
}: DetectBlocksPanelProps) {
  const [reading, setReading] = useState(false)
  const [outcome, setOutcome] = useState<DetectionOutcome | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const pending = useMemo(
    () => (outcome?.kind === 'review' ? outcome.review.rows.filter((r) => !done.has(r.key)) : []),
    [outcome, done],
  )
  /** Rows whose outline the database would refuse: flagged, never saved. */
  const outlineErrors = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of pending) {
      const err = pointsError('rect', r.block.points)
      if (err) m.set(r.key, err)
    }
    return m
  }, [pending])
  const rows = pending.filter((r) => !outlineErrors.has(r.key))
  const unusable = pending.filter((r) => outlineErrors.has(r.key))
  const matched = rows.filter((r) => r.category === 'matched')
  const needsYou = rows.filter((r) => r.category === 'needs_you')
  const noTag = rows.filter((r) => r.category === 'no_tag')

  /** Boards that cannot be picked again: on the plan, pending as matched, or picked in another row. */
  const reserved = useMemo(() => {
    const s = new Set<string>()
    for (const sh of existingShapes) if (sh.nodeId) s.add(sh.nodeId)
    for (const r of pending) if (r.category === 'matched' && r.nodeId) s.add(r.nodeId)
    for (const id of Object.values(choice)) if (id) s.add(id)
    return s
  }, [existingShapes, pending, choice])

  if (!canEdit) return null

  if (!isPdf) {
    return (
      <section aria-label="Detect blocks" style={{ marginTop: 8 }}>
        <p style={muted}>Block detection reads the text of a PDF drawing. This drawing is an image — draw blocks by hand.</p>
      </section>
    )
  }

  async function detect() {
    if (!pdfUrl) { setReadError('The drawing file could not be opened. Reload the page.'); return }
    setReading(true)
    setReadError(null)
    setSaveError(null)
    setOutcome(null)
    setDone(new Set())
    setChoice({})
    try {
      const page = await extractPageText({ url: pdfUrl }, pageIndex)
      if (!page.ok) { setReadError(page.error); return }
      setOutcome(runDetection(page.items, nodes, existingShapes))
    } catch {
      setReadError('The drawing could not be read. Try again.')
    } finally {
      setReading(false)
    }
  }

  async function accept(items: Array<{ row: ReviewRow; nodeId: string | null }>) {
    if (items.length === 0) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await acceptDetectedBlocksAction({
        planId,
        blocks: items.map(({ row, nodeId }) => ({ points: row.block.points, nodeId, detectedTag: detectedTagFor(row.block) })),
      })
      if (!res.ok) { setSaveError(res.error); return }
      setDone((prev) => { const next = new Set(prev); for (const i of items) next.add(i.row.key); return next })
      setChoice((prev) => { const next = { ...prev }; for (const i of items) delete next[i.row.key]; return next })
      onAccepted(res.data)
    } catch {
      setSaveError(NO_ANSWER)
    } finally {
      setBusy(false)
    }
  }

  function skip(row: ReviewRow) {
    setDone((prev) => new Set(prev).add(row.key))
    setChoice((prev) => { const next = { ...prev }; delete next[row.key]; return next })
  }

  function optionsFor(row: ReviewRow): DetectNode[] {
    const q = normaliseTag(filter[row.key] ?? '')
    const first = new Set(row.candidateIds)
    return nodes
      .filter((n) => !q || normaliseTag(nodeLabel(n)).includes(q))
      .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || nodeLabel(a).localeCompare(nodeLabel(b)))
  }

  const focusButton = (row: ReviewRow) =>
    onFocus ? (
      <button type="button" onClick={() => onFocus(row.block.box)} aria-label={`Show ${rowLabel(row)} on the drawing`}>Show</button>
    ) : null
  const skipButton = (row: ReviewRow) => (
    <button type="button" disabled={busy} onClick={() => skip(row)} aria-label={`Skip ${rowLabel(row)}`}>Skip</button>
  )

  const review = outcome?.kind === 'review' ? outcome.review : null

  return (
    <section aria-label="Detect blocks" style={{ marginTop: 8 }}>
      <button type="button" onClick={detect} disabled={reading || busy}>
        {reading ? 'Reading the drawing…' : 'Detect blocks'}
      </button>

      {readError && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{readError}</p>}

      {outcome?.kind === 'no_text' && <p style={muted}>This page has no readable text — draw blocks by hand.</p>}

      {outcome?.kind === 'no_blocks' && (
        <p style={muted}>
          {outcome.labelCount === 0
            ? 'No DB blocks were found on this page (no NO: labels). Draw blocks by hand.'
            : `No DB blocks were found: none of the ${outcome.labelCount} NO: labels starts a full NO–CT table. Draw blocks by hand.`}
        </p>
      )}

      {review && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, margin: '6px 0 4px' }}>{detectionSummary(review)}</p>
          {review.alreadyOnPlan > 0 && (
            <p style={muted}>
              {review.alreadyOnPlan === 1
                ? '1 block already on this plan was left out.'
                : `${review.alreadyOnPlan} blocks already on this plan were left out.`}
            </p>
          )}
          {review.rejected.length > 0 && (
            <details>
              <summary style={muted}>{review.rejected.length} NO: labels did not start a full table</summary>
              <ul style={muted}>{review.rejected.map((r, i) => <li key={i}>{r.reason}</li>)}</ul>
            </details>
          )}
          {saveError && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{saveError}</p>}

          {matched.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Matched ({matched.length})</h4>
              <button type="button" disabled={busy} onClick={() => accept(matched.map((row) => ({ row, nodeId: row.nodeId })))}>
                {`Accept ${matched.length} matched`}
              </button>
              {matched.map((row) => {
                const node = nodes.find((n) => n.id === row.nodeId)
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{rowLabel(row)} → {node ? nodeLabel(node) : '—'}</span>
                    {focusButton(row)}
                    {skipButton(row)}
                  </div>
                )
              })}
            </div>
          )}

          {needsYou.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Need you ({needsYou.length})</h4>
              {needsYou.map((row) => {
                const label = rowLabel(row)
                const picked = choice[row.key] ?? ''
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{label}{row.block.name && row.block.tag ? ` (${row.block.name})` : ''}</span>
                    <span style={muted}>{row.reason}</span>
                    <input
                      type="search"
                      aria-label={`Filter boards for ${label}`}
                      placeholder="Filter boards"
                      value={filter[row.key] ?? ''}
                      onChange={(e) => setFilter((f) => ({ ...f, [row.key]: e.target.value }))}
                      className="compact-field"
                    />
                    <select
                      aria-label={`Board for ${label}`}
                      value={picked}
                      onChange={(e) => setChoice((c) => ({ ...c, [row.key]: e.target.value }))}
                      className="compact-field"
                    >
                      <option value="">Pick a board…</option>
                      {optionsFor(row).map((n) => (
                        <option key={n.id} value={n.id} disabled={reserved.has(n.id) && picked !== n.id}>
                          {nodeLabel(n)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !picked}
                      onClick={() => accept([{ row, nodeId: picked }])}
                      aria-label={`Add ${label}`}
                    >Add</button>
                    {focusButton(row)}
                    {skipButton(row)}
                  </div>
                )
              })}
            </div>
          )}

          {noTag.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Without a tag ({noTag.length})</h4>
              {noTag.map((row) => {
                const label = rowLabel(row)
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{label}</span>
                    <button type="button" disabled={busy} onClick={() => accept([{ row, nodeId: null }])} aria-label={`Add ${label} unlinked`}>
                      Add unlinked
                    </button>
                    {focusButton(row)}
                    {skipButton(row)}
                  </div>
                )
              })}
            </div>
          )}

          {unusable.length > 0 && (
            <div>
              <h4 style={sectionTitle}>Cannot be added ({unusable.length})</h4>
              {unusable.map((row) => (
                <div key={row.key} style={rowStyle}>
                  <span>{`${rowLabel(row)}: ${outlineErrors.get(row.key)} Draw this block by hand.`}</span>
                  {skipButton(row)}
                </div>
              ))}
            </div>
          )}

          {pending.length === 0 && review.rows.length > 0 && <p style={muted}>Every detected block has been handled.</p>}
          {review.rows.length === 0 && <p style={muted}>Every block on this page is already on the plan.</p>}
        </div>
      )}
    </section>
  )
}
