'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  type CableForCalc,
  type SupplyForCalc,
} from '@esite/shared'
import type { EnrichedRun, EnrichedCable } from '@/lib/cable-schedule/export-payload'
import { sansBreadcrumb, sansBreadcrumbAsTooltip } from '@/lib/cable-schedule/sans-breadcrumb'
import {
  ConfirmedLengthEditor,
} from './LengthEditPopover'
import { EditableCell } from './EditableCell'
import { CableFormModal, type DrawerState } from './CableFormModal'
import { TableScrollX } from '@/components/ui/TableScrollX'
import { useRouter } from 'next/navigation'
import {
  updateSupplyAction,
  updateCableAction,
  updateRunCableFieldsAction,
  normaliseRunPropertiesAction,
  deleteCableAction,
  deleteSupplyAction,
  repointSupplyAction,
} from '@/actions/cable-entities.actions'
import { bulkUpdateCableLengthStatusAction } from '@/actions/cable-length.actions'

const VOLTAGE_OPTIONS = [230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000]
  .map((v) => ({ value: String(v), label: `${v} V` }))

/**
 * Column count for full-width inline rows (mixed-properties banner, shared-edit
 * error banner, "+ Add strand" tail row, inline edit-strand / edit-run /
 * add-strand form rows). Update in lock-step with the <thead> column list.
 */
const TOTAL_COLS = 24

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

/**
 * Legacy per-cable row shape kept for cloud-diff annotations + node IDs that
 * EnrichedRun doesn't carry today. Used as a sidecar lookup; the grid no longer
 * iterates this directly (one row per RUN now).
 */
export interface ScheduleRow {
  id: string
  cable_no: number
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
  per_cable_load_a: number | null
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
  combined_capacity_a: number
  supply_under_rated: boolean
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  tag_override: string | null
  manual_override: boolean
  notes: string | null
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
  /** Cloud annotations + node IDs keyed by cable id; legacy shape. */
  rows: ScheduleRow[]
  /** One per supply — the canonical "schedule line" iteration target. */
  runs: EnrichedRun[]
  supplies: SupplyForCalc[]
  cables: CableForCalc[]
  nodeOptions: NodeOption[]
  locked: boolean
  lengthMode: 'design' | 'as-built' | 'worst'
  canEdit: boolean
}

const LENGTH_STATUS_TONE: Record<EnrichedRun['length_status'], string> = {
  UNMEASURED: 'badge-muted',
  MEASURED:   'badge-info',
  CONFIRMED:  'badge-success',
  DISCREPANCY: 'badge-error',
}

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Number(n).toFixed(decimals)
}

function activeLengthForCable(c: EnrichedCable, mode: 'design' | 'as-built' | 'worst'): number | null {
  const meas = c.measured_length_m
  const conf = c.confirmed_length_m
  if (mode === 'design') return meas
  if (mode === 'worst') {
    if (meas != null && conf != null) return Math.max(meas, conf)
    return conf ?? meas
  }
  if (c.length_status === 'CONFIRMED' && conf != null) return conf
  return meas
}

/** Worst (longest) active length across a run's strands, in metres. */
function activeLengthForRun(run: EnrichedRun, mode: 'design' | 'as-built' | 'worst'): number | null {
  let worst: number | null = null
  for (const c of run.cables) {
    const l = activeLengthForCable(c, mode)
    if (l == null) continue
    if (worst == null || l > worst) worst = l
  }
  return worst
}

function deltaForCable(c: EnrichedCable): { abs: number; pct: number } | null {
  if (c.measured_length_m == null || c.confirmed_length_m == null) return null
  const abs = c.confirmed_length_m - c.measured_length_m
  const pct = c.measured_length_m > 0 ? (abs / c.measured_length_m) * 100 : 0
  return { abs, pct }
}

function utilisationPctForRun(run: EnrichedRun): number | null {
  if (run.combined_capacity_a == null || run.combined_capacity_a <= 0) return null
  if (run.load_a == null) return null
  return (run.load_a / run.combined_capacity_a) * 100
}

/** Canonical run identifier (FROM–TO). Used for search matching + action aria-labels. */
function runLabel(run: EnrichedRun): string {
  const suffix = run.parallel_count > 1 ? ` ×${run.parallel_count}` : ''
  return `${run.from_label}–${run.to_label}${suffix}`
}

/** Per-strand tag (honours the cable's tag_override). Used for search matching. */
function strandTag(c: EnrichedCable): string {
  if (c.tag_override) return c.tag_override
  return `${c.from_label}-${c.to_label}-${c.size_mm2}-${c.cable_no}`
}

/**
 * Cloud annotation for a run = "added" if ANY strand is added, else "changed"
 * if any strand is changed, else null. Letter takes the first matching strand.
 */
function cloudForRun(run: EnrichedRun, rowById: Map<string, ScheduleRow>): { kind: 'added' | 'changed' | null; letter: string } {
  let kind: 'added' | 'changed' | null = null
  let letter = ''
  for (const c of run.cables) {
    const r = rowById.get(c.id)
    if (!r?.cloud_kind) continue
    if (r.cloud_kind === 'added') {
      return { kind: 'added', letter: r.cloud_letter }
    }
    if (kind == null) {
      kind = 'changed'
      letter = r.cloud_letter
    }
  }
  return { kind, letter }
}

export function CableScheduleGrid({
  projectId,
  revisionId,
  rows,
  runs,
  supplies,
  cables,
  nodeOptions,
  locked,
  lengthMode,
  canEdit,
}: Props) {
  const [query, setQuery] = useState('')
  const [editConfirmed, setEditConfirmed] = useState<EnrichedCable | null>(null)
  const [pendingDelete, setPendingDelete] = useState<EnrichedCable | null>(null)
  const [pendingDeleteRun, setPendingDeleteRun] = useState<EnrichedRun | null>(null)
  const [repointing, setRepointing] = useState<{ supplyId: string; from: string; to: string; end: 'from' | 'to'; current: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<DrawerState | null>(null)

  // C11 — selection model for bulk strand status update. Tracks individual
  // cable ids (strands), not runs. Cleared on successful bulk action.
  const [selectedCableIds, setSelectedCableIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const router = useRouter()
  const [savingShared, setSavingShared] = useState<string | null>(null) // supply_id while a fan-out is in flight
  const [sharedError, setSharedError] = useState<{ supplyId: string; message: string } | null>(null)

  // Live state mirrors props so optimistic edits survive until revalidatePath
  // brings fresh server data. Re-seeded on prop change (same pattern as before).
  const [liveRuns, setLiveRuns] = useState<EnrichedRun[]>(runs)
  const [liveSupplies, setLiveSupplies] = useState<SupplyForCalc[]>(supplies)
  const [liveCables, setLiveCables] = useState<CableForCalc[]>(cables)
  useEffect(() => { setLiveRuns(runs); setLiveSupplies(supplies); setLiveCables(cables) }, [runs, supplies, cables])

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows])

  // ── Recompute VD across all runs from the current raw snapshot ──────
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

  // ── Supply-level field (voltage, design load, section) ──────────────
  async function saveSupplyField(
    supplyId: string,
    field: 'voltage_v' | 'design_load_a' | 'section',
    next: string | number | null,
  ): Promise<{ error?: string }> {
    const prevSupplies = liveSupplies
    const prevRuns = liveRuns
    const numericNext: number | null = next == null ? null : Number(next)

    const nextSupplies = field === 'section'
      ? liveSupplies
      : liveSupplies.map((s) => s.id === supplyId ? { ...s, [field]: numericNext as number } : s)
    setLiveSupplies(nextSupplies)
    const vd = recomputeVd(nextSupplies, liveCables)
    setLiveRuns(liveRuns.map((r) => {
      if (r.supply_id !== supplyId) return r
      const v = vd.get(supplyId)
      return {
        ...r,
        voltage_v: field === 'voltage_v' ? Number(numericNext) : r.voltage_v,
        load_a: field === 'design_load_a' ? numericNext : r.load_a,
        section: field === 'section' ? (next as string | null) : r.section,
        vd_pct: v?.vd ?? r.vd_pct,
        cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct,
      }
    }))

    const res = await updateSupplyAction({
      supplyId,
      voltageV: field === 'voltage_v' ? Number(next) : undefined,
      designLoadA: field === 'design_load_a' ? Number(next) : undefined,
      section: field === 'section' ? (next as 'NORMAL' | 'EMERGENCY' | null) : undefined,
    })
    if (res.error) { setLiveSupplies(prevSupplies); setLiveRuns(prevRuns); return { error: res.error } }
    return {}
  }

  // ── Run-level shared field (fan-out to every parallel cable on the supply) ─
  // measured_length_m IS shared (the 90% case: parallels share a route + length)
  // but is NOT included in mixed_properties divergence detection — the badge
  // would be noisy because strand-by-strand length variation is normal.
  type SharedField =
    | 'size_mm2' | 'cores' | 'conductor' | 'insulation'
    | 'installation_method' | 'depth_mm' | 'grouped_with'
    | 'measured_length_m'

  async function saveRunSharedField(
    supplyId: string,
    field: SharedField,
    next: string | number | null,
  ): Promise<{ error?: string }> {
    const prevRuns = liveRuns
    const prevCables = liveCables
    setSavingShared(supplyId)
    setSharedError(null)

    // Optimistic: patch every strand in the supply + the run aggregate.
    const nextCables = liveCables.map((c) => {
      if (c.supply_id !== supplyId) return c
      const patch: Record<string, unknown> = {}
      if (field === 'size_mm2') patch.size_mm2 = Number(next)
      else if (field === 'depth_mm') patch.depth_mm = next == null ? null : Number(next)
      else if (field === 'grouped_with') patch.grouped_with = Number(next)
      else if (field === 'measured_length_m') patch.measured_length_m = next == null ? null : Number(next)
      else patch[field] = next
      return { ...c, ...patch } as CableForCalc
    })
    setLiveCables(nextCables)
    const vd = recomputeVd(liveSupplies, nextCables)
    setLiveRuns(liveRuns.map((r) => {
      if (r.supply_id !== supplyId) return r
      const v = vd.get(supplyId)
      const headCables = r.cables.map((c) => {
        const patch: Partial<EnrichedCable> = {}
        if (field === 'size_mm2') patch.size_mm2 = Number(next)
        else if (field === 'cores') patch.cores = next as EnrichedCable['cores']
        else if (field === 'conductor') patch.conductor = next as EnrichedCable['conductor']
        else if (field === 'insulation') patch.insulation = next as EnrichedCable['insulation']
        else if (field === 'installation_method') patch.installation_method = next as string | null
        else if (field === 'depth_mm') patch.depth_mm = next == null ? null : Number(next)
        else if (field === 'grouped_with') patch.grouped_with = Number(next)
        else if (field === 'measured_length_m') {
          patch.measured_length_m = next == null ? null : Number(next)
          // Mirror the strand-level status auto-flip from updateCableAction so
          // the optimistic state matches what the server will return.
          if (next != null && c.length_status === 'UNMEASURED') patch.length_status = 'MEASURED'
          else if (next == null && c.length_status === 'MEASURED') patch.length_status = 'UNMEASURED'
        }
        return { ...c, ...patch }
      })
      const headPatch: Partial<EnrichedRun> = {}
      if (field === 'size_mm2') headPatch.size_mm2 = Number(next)
      else if (field === 'cores') headPatch.cores = next as EnrichedRun['cores']
      else if (field === 'conductor') headPatch.conductor = next as EnrichedRun['conductor']
      else if (field === 'insulation') headPatch.insulation = next as EnrichedRun['insulation']
      else if (field === 'installation_method') headPatch.installation_method = next as string | null
      else if (field === 'depth_mm') headPatch.depth_mm = next == null ? null : Number(next)
      else if (field === 'grouped_with') headPatch.grouped_with = Number(next)
      else if (field === 'measured_length_m') {
        headPatch.active_length_m = next == null ? null : Number(next)
        // Recompute run-level worst status from the (now-patched) strands.
        const ranks = { CONFIRMED: 0, MEASURED: 1, DISCREPANCY: 2, UNMEASURED: 3 }
        let worst: EnrichedCable['length_status'] = headCables[0].length_status
        for (const c of headCables) {
          if (ranks[c.length_status] > ranks[worst]) worst = c.length_status
        }
        headPatch.length_status = worst
      }
      return {
        ...r,
        ...headPatch,
        cables: headCables,
        vd_pct: v?.vd ?? r.vd_pct,
        cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct,
        // Fan-out clears any prior divergence on this field.
        mixed_properties: { fields: r.mixed_properties.fields.filter((f) => f !== field) },
      }
    }))

    const patch: Parameters<typeof updateRunCableFieldsAction>[0]['patch'] = {}
    if (field === 'size_mm2') patch.sizeMm2 = Number(next)
    else if (field === 'cores') patch.cores = next as '3' | '3+E' | '4'
    else if (field === 'conductor') patch.conductor = next as 'CU' | 'AL'
    else if (field === 'insulation') patch.insulation = next as 'PVC' | 'XLPE' | 'PILC'
    else if (field === 'installation_method') patch.installationMethod = next as string | null
    else if (field === 'depth_mm') patch.depthMm = next == null ? null : Number(next)
    else if (field === 'grouped_with') patch.groupedWith = Number(next)
    else if (field === 'measured_length_m') patch.measuredLengthM = next == null ? null : Number(next)

    const res = await updateRunCableFieldsAction({ supplyId, patch })
    setSavingShared(null)
    if (res.error) {
      setLiveRuns(prevRuns); setLiveCables(prevCables)
      setSharedError({ supplyId, message: res.error })
      return { error: res.error }
    }
    if (res.errors && res.errors.length > 0) {
      // Partial success — keep optimistic state but surface the per-strand failures.
      setSharedError({ supplyId, message: `${res.errors.length} strand(s) failed: ${res.errors[0].error}` })
    }
    return {}
  }

  // ── Per-strand field (measured length, ohm override, tag, notes) ────
  type StrandField =
    | 'measured_length_m' | 'ohm_per_km_override' | 'notes' | 'ambient_temp_c'

  async function saveStrandField(
    cableId: string, supplyId: string, field: StrandField, next: string | number | null,
  ): Promise<{ error?: string }> {
    const prevRuns = liveRuns
    const prevCables = liveCables

    const cableKey: Record<string, unknown> = {}
    switch (field) {
      case 'measured_length_m':
        cableKey.measured_length_m = next == null ? null : Number(next)
        break
      case 'ohm_per_km_override':
        cableKey.ohm_per_km = next == null ? null : Number(next)
        break
      case 'notes':
        break
      case 'ambient_temp_c':
        cableKey.ambient_temp_c = Number(next)
        break
    }
    const nextCables = liveCables.map((c) => c.id === cableId ? { ...c, ...cableKey } as CableForCalc : c)
    setLiveCables(nextCables)
    const vd = recomputeVd(liveSupplies, nextCables)
    setLiveRuns(liveRuns.map((r) => {
      if (r.supply_id !== supplyId) return r
      const v = vd.get(supplyId)
      const nextStrands = r.cables.map((c) => {
        if (c.id !== cableId) return c
        const patch: Partial<EnrichedCable> = {}
        if (field === 'measured_length_m') patch.measured_length_m = next == null ? null : Number(next)
        else if (field === 'ohm_per_km_override') {
          patch.ohm_per_km = next == null ? null : Number(next)
          patch.manual_override = next != null
        }
        else if (field === 'notes') patch.notes = next as string | null
        else if (field === 'ambient_temp_c') patch.ambient_temp_c = Number(next)
        return { ...c, ...patch }
      })
      return { ...r, cables: nextStrands, vd_pct: v?.vd ?? r.vd_pct, cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct }
    }))

    const res = await updateCableAction({
      cableId,
      measuredLengthM: field === 'measured_length_m' ? (next == null ? null : Number(next)) : undefined,
      ohmPerKmOverride: field === 'ohm_per_km_override' ? (next == null ? null : Number(next)) : undefined,
      notes: field === 'notes' ? (next as string | null) : undefined,
      ambientTempC: field === 'ambient_temp_c' ? Number(next) : undefined,
    })
    if (res.error) { setLiveRuns(prevRuns); setLiveCables(prevCables); return { error: res.error } }
    return {}
  }

  // ── Normalise a run's divergent properties to head cable ────────────
  async function normaliseRun(supplyId: string): Promise<void> {
    const prevRuns = liveRuns
    setSavingShared(supplyId)
    setSharedError(null)
    const res = await normaliseRunPropertiesAction(supplyId)
    setSavingShared(null)
    if (res.error) {
      setLiveRuns(prevRuns)
      setSharedError({ supplyId, message: res.error })
      return
    }
    // Optimistically clear the mixed flag — fresh server snapshot will arrive
    // via revalidatePath in the page route.
    setLiveRuns(liveRuns.map((r) => r.supply_id === supplyId
      ? { ...r, mixed_properties: { fields: [] } }
      : r))
  }

  async function confirmDeleteCable(): Promise<void> {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    const prevRuns = liveRuns
    const prevCables = liveCables
    const nextCables = liveCables.filter((c) => c.id !== target.id)
    setLiveCables(nextCables)
    const vd = recomputeVd(liveSupplies, nextCables)
    setLiveRuns(liveRuns
      .map((r) => {
        if (r.supply_id !== target.supply_id) return r
        const remaining = r.cables.filter((c) => c.id !== target.id)
        if (remaining.length === 0) return null
        const v = vd.get(r.supply_id)
        return {
          ...r,
          cables: remaining,
          parallel_count: remaining.length,
          vd_pct: v?.vd ?? r.vd_pct,
          cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct,
        }
      })
      .filter((r): r is EnrichedRun => r != null))
    const res = await deleteCableAction(target.id)
    if (res.error) {
      setLiveRuns(prevRuns)
      setLiveCables(prevCables)
      alert(`Could not delete: ${res.error}`)
    }
  }

  async function confirmDeleteRun(): Promise<void> {
    if (!pendingDeleteRun) return
    const target = pendingDeleteRun
    setPendingDeleteRun(null)
    const prevRuns = liveRuns
    const prevCables = liveCables
    const cableIds = new Set(target.cables.map((c) => c.id))
    setLiveCables(liveCables.filter((c) => !cableIds.has(c.id)))
    setLiveRuns(liveRuns.filter((r) => r.supply_id !== target.supply_id))
    const res = await deleteSupplyAction(target.supply_id)
    if (res.error) {
      setLiveRuns(prevRuns)
      setLiveCables(prevCables)
      alert(`Could not delete: ${res.error}`)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return liveRuns
    return liveRuns.filter((r) =>
      r.from_label.toLowerCase().includes(q) ||
      r.to_label.toLowerCase().includes(q) ||
      runLabel(r).toLowerCase().includes(q) ||
      r.cables.some((c) => (c.notes ?? '').toLowerCase().includes(q) || strandTag(c).toLowerCase().includes(q)))
  }, [liveRuns, query])

  function toggleExpand(supplyId: string): void {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(supplyId)) next.delete(supplyId)
      else next.add(supplyId)
      return next
    })
  }

  // C11 — selection helpers.
  function toggleCableSelection(cableId: string): void {
    setSelectedCableIds((cur) => {
      const next = new Set(cur)
      if (next.has(cableId)) next.delete(cableId)
      else next.add(cableId)
      return next
    })
  }

  function clearSelection(): void {
    setSelectedCableIds(new Set())
    setBulkError(null)
  }

  async function bulkSetStatus(newStatus: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED'): Promise<void> {
    if (selectedCableIds.size === 0 || bulkSaving) return
    setBulkSaving(true)
    setBulkError(null)
    const ids = Array.from(selectedCableIds)
    const res = await bulkUpdateCableLengthStatusAction({
      revisionId,
      cableIds: ids,
      newStatus,
    })
    setBulkSaving(false)
    if (!res.ok) {
      setBulkError(res.error)
      return
    }
    clearSelection()
    router.refresh()
  }

  const totalStrands = useMemo(() => liveRuns.reduce((acc, r) => acc + r.parallel_count, 0), [liveRuns])

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
          {filtered.length} of {liveRuns.length} runs · {totalStrands} cables
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
            padding: '4px 8px', borderRadius: 4,
            color: lengthMode === 'design' ? 'var(--c-amber)'
                 : lengthMode === 'worst'  ? 'var(--c-red)'
                 : 'var(--c-text-mid)',
            background: lengthMode === 'design' ? 'var(--c-amber-dim)'
                      : lengthMode === 'worst'  ? 'var(--c-red-dim)'
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
        {canEdit && !locked && (
          <button
            type="button"
            className="btn-primary-amber"
            onClick={() => setDrawer({ mode: 'add-run', revisionId, nodeOptions })}
            title="Add a new run (supply + first cable strand)"
            style={{ marginLeft: 'auto' }}
          >
            + Add run
          </button>
        )}
      </div>

      <TableScrollX className="data-panel">
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
              <Th w={24} align="center" />{/* expand chevron */}
              <Th w={110} align="center">Run</Th>
              <Th w={32} align="center">Δ</Th>
              <Th w={120}>From</Th>
              <Th w={120}>To</Th>
              <Th w={70} align="right">V</Th>
              <Th w={80} align="right">Load (A)</Th>
              <Th w={90} align="right">Load / cable</Th>
              <Th w={70} align="right">mm²</Th>
              <Th w={55} align="center">Cores</Th>
              <Th w={55} align="center">Cond</Th>
              <Th w={55} align="center">Insul</Th>
              <Th w={80} align="right">Ω/km</Th>
              <Th w={70} align="center">Parallel</Th>
              <Th w={85}>Length (m)</Th>
              <Th w={100}>Length status</Th>
              <Th w={80} align="right">VD %</Th>
              <Th w={85} align="right">Σ VD %</Th>
              <Th w={95} align="right">Rating (A)</Th>
              <Th w={75} align="right">Util %</Th>
              <Th w={100}>Install</Th>
              <Th w={70} align="right">Depth</Th>
              <Th w={55} align="right">Grp</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run, runIdx) => {
              const cloud = cloudForRun(run, rowById)
              const util = utilisationPctForRun(run)
              const vdTone = run.vd_pct > 5 ? 'var(--c-red)' : run.vd_pct > 3 ? 'var(--c-amber)' : 'var(--c-text)'
              const cumTone = run.cumulative_vd_pct > 5 ? 'var(--c-red)' : run.cumulative_vd_pct > 3 ? 'var(--c-amber)' : 'var(--c-text)'
              const utilTone = util == null ? 'var(--c-text-dim)' : util > 80 ? 'var(--c-red)' : util > 65 ? 'var(--c-amber)' : 'var(--c-text)'
              const len = activeLengthForRun(run, lengthMode)
              const isExpandable = run.parallel_count > 1 || run.mixed_properties.fields.length > 0
              const isExpanded = expanded.has(run.supply_id)
              const head = run.cables[0]
              const headRow = rowById.get(head.id)
              const isMixed = (f: SharedField): boolean => run.mixed_properties.fields.includes(f as never)
              const isSaving = savingShared === run.supply_id

              const mixedBadge = (field: SharedField, current: React.ReactNode): React.ReactNode => isMixed(field)
                ? <span className="badge badge-warning" title={`Parallel cables disagree on ${field} — Expand to view; Normalise to fix.`}>⚠ Mixed</span>
                : current

              // Group headers. page.tsx orders runs FROM-board → section →
              // conductor → to, so same-board runs are contiguous here: emit a
              // board header on each from-board change, and a section·conductor
              // sub-header on each change within a board. Co-locates everything
              // a board feeds. Display-only — exports keep their own order.
              const prevRun = runIdx > 0 ? filtered[runIdx - 1] : null
              const newBoard = !prevRun || prevRun.from_label !== run.from_label
              const newSubgroup = !prevRun
                || prevRun.from_label !== run.from_label
                || prevRun.section !== run.section
                || prevRun.conductor !== run.conductor
              const groupHeaderRows: React.ReactNode[] = []
              if (newBoard) {
                groupHeaderRows.push(
                  <tr key={`board-${run.from_label}`}>
                    <td colSpan={TOTAL_COLS} style={{
                      background: 'var(--c-base)',
                      borderTop: '2px solid var(--c-amber-mid)',
                      padding: '8px 14px', fontWeight: 700, fontSize: 12,
                      letterSpacing: '0.04em', color: 'var(--c-text)',
                    }}>
                      {run.from_label}
                    </td>
                  </tr>,
                )
              }
              if (newSubgroup) {
                groupHeaderRows.push(
                  <tr key={`sub-${run.from_label}-${run.section ?? 'none'}-${run.conductor}`}>
                    <td colSpan={TOTAL_COLS} style={{
                      background: 'var(--c-panel)',
                      borderTop: '1px solid var(--c-border)',
                      padding: '3px 14px 3px 28px', fontSize: 10,
                      letterSpacing: '0.06em', color: 'var(--c-text-dim)',
                    }}>
                      {run.section ?? '—'} · {run.conductor}
                    </td>
                  </tr>,
                )
              }

              return [
                ...groupHeaderRows,
                <tr key={`run-${run.supply_id}`} style={{
                  borderTop: '1px solid var(--c-border)',
                  background: run.parallel_count > 1 ? 'var(--c-amber-dim)' : undefined,
                }}>
                  <Td align="center" style={{ padding: 0 }}>
                    {isExpandable ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(run.supply_id)}
                        aria-label={isExpanded ? 'Collapse strands' : 'Expand strands'}
                        title={isExpanded ? 'Hide individual strands' : 'Show individual parallel strands'}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--c-text-mid)', fontSize: 12, padding: '2px 6px',
                        }}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    ) : canEdit && !locked && (
                      // Single-strand run = the run IS the cable. Surface
                      // checkbox here so C11 selection works without forcing
                      // a non-existent expand.
                      <input
                        type="checkbox"
                        checked={selectedCableIds.has(head.id)}
                        onChange={() => toggleCableSelection(head.id)}
                        aria-label={`Select cable ${runLabel(run)} for bulk status update`}
                        title="Select for bulk length-status update"
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                  </Td>
                  <Td align="center" style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--c-text-dim)', fontSize: 10 }}>{runIdx + 1}</span>
                      {run.cables.some((c) => c.manual_override) && (
                        <span title="At least one strand has a manual Ω/km override" style={{ color: 'var(--c-amber)', fontSize: 10 }}>⚑</span>
                      )}
                      {canEdit && !locked && (
                        <button
                          type="button"
                          onClick={() => setDrawer({ mode: 'edit-run', supplyId: run.supply_id, run })}
                          aria-label={`Edit run ${run.from_label} to ${run.to_label}`}
                          title="Edit run (shared cable properties + supply fields)"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12, padding: '0 2px' }}
                        >
                          ✏
                        </button>
                      )}
                      {canEdit && !locked && (
                        <button
                          type="button"
                          onClick={() => setDrawer({
                            mode: 'add-run',
                            revisionId,
                            nodeOptions,
                            defaults: {
                              size_mm2: run.size_mm2,
                              cores: run.cores,
                              conductor: run.conductor,
                              insulation: run.insulation,
                              installation_method: run.installation_method ?? undefined,
                              depth_mm: run.depth_mm ?? undefined,
                              voltage_v: run.voltage_v,
                              design_load_a: run.load_a,
                              section: run.section ?? null,
                            },
                          })}
                          aria-label={`Duplicate run ${run.from_label} to ${run.to_label}`}
                          title="Create a new run with these cable properties (you'll set the new FROM/TO)"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12, padding: '0 2px' }}
                        >
                          📋
                        </button>
                      )}
                      {canEdit && !locked && (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteRun(run)}
                          aria-label={`Delete run ${run.from_label} to ${run.to_label}`}
                          title="Delete this run and all its strands"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 12, padding: '0 2px' }}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  </Td>
                  <Td align="center" style={{ padding: '4px 6px' }}>
                    {cloud.kind && (
                      <span
                        title={cloud.kind === 'added' ? `New in ${cloud.letter} vs last issued` : `Changed in ${cloud.letter} vs last issued`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 4px',
                          borderRadius: 8, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                          color: cloud.kind === 'added' ? 'var(--c-green)' : 'var(--c-amber)',
                          background: cloud.kind === 'added' ? 'var(--c-green-dim)' : 'var(--c-amber-dim)',
                          border: `1px solid ${cloud.kind === 'added' ? 'var(--c-green)' : 'var(--c-amber-mid)'}`,
                        }}
                      >
                        ☁{cloud.letter}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {canEdit && !locked && headRow ? (
                      <button type="button" style={editCellBtn} onClick={() => setRepointing({ supplyId: run.supply_id, from: run.from_label, to: run.to_label, end: 'from', current: headRow.from_node_id })}>
                        {run.from_label}
                      </button>
                    ) : run.from_label}
                  </Td>
                  <Td>
                    {canEdit && !locked && headRow ? (
                      <button type="button" style={editCellBtn} onClick={() => setRepointing({ supplyId: run.supply_id, from: run.from_label, to: run.to_label, end: 'to', current: headRow.to_node_id })}>
                        {run.to_label}
                      </button>
                    ) : run.to_label}
                  </Td>
                  <Td align="right">
                    <EditableCell type="select" align="right" disabled={locked || !canEdit || isSaving}
                      value={run.voltage_v} options={VOLTAGE_OPTIONS}
                      format={(v) => v == null ? '—' : `${v}`}
                      onSave={(n) => saveSupplyField(run.supply_id, 'voltage_v', n)} />
                  </Td>
                  <Td align="right">
                    <EditableCell type="number" align="right" disabled={locked || !canEdit || isSaving}
                      value={run.load_a} format={(v) => fmt(typeof v === 'number' ? v : null)}
                      onSave={(n) => saveSupplyField(run.supply_id, 'design_load_a', n)} />
                  </Td>
                  <Td align="right">
                    {run.load_a == null ? '—' : fmt(run.load_a / Math.max(1, run.parallel_count), 0)}
                  </Td>
                  <Td align="right">
                    {mixedBadge('size_mm2',
                      <EditableCell type="select" align="right" disabled={locked || !canEdit || isSaving}
                        value={run.size_mm2} options={SIZE_OPTIONS}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'size_mm2', n)} />)}
                  </Td>
                  <Td align="center">
                    {mixedBadge('cores',
                      <EditableCell type="select" align="center" disabled={locked || !canEdit || isSaving}
                        value={run.cores} options={CORES_OPTIONS}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'cores', n)} />)}
                  </Td>
                  <Td align="center">
                    {mixedBadge('conductor',
                      <EditableCell type="select" align="center" disabled={locked || !canEdit || isSaving}
                        value={run.conductor} options={CONDUCTOR_OPTIONS}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'conductor', n)} />)}
                  </Td>
                  <Td align="center">
                    {mixedBadge('insulation',
                      <EditableCell type="select" align="center" disabled={locked || !canEdit || isSaving}
                        value={run.insulation} options={INSULATION_OPTIONS}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'insulation', n)} />)}
                  </Td>
                  <Td align="right">
                    <span title={run.parallel_count > 1 ? 'Run-level Ω/km from head strand; expand to edit per-strand overrides.' : undefined}>
                      {fmt(run.ohm_per_km, 4)}
                    </span>
                  </Td>
                  <Td align="center" style={{ fontWeight: run.parallel_count > 1 ? 700 : 400 }}>
                    {run.parallel_count > 1 ? `×${run.parallel_count}` : '×1'}
                  </Td>
                  <Td>
                    {(() => {
                      // Per-strand length distribution surfaces in the cell's
                      // tooltip so a PM about to overwrite a divergent run
                      // sees what they're about to flatten. Cell pre-fills
                      // with the run's worst (longest) length — matches the
                      // displayed value in collapsed rows.
                      const strandLens = run.cables.map((c) => c.measured_length_m)
                      const distinct = new Set(strandLens.map((l) => l == null ? '∅' : String(l)))
                      const strandsDiffer = distinct.size > 1
                      const tip = strandsDiffer
                        ? `Strands differ: ${strandLens.map((l) => l == null ? '—' : `${l}m`).join(' / ')}. Click to overwrite all; expand to edit each.`
                        : run.parallel_count > 1
                          ? `Same on all ${run.parallel_count} strands. Click to overwrite all; expand to edit each.`
                          : 'Click to edit'
                      return (
                        <span title={tip} style={strandsDiffer ? { color: 'var(--c-amber)' } : undefined}>
                          <EditableCell
                            type="number"
                            disabled={locked || !canEdit || isSaving}
                            value={len}
                            format={(v) => fmt(typeof v === 'number' ? v : null, 1)}
                            onSave={(n) => saveRunSharedField(run.supply_id, 'measured_length_m', n)}
                          />
                        </span>
                      )
                    })()}
                  </Td>
                  <Td>
                    <span className={`badge ${LENGTH_STATUS_TONE[run.length_status]}`}>
                      {run.length_status}
                    </span>
                  </Td>
                  <Td align="right" style={{ color: vdTone, fontWeight: run.vd_pct > 3 ? 700 : 400 }}>
                    {run.vd_pct > 0 ? fmt(run.vd_pct, 2) : '—'}
                  </Td>
                  <Td align="right" style={{ color: cumTone, fontWeight: run.cumulative_vd_pct > 3 ? 700 : 400 }}>
                    {run.cumulative_vd_pct > 0 ? fmt(run.cumulative_vd_pct, 2) : '—'}
                  </Td>
                  <Td align="right" style={{ color: run.under_rated ? 'var(--c-red)' : 'var(--c-text)' }}>
                    {(() => {
                      const breadcrumb = sansBreadcrumb(run)
                      const tipBody = sansBreadcrumbAsTooltip(breadcrumb)
                      const capacityTip = run.combined_capacity_a == null
                        ? tipBody
                        : `Combined capacity: ${Math.round(run.combined_capacity_a)} A (sum of ${run.parallel_count} strands)\n\n${tipBody}`
                      return (
                        <>
                          <span title={capacityTip}>{fmt(run.combined_capacity_a, 0)}</span>
                          {breadcrumb.ratingTableCode && (
                            <span
                              title={tipBody}
                              style={{ marginLeft: 6, color: 'var(--c-text-dim)', fontSize: 10, cursor: 'help', borderBottom: '1px dotted var(--c-text-dim)' }}
                            >
                              {breadcrumb.ratingTableCode.replace(/^TABLE_/, 'T').replace(/_/g, '.')}
                            </span>
                          )}
                          {!breadcrumb.ratingTableCode && (
                            <span
                              title={tipBody}
                              style={{ marginLeft: 6, color: 'var(--c-amber)', fontSize: 10, cursor: 'help' }}
                            >
                              ⚠ no SANS
                            </span>
                          )}
                          {run.under_rated && (
                            <span
                              title={`Run under-rated: ${Math.round(run.combined_capacity_a ?? 0)} A combined capacity < ${run.load_a ?? '?'} A design load`}
                              style={{ marginLeft: 6, color: 'var(--c-red)', fontWeight: 700, cursor: 'help' }}
                            >
                              ⚠
                            </span>
                          )}
                        </>
                      )
                    })()}
                  </Td>
                  <Td align="right" style={{ color: utilTone, fontWeight: util != null && util > 65 ? 700 : 400 }}>
                    {util == null ? '—' : fmt(util, 1)}
                  </Td>
                  <Td>
                    {mixedBadge('installation_method',
                      <EditableCell type="select" disabled={locked || !canEdit || isSaving}
                        value={run.installation_method} options={INSTALL_OPTIONS}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'installation_method', n)} />)}
                  </Td>
                  <Td align="right">
                    {mixedBadge('depth_mm',
                      <EditableCell type="number" align="right" disabled={locked || !canEdit || isSaving}
                        value={run.depth_mm}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'depth_mm', n)} />)}
                  </Td>
                  <Td align="right">
                    {mixedBadge('grouped_with',
                      <EditableCell type="number" align="right" disabled={locked || !canEdit || isSaving}
                        value={run.grouped_with}
                        onSave={(n) => saveRunSharedField(run.supply_id, 'grouped_with', n)} />)}
                  </Td>
                  <Td style={{ fontFamily: 'inherit', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <EditableCell type="text" disabled={locked || !canEdit}
                      value={head.notes} placeholder=""
                      onSave={(n) => saveStrandField(head.id, run.supply_id, 'notes', n)} />
                  </Td>
                </tr>,
                // ── Mixed-properties banner row (only when divergent) ─────
                ...(run.mixed_properties.fields.length > 0 && canEdit && !locked ? [(
                  <tr key={`mixed-${run.supply_id}`}>
                    <td colSpan={TOTAL_COLS} style={{ background: 'var(--c-amber-dim)', padding: '6px 14px', borderTop: '1px solid var(--c-border)' }}>
                      <span style={{ fontSize: 11, color: 'var(--c-text)' }}>
                        ⚠ Parallel strands disagree on: <strong>{run.mixed_properties.fields.join(', ')}</strong>.
                      </span>
                      <button
                        type="button"
                        onClick={() => normaliseRun(run.supply_id)}
                        disabled={isSaving}
                        className="btn-primary-amber"
                        style={{ marginLeft: 10, padding: '2px 10px', fontSize: 11 }}
                      >
                        {isSaving ? 'Normalising…' : 'Normalise to strand 1'}
                      </button>
                    </td>
                  </tr>
                )] : []),
                // ── Shared-edit error banner (only on partial failure) ────
                ...(sharedError?.supplyId === run.supply_id ? [(
                  <tr key={`error-${run.supply_id}`}>
                    <td colSpan={TOTAL_COLS} role="alert" style={{ background: 'var(--c-red-dim)', padding: '6px 14px', borderTop: '1px solid var(--c-red)', color: 'var(--c-red)', fontSize: 11 }}>
                      {sharedError.message}
                    </td>
                  </tr>
                )] : []),
                // ── Expanded strand sub-rows ──────────────────────────────
                ...(isExpanded ? run.cables.flatMap((c) => {
                  const delta = deltaForCable(c)
                  const deltaFlag = delta && c.measured_length_m
                    && (Math.abs(delta.abs) > 5 || Math.abs(delta.pct) > 10)
                  const sLen = activeLengthForCable(c, lengthMode)
                  return [(
                    <tr key={`strand-${c.id}`} style={{ background: 'var(--c-base)', fontSize: 11 }}>
                      <Td align="center" style={{ color: 'var(--c-text-dim)', padding: 0 }}>
                        {canEdit && !locked ? (
                          <input
                            type="checkbox"
                            checked={selectedCableIds.has(c.id)}
                            onChange={() => toggleCableSelection(c.id)}
                            aria-label={`Select strand #${c.cable_no} for bulk status update`}
                            title="Select for bulk length-status update"
                            style={{ cursor: 'pointer' }}
                          />
                        ) : '↳'}
                      </Td>
                      <Td align="center" style={{ color: 'var(--c-text-dim)' }}>#{c.cable_no}</Td>
                      <Td />
                      <Td colSpan={2} style={{ color: 'var(--c-text-dim)', fontStyle: 'italic', fontSize: 10 }}>
                        (strand of run above)
                      </Td>
                      <Td colSpan={5} />
                      <Td align="right">
                        <EditableCell type="number" align="right" disabled={locked || !canEdit}
                          value={c.ohm_per_km}
                          format={(v) => fmt(typeof v === 'number' ? v : null, 4)}
                          placeholder="(auto)"
                          onSave={(n) => saveStrandField(c.id, run.supply_id, 'ohm_per_km_override', n)} />
                      </Td>
                      <Td align="center" style={{ color: 'var(--c-text-dim)' }}>—</Td>
                      <Td>
                        <EditableCell type="number" align="left" disabled={locked || !canEdit}
                          value={c.measured_length_m}
                          format={(v) => fmt(typeof v === 'number' ? v : null, 1)}
                          onSave={(n) => saveStrandField(c.id, run.supply_id, 'measured_length_m', n)} />
                        {' / '}
                        {locked ? (
                          fmt(c.confirmed_length_m, 1)
                        ) : (
                          <button type="button" onClick={() => setEditConfirmed(c)} title="Confirm length (Site / Verifier)" style={editCellBtn}>
                            {fmt(c.confirmed_length_m, 1)}
                          </button>
                        )}
                        {delta != null && (
                          <span style={{ marginLeft: 6, color: deltaFlag ? 'var(--c-red)' : 'var(--c-text-dim)' }}>
                            Δ{delta.abs > 0 ? '+' : ''}{fmt(delta.abs, 1)}
                          </span>
                        )}
                        {sLen != null && (
                          <span style={{ marginLeft: 6, color: 'var(--c-text-dim)' }} title={`Active (${lengthMode})`}>
                            ({fmt(sLen, 1)})
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className={`badge ${LENGTH_STATUS_TONE[c.length_status]}`}>{c.length_status}</span>
                      </Td>
                      <Td colSpan={2} />
                      <Td align="right">
                        <span title={sansBreadcrumbAsTooltip(sansBreadcrumb({
                          size_mm2: c.size_mm2,
                          cores: c.cores,
                          conductor: c.conductor,
                          insulation: c.insulation,
                          ambient_temp_c: c.ambient_temp_c,
                          depth_mm: c.depth_mm,
                          grouped_with: c.grouped_with,
                          derated_current_rating_a: c.derated_current_rating_a,
                          derate_depth:    (c as EnrichedCable & { derate_depth?: number | null }).derate_depth ?? null,
                          derate_thermal:  (c as EnrichedCable & { derate_thermal?: number | null }).derate_thermal ?? null,
                          derate_grouping: (c as EnrichedCable & { derate_grouping?: number | null }).derate_grouping ?? null,
                          derate_temp:     (c as EnrichedCable & { derate_temp?: number | null }).derate_temp ?? null,
                        }))}>
                          {fmt(c.derated_current_rating_a, 0)}
                        </span>
                      </Td>
                      <Td colSpan={4} />
                      <Td>
                        {canEdit && !locked && (
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              title={`Edit strand #${c.cable_no} — per-strand fields (measured length, Ω override, tag, notes)`}
                              onClick={() => setDrawer({ mode: 'edit-strand', cableId: c.id, strand: c, supplyId: run.supply_id, runLabel: `${run.from_label}–${run.to_label}` })}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-amber)', fontSize: 11 }}
                            >
                              ✏ edit
                            </button>
                            <button
                              type="button"
                              title={`Delete strand #${c.cable_no} — last strand deletes the run`}
                              onClick={() => setPendingDelete(c)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-red)', fontSize: 11 }}
                            >
                              ✕ delete
                            </button>
                          </span>
                        )}
                      </Td>
                    </tr>
                  ),
                  ]
                }) : []),
                // ── "+ Add strand" tail row, only when run is expanded ───
                ...(isExpanded && canEdit && !locked ? [(
                  <tr key={`add-strand-${run.supply_id}`} style={{ background: 'var(--c-base)' }}>
                    <td colSpan={TOTAL_COLS} style={{ padding: '6px 14px', borderTop: '1px dashed var(--c-border)' }}>
                      <button
                        type="button"
                        onClick={() => setDrawer({ mode: 'add-strand', supplyId: run.supply_id, run })}
                        title={`Append a new strand to this run (defaults inherited from strand 1)`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-amber)', fontSize: 11, fontFamily: 'inherit' }}
                      >
                        + Add strand to run ({run.parallel_count + 1} of N)
                      </button>
                    </td>
                  </tr>
                )] : []),
              ]
            })}
          </tbody>
        </table>
      </TableScrollX>

      {/* Single centered modal — covers all four modes plus duplicate. */}
      {drawer && (
        <CableFormModal
          state={drawer}
          onClose={() => setDrawer(null)}
          onSaved={() => router.refresh()}
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
      {pendingDelete && (
        <ConfirmDialog
          title="Delete strand"
          body={`Delete strand #${pendingDelete.cable_no} (${pendingDelete.from_label} → ${pendingDelete.to_label})? This also removes its terminations and tags. If it is the last strand on this run, the run is removed too.`}
          confirmLabel="Delete"
          onConfirm={confirmDeleteCable}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {pendingDeleteRun && (
        <ConfirmDialog
          title="Delete run"
          body={`Delete run ${pendingDeleteRun.from_label} → ${pendingDeleteRun.to_label}${pendingDeleteRun.parallel_count > 1 ? ` and all ${pendingDeleteRun.parallel_count} parallel strands` : ''}? This removes the supply and its cables, terminations and tags. This cannot be undone.`}
          confirmLabel="Delete run"
          onConfirm={confirmDeleteRun}
          onCancel={() => setPendingDeleteRun(null)}
        />
      )}
      {repointing && (
        <RepointPicker
          end={repointing.end}
          current={repointing.current}
          nodeOptions={repointing.end === 'from' ? nodeOptions : nodeOptions.filter((n) => n.kind === 'board')}
          onCancel={() => setRepointing(null)}
          onPick={async (nodeId, kind) => {
            const { supplyId, end } = repointing
            const res = await repointSupplyAction({
              supplyId,
              // A 'board'-kind NodeOption is a structure.nodes row → from_node_id;
              // a 'source'-kind one is a cable_schedule.sources row → from_source_id.
              ...(end === 'from'
                ? { fromSourceId: kind === 'source' ? nodeId : null, fromNodeId: kind === 'board' ? nodeId : null }
                : { toNodeId: nodeId }),
            })
            if (!res.error) setRepointing(null)
            return res
          }}
        />
      )}

      {/* C11 — sticky bulk-action bar. Appears when any strand is selected. */}
      {selectedCableIds.size > 0 && (
        <div
          role="region"
          aria-label="Bulk strand actions"
          style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--c-panel)', border: '1px solid var(--c-amber)',
            borderRadius: 6, padding: '10px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', gap: 12, zIndex: 100,
            fontFamily: 'var(--font-mono)', fontSize: 12, flexWrap: 'wrap', maxWidth: '92vw',
          }}
        >
          <span style={{ color: 'var(--c-amber)', fontWeight: 700 }}>
            {selectedCableIds.size} selected
          </span>
          <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>Mark as:</span>
          <button
            type="button"
            onClick={() => bulkSetStatus('MEASURED')}
            disabled={bulkSaving}
            className="btn-primary-amber"
            style={{ padding: '4px 12px', fontSize: 11, opacity: bulkSaving ? 0.5 : 1 }}
          >
            MEASURED
          </button>
          <button
            type="button"
            onClick={() => bulkSetStatus('CONFIRMED')}
            disabled={bulkSaving}
            style={{
              background: 'var(--c-base)', border: '1px solid var(--c-border)',
              color: 'var(--c-text)', borderRadius: 4, padding: '4px 12px',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: bulkSaving ? 'wait' : 'pointer',
              opacity: bulkSaving ? 0.5 : 1,
            }}
          >
            CONFIRMED
          </button>
          <button
            type="button"
            onClick={() => bulkSetStatus('UNMEASURED')}
            disabled={bulkSaving}
            style={{
              background: 'var(--c-base)', border: '1px solid var(--c-border)',
              color: 'var(--c-text-dim)', borderRadius: 4, padding: '4px 12px',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: bulkSaving ? 'wait' : 'pointer',
              opacity: bulkSaving ? 0.5 : 1,
            }}
          >
            UNMEASURED
          </button>
          <span style={{ color: 'var(--c-text-dim)' }}>|</span>
          <button
            type="button"
            onClick={clearSelection}
            disabled={bulkSaving}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--c-text-mid)', padding: '4px 8px',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Clear
          </button>
          {bulkSaving && (
            <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>Saving…</span>
          )}
          {bulkError && (
            <span role="alert" style={{ color: 'var(--c-red)', fontSize: 11 }}>
              {bulkError}
            </span>
          )}
        </div>
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
  children, align, style, colSpan,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  style?: React.CSSProperties
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
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
            style={{ background: 'var(--c-red)', borderColor: 'var(--c-red)' }}>
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
  onPick: (nodeId: string, kind: 'source' | 'board') => Promise<{ error?: string }>
}) {
  const [selectedId, setSelectedId] = useState<string>(
    nodeOptions.some((n) => n.id === current) ? current : (nodeOptions[0]?.id ?? ''),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedOption = nodeOptions.find((n) => n.id === selectedId)

  async function handlePick(): Promise<void> {
    const opt = nodeOptions.find((n) => n.id === selectedId)
    if (!opt) return
    setSaving(true); setError(null)
    const res = await onPick(opt.id, opt.kind)
    setSaving(false)
    if (res.error) setError(res.error)
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
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ fontSize: 12 }}
        >
          {nodeOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.code} {n.kind === 'source' ? '(source)' : '(board)'}
            </option>
          ))}
        </select>
        {error && (
          <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onCancel} className="btn-primary-amber" autoFocus
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
            Cancel
          </button>
          <button type="button" onClick={handlePick} className="btn-primary-amber"
            disabled={!selectedOption || saving}>
            {saving ? 'Re-routing…' : 'Re-route'}
          </button>
        </div>
      </div>
    </div>
  )
}
