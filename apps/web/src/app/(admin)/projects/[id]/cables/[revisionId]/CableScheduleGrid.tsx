'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  type CableForCalc,
  type SupplyForCalc,
} from '@esite/shared'
import {
  ConfirmedLengthEditor,
} from './LengthEditPopover'
import { EditableCell } from './EditableCell'
import { updateSupplyAction, updateCableAction, deleteCableAction, repointSupplyAction } from '@/actions/cable-entities.actions'

const VOLTAGE_OPTIONS = [230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000]
  .map((v) => ({ value: String(v), label: `${v} V` }))

const SIZE_OPTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
  .map((s) => ({ value: String(s), label: String(s) }))
const CORES_OPTIONS = ['3', '3+E', '4'].map((c) => ({ value: c, label: c }))
const CONDUCTOR_OPTIONS = [{ value: 'CU', label: 'Cu' }, { value: 'AL', label: 'Al' }]
const INSULATION_OPTIONS = ['XLPE', 'PVC', 'PILC'].map((i) => ({ value: i, label: i }))
const INSTALL_OPTIONS = [
  { value: 'DIRECT_IN_GROUND', label: 'Direct in ground' },
  { value: 'DUCT', label: 'Duct' },
  { value: 'LADDER', label: 'Ladder' },
  { value: 'TRAY', label: 'Tray' },
  { value: 'CLIPPED', label: 'Clipped' },
]

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
  const [editConfirmed, setEditConfirmed] = useState<ScheduleRow | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ScheduleRow | null>(null)
  const [repointing, setRepointing] = useState<{ row: ScheduleRow; end: 'from' | 'to' } | null>(null)

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

  async function saveSupplyField(
    supplyId: string,
    field: 'voltage_v' | 'design_load_a' | 'section',
    next: string | number | null,
  ): Promise<{ error?: string }> {
    const prevSupplies = liveSupplies
    const prevRows = liveRows
    // EditableCell yields strings for select cells and null for cleared number cells.
    const numericNext: number | null = next == null ? null : Number(next)
    // Optimistic: patch raw supplies + every row on that supply.
    // section doesn't affect VD — only the calc fields go into liveSupplies.
    const nextSupplies = field === 'section'
      ? liveSupplies
      : liveSupplies.map((s) =>
          s.id === supplyId ? { ...s, [field]: numericNext as number } : s)
    setLiveSupplies(nextSupplies)
    const vd = recomputeVd(nextSupplies, liveCables)
    setLiveRows(liveRows.map((r) => {
      if (r.supply_id !== supplyId) return r
      const v = vd.get(supplyId)
      return {
        ...r,
        voltage_v: field === 'voltage_v' ? numericNext : r.voltage_v,
        load_a: field === 'design_load_a' ? numericNext : r.load_a,
        section: field === 'section' ? (next as string | null) : r.section,
        vd_pct: v?.vd ?? r.vd_pct,
        cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct,
      }
    }))
    // Persist.
    const res = await updateSupplyAction({
      supplyId,
      voltageV: field === 'voltage_v' ? Number(next) : undefined,
      designLoadA: field === 'design_load_a' ? Number(next) : undefined,
      section: field === 'section' ? (next as 'NORMAL' | 'EMERGENCY' | null) : undefined,
    })
    if (res.error) { setLiveSupplies(prevSupplies); setLiveRows(prevRows); return { error: res.error } }
    return {}
  }

  type CableField =
    | 'size_mm2' | 'cores' | 'conductor' | 'insulation' | 'armour'
    | 'installation_method' | 'depth_mm' | 'grouped_with' | 'ambient_temp_c'
    | 'measured_length_m' | 'ohm_per_km_override' | 'tag_override' | 'notes'

  async function saveCableField(
    cableId: string, supplyId: string, field: CableField, next: string | number | null,
  ): Promise<{ error?: string }> {
    const prevRows = liveRows
    const prevCables = liveCables

    const rowKey: Partial<ScheduleRow> = {}
    const cableKey: Record<string, unknown> = {}
    switch (field) {
      case 'size_mm2': rowKey.size_mm2 = Number(next); cableKey.size_mm2 = Number(next); break
      case 'cores': rowKey.cores = next as string; cableKey.cores = next; break
      case 'conductor': rowKey.conductor = next as 'CU' | 'AL'; cableKey.conductor = next; break
      case 'insulation': rowKey.insulation = next as ScheduleRow['insulation']; cableKey.insulation = next; break
      case 'armour': rowKey.armour = next as string | null; break
      case 'installation_method': rowKey.installation_method = next as string | null; break
      case 'depth_mm': rowKey.depth_mm = next == null ? null : Number(next); break
      case 'grouped_with': rowKey.grouped_with = Number(next); break
      case 'ambient_temp_c': rowKey.ambient_temp_c = Number(next); break
      case 'measured_length_m':
        rowKey.measured_length_m = next == null ? null : Number(next)
        cableKey.measured_length_m = next == null ? null : Number(next)
        break
      case 'ohm_per_km_override':
        rowKey.ohm_per_km = next == null ? null : Number(next)
        rowKey.manual_override = next != null
        cableKey.ohm_per_km = next == null ? null : Number(next)
        break
      case 'tag_override': rowKey.tag_override = next as string | null; break
      case 'notes': rowKey.notes = next as string | null; break
    }
    const nextCables = liveCables.map((c) =>
      c.id === cableId ? { ...c, ...cableKey } as CableForCalc : c)
    setLiveCables(nextCables)
    const vd = recomputeVd(liveSupplies, nextCables)
    setLiveRows(liveRows.map((r) => {
      if (r.id !== cableId) {
        if (r.supply_id === supplyId) {
          const v = vd.get(supplyId)
          return { ...r, vd_pct: v?.vd ?? r.vd_pct, cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct }
        }
        return r
      }
      const v = vd.get(supplyId)
      return { ...r, ...rowKey, vd_pct: v?.vd ?? r.vd_pct, cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct }
    }))

    const res = await updateCableAction({
      cableId,
      sizeMm2: field === 'size_mm2' ? Number(next) : undefined,
      cores: field === 'cores' ? (next as '3' | '3+E' | '4') : undefined,
      conductor: field === 'conductor' ? (next as 'CU' | 'AL') : undefined,
      insulation: field === 'insulation' ? (next as 'PVC' | 'XLPE' | 'PILC') : undefined,
      armour: field === 'armour' ? (next as 'SWA' | 'UNARMOURED' | null) : undefined,
      installationMethod: field === 'installation_method'
        ? (next as 'DIRECT_IN_GROUND' | 'DUCT' | 'LADDER' | 'TRAY' | 'CLIPPED' | null) : undefined,
      depthMm: field === 'depth_mm' ? (next == null ? null : Number(next)) : undefined,
      groupedWith: field === 'grouped_with' ? Number(next) : undefined,
      ambientTempC: field === 'ambient_temp_c' ? Number(next) : undefined,
      measuredLengthM: field === 'measured_length_m' ? (next == null ? null : Number(next)) : undefined,
      ohmPerKmOverride: field === 'ohm_per_km_override' ? (next == null ? null : Number(next)) : undefined,
      tagOverride: field === 'tag_override' ? (next as string | null) : undefined,
      notes: field === 'notes' ? (next as string | null) : undefined,
    })
    if (res.error) { setLiveRows(prevRows); setLiveCables(prevCables); return { error: res.error } }
    if (res.recomputed) {
      setLiveRows((cur) => cur.map((r) => r.id === cableId
        ? {
            ...r,
            ohm_per_km: res.recomputed!.ohm_per_km,
            derated_rating_a: res.recomputed!.derated_current_rating_a ?? r.derated_rating_a,
            manual_override: field === 'ohm_per_km_override' ? r.manual_override : false,
          }
        : r))
    }
    return {}
  }

  async function confirmDeleteCable() {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    const prevRows = liveRows
    const prevCables = liveCables
    // Optimistic: prune the cable from the raw snapshot and recompute VD so a
    // surviving parallel sibling reflects its new (higher) volt-drop immediately.
    const nextCables = liveCables.filter((c) => c.id !== target.id)
    setLiveCables(nextCables)
    const vd = recomputeVd(liveSupplies, nextCables)
    setLiveRows(liveRows.filter((r) => r.id !== target.id).map((r) => {
      const v = vd.get(r.supply_id)
      return v ? { ...r, vd_pct: v.vd, cumulative_vd_pct: v.cum } : r
    }))
    const res = await deleteCableAction(target.id)
    if (res.error) {
      setLiveRows(prevRows)
      setLiveCables(prevCables)
      alert(`Could not delete: ${res.error}`)
    }
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
              {canEdit && !locked && <Th w={28} />}
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
                  {canEdit && !locked && (
                    <Td align="center" style={{ padding: '4px 2px' }}>
                      <button type="button" title="Delete cable"
                        onClick={() => setPendingDelete(r)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12 }}>
                        ✕
                      </button>
                    </Td>
                  )}
                  <Td>
                    <span style={{ fontWeight: 600, color: 'var(--c-text)' }}>{cableTag(r)}</span>
                    {r.manual_override && (
                      <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--c-amber)' }} title="Manual override">⚑</span>
                    )}
                  </Td>
                  <Td>
                    {canEdit && !locked ? (
                      <button type="button" style={editCellBtn} onClick={() => setRepointing({ row: r, end: 'from' })}>
                        {r.from_label}
                      </button>
                    ) : r.from_label}
                  </Td>
                  <Td>
                    {canEdit && !locked ? (
                      <button type="button" style={editCellBtn} onClick={() => setRepointing({ row: r, end: 'to' })}>
                        {r.to_label}
                      </button>
                    ) : r.to_label}
                  </Td>
                  <Td align="right">
                    <EditableCell
                      type="select" align="right" disabled={locked || !canEdit}
                      value={r.voltage_v} options={VOLTAGE_OPTIONS}
                      format={(v) => v == null ? '—' : `${v}`}
                      onSave={(next) => saveSupplyField(r.supply_id, 'voltage_v', next)}
                    />
                  </Td>
                  <Td align="right">
                    <EditableCell
                      type="number" align="right" disabled={locked || !canEdit}
                      value={r.load_a} format={(v) => fmt(typeof v === 'number' ? v : null)}
                      onSave={(next) => saveSupplyField(r.supply_id, 'design_load_a', next)}
                    />
                  </Td>
                  <Td align="right">
                    <EditableCell type="select" align="right" disabled={locked || !canEdit}
                      value={r.size_mm2} options={SIZE_OPTIONS}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'size_mm2', n)} />
                  </Td>
                  <Td align="center">
                    <EditableCell type="select" align="center" disabled={locked || !canEdit}
                      value={r.cores} options={CORES_OPTIONS}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'cores', n)} />
                  </Td>
                  <Td align="center">
                    <EditableCell type="select" align="center" disabled={locked || !canEdit}
                      value={r.conductor} options={CONDUCTOR_OPTIONS}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'conductor', n)} />
                  </Td>
                  <Td align="center">
                    <EditableCell type="select" align="center" disabled={locked || !canEdit}
                      value={r.insulation} options={INSULATION_OPTIONS}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'insulation', n)} />
                  </Td>
                  <Td align="right">
                    <EditableCell type="number" align="right" disabled={locked || !canEdit}
                      value={r.ohm_per_km}
                      format={(v) => fmt(typeof v === 'number' ? v : null, 4)}
                      placeholder="(auto)"
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'ohm_per_km_override', n)} />
                  </Td>
                  <Td align="right">{r.cable_no}</Td>
                  <Td align="right">
                    <EditableCell type="number" align="right" disabled={locked || !canEdit}
                      value={r.measured_length_m}
                      format={(v) => fmt(typeof v === 'number' ? v : null, 1)}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'measured_length_m', n)} />
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
                  <Td>
                    <EditableCell type="select" disabled={locked || !canEdit}
                      value={r.installation_method} options={INSTALL_OPTIONS}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'installation_method', n)} />
                  </Td>
                  <Td align="right">
                    <EditableCell type="number" align="right" disabled={locked || !canEdit}
                      value={r.depth_mm}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'depth_mm', n)} />
                  </Td>
                  <Td align="right">
                    <EditableCell type="number" align="right" disabled={locked || !canEdit}
                      value={r.grouped_with}
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'grouped_with', n)} />
                  </Td>
                  <Td style={{ fontFamily: 'inherit', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <EditableCell type="text" disabled={locked || !canEdit}
                      value={r.notes} placeholder=""
                      onSave={(n) => saveCableField(r.id, r.supply_id, 'notes', n)} />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editConfirmed && (
        <ConfirmedLengthEditor
          cableId={editConfirmed.id}
          initialValue={editConfirmed.confirmed_length_m}
          initialMethod={null}
          measuredM={editConfirmed.measured_length_m}
          onClose={() => setEditConfirmed(null)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete cable"
          body={`Delete cable #${pendingDelete.cable_no} (${pendingDelete.from_label} → ${pendingDelete.to_label})? This also removes its terminations and tags. If it is the last cable on this run, the run is removed too.`}
          confirmLabel="Delete"
          onConfirm={confirmDeleteCable}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {repointing && (
        <RepointPicker
          end={repointing.end}
          current={repointing.end === 'from' ? repointing.row.from_node_id : repointing.row.to_node_id}
          nodeOptions={repointing.end === 'from' ? nodeOptions : nodeOptions.filter((n) => n.kind === 'board')}
          onCancel={() => setRepointing(null)}
          onPick={async (nodeId, kind) => {
            const { row, end } = repointing
            setRepointing(null)
            const res = await repointSupplyAction({
              supplyId: row.supply_id,
              ...(end === 'from'
                ? { fromSourceId: kind === 'source' ? nodeId : null, fromBoardId: kind === 'board' ? nodeId : null }
                : { toBoardId: nodeId }),
            })
            if (res.error) { alert(`Could not re-route: ${res.error}`) }
            // repointSupplyAction revalidates → fresh rows arrive via the Task-8 useEffect re-seed.
          }}
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

function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="c12-confirm-dialog-title"
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="data-panel" style={{ padding: 16, minWidth: 320, maxWidth: 440,
        display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c-panel)' }}>
        <h3 id="c12-confirm-dialog-title" style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--c-text)' }}>{title}</h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>{body}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onCancel} className="btn-primary-amber" autoFocus
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary-amber"
            style={{ background: '#dc2626', borderColor: '#dc2626' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function RepointPicker({
  end, current, nodeOptions, onCancel, onPick,
}: {
  end: 'from' | 'to'
  current: string
  nodeOptions: NodeOption[]
  onCancel: () => void
  onPick: (nodeId: string, kind: 'source' | 'board') => void
}) {
  const [selected, setSelected] = useState(current ?? nodeOptions[0]?.id ?? '')

  const selectedOption = nodeOptions.find((n) => n.id === selected)

  function handlePick() {
    if (!selectedOption) return
    onPick(selectedOption.id, selectedOption.kind)
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="c12-repoint-picker-title"
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="data-panel" style={{ padding: 16, minWidth: 320, maxWidth: 440,
        display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c-panel)' }}>
        <h3 id="c12-repoint-picker-title" style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--c-text)' }}>
          Re-route — change the {end === 'from' ? 'origin' : 'destination'}
        </h3>
        <select
          className="ob-input"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{ fontSize: 12 }}
        >
          {nodeOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.code} {n.kind === 'source' ? '(source)' : '(board)'}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onCancel} className="btn-primary-amber" autoFocus
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
            Cancel
          </button>
          <button type="button" onClick={handlePick} className="btn-primary-amber"
            disabled={!selectedOption}>
            Re-route
          </button>
        </div>
      </div>
    </div>
  )
}
