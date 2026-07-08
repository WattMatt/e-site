'use client'

/**
 * DbLegendPanel — per-tenant DB legend editor (spec 2026-07-08).
 *
 *   1. Header strip: location / fed-from / earth-leakage / card size —
 *      auto-saves on blur via updateLegendHeaderAction. Main breaker is
 *      displayed read-only from the node's breaker fields.
 *   2. Circuit grid: inline-editable rows (save appears when dirty),
 *      spare toggle, delete, single "Add way", quick-add N ways.
 *   3. Print: anchor to /api/tenant-schedule/legend-card/pdf.
 *
 * Inline-expand panel — ScheduleTable renders it full-width below the tenant
 * row (same shape as ScopeOfWorkPanel).
 */

import { useState, useTransition } from 'react'
import type { LegendCircuit, LegendHeader } from '@esite/shared'
import {
  upsertCircuitAction,
  deleteCircuitAction,
  quickAddWaysAction,
  updateLegendHeaderAction,
  type CircuitInput,
} from '@/actions/db-legend.actions'

interface Props {
  projectId: string
  nodeId: string
  shopName: string | null
  /** Pre-formatted node breaker, e.g. "63 A TP" (ScheduleTable's formatBreaker). */
  mainBreaker: string | null
  header: LegendHeader | null
  circuits: LegendCircuit[]
  readOnly?: boolean
  onClose: () => void
}

type DraftCircuit = Omit<LegendCircuit, 'id' | 'node_id' | 'sort_order'> & {
  id: string | null // null = unsaved new row
  localKey: string
}

function toDraft(c: LegendCircuit): DraftCircuit {
  return { ...c, id: c.id, localKey: c.id }
}

function emptyDraft(): DraftCircuit {
  return {
    id: null,
    localKey: crypto.randomUUID(),
    circuit_no: '',
    description: null,
    phase: null,
    breaker_rating_a: null,
    poles: null,
    curve: null,
    cable_size: null,
    is_spare: false,
  }
}

export function DbLegendPanel({
  projectId,
  nodeId,
  shopName,
  mainBreaker,
  header,
  circuits: initialCircuits,
  readOnly = false,
  onClose,
}: Props) {
  const [rows, setRows] = useState<DraftCircuit[]>(initialCircuits.map(toDraft))
  const [savedByKey, setSavedByKey] = useState<Record<string, DraftCircuit>>(
    Object.fromEntries(initialCircuits.map((c) => [c.id, toDraft(c)])),
  )
  const [headerDraft, setHeaderDraft] = useState({
    db_location: header?.db_location ?? '',
    db_fed_from: header?.db_fed_from ?? '',
    db_earth_leakage_ma: header?.db_earth_leakage_ma != null ? String(header.db_earth_leakage_ma) : '',
    legend_card_size: header?.legend_card_size ?? ('A4' as 'A4' | 'A5'),
  })
  const [quickCount, setQuickCount] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function isDirty(row: DraftCircuit): boolean {
    if (row.id === null) return true
    const saved = savedByKey[row.localKey]
    if (!saved) return true
    return (
      row.circuit_no !== saved.circuit_no ||
      row.description !== saved.description ||
      row.phase !== saved.phase ||
      row.breaker_rating_a !== saved.breaker_rating_a ||
      row.poles !== saved.poles ||
      row.curve !== saved.curve ||
      row.cable_size !== saved.cable_size ||
      row.is_spare !== saved.is_spare
    )
  }

  function patchRow(localKey: string, patch: Partial<DraftCircuit>) {
    setRows((prev) => prev.map((r) => (r.localKey === localKey ? { ...r, ...patch } : r)))
  }

  function saveRow(row: DraftCircuit) {
    setError(null)
    const input: CircuitInput = {
      id: row.id ?? undefined,
      circuit_no: row.circuit_no,
      description: row.description || null,
      phase: row.phase,
      breaker_rating_a: row.breaker_rating_a,
      poles: row.poles,
      curve: row.curve,
      cable_size: row.cable_size || null,
      is_spare: row.is_spare,
    }
    startTransition(async () => {
      const res = await upsertCircuitAction(projectId, nodeId, input)
      if ('error' in res) {
        setError(res.error)
        return
      }
      const saved: DraftCircuit = { ...row, id: res.circuit.id }
      setRows((prev) => prev.map((r) => (r.localKey === row.localKey ? saved : r)))
      setSavedByKey((prev) => ({ ...prev, [row.localKey]: saved }))
    })
  }

  function removeRow(row: DraftCircuit) {
    setError(null)
    if (row.id === null) {
      setRows((prev) => prev.filter((r) => r.localKey !== row.localKey))
      return
    }
    const snapshot = rows
    setRows((prev) => prev.filter((r) => r.localKey !== row.localKey)) // optimistic
    startTransition(async () => {
      const res = await deleteCircuitAction(projectId, nodeId, row.id as string)
      if ('error' in res) {
        setError(res.error)
        setRows(snapshot)
      }
    })
  }

  function quickAdd() {
    setError(null)
    startTransition(async () => {
      const res = await quickAddWaysAction(projectId, nodeId, quickCount)
      if ('error' in res) {
        setError(res.error)
        return
      }
      const drafts = res.circuits.map(toDraft)
      setRows((prev) => [...prev, ...drafts])
      setSavedByKey((prev) => ({
        ...prev,
        ...Object.fromEntries(drafts.map((d) => [d.localKey, d])),
      }))
    })
  }

  function saveHeaderField(patch: Partial<typeof headerDraft>) {
    setError(null)
    // Snapshot current state BEFORE the optimistic mutation so we can revert
    // to it (not to the stale mount-time prop) if the action fails.
    const snapshot = headerDraft
    const next = { ...headerDraft, ...patch }
    setHeaderDraft(next) // optimistic
    startTransition(async () => {
      const res = await updateLegendHeaderAction(projectId, nodeId, {
        db_location: next.db_location.trim() || null,
        db_fed_from: next.db_fed_from.trim() || null,
        db_earth_leakage_ma: next.db_earth_leakage_ma.trim() === '' ? null : Number(next.db_earth_leakage_ma),
        legend_card_size: next.legend_card_size,
      })
      if ('error' in res) {
        setError(res.error)
        setHeaderDraft(snapshot) // revert
      }
    })
  }

  const printHref = `/api/tenant-schedule/legend-card/pdf?nodeId=${nodeId}&size=${headerDraft.legend_card_size}`

  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--c-bg)',
        borderTop: '1px solid var(--c-border)',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--c-text-dim)', marginRight: 8,
            }}
          >
            DB Legend
          </span>
          {shopName && <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{shopName}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href={printHref}
            style={{
              fontSize: 11, fontWeight: 600, textDecoration: 'none', padding: '4px 10px',
              border: '1px solid var(--c-green)', borderRadius: 5, color: 'var(--c-green)', whiteSpace: 'nowrap',
            }}
          >
            Print legend card ({headerDraft.legend_card_size})
          </a>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
            aria-label="Close legend panel"
          >
            ×
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '8px 12px', marginBottom: 12, background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)', borderRadius: 6, fontSize: 13, color: 'var(--c-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* Board header fields */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <HeaderField label="Location">
          <input
            type="text"
            value={headerDraft.db_location}
            disabled={readOnly}
            onChange={(e) => setHeaderDraft((p) => ({ ...p, db_location: e.target.value }))}
            onBlur={() => !readOnly && saveHeaderField({})}
            style={inputStyle(130)}
          />
        </HeaderField>
        <HeaderField label="Fed from">
          <input
            type="text"
            value={headerDraft.db_fed_from}
            disabled={readOnly}
            onChange={(e) => setHeaderDraft((p) => ({ ...p, db_fed_from: e.target.value }))}
            onBlur={() => !readOnly && saveHeaderField({})}
            style={inputStyle(130)}
          />
        </HeaderField>
        <HeaderField label="Main breaker">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-text)', padding: '5px 0', display: 'inline-block' }}>
            {mainBreaker ?? '—'}
          </span>
        </HeaderField>
        <HeaderField label="Earth leakage (mA)">
          <input
            type="number"
            min={1}
            value={headerDraft.db_earth_leakage_ma}
            disabled={readOnly}
            onChange={(e) => setHeaderDraft((p) => ({ ...p, db_earth_leakage_ma: e.target.value }))}
            onBlur={() => !readOnly && saveHeaderField({})}
            style={inputStyle(70)}
          />
        </HeaderField>
        <HeaderField label="Card size">
          <select
            value={headerDraft.legend_card_size}
            disabled={readOnly}
            onChange={(e) => saveHeaderField({ legend_card_size: e.target.value as 'A4' | 'A5' })}
            style={inputStyle(64)}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
        </HeaderField>
      </div>

      {/* Circuit grid */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
            {['CCT', 'Phase', 'Description', 'CB (A)', 'Poles', 'Curve', 'Cable', 'Spare', ''].map((h) => (
              <th
                key={h}
                style={{
                  padding: '6px 8px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10,
                  fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-dim)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.localKey} style={{ borderBottom: '1px solid var(--c-border)', opacity: row.is_spare ? 0.65 : 1 }}>
              <td style={cellStyle}>
                <input type="text" value={row.circuit_no} disabled={readOnly} aria-label={`Circuit number`}
                  onChange={(e) => patchRow(row.localKey, { circuit_no: e.target.value })} style={inputStyle(44)} />
              </td>
              <td style={cellStyle}>
                <select value={row.phase ?? ''} disabled={readOnly} aria-label="Phase"
                  onChange={(e) => patchRow(row.localKey, { phase: (e.target.value || null) as DraftCircuit['phase'] })} style={inputStyle(56)}>
                  <option value="">—</option>
                  <option value="L1">L1</option>
                  <option value="L2">L2</option>
                  <option value="L3">L3</option>
                  <option value="3P">3Φ</option>
                </select>
              </td>
              <td style={cellStyle}>
                <input type="text" value={row.description ?? ''} disabled={readOnly} placeholder={row.is_spare ? 'SPARE' : ''}
                  aria-label="Description"
                  onChange={(e) => patchRow(row.localKey, { description: e.target.value || null })} style={inputStyle(200)} />
              </td>
              <td style={cellStyle}>
                <input type="number" min={0} value={row.breaker_rating_a ?? ''} disabled={readOnly} aria-label="Breaker rating (A)"
                  onChange={(e) => patchRow(row.localKey, { breaker_rating_a: e.target.value === '' ? null : Number(e.target.value) })}
                  style={inputStyle(60)} />
              </td>
              <td style={cellStyle}>
                <select value={row.poles ?? ''} disabled={readOnly} aria-label="Poles"
                  onChange={(e) => patchRow(row.localKey, { poles: (e.target.value === '' ? null : Number(e.target.value)) as DraftCircuit['poles'] })}
                  style={inputStyle(48)}>
                  <option value="">—</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </td>
              <td style={cellStyle}>
                <select value={row.curve ?? ''} disabled={readOnly} aria-label="Curve"
                  onChange={(e) => patchRow(row.localKey, { curve: (e.target.value || null) as DraftCircuit['curve'] })} style={inputStyle(48)}>
                  <option value="">—</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </td>
              <td style={cellStyle}>
                <input type="text" value={row.cable_size ?? ''} disabled={readOnly} aria-label="Cable size"
                  onChange={(e) => patchRow(row.localKey, { cable_size: e.target.value || null })} style={inputStyle(90)} />
              </td>
              <td style={cellStyle}>
                <input type="checkbox" checked={row.is_spare} disabled={readOnly} aria-label="Spare"
                  onChange={(e) => patchRow(row.localKey, { is_spare: e.target.checked })} />
              </td>
              <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                {!readOnly && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isDirty(row) && (
                      <button onClick={() => saveRow(row)} disabled={isPending || row.circuit_no.trim() === ''}
                        style={smallBtn('var(--c-green)')}>
                        Save
                      </button>
                    )}
                    <button onClick={() => removeRow(row)} disabled={isPending} aria-label={`Delete circuit ${row.circuit_no}`}
                      style={smallBtn('var(--c-red)')}>
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...cellStyle, color: 'var(--c-text-dim)', padding: '14px 8px' }}>
                No circuits captured yet{readOnly ? '.' : ' — add ways below.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Add controls */}
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button onClick={() => setRows((prev) => [...prev, emptyDraft()])} disabled={isPending} style={smallBtn('var(--c-text-mid)')}>
            + Add way
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min={1} max={60} value={quickCount} aria-label="Number of ways to add"
              onChange={(e) => setQuickCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              style={inputStyle(52)}
            />
            <button onClick={quickAdd} disabled={isPending} style={smallBtn('var(--c-green)')}>
              + Add ways
            </button>
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>new ways start as SPARE</span>
          </div>
        </div>
      )}
    </div>
  )
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--c-text-dim)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const cellStyle: React.CSSProperties = { padding: '5px 8px' }

function inputStyle(width: number): React.CSSProperties {
  return {
    width, padding: '4px 6px', fontSize: 12, fontFamily: 'var(--font-mono)',
    background: 'var(--c-panel)', color: 'var(--c-text)',
    border: '1px solid var(--c-border)', borderRadius: 4,
  }
}

function smallBtn(color: string): React.CSSProperties {
  return {
    background: 'none', border: `1px solid ${color}`, borderRadius: 5, cursor: 'pointer',
    padding: '3px 9px', fontSize: 11, color, fontWeight: 600, whiteSpace: 'nowrap',
  }
}
