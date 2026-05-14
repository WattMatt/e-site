'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  type CableForCalc,
  type SupplyForCalc,
} from '@esite/shared'
import {
  MeasuredLengthEditor,
  ConfirmedLengthEditor,
} from './LengthEditPopover'

export interface ScheduleRow {
  id: string
  cable_no: number
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
  size_mm2: number
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  ohm_per_km: number | null
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  vd_pct: number
  cumulative_vd_pct: number
  derated_rating_a: number | null
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  tag_override: string | null
  manual_override: boolean
  notes: string | null
  /** When this cable is new or changed vs the most-recent ISSUED revision. */
  cloud_kind: 'added' | 'changed' | null
  cloud_letter: string
  supply_id: string
  from_node_id: string
  to_node_id: string
  armour: string | null
  section: string | null
  ambient_temp_c: number
}

export interface NodeOption { id: string; code: string; kind: 'source' | 'board' }

interface Props {
  projectId: string
  revisionId: string
  rows: ScheduleRow[]
  supplies: SupplyForCalc[]
  cables: CableForCalc[]
  nodeOptions: NodeOption[]
  locked: boolean
  lengthMode: 'design' | 'as-built' | 'worst'
  canEdit: boolean
}

const LENGTH_STATUS_TONE: Record<ScheduleRow['length_status'], string> = {
  UNMEASURED: 'badge-muted',
  MEASURED:   'badge-info',
  CONFIRMED:  'badge-success',
  DISCREPANCY: 'badge-error',
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Number(n).toFixed(decimals)
}

function activeLength(r: ScheduleRow): number | null {
  if (r.length_status === 'CONFIRMED' && r.confirmed_length_m != null) return r.confirmed_length_m
  return r.measured_length_m
}

function deltaLength(r: ScheduleRow): { abs: number; pct: number } | null {
  if (r.measured_length_m == null || r.confirmed_length_m == null) return null
  const abs = r.confirmed_length_m - r.measured_length_m
  const pct = r.measured_length_m > 0 ? (abs / r.measured_length_m) * 100 : 0
  return { abs, pct }
}

function utilisationPct(r: ScheduleRow): number | null {
  if (r.derated_rating_a == null || r.derated_rating_a <= 0 || r.load_a == null) return null
  return (r.load_a / r.derated_rating_a) * 100
}

function cableTag(r: ScheduleRow): string {
  if (r.tag_override) return r.tag_override
  return `${r.from_label}-${r.to_label}-${r.size_mm2}-${r.cable_no}`
}

export function CableScheduleGrid({ projectId, revisionId, rows, supplies, cables, nodeOptions, locked, lengthMode, canEdit }: Props) {
  const [query, setQuery] = useState('')
  const [editMeasured, setEditMeasured] = useState<ScheduleRow | null>(null)
  const [editConfirmed, setEditConfirmed] = useState<ScheduleRow | null>(null)

  const [liveRows, setLiveRows] = useState<ScheduleRow[]>(rows)
  const [liveSupplies, setLiveSupplies] = useState<SupplyForCalc[]>(supplies)
  const [liveCables, setLiveCables] = useState<CableForCalc[]>(cables)

  // Re-seed if the server sends fresh data (after revalidatePath).
  useEffect(() => { setLiveRows(rows); setLiveSupplies(supplies); setLiveCables(cables) },
    [rows, supplies, cables])

  /** Recompute VD + cumulative VD across all rows from the current raw snapshot. */
  function recomputeVd(
    nextSupplies: SupplyForCalc[],
    nextCables: CableForCalc[],
  ): Map<string, { vd: number; cum: number }> {
    const cumMap = computeCumulativeVdMap(nextSupplies, nextCables, lengthMode)
    const out = new Map<string, { vd: number; cum: number }>()
    for (const s of nextSupplies) {
      out.set(s.id, {
        vd: voltDropPctForSupply(s, nextCables, lengthMode),
        cum: cumMap.get(s.id) ?? 0,
      })
    }
    return out
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return liveRows
    return liveRows.filter(
      (r) =>
        r.from_label.toLowerCase().includes(q) ||
        r.to_label.toLowerCase().includes(q) ||
        cableTag(r).toLowerCase().includes(q) ||
        (r.notes ?? '').toLowerCase().includes(q),
    )
  }, [liveRows, query])

  // Group rows by supply for the parallel-cable left-edge brace (same FROM-TO
  // pair sharing a colour). Two adjacent rows with identical FROM+TO get a
  // matching colour-bar accent.
  function isPartOfParallel(idx: number): boolean {
    const r = filtered[idx]
    const next = filtered[idx + 1]
    const prev = filtered[idx - 1]
    const sameAs = (a: ScheduleRow, b: ScheduleRow | undefined): boolean =>
      !!b && a.from_label === b.from_label && a.to_label === b.to_label
    return !!r && (sameAs(r, next) || sameAs(r, prev!))
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tag, FROM, TO, notes…"
          className="ob-input"
          style={{ flex: 1, minWidth: 240, maxWidth: 360 }}
        />
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
          {filtered.length} of {liveRows.length} cables
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
            padding: '4px 8px', borderRadius: 4,
            color: lengthMode === 'design' ? 'var(--c-amber)'
                 : lengthMode === 'worst'  ? '#dc2626'
                 : 'var(--c-text-mid)',
            background: lengthMode === 'design' ? 'var(--c-amber-dim)'
                      : lengthMode === 'worst'  ? 'rgba(220,38,38,0.08)'
                      : 'var(--c-base)',
            border: '1px solid var(--c-border)',
          }}
          title="Active length-source mode driving VD + cumulative VD"
        >
          mode: {lengthMode.toUpperCase()}
        </span>
        {locked && (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
              padding: '4px 8px', borderRadius: 4, color: 'var(--c-text-mid)',
              background: 'var(--c-base)', border: '1px solid var(--c-border)',
            }}
          >
            🔒 READ-ONLY (revision issued)
          </span>
        )}
      </div>

      <div
        className="data-panel"
        style={{ overflowX: 'auto', overflowY: 'visible' }}
      >
        <table
          style={{
            width: '100%',
            minWidth: 2000,
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <Th w={4} />
              <Th w={32} align="center">Δ</Th>
              <Th w={220}>Cable tag</Th>
              <Th w={120}>From</Th>
              <Th w={120}>To</Th>
              <Th w={70} align="right">V</Th>
              <Th w={70} align="right">A</Th>
              <Th w={70} align="right">mm²</Th>
              <Th w={55} align="center">Cores</Th>
              <Th w={55} align="center">Cond</Th>
              <Th w={55} align="center">Insul</Th>
              <Th w={80} align="right">Ω/km</Th>
              <Th w={45} align="right">C/no</Th>
              <Th w={75} align="right">Meas (m)</Th>
              <Th w={75} align="right">Conf (m)</Th>
              <Th w={70} align="right">Δ m</Th>
              <Th w={100}>Length</Th>
              <Th w={80} align="right">VD %</Th>
              <Th w={85} align="right">Σ VD %</Th>
              <Th w={85} align="right">Derate A</Th>
              <Th w={75} align="right">Util %</Th>
              <Th w={100}>Install</Th>
              <Th w={70} align="right">Depth</Th>
              <Th w={55} align="right">Grp</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const delta = deltaLength(r)
              const util = utilisationPct(r)
              const vdTone =
                r.vd_pct > 5 ? '#dc2626' : r.vd_pct > 3 ? 'var(--c-amber)' : 'var(--c-text)'
              const cumTone =
                r.cumulative_vd_pct > 5 ? '#dc2626'
                : r.cumulative_vd_pct > 3 ? 'var(--c-amber)' : 'var(--c-text)'
              const utilTone =
                util == null ? 'var(--c-text-dim)'
                : util > 80 ? '#dc2626' : util > 65 ? 'var(--c-amber)' : 'var(--c-text)'
              const utilTooHot = util != null && r.load_a != null && r.derated_rating_a != null
                && r.derated_rating_a < r.load_a
              const deltaFlag = delta && r.measured_length_m
                && (Math.abs(delta.abs) > 5 || Math.abs(delta.pct) > 10)
              const len = activeLength(r)

              return (
                <tr
                  key={r.id}
                  style={{
                    borderTop: '1px solid var(--c-border)',
                    background: isPartOfParallel(i) ? 'rgba(243, 178, 88, 0.04)' : undefined,
                  }}
                >
                  <td style={{ padding: 0, width: 4, background: isPartOfParallel(i) ? 'var(--c-amber)' : 'transparent' }} />
                  <Td align="center" style={{ padding: '4px 6px' }}>
                    {r.cloud_kind && (
                      <span
                        title={r.cloud_kind === 'added'
                          ? `New in ${r.cloud_letter} vs last issued`
                          : `Changed in ${r.cloud_letter} vs last issued`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          padding: '1px 4px',
                          borderRadius: 8,
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          color: r.cloud_kind === 'added' ? '#16a34a' : 'var(--c-amber)',
                          background: r.cloud_kind === 'added' ? 'rgba(34,197,94,0.1)' : 'var(--c-amber-dim)',
                          border: `1px solid ${r.cloud_kind === 'added' ? '#16a34a' : 'var(--c-amber-mid)'}`,
                        }}
                      >
                        ☁{r.cloud_letter}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ fontWeight: 600, color: 'var(--c-text)' }}>{cableTag(r)}</span>
                    {r.manual_override && (
                      <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--c-amber)' }} title="Manual override">⚑</span>
                    )}
                  </Td>
                  <Td>{r.from_label}</Td>
                  <Td>{r.to_label}</Td>
                  <Td align="right">{fmt(r.voltage_v)}</Td>
                  <Td align="right">{fmt(r.load_a)}</Td>
                  <Td align="right">{fmt(r.size_mm2)}</Td>
                  <Td align="center">{r.cores}</Td>
                  <Td align="center">{r.conductor}</Td>
                  <Td align="center">{r.insulation}</Td>
                  <Td align="right">{fmt(r.ohm_per_km, 4)}</Td>
                  <Td align="right">{r.cable_no}</Td>
                  <Td align="right">
                    {locked ? (
                      fmt(r.measured_length_m, 1)
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditMeasured(r)}
                        title="Edit measured length (Designer)"
                        style={editCellBtn}
                      >
                        {fmt(r.measured_length_m, 1)}
                      </button>
                    )}
                  </Td>
                  <Td align="right">
                    {locked ? (
                      fmt(r.confirmed_length_m, 1)
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditConfirmed(r)}
                        title="Confirm length (Site / Verifier)"
                        style={editCellBtn}
                      >
                        {fmt(r.confirmed_length_m, 1)}
                      </button>
                    )}
                  </Td>
                  <Td align="right">
                    {delta == null ? '—' : (
                      <span style={{ color: deltaFlag ? '#dc2626' : 'var(--c-text)' }}>
                        {delta.abs > 0 ? '+' : ''}{fmt(delta.abs, 1)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className={`badge ${LENGTH_STATUS_TONE[r.length_status]}`}>
                      {r.length_status}
                    </span>
                  </Td>
                  <Td align="right" style={{ color: vdTone, fontWeight: r.vd_pct > 3 ? 700 : 400 }}>
                    {r.vd_pct > 0 ? fmt(r.vd_pct, 2) : '—'}
                  </Td>
                  <Td align="right" style={{ color: cumTone, fontWeight: r.cumulative_vd_pct > 3 ? 700 : 400 }}>
                    {r.cumulative_vd_pct > 0 ? fmt(r.cumulative_vd_pct, 2) : '—'}
                  </Td>
                  <Td align="right" style={{ color: utilTooHot ? '#dc2626' : 'var(--c-text)' }}>
                    {fmt(r.derated_rating_a, 0)}
                  </Td>
                  <Td align="right" style={{ color: utilTone, fontWeight: util != null && util > 65 ? 700 : 400 }}>
                    {util == null ? '—' : fmt(util, 1)}
                  </Td>
                  <Td>{r.installation_method ?? '—'}</Td>
                  <Td align="right">{fmt(r.depth_mm)}</Td>
                  <Td align="right">{r.grouped_with}</Td>
                  <Td style={{ fontFamily: 'inherit', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.notes ?? ''}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editMeasured && (
        <MeasuredLengthEditor
          cableId={editMeasured.id}
          initialValue={editMeasured.measured_length_m}
          initialMethod={null}
          onClose={() => setEditMeasured(null)}
        />
      )}
      {editConfirmed && (
        <ConfirmedLengthEditor
          cableId={editConfirmed.id}
          initialValue={editConfirmed.confirmed_length_m}
          initialMethod={null}
          measuredM={editConfirmed.measured_length_m}
          onClose={() => setEditConfirmed(null)}
        />
      )}
    </div>
  )
}

const editCellBtn: React.CSSProperties = {
  background: 'none',
  border: '1px dashed transparent',
  borderRadius: 3,
  color: 'inherit',
  font: 'inherit',
  padding: '0 4px',
  margin: '-2px',
  cursor: 'pointer',
}

function Th({
  children, align, w,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  w?: number
}) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '8px 10px',
        fontSize: 9,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--c-text-dim)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        width: w ? w : undefined,
        position: 'sticky',
        top: 0,
        background: 'var(--c-base)',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children, align, style,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  style?: React.CSSProperties
}) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '6px 10px',
        verticalAlign: 'top',
        whiteSpace: 'nowrap',
        color: 'var(--c-text)',
        ...style,
      }}
    >
      {children}
    </td>
  )
}
