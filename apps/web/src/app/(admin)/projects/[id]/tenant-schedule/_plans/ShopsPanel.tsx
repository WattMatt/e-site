'use client'

/**
 * Shops on this sheet — the floor plan's review panel (spec 2026-10-21 §5),
 * the tenant-layout counterpart of DetectBlocksPanel. StatusPlanWorkspace
 * renders it above the drawing when the sheet scans itself on open
 * (`autoScan`: no shop linked yet, or the file was replaced — see
 * lib/status-plans/auto-scan.ts), otherwise in ShapePanel's `extra` slot.
 *
 * A scan reads the page's text layer only (never a fill), finds the SHOP
 * labels and keeps them. The review is recomputed from those labels and the
 * workspace's LIVE shapes on every render, so a link, a drawn shop or an
 * accepted outline moves its row to "On the plan" without a rescan.
 *
 * Nothing is written until a person clicks:
 *  - Link N shapes / Link: linkShapesByLabelAction (all-or-nothing), then Undo
 *    for that batch until the next scan;
 *  - Draw / Redraw: arms the canvas's polygon tool with the tenant, so the
 *    shape the person draws saves already linked (the canvas saves it);
 *  - Suggest outline: a flood fill from the label over the page bitmap, gated
 *    on the scale and the schedule's GLA. An offered outline is only previewed;
 *    `acceptSuggestion` is the one place a 'detected' shape is created.
 * Results are handed back through onLinked / onCreated and folded into the
 * workspace's shapes (no router.refresh()). A scan's counts (never a tenant
 * name) go to Sentry as a breadcrumb.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import {
  boundingBox,
  detectShopLabels,
  normaliseTag,
  pointInShape,
  reviewShopLabels,
  shapeAreaPx,
  shopReviewSummary,
  stripLeadingZeros,
  type Box,
  type ShopLabelResult,
  type ShopReviewNode,
  type ShopReviewRow,
  type ShopReviewShape,
} from '@esite/shared/status-plans'
import { extractPageText } from '@/lib/status-plans/extract-page-text'
import { linkShapesByLabelAction, unlinkShapesAction } from '@/actions/status-plan-link.actions'
import { createStatusPlanShapeAction } from '@/actions/status-plan.actions'
import { fillFromAnchor, gateSuggestion, inkMaskFromImageData, type InkMask } from '@/lib/status-plans/fill-outline'
import { backingSize, type SheetBacking } from '@/lib/sheet/use-sheet-image'
import type { PendingLink } from '@/lib/status-plans/canvas-reducer'
import type { CanvasShape } from '@/lib/status-plans/types'

export interface ShopsPanelProps {
  sheetId: string
  /** 1-based page of the sheet's file. */
  pageIndex: number
  pdfUrl: string | null
  isPdf: boolean
  nodes: ShopReviewNode[]
  /** The workspace's LIVE shapes on this sheet. */
  shapes: ShopReviewShape[]
  /** The same shapes as stored: the concurrency token every link presents. */
  shapesById: ReadonlyMap<string, CanvasShape>
  pixelsPerMeter: number | null
  /** The sheet's file was replaced and not yet re-anchored. */
  replaced: boolean
  /** The page bitmap the canvas drew (2 px per PDF point), or null while it loads. */
  backing: SheetBacking | null
  canEdit: boolean
  /** Scan as soon as this panel mounts (once). */
  autoScan: boolean
  onLinked: (shapes: CanvasShape[]) => void
  onCreated: (shape: CanvasShape) => void
  onFocus: (box: Box) => void
  onArmDraw: (link: PendingLink) => void
  /** A suggested outline to draw on the canvas, or null to clear it. */
  onPreview: (polygon: number[] | null) => void
}

/** Show / Draw zoom to the label padded by this many image pixels: about a shop's size round it. */
export const DRAW_PAD_PX = 400

const NO_ANSWER = 'The server did not answer. Nothing was changed; try again.'
const NO_SCALE = 'Calibrate the sheet first.'
const NO_BITMAP = 'The drawing is still loading; try again when it shows.'
const UNREADABLE_BITMAP = 'This drawing cannot be read for an outline; draw this shop by hand.'

type Suggestion =
  | { offered: true; fillM2: number; glaM2: number; polygon: number[] }
  | { offered: false; reason: string }
interface Scan { labels: ShopLabelResult; rawItemCount: number }

const muted = { fontSize: 12, color: 'var(--c-text-dim)', margin: '4px 0' } as const
const sectionTitle = { fontSize: 12, fontWeight: 600, margin: '10px 0 4px' } as const
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--c-border)', fontSize: 12 } as const

const padBox = (b: Box, pad: number): Box => ({ minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad })
const labelText = (r: ShopReviewRow) => `SHOP ${r.label.tag}`
const m2 = (v: number) => v.toFixed(1)

function nodeLabel(n: ShopReviewNode): string {
  const tag = n.shop_number ?? n.code ?? '—'
  return n.name ? `${tag} · ${n.name}` : tag
}

export function ShopsPanel({
  sheetId, pageIndex, pdfUrl, isPdf, nodes, shapes, shapesById, pixelsPerMeter, replaced, backing, canEdit, autoScan,
  onLinked, onCreated, onFocus, onArmDraw, onPreview,
}: ShopsPanelProps) {
  const [reading, setReading] = useState(false)
  const [scanned, setScanned] = useState<Scan | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [batch, setBatch] = useState<CanvasShape[] | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({})
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const review = useMemo(
    () => (scanned ? reviewShopLabels({ labels: scanned.labels, nodes, shapes, replaced }) : null),
    [scanned, nodes, shapes, replaced],
  )
  const rowsIn = (state: ShopReviewRow['state']) => review?.rows.filter((r) => r.state === state) ?? []
  const onPlan = review?.rows.filter((r) => r.state === 'linked' || r.state === 'linked_outside') ?? []
  const toLink = rowsIn('link')
  const toDraw = rowsIn('draw')
  const conflicts = rowsIn('conflict')
  const needsYou = rowsIn('needs_you')
  const notOnSchedule = rowsIn('not_on_schedule')
  const moved = replaced ? rowsIn('moved') : []
  const areaNotes = review?.rows.filter((r) => r.areaNote) ?? []

  /** Shops that cannot be picked again: linked on this sheet, or picked in another row. */
  const reserved = useMemo(() => {
    const s = new Set<string>()
    for (const sh of shapes) if (sh.nodeId) s.add(sh.nodeId)
    for (const id of Object.values(choice)) if (id) s.add(id)
    return s
  }, [shapes, choice])

  // A result that lands after unmount (another sheet) or after a newer scan is dropped.
  const mounted = useRef(false)
  const runRef = useRef(0)
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onPreviewRef.current(null)
    }
  }, [])

  // The automatic scan: once per sheet. scanRef points at this render's scan().
  const scanRef = useRef<(() => Promise<void>) | null>(null)
  const autoScannedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!autoScan || !canEdit || !isPdf || autoScannedFor.current === sheetId) return
    autoScannedFor.current = sheetId
    void scanRef.current?.()
  }, [autoScan, canEdit, isPdf, sheetId])

  // The ink mask is built once per page bitmap (~165 ms on an A0); a new bitmap invalidates it.
  const maskRef = useRef<{ backing: SheetBacking; mask: InkMask } | null>(null)

  if (!canEdit) return null

  if (!isPdf) {
    return (
      <section aria-label="Shops on this sheet" style={{ marginTop: 8 }}>
        <p style={muted}>Shop detection reads the text of a PDF drawing. This drawing is an image — draw the shops by hand.</p>
      </section>
    )
  }

  function clearPreview() {
    setPreviewKey(null)
    onPreview(null)
  }

  async function scan() {
    if (!pdfUrl) { setReadError('The drawing file could not be opened. Reload the page.'); return }
    const run = ++runRef.current
    const live = () => runRef.current === run && mounted.current
    setReading(true)
    setReadError(null)
    setSaveError(null)
    setScanned(null)
    setBatch(null)
    setSuggestions({})
    setChoice({})
    clearPreview()
    try {
      let page: Awaited<ReturnType<typeof extractPageText>>
      try {
        page = await extractPageText({ url: pdfUrl }, pageIndex)
      } catch {
        if (live()) setReadError('The drawing link has expired or could not be read — reload the page and try again.')
        return
      }
      if (!live()) return
      if (!page.ok) { setReadError(page.error); return }
      const labels = detectShopLabels(page.items)
      const counts = reviewShopLabels({ labels, nodes, shapes, replaced }).counts
      Sentry.addBreadcrumb({ category: 'status-plans', message: 'shops-scan', data: counts })
      setScanned({ labels, rawItemCount: page.rawItemCount })
    } catch {
      if (live()) setReadError('The drawing could not be read. Try again.')
    } finally {
      if (live()) setReading(false)
    }
  }
  scanRef.current = scan

  async function link(rows: Array<{ row: ShopReviewRow; shapeId: string; nodeId: string }>) {
    if (rows.length === 0) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await linkShapesByLabelAction({
        sheetId,
        links: rows.map(({ row, shapeId, nodeId }) => ({
          shapeId, nodeId, detectedTag: labelText(row), expectedUpdatedAt: shapesById.get(shapeId)?.updatedAt ?? '',
        })),
      })
      if (!res.ok) { setSaveError(res.error); return }
      setBatch(res.data)
      onLinked(res.data)
    } catch {
      setSaveError(NO_ANSWER)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!batch) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await unlinkShapesAction({
        sheetId,
        unlinks: batch.map((s) => ({ shapeId: s.id, expectedUpdatedAt: shapesById.get(s.id)?.updatedAt ?? s.updatedAt })),
      })
      if (!res.ok) { setSaveError(res.error); return }
      setBatch(null)
      onLinked(res.data)
    } catch {
      setSaveError(NO_ANSWER)
    } finally {
      setBusy(false)
    }
  }

  function draw(row: ShopReviewRow, nodeId: string) {
    onArmDraw({ nodeId, detectedTag: labelText(row) })
    onFocus(padBox(row.label.box, DRAW_PAD_PX))
  }

  function show(row: ShopReviewRow) {
    const s = suggestions[row.key]
    if (s?.offered) {
      setPreviewKey(row.key)
      onPreview(s.polygon)
    }
    onFocus(padBox(row.label.box, DRAW_PAD_PX))
  }

  function showShape(shapeId: string | null) {
    const pts = shapeId ? shapesById.get(shapeId)?.points : undefined
    if (pts && pts.length >= 6) onFocus(boundingBox(pts))
  }

  /** The bitmap as an ink mask, built on first use and kept for this bitmap. */
  function maskFor(b: SheetBacking): InkMask {
    if (maskRef.current?.backing === b) return maskRef.current.mask
    const [w, h] = backingSize(b)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(b, 0, 0, w, h)
    const mask = inkMaskFromImageData(ctx.getImageData(0, 0, w, h))
    maskRef.current = { backing: b, mask }
    return mask
  }

  function suggestFor(row: ShopReviewRow): Suggestion {
    // The scale is checked before any pixel is read: without it no fill could be judged.
    if (pixelsPerMeter == null || !(pixelsPerMeter > 0)) return { offered: false, reason: NO_SCALE }
    if (!backing) return { offered: false, reason: NO_BITMAP }
    let mask: InkMask
    try {
      mask = maskFor(backing)
    } catch {
      return { offered: false, reason: UNREADABLE_BITMAP } // e.g. a cross-origin image taints the canvas
    }
    const outcome = fillFromAnchor(mask, row.label.anchor)
    const gla = row.nodeId ? nodeById.get(row.nodeId)?.scheduledM2 ?? null : null
    const gate = gateSuggestion(outcome, pixelsPerMeter, gla)
    if (!gate.offered) return { offered: false, reason: gate.reason }
    // The gate offers only a fill that completed; anything else is refused, never guessed.
    if (outcome.kind !== 'ok') return { offered: false, reason: UNREADABLE_BITMAP }
    return { offered: true, fillM2: gate.fillM2, glaM2: gate.glaM2, polygon: outcome.polygon }
  }

  function suggest(row: ShopReviewRow) {
    const s = suggestFor(row)
    setSuggestions((prev) => ({ ...prev, [row.key]: s }))
    if (s.offered) {
      setPreviewKey(row.key)
      onPreview(s.polygon)
      onFocus(padBox(boundingBox(s.polygon), DRAW_PAD_PX / 4))
    } else if (previewKey === row.key) {
      clearPreview()
    }
  }

  /** Every draw row in turn, yielding between rows so the count can paint. Nothing is previewed. */
  async function suggestAll() {
    const rows = toDraw
    setBusy(true)
    try {
      for (let i = 0; i < rows.length; i++) {
        setProgress({ i: i + 1, n: rows.length })
        await new Promise((r) => setTimeout(r, 0))
        if (!mounted.current) return
        const s = suggestFor(rows[i]!)
        setSuggestions((prev) => ({ ...prev, [rows[i]!.key]: s }))
      }
    } finally {
      if (mounted.current) { setProgress(null); setBusy(false) }
    }
  }

  function dismiss(row: ShopReviewRow) {
    setSuggestions((prev) => { const next = { ...prev }; delete next[row.key]; return next })
    if (previewKey === row.key) clearPreview()
  }

  /** The only place a shape is saved as 'detected': a person accepted the suggested outline. */
  async function acceptSuggestion(row: ShopReviewRow, polygon: number[]) {
    if (!row.nodeId) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await createStatusPlanShapeAction({
        sheetId, shape: 'polygon', points: polygon, nodeId: row.nodeId, detectedTag: labelText(row), source: 'detected',
      })
      if (!res.ok) { setSaveError(res.error); return }
      dismiss(row)
      clearPreview()
      onCreated(res.data)
    } catch {
      setSaveError(NO_ANSWER)
    } finally {
      setBusy(false)
    }
  }

  /** The smallest unlinked, non-area shape on this sheet holding the label, if any. */
  function holderOf(row: ShopReviewRow): string | null {
    const { x, y } = row.label.anchor
    const hits = shapes.filter((s) => s.areaType == null && s.nodeId == null && pointInShape(x, y, s.points))
    hits.sort((a, b) => shapeAreaPx(a.points) - shapeAreaPx(b.points))
    return hits[0]?.id ?? null
  }

  function optionsFor(row: ShopReviewRow): ShopReviewNode[] {
    const first = new Set(row.candidateIds)
    return nodes
      .filter((n) => !n.decommissioned)
      .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || nodeLabel(a).localeCompare(nodeLabel(b)))
  }

  const nameOf = (nodeId: string | null) => {
    const n = nodeId ? nodeById.get(nodeId) : undefined
    return n ? nodeLabel(n) : '—'
  }
  const showButton = (row: ShopReviewRow) => (
    <button type="button" onClick={() => show(row)} aria-label={`Show ${labelText(row)} on the drawing`}>Show</button>
  )

  function suggestionLine(row: ShopReviewRow) {
    const s = suggestions[row.key]
    if (!s) return null
    if (!s.offered) return <span style={muted}>{s.reason}</span>
    const polygon = s.polygon
    return (
      <>
        <span>{`Outline ${m2(s.fillM2)} m² vs GLA ${m2(s.glaM2)} m²`}</span>
        <button type="button" disabled={busy} onClick={() => void acceptSuggestion(row, polygon)} aria-label={`Accept outline for ${labelText(row)}`}>Accept</button>
        <button type="button" disabled={busy} onClick={() => dismiss(row)} aria-label={`Dismiss outline for ${labelText(row)}`}>Dismiss</button>
      </>
    )
  }

  const linkCount = toLink.length

  return (
    <section aria-label="Shops on this sheet" style={{ marginTop: 8 }}>
      <button type="button" onClick={scan} disabled={reading || busy}>
        {reading ? 'Scanning sheet…' : 'Scan sheet for shops'}
      </button>
      {reading && <p role="status" style={muted}>Scanning sheet…</p>}
      {readError && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{readError}</p>}

      {scanned && scanned.rawItemCount === 0 && <p style={muted}>This page has no readable text — draw the shops by hand.</p>}

      {review && scanned && scanned.rawItemCount > 0 && (
        <div>
          <p style={{ fontSize: autoScan ? 14 : 12, fontWeight: 600, margin: '6px 0 4px' }}>{shopReviewSummary(review)}</p>
          {saveError && <p role="alert" style={{ ...muted, color: 'var(--c-amber)' }}>{saveError}</p>}
          {batch && (
            <p style={muted}>
              {batch.length === 1 ? 'Linked 1 shape.' : `Linked ${batch.length} shapes.`}{' '}
              <button type="button" disabled={busy} onClick={() => void undo()}>Undo</button>
            </p>
          )}
          {progress && <p role="status" style={muted}>{`Suggesting ${progress.i} of ${progress.n}`}</p>}

          {linkCount > 0 && (
            <section aria-label="Link now">
              <h4 style={sectionTitle}>Link now ({linkCount})</h4>
              <button
                type="button"
                disabled={busy}
                onClick={() => void link(toLink.map((row) => ({ row, shapeId: row.shapeId!, nodeId: row.nodeId! })))}
              >{linkCount === 1 ? 'Link 1 shape' : `Link ${linkCount} shapes`}</button>
              {toLink.map((row) => (
                <div key={row.key} style={rowStyle}>
                  <span>{labelText(row)} → {nameOf(row.nodeId)}</span>
                  {showButton(row)}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void link([{ row, shapeId: row.shapeId!, nodeId: row.nodeId! }])}
                    aria-label={`Link ${labelText(row)}`}
                  >Link</button>
                </div>
              ))}
            </section>
          )}

          {toDraw.length > 0 && (
            <section aria-label="Draw">
              <h4 style={sectionTitle}>Draw ({toDraw.length})</h4>
              <button type="button" disabled={busy} onClick={() => void suggestAll()}>Suggest all</button>
              {toDraw.map((row) => (
                <div key={row.key} style={rowStyle}>
                  <span>{labelText(row)} → {nameOf(row.nodeId)}</span>
                  {showButton(row)}
                  <button type="button" disabled={busy} onClick={() => draw(row, row.nodeId!)} aria-label={`Draw ${labelText(row)}`}>Draw</button>
                  <button type="button" disabled={busy} onClick={() => suggest(row)} aria-label={`Suggest outline for ${labelText(row)}`}>Suggest outline</button>
                  {suggestionLine(row)}
                </div>
              ))}
            </section>
          )}

          {moved.length > 0 && (
            <section aria-label="Moved">
              <h4 style={sectionTitle}>Moved ({moved.length})</h4>
              {moved.map((row) => (
                <div key={row.key} style={rowStyle}>
                  <span>{labelText(row)} → {nameOf(row.nodeId)}</span>
                  <span style={muted}>{row.reason}</span>
                  <button type="button" onClick={() => onFocus(padBox(row.label.box, DRAW_PAD_PX))} aria-label={`Show ${labelText(row)} label`}>Show label</button>
                  <button type="button" onClick={() => showShape(row.shapeId)} aria-label={`Show ${labelText(row)} shape`}>Show shape</button>
                  <button type="button" disabled={busy} onClick={() => draw(row, row.nodeId!)} aria-label={`Redraw ${labelText(row)}`}>Redraw</button>
                </div>
              ))}
            </section>
          )}

          {conflicts.length > 0 && (
            <section aria-label="Conflicts">
              <h4 style={sectionTitle}>Conflicts ({conflicts.length})</h4>
              {conflicts.map((row) => {
                const holder = row.shapeId ? shapesById.get(row.shapeId)?.nodeId ?? null : null
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{labelText(row)} → {nameOf(row.nodeId)}</span>
                    {holder && <span>{`shape linked to ${nameOf(holder)}`}</span>}
                    <span style={muted}>{row.reason}</span>
                    {showButton(row)}
                  </div>
                )
              })}
              <p style={muted}>Re-link these from the shape panel: select the shape and choose its shop.</p>
            </section>
          )}

          {needsYou.length > 0 && (
            <section aria-label="Needs you">
              <h4 style={sectionTitle}>Needs you ({needsYou.length})</h4>
              {needsYou.map((row) => {
                const label = labelText(row)
                // One candidate is preselected, except for a duplicate label: each copy may be a different shop.
                const single = row.candidateIds.length === 1 && !review.duplicates[stripLeadingZeros(normaliseTag(row.label.tag))]
                const picked = choice[row.key] ?? (single ? row.candidateIds[0]! : '')
                const holder = holderOf(row)
                return (
                  <div key={row.key} style={rowStyle}>
                    <span>{label}</span>
                    <span style={muted}>{row.reason}</span>
                    <select
                      aria-label={`Shop for ${label}`}
                      value={picked}
                      onChange={(e) => setChoice((c) => ({ ...c, [row.key]: e.target.value }))}
                      className="compact-field"
                    >
                      <option value="">Pick a shop…</option>
                      {optionsFor(row).map((n) => (
                        <option key={n.id} value={n.id} disabled={reserved.has(n.id) && picked !== n.id}>{nodeLabel(n)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !picked || !holder}
                      onClick={() => holder && void link([{ row, shapeId: holder, nodeId: picked }])}
                      aria-label={`Link ${label}`}
                    >Link</button>
                    <button type="button" disabled={busy || !picked} onClick={() => draw(row, picked)} aria-label={`Draw ${label}`}>Draw</button>
                    {showButton(row)}
                  </div>
                )
              })}
            </section>
          )}

          {notOnSchedule.length > 0 && (
            <section aria-label="Not on schedule">
              <h4 style={sectionTitle}>Not on schedule ({notOnSchedule.length})</h4>
              {notOnSchedule.map((row) => (
                <div key={row.key} style={rowStyle}>
                  <span>{labelText(row)}</span>
                  <span style={muted}>{row.reason}</span>
                  {showButton(row)}
                </div>
              ))}
            </section>
          )}

          {areaNotes.length > 0 && (
            <section aria-label="Drawing ≠ schedule">
              <h4 style={sectionTitle}>Drawing ≠ schedule ({areaNotes.length})</h4>
              {areaNotes.map((row) => (
                <div key={row.key} style={rowStyle}><span>{`${labelText(row)}: ${row.areaNote}`}</span></div>
              ))}
            </section>
          )}

          {onPlan.length > 0 && (
            <section aria-label="On the plan">
              <details>
                <summary style={sectionTitle}>{`On the plan (${onPlan.length})`}</summary>
                {onPlan.map((row) => (
                  <div key={row.key} style={rowStyle}>
                    <span>{labelText(row)} → {nameOf(row.nodeId)}</span>
                    {row.state === 'linked_outside' && <span style={muted}>{row.reason}</span>}
                    {row.state === 'linked_outside' ? (
                      <button type="button" onClick={() => showShape(row.shapeId)} aria-label={`Show ${labelText(row)} shape`}>Show</button>
                    ) : showButton(row)}
                  </div>
                ))}
              </details>
            </section>
          )}

          {review.unlabelled.length > 0 && <p style={muted}>{`Shapes with no label inside: ${review.unlabelled.length}`}</p>}
        </div>
      )}
    </section>
  )
}
