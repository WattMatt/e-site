'use client'

/**
 * The selected shape: what it is, how the shop stands, its measured vs
 * scheduled area, and (for writers) assign / area type / unassign / delete.
 * `extra` is the slice-3 seam: the schematic "Detect blocks" panel renders
 * there. Every rule this panel shows comes from shape-view / node-options.
 */
import { useState, type ReactNode } from 'react'
import { AREA_TYPES, AREA_TYPE_LABEL, type AreaType, type NodeOrderStatus, type ShopLink, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { filterNodeOptions, type NodeOption } from '@/lib/status-plans/node-options'
import { swatchCss, type ShapeView } from '@/lib/status-plans/shape-view'
import type { CanvasShape, PlanNode } from '@/lib/status-plans/types'

export interface ShapePanelProps {
  purpose: StatusPlanPurpose
  shape: CanvasShape | null
  view: ShapeView | null
  node: PlanNode | null
  link: ShopLink | null
  options: NodeOption[]
  canEdit: boolean
  busy: boolean
  /** The workspace's two-step delete is armed for this shape. */
  deleteArmed: boolean
  hasScale: boolean
  onAssignNode: (nodeId: string) => void
  onSetAreaType: (t: AreaType) => void
  onUnassign: () => void
  onDelete: () => void
  /** Slice 3 seam (schematic block detection). */
  extra?: ReactNode
}

const LIST_LIMIT = 40

const ORDER_LABEL: Record<NodeOrderStatus, string> = { required: 'Required', ordered: 'Ordered', received: 'Received', by_tenant: 'By tenant' }
const SCOPE_LABEL = { awaited: 'Awaited', received: 'Received', not_required: 'Not required' } as const

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--c-text-dim)' }}>{k}</span>
      <span>{v}</span>
    </div>
  )
}

const signed = (v: number, unit: string) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}${unit}`

export function ShapePanel(p: ShapePanelProps) {
  const [query, setQuery] = useState('')

  if (!p.shape || !p.view) {
    return (
      <div className="data-panel" style={{ padding: 12, fontSize: 13, color: 'var(--c-text-mid)' }}>
        {p.canEdit
          ? p.purpose === 'tenant_layout'
            ? 'Select a shape to see its shop, or draw one with Polygon or Rectangle.'
            : 'Select a block to see its board, or draw one with Rectangle.'
          : 'Select a shape to see its shop.'}
        {p.extra}
      </div>
    )
  }

  const { view, shape } = p
  const facts = p.link?.state === 'active' ? p.link.facts : null
  const filtered = filterNodeOptions(p.options, query)

  return (
    <div className="data-panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 15 }}>{view.labelLines.filter((l) => !l.endsWith('m²')).join(' — ') || 'Shape'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12 }}>
          <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, display: 'inline-block', ...swatchCss(view.style) }} />
          <span>{view.statusLabel}</span>
          {shape.source === 'detected' && <span style={{ color: 'var(--c-text-dim)' }}>· detected{shape.detectedTag ? ` (${shape.detectedTag})` : ''}</span>}
        </div>
      </div>

      {facts && (
        <div>
          <Row k="Scope" v={SCOPE_LABEL[facts.scope]} />
          <Row k="Layout" v={facts.layoutIssued ? 'Issued' : 'Not issued'} />
          <Row k="DB order" v={facts.db ? ORDER_LABEL[facts.db] : 'No order yet'} />
          <Row k="Lights order" v={facts.lights ? ORDER_LABEL[facts.lights] : 'No order yet'} />
          <Row k="BO date" v={facts.boDate ?? '—'} />
        </div>
      )}

      {p.purpose === 'tenant_layout' && (
        <div>
          <Row k="Measured" v={view.areaM2 !== null ? `${view.areaM2.toFixed(1)} m²` : p.hasScale ? '—' : '— (no scale on this page)'} />
          {p.node && <Row k="Scheduled" v={p.node.scheduledM2 !== null ? `${p.node.scheduledM2.toFixed(1)} m²` : '—'} />}
          {view.check?.state === 'differs' && view.check.deltaM2 !== null && view.check.deltaPct !== null && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-amber)' }}>
              Area differs from the schedule by {signed(view.check.deltaM2, ' m²')} ({signed(view.check.deltaPct, ' %')}).
            </p>
          )}
        </div>
      )}

      {p.canEdit && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            {p.purpose === 'tenant_layout' ? 'Find a shop' : 'Find a board'}
            <input
              className="ob-input"
              aria-label={p.purpose === 'tenant_layout' ? 'Find a shop' : 'Find a board'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Number, name or code"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
            {filtered.slice(0, LIST_LIMIT).map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={o.disabled || p.busy || o.id === shape.nodeId}
                  onClick={() => p.onAssignNode(o.id)}
                  style={{ width: '100%', textAlign: 'left', padding: '6px 8px', background: o.id === shape.nodeId ? 'var(--c-amber-mid)' : 'none', border: 0, borderBottom: '1px solid var(--c-border)', cursor: o.disabled ? 'not-allowed' : 'pointer', fontSize: 12 }}
                >
                  <span>{o.label}</span>
                  {(o.sub || o.reason) && (
                    <span style={{ display: 'block', color: 'var(--c-text-dim)', fontSize: 11 }}>
                      {[o.sub, o.reason].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li style={{ padding: 8, fontSize: 12, color: 'var(--c-text-dim)' }}>Nothing matches.</li>}
            {filtered.length > LIST_LIMIT && (
              <li style={{ padding: 8, fontSize: 12, color: 'var(--c-text-dim)' }}>{filtered.length - LIST_LIMIT} more — refine the search.</li>
            )}
          </ul>

          {p.purpose === 'tenant_layout' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {AREA_TYPES.map((t) => (
                <button key={t} type="button" disabled={p.busy || shape.areaType === t} onClick={() => p.onSetAreaType(t)} style={{ fontSize: 11, padding: '4px 8px' }}>
                  {AREA_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(shape.nodeId || shape.areaType) && (
              <button type="button" disabled={p.busy} onClick={p.onUnassign} style={{ fontSize: 12 }}>Unassign</button>
            )}
            <button
              type="button"
              disabled={p.busy}
              onClick={p.onDelete}
              style={{ fontSize: 12, color: '#dc2626', fontWeight: p.deleteArmed ? 700 : 400 }}
            >
              {p.deleteArmed ? 'Press again to delete' : 'Delete shape'}
            </button>
          </div>
        </div>
      )}

      {p.extra}
    </div>
  )
}
