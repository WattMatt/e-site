'use client'

/**
 * The status plan page's client side: state, writes, banners and layout.
 *
 * Every write is a per-shape server action whose result is FOLDED INTO LOCAL
 * STATE. There is no router.refresh(): it would re-render the server page
 * under the canvas and re-mint the drawing's signed URL. Selection is
 * mirrored to ?shape= with history.replaceState (no server round trip), so a
 * link from the tenant schedule and a reload land on the same shape.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PURPOSE_LABEL, type AreaType } from '@esite/shared/status-plans'
import {
  createStatusPlanShapeAction,
  deleteStatusPlanAction,
  deleteStatusPlanShapeAction,
  reanchorStatusPlanAction,
  renameStatusPlanAction,
  updateStatusPlanShapeAction,
} from '@/actions/status-plan.actions'
import { pageScaleFor, withPageScale } from '@/lib/sheet/page-scale'
import { legendSummary, needsAttention, resolveShapeView, type ShapeView } from '@/lib/status-plans/shape-view'
import { buildNodeOptions } from '@/lib/status-plans/node-options'
import { fileLabel, statusPlanHref, statusPlansHref } from '@/lib/status-plans/plan-urls'
import type { CanvasTool, ShapeCommit } from '@/lib/status-plans/canvas-reducer'
import type { ActionResult, CanvasShape, PlanNode, PlanSheet, StatusPlanPageProps } from '@/lib/status-plans/types'
import { ShapePanel } from './ShapePanel'
import { PlanLegend } from './PlanLegend'
import { DetectBlocksPanel, type DetectNode } from './DetectBlocksPanel'

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
  loading: () => <div className="data-panel" style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)' }}>Loading the drawing…</div>,
})

const ARM_MS = 4000
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function StatusPlanWorkspace(props: StatusPlanPageProps) {
  const { projectId, plan, canEdit, today } = props
  const purpose = plan.purpose
  const router = useRouter()

  const [shapes, setShapes] = useState<CanvasShape[]>(props.shapes)
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes
  const [sheet, setSheet] = useState<PlanSheet>(props.sheet)
  const [planName, setPlanName] = useState(plan.name)
  const [sourceFilePath, setSourceFilePath] = useState(plan.sourceFilePath)
  const [selectedId, setSelectedId] = useState<string | null>(props.initialShapeId)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; conflict: boolean } | null>(null)
  const [armedShape, setArmedShape] = useState<string | null>(null)
  const [armedPlan, setArmedPlan] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(plan.name)
  const [requestedTool, setRequestedTool] = useState<{ tool: CanvasTool; nonce: number } | null>(null)

  useEffect(() => {
    if (!armedShape) return
    const t = setTimeout(() => setArmedShape(null), ARM_MS)
    return () => clearTimeout(t)
  }, [armedShape])
  useEffect(() => {
    if (!armedPlan) return
    const t = setTimeout(() => setArmedPlan(false), ARM_MS)
    return () => clearTimeout(t)
  }, [armedPlan])

  // ?shape= mirrors the selection without a navigation.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', statusPlanHref(projectId, plan.id, selectedId))
    } catch {
      /* a sandboxed frame may refuse; the selection still works */
    }
  }, [projectId, plan.id, selectedId])

  // ── Derived ──────────────────────────────────────────────────────────────
  const nodesById = useMemo(() => new Map(props.nodes.map((n) => [n.id, n])), [props.nodes])
  const pixelsPerMeter = pageScaleFor(sheet, plan.pageIndex)
  const views = useMemo(() => {
    const ctx = { purpose, nodesById, shopLinks: props.shopLinks, dbOrders: props.dbOrders, today, pixelsPerMeter }
    const out: Record<string, ShapeView> = {}
    for (const s of shapes) out[s.id] = resolveShapeView(s, ctx)
    return out
  }, [shapes, purpose, nodesById, props.shopLinks, props.dbOrders, today, pixelsPerMeter])
  const summary = useMemo(() => legendSummary(Object.values(views), purpose), [views, purpose])
  const attention = useMemo(() => needsAttention(shapes, views), [shapes, views])
  const selected = shapes.find((s) => s.id === selectedId) ?? null
  const detectNodes = useMemo(() => props.nodes.map(toDetectNode), [props.nodes])
  const options = useMemo(() => buildNodeOptions(props.nodes, shapes, selectedId, purpose), [props.nodes, shapes, selectedId, purpose])
  const drawingChanged = sheet.currentFilePath !== sourceFilePath

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
    run(() => createStatusPlanShapeAction({ planId: plan.id, shape: c.shape, points: c.points }), (s) => {
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

  function rename() {
    void run(() => renameStatusPlanAction({ planId: plan.id, name: nameDraft }), (d) => {
      setPlanName(d.name)
      setRenaming(false)
    })
  }
  function deletePlan() {
    if (!armedPlan) { setArmedPlan(true); return }
    setArmedPlan(false)
    void run(() => deleteStatusPlanAction({ planId: plan.id }), () => router.push(statusPlansHref(projectId)))
  }
  function reanchor() {
    void run(() => reanchorStatusPlanAction({ planId: plan.id }), (d) => setSourceFilePath(d.sourceFilePath))
  }

  // Schematic plans: read the drawing's text and propose one rectangle per DB block (slice 3).
  // existingShapes is the LIVE state, so a re-run leaves accepted blocks out.
  const schematicSlot = purpose === 'distribution_schematic' ? (
    <div data-slot="schematic-detection">
      <DetectBlocksPanel
        planId={plan.id}
        pageIndex={plan.pageIndex}
        pdfUrl={sheet.signedUrl}
        isPdf={sheet.isPdf}
        nodes={detectNodes}
        existingShapes={shapes.map((s) => ({ id: s.id, points: s.points, nodeId: s.nodeId }))}
        canEdit={canEdit}
        onAccepted={(added) => setShapes((prev) => [...prev, ...added])}
      />
    </div>
  ) : null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        {renaming ? (
          <>
            <input className="ob-input" aria-label="Plan name" value={nameDraft} maxLength={120} onChange={(e) => setNameDraft(e.target.value)} />
            <button type="button" className="btn-primary-amber" disabled={busy} onClick={rename}>Save</button>
            <button type="button" onClick={() => { setRenaming(false); setNameDraft(planName) }}>Cancel</button>
          </>
        ) : (
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{planName}</h1>
        )}
        <span style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>
          {PURPOSE_LABEL[purpose]} · {sheet.name} · page {plan.pageIndex}
        </span>
        {canEdit && !renaming && (
          <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
            <button type="button" onClick={() => setRenaming(true)}>Rename</button>
            <button type="button" disabled={busy} onClick={deletePlan} style={{ color: '#dc2626', fontWeight: armedPlan ? 700 : 400 }}>
              {armedPlan ? 'Press again to delete the plan' : 'Delete plan'}
            </button>
          </span>
        )}
      </div>

      {drawingChanged && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, borderColor: 'var(--c-amber)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            This plan was drawn on <strong>{fileLabel(sourceFilePath)}</strong>; the drawing is now <strong>{fileLabel(sheet.currentFilePath)}</strong>.
            Shapes are shown where they were drawn — check them against the new sheet.
          </span>
          {canEdit && <button type="button" disabled={busy} onClick={reanchor}>Shapes checked — use the new file</button>}
        </div>
      )}

      {purpose === 'tenant_layout' && pixelsPerMeter === null && (
        <div role="status" className="data-panel" style={{ padding: '8px 12px', fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Calibrate this page on the drawing to measure areas. Until then areas show “—”.</span>
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
          pageIndex={plan.pageIndex}
          purpose={purpose}
          shapes={shapes}
          views={views}
          selectedId={selectedId}
          canEdit={canEdit}
          busy={busy}
          requestedTool={requestedTool}
          onSelect={onSelect}
          onCreate={onCreate}
          onReshape={onReshape}
          onDeleteRequest={requestDelete}
          onCalibrated={(c) => setSheet((s) => withPageScale(s, c.pageIndex, c.pixelsPerMeter))}
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
          <PlanLegend purpose={purpose} summary={summary} hasScale={pixelsPerMeter !== null} attention={attention} onSelectShape={onSelect} />
        </aside>
      </div>
    </div>
  )
}
