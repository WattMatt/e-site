'use client'

/**
 * A tenant plan's client side: the sheet strip, the current sheet's canvas,
 * writes, banners and the legend (spec 2026-10-12 §2, §5).
 *
 * Every shape write is a per-shape server action whose result is FOLDED INTO
 * LOCAL STATE. There is no router.refresh(): it would re-render the server page
 * under the canvas and re-mint the sheet's signed URL. Moving to another sheet
 * is a navigation (?sheet=), the one time a new URL is wanted. Selection is
 * mirrored to ?sheet=&shape= with history.replaceState (no server round trip),
 * so the tenant schedule's "On plan" link and a reload land on the same shape.
 *
 * `shapes` holds every sheet's shapes: the canvas gets the current sheet's, the
 * legend shows this sheet and the whole plan, and the node picker sees them all
 * (a board appears once per plan, across sheets).
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PURPOSE_LABEL, type AreaType } from '@esite/shared/status-plans'
import {
  createStatusPlanShapeAction,
  deleteStatusPlanShapeAction,
  updateStatusPlanShapeAction,
} from '@/actions/status-plan.actions'
import { reanchorTenantPlanSheetAction } from '@/actions/tenant-plan-sheets.actions'
import { legendSummary, needsAttention, resolveShapeView, type ShapeView } from '@/lib/status-plans/shape-view'
import { buildNodeOptions } from '@/lib/status-plans/node-options'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import type { CanvasTool, ShapeCommit } from '@/lib/status-plans/canvas-reducer'
import type { ActionResult, CanvasShape, PlanNode, PlanSheet, SheetSummary, StatusPlanPageProps } from '@/lib/status-plans/types'
import { ShapePanel } from './ShapePanel'
import { PlanLegend } from './PlanLegend'
import { DetectBlocksPanel, type DetectNode } from './DetectBlocksPanel'
import { SheetStrip } from './SheetStrip'
import { SheetControls } from './SheetControls'

/**
 * A plan node as the block matcher reads it. The loader shows a missing code
 * as '—' and folds a board's name into shopName (shop_name ?? name), which is
 * the name the main-board alias needs.
 */
function toDetectNode(n: PlanNode): DetectNode {
  return { id: n.id, kind: n.kind, code: n.code && n.code !== '—' ? n.code : null, shop_number: n.shopNumber, name: n.shopName }
}

const StatusPlanCanvas = dynamic(() => import('./StatusPlanCanvas').then((m) => m.StatusPlanCanvas), {
  ssr: false,
  loading: () => <div className="data-panel" style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>Loading the sheet…</div>,
})

const ARM_MS = 4000
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function StatusPlanWorkspace(props: StatusPlanPageProps) {
  const { projectId, plan, canEdit, today } = props
  const purpose = plan.purpose

  const [shapes, setShapes] = useState<CanvasShape[]>(props.shapes)
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const [sheet, setSheet] = useState<PlanSheet>(props.sheet)
  const [sheets, setSheets] = useState<SheetSummary[]>(props.sheets)
  const [selectedId, setSelectedId] = useState<string | null>(props.initialShapeId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; conflict: boolean } | null>(null)
  const [armedShape, setArmedShape] = useState<string | null>(null)
  const [requestedTool, setRequestedTool] = useState<{ tool: CanvasTool; nonce: number } | null>(null)

  useEffect(() => {
    if (!armedShape) return
    const t = setTimeout(() => setArmedShape(null), ARM_MS)
    return () => clearTimeout(t)
  }, [armedShape])

  // ?sheet=&shape= mirror the view without a navigation.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', tenantPlanHref(projectId, purpose, { sheet: sheet.id, shape: selectedId }))
    } catch {
      /* a sandboxed frame may refuse; the selection still works */
    }
  }, [projectId, purpose, sheet.id, selectedId])

  /** A sheet row changed on the server (rename, re-anchor, scale): keep the strip and the canvas in step. */
  const applySheet = useCallback((s: SheetSummary) => {
    setSheets((prev) => prev.map((x) => (x.id === s.id ? s : x)))
    setSheet((prev) => (prev.id === s.id ? { ...prev, ...s } : prev))
  }, [])

  // ── Derived ──────────────────────────────────────────────────────────────
  const nodesById = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes])
  const scaleBySheet = useMemo(() => new Map(sheets.map((s) => [s.id, s.pixelsPerMeter])), [sheets])
  const pixelsPerMeter = sheet.pixelsPerMeter
  const views = useMemo(() => {
    const out: Record<string, ShapeView> = {}
    for (const s of shapes) {
      out[s.id] = resolveShapeView(s, {
        purpose, nodesById, shopLinks: props.shopLinks, dbOrders: props.dbOrders, today,
        pixelsPerMeter: scaleBySheet.get(s.sheetId) ?? null,
      })
    }
    return out
  }, [shapes, purpose, nodesById, props.shopLinks, props.dbOrders, today, scaleBySheet])
  const sheetShapes = useMemo(() => shapes.filter((s) => s.sheetId === sheet.id), [shapes, sheet.id])
  const sheetSummary = useMemo(() => legendSummary(sheetShapes.map((s) => views[s.id]!), purpose), [sheetShapes, views, purpose])
  const planSummary = useMemo(() => legendSummary(shapes.map((s) => views[s.id]!), purpose), [shapes, views, purpose])
  const attention = useMemo(() => needsAttention(sheetShapes, views), [sheetShapes, views])
  const selected = sheetShapes.find((s) => s.id === selectedId) ?? null
  const detectNodes = useMemo(() => props.nodes.map(toDetectNode), [props.nodes])
  const options = useMemo(() => buildNodeOptions(props.nodes, shapes, selectedId, purpose), [props.nodes, shapes, selectedId, purpose])

  // ── Writes ───────────────────────────────────────────────────────────────
  async function run<T>(fn: () => Promise<ActionResult<T>>, onOk: (d: T) => void): Promise<{ error?: string }> {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fn()
      if (!res.ok) {
        setNotice({ text: res.error, conflict: res.conflict === true })
        return { error: res.error }
      }
      onOk(res.data)
      return {}
    } catch {
      setNotice({ text: NO_ANSWER, conflict: false })
      return { error: NO_ANSWER }
    } finally {
      setBusy(false)
    }
  }
  const replaceShape = (s: CanvasShape) => setShapes((prev) => prev.map((x) => (x.id === s.id ? s : x)))

  const onCreate = (c: ShapeCommit) =>
    run(() => createStatusPlanShapeAction({ sheetId: sheet.id, shape: c.shape, points: c.points }), (s) => {
      setShapes((prev) => [...prev, s])
      setSelectedId(s.id)
    })

  const onReshape = (shapeId: string, points: number[]) => {
    const s = shapesRef.current.find((x) => x.id === shapeId)
    if (!s) return Promise.resolve({ error: 'That shape is gone — reload to see the plan.' })
    return run(() => updateStatusPlanShapeAction({ shapeId, expectedUpdatedAt: s.updatedAt, points }), replaceShape)
  }

  function patchSelected(patch: { nodeId?: string | null; areaType?: AreaType | null }) {
    const s = selected
    if (!s) return
    void run(() => updateStatusPlanShapeAction({ shapeId: s.id, expectedUpdatedAt: s.updatedAt, ...patch }), replaceShape)
  }

  const requestDelete = useCallback(() => {
    const s = shapesRef.current.find((x) => x.id === selectedId)
    if (!s) return
    if (armedShape !== s.id) { setArmedShape(s.id); return }
    setArmedShape(null)
    void run(() => deleteStatusPlanShapeAction({ shapeId: s.id, expectedUpdatedAt: s.updatedAt }), () => {
      setShapes((prev) => prev.filter((x) => x.id !== s.id))
      setSelectedId(null)
    })
  }, [selectedId, armedShape])

  const onSelect = useCallback((id: string | null) => {
    setSelectedId(id)
    setArmedShape(null)
  }, [])

  function reanchor() {
    void run(() => reanchorTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt }), applySheet)
  }

  // Line diagrams: read the sheet's text and propose one rectangle per DB block.
  // existingShapes is the LIVE state of this sheet, so a re-run leaves accepted blocks out.
  const schematicSlot = purpose === 'distribution_schematic' ? (
    <div data-slot="schematic-detection">
      <DetectBlocksPanel
        sheetId={sheet.id}
        pageIndex={sheet.pageIndex}
        pdfUrl={sheet.signedUrl}
        isPdf={sheet.isPdf}
        nodes={detectNodes}
        existingShapes={sheetShapes.map((s) => ({ id: s.id, points: s.points, nodeId: s.nodeId }))}
        canEdit={canEdit}
        onAccepted={(added) => setShapes((prev) => [...prev, ...added])}
      />
    </div>
  ) : null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{PURPOSE_LABEL[purpose]}</h1>
        <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          {sheet.label} · {sheet.fileName}{sheet.isPdf ? ` · page ${sheet.pageIndex}` : ''}
        </span>
      </div>

      <SheetStrip projectId={projectId} purpose={purpose} sheets={sheets} currentId={sheet.id} canEdit={canEdit} />
      {canEdit && (
        <SheetControls projectId={projectId} purpose={purpose} sheet={sheet} shapeCount={sheetShapes.length} onChanged={applySheet} />
      )}

      {sheet.replacedAt && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, borderColor: 'var(--c-amber)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            This sheet&apos;s file was replaced (<strong>{sheet.fileName}</strong>, revision {sheet.revision}). Shapes and the scale
            were kept where they were — check them against the new file.
          </span>
          {canEdit && <button type="button" disabled={busy} onClick={reanchor}>Shapes checked — keep them</button>}
        </div>
      )}

      {purpose === 'tenant_layout' && pixelsPerMeter === null && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Set this sheet&apos;s scale to measure areas. Until then areas show “—”.</span>
          {canEdit && (
            <button type="button" onClick={() => setRequestedTool({ tool: 'calibrate', nonce: Date.now() })}>Set scale</button>
          )}
        </div>
      )}

      {notice && (
        <div role="alert" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, color: '#dc2626', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>{notice.text}</span>
          {notice.conflict && <button type="button" onClick={() => window.location.reload()}>Reload</button>}
        </div>
      )}

      <div className="stack-below-lg" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 12, alignItems: 'start' }}>
        <StatusPlanCanvas
          sheet={sheet}
          pageIndex={sheet.pageIndex}
          purpose={purpose}
          shapes={sheetShapes}
          views={views}
          selectedId={selectedId}
          canEdit={canEdit}
          busy={busy}
          requestedTool={requestedTool}
          onSelect={onSelect}
          onCreate={onCreate}
          onReshape={onReshape}
          onDeleteRequest={requestDelete}
          onCalibrated={applySheet}
        />
        <aside style={{ display: 'grid', gap: 12 }}>
          <ShapePanel
            purpose={purpose}
            shape={selected}
            view={selected ? views[selected.id] ?? null : null}
            node={selected?.nodeId ? nodesById.get(selected.nodeId) ?? null : null}
            link={selected?.nodeId ? props.shopLinks[selected.nodeId] ?? null : null}
            options={options}
            canEdit={canEdit}
            busy={busy}
            deleteArmed={selected !== null && armedShape === selected.id}
            hasScale={pixelsPerMeter !== null}
            onAssignNode={(nodeId) => patchSelected({ nodeId })}
            onSetAreaType={(areaType) => patchSelected({ areaType })}
            onUnassign={() => patchSelected({ nodeId: null, areaType: null })}
            onDelete={requestDelete}
            extra={schematicSlot}
          />
          <PlanLegend
            purpose={purpose}
            summary={sheetSummary}
            planSummary={planSummary}
            sheetCount={sheets.length}
            hasScale={pixelsPerMeter !== null}
            attention={attention}
            onSelectShape={onSelect}
          />
        </aside>
      </div>
    </div>
  )
}
