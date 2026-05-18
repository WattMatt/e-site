'use client'

/**
 * CableFormDrawer — four-mode form drawer covering the explicit save/cancel
 * paths the inline EditableCell pattern can't (atomic multi-field edits,
 * cross-field validation, less-confident-user friendly, mobile-friendly).
 *
 * Modes:
 *   • add-run      — create a NEW run (supply + its first cable strand) in one
 *                    transaction. Engineer picks FROM (source or board) + TO
 *                    (board) and the shared cable properties. C9 — symmetric
 *                    with the other three modes so the engineer never leaves
 *                    the drawer pattern. Subsequent parallel strands go
 *                    through add-strand. Posts via addRunAction (thin wrapper
 *                    over addParallelCableSetAction with count=1).
 *   • add-strand   — append a new parallel strand to an existing run (supply).
 *                    Defaults inherited from the run's head strand; engineer
 *                    overrides any field; one atomic INSERT via addCableAction.
 *   • edit-strand  — change PER-STRAND fields (measured length, Ω/km override,
 *                    tag, notes, ambient temp). Shared cable properties (size,
 *                    cores etc.) live on edit-run instead — separation of
 *                    concerns. Posts via updateCableAction.
 *   • edit-run     — change SHARED cable properties + supply-level fields
 *                    (voltage, design load, section). Fans out shared cable
 *                    fields to every strand via updateRunCableFieldsAction;
 *                    supply fields go via updateSupplyAction. Two parallel
 *                    server calls.
 *
 * Validation runs on submit only (forgiving — type freely, fix red fields after
 * the first failed attempt). No live per-field validation.
 *
 * Confirmed length is INTENTIONALLY NOT handled here — it has its own modal
 * (ConfirmedLengthEditor / LengthEditPopover) for the site-verifier flow.
 */

import { useEffect, useMemo, useState } from 'react'
import type { EnrichedRun, EnrichedCable } from '@/lib/cable-schedule/export-payload'
import type { NodeOption } from './CableScheduleGrid'
import {
  addCableAction,
  addRunAction,
  updateCableAction,
  updateSupplyAction,
  updateRunCableFieldsAction,
} from '@/actions/cable-entities.actions'

type Mode = 'add-run' | 'add-strand' | 'edit-strand' | 'edit-run'

export type DrawerState =
  | { mode: 'add-run'; revisionId: string; nodeOptions: NodeOption[] }
  | { mode: 'add-strand'; supplyId: string; run: EnrichedRun }
  | { mode: 'edit-strand'; cableId: string; strand: EnrichedCable; supplyId: string; runLabel: string }
  | { mode: 'edit-run'; supplyId: string; run: EnrichedRun }

interface Props {
  state: DrawerState
  onClose: () => void
  /** Called after a successful save. Parent should revalidate / re-fetch. */
  onSaved: () => void
}

const SIZE_OPTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const VOLTAGE_OPTIONS = [230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000]
const SECTION_OPTIONS: Array<{ value: 'NORMAL' | 'EMERGENCY' | ''; label: string }> = [
  { value: '', label: '— None —' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'EMERGENCY', label: 'Emergency' },
]

/**
 * Slide-in chrome wrapper around CableFormBody. After the Flow-2 inline-drawer
 * refactor this is ONLY mounted at the page level for `mode === 'add-run'` —
 * the other three modes (add-strand / edit-strand / edit-run) render
 * `<CableFormBody />` inline as a <tr colSpan> directly in the grid.
 */
export function CableFormDrawer({ state, onClose, onSaved }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cable-form-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          width: 460, maxWidth: '95vw', height: '100%', background: 'var(--c-panel)',
          display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--c-border)',
        }}
      >
        <CableFormBody state={state} onClose={onClose} onSaved={onSaved} variant="drawer" />
      </div>
    </div>
  )
}

/**
 * Form body — the field stack + validation + submit logic, without any
 * positioning chrome. Mounted inline inside a `<td colSpan>` cell for the
 * edit-strand / edit-run / add-strand modes, and inside `<CableFormDrawer>`'s
 * slide-in shell for add-run.
 */
export function CableFormBody({ state, onClose, onSaved, variant = 'inline' }: Props & { variant?: 'inline' | 'drawer' }) {
  const mode: Mode = state.mode
  // Narrow the discriminated union to per-mode locals — TS narrows correctly
  // inside the ternaries but not across uses of the captured `mode` variable.
  const _run: EnrichedRun | null =
    state.mode === 'add-strand' || state.mode === 'edit-run' ? state.run : null
  const _strand: EnrichedCable | null = state.mode === 'edit-strand' ? state.strand : null
  const _cableId: string | null = state.mode === 'edit-strand' ? state.cableId : null
  const _runLabel: string | null = state.mode === 'edit-strand' ? state.runLabel : null
  const _supplyId: string | null =
    state.mode === 'add-run' ? null : state.supplyId
  const _revisionId: string | null = state.mode === 'add-run' ? state.revisionId : null
  const _nodeOptions: NodeOption[] = state.mode === 'add-run' ? state.nodeOptions : []
  // Re-export under their public names (the trailing `!` is safe inside the
  // mode-guarded code paths below — TS just can't infer cross-statement).
  const run = _run
  const strand = _strand
  const cableId = _cableId
  const runLabel = _runLabel
  const supplyId = _supplyId
  const revisionId = _revisionId
  const nodeOptions = _nodeOptions
  // `head` is only meaningful when we have a strand/run to inherit defaults
  // from. add-run starts from cold defaults — guard with the non-null modes.
  const head: EnrichedCable | null =
    mode === 'add-run' ? null : (strand ?? run!.cables[0])

  // ── Form state ─────────────────────────────────────────────────────
  // Shared cable fields (used by add-run + add-strand + edit-run).
  // add-run defaults — sensible for ~80% of LV jobs at WM: 4×16 mm² Cu XLPE
  // direct in ground, grouped 1. Engineer overrides as needed.
  const [sizeMm2, setSizeMm2] = useState<number>(head?.size_mm2 ?? 16)
  const [cores, setCores] = useState<EnrichedCable['cores']>(head?.cores ?? '4')
  const [conductor, setConductor] = useState<EnrichedCable['conductor']>(head?.conductor ?? 'CU')
  const [insulation, setInsulation] = useState<EnrichedCable['insulation']>(head?.insulation ?? 'XLPE')
  const [installMethod, setInstallMethod] = useState<string>(
    head?.installation_method ?? (mode === 'add-run' ? 'DIRECT_IN_GROUND' : ''),
  )
  const [depthMm, setDepthMm] = useState<string>(
    head?.depth_mm == null ? (mode === 'add-run' ? '800' : '') : String(head.depth_mm),
  )
  const [groupedWith, setGroupedWith] = useState<number>(head?.grouped_with ?? 1)

  // Per-strand fields (used by add-run + add-strand + edit-strand).
  const [measuredLengthM, setMeasuredLengthM] = useState<string>(
    head?.measured_length_m == null ? '' : String(head.measured_length_m),
  )
  const [ohmPerKmOverride, setOhmPerKmOverride] = useState<string>(
    head?.manual_override && head?.ohm_per_km != null ? String(head.ohm_per_km) : '',
  )
  const [tagOverride, setTagOverride] = useState<string>(head?.tag_override ?? '')
  const [notes, setNotes] = useState<string>(head?.notes ?? '')
  const [ambientTempC, setAmbientTempC] = useState<number>(
    mode === 'edit-strand' ? strand!.ambient_temp_c : 30,
  )

  // Supply-level fields (used by add-run + edit-run).
  const initSupply = mode === 'edit-run' ? run! : null
  const [voltageV, setVoltageV] = useState<number>(initSupply?.voltage_v ?? 400)
  const [designLoadA, setDesignLoadA] = useState<string>(
    initSupply?.load_a == null ? '' : String(initSupply.load_a),
  )
  const [section, setSection] = useState<'NORMAL' | 'EMERGENCY' | ''>(
    (initSupply?.section as 'NORMAL' | 'EMERGENCY' | null) ?? '',
  )

  // FROM / TO selectors (add-run only). FROM accepts any source or board;
  // TO is a board only (matches the supplies-table CHECK constraint).
  const fromOptions = useMemo(() => nodeOptions, [nodeOptions])
  const toOptions = useMemo(() => nodeOptions.filter((n) => n.kind === 'board'), [nodeOptions])
  const [fromNodeId, setFromNodeId] = useState<string>('')
  const [toNodeId, setToNodeId] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Esc to close — only when not mid-save (don't lose user's data to a stray Esc).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (mode !== 'edit-strand') {
      if (!sizeMm2 || sizeMm2 <= 0) errs.sizeMm2 = 'Size required'
      if (!cores) errs.cores = 'Cores required'
      if (!conductor) errs.conductor = 'Conductor required'
      if (!insulation) errs.insulation = 'Insulation required'
      if (installMethod === 'DIRECT_IN_GROUND' && (!depthMm || Number(depthMm) <= 0)) {
        errs.depthMm = 'Depth required for direct-in-ground installation'
      }
      if (groupedWith < 1) errs.groupedWith = 'Must be ≥ 1'
    }
    if (measuredLengthM !== '' && (isNaN(Number(measuredLengthM)) || Number(measuredLengthM) < 0)) {
      errs.measuredLengthM = 'Must be a non-negative number'
    }
    if (ohmPerKmOverride !== '' && (isNaN(Number(ohmPerKmOverride)) || Number(ohmPerKmOverride) <= 0)) {
      errs.ohmPerKmOverride = 'Must be positive (leave blank for SANS auto-lookup)'
    }
    if (mode === 'add-run' || mode === 'edit-run') {
      if (designLoadA === '' || isNaN(Number(designLoadA)) || Number(designLoadA) <= 0) {
        errs.designLoadA = mode === 'add-run'
          ? 'Design load required (A)'
          : 'Must be a positive number'
      }
    }
    if (mode === 'add-run') {
      if (!fromNodeId) errs.fromNodeId = 'FROM (source or board) required'
      if (!toNodeId) errs.toNodeId = 'TO (board) required'
      // installation method has no '' option for add-run — but guard anyway.
      if (!installMethod) errs.installMethod = 'Installation method required'
      // Self-loop guard — board to itself isn't a valid supply.
      if (fromNodeId && toNodeId && fromNodeId === toNodeId) {
        errs.toNodeId = 'TO must be different from FROM'
      }
    }
    return errs
  }

  async function handleSubmit() {
    setError(null)
    const errs = validate()
    setValidationErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSaving(true)
    try {
      const installVal = (installMethod || null) as
        | 'DIRECT_IN_GROUND' | 'DUCT' | 'LADDER' | 'TRAY' | 'CLIPPED' | null
      const depthVal = depthMm === '' ? null : Number(depthMm)
      const measVal = measuredLengthM === '' ? null : Number(measuredLengthM)
      const ohmVal = ohmPerKmOverride === '' ? null : Number(ohmPerKmOverride)
      const tagVal = tagOverride.trim() || null
      const notesVal = notes.trim() || null

      if (mode === 'add-run') {
        // Resolve FROM kind from the picked node so we set fromSourceId XOR
        // fromBoardId per the supplies-table CHECK constraint.
        const fromOpt = fromOptions.find((o) => o.id === fromNodeId)
        if (!fromOpt) { setError('FROM node not found'); return }
        const res = await addRunAction({
          revisionId: revisionId!,
          fromSourceId: fromOpt.kind === 'source' ? fromNodeId : null,
          fromBoardId: fromOpt.kind === 'board' ? fromNodeId : null,
          toBoardId: toNodeId,
          voltageV,
          designLoadA: Number(designLoadA),
          section: section === '' ? null : section,
          sizeMm2,
          cores,
          conductor,
          insulation,
          armour: 'SWA',
          measuredLengthM: measVal,
          installationMethod: installVal as
            | 'DIRECT_IN_GROUND' | 'DUCT' | 'LADDER' | 'TRAY' | 'CLIPPED',
          depthMm: depthVal,
          groupedWith,
          ambientTempC,
          thermalResistivityKmw: 1.0,
          ohmPerKmOverride: ohmVal,
        })
        if (res.error) { setError(res.error); return }
      } else if (mode === 'add-strand') {
        const res = await addCableAction({
          supplyId: supplyId!,
          sizeMm2,
          cores,
          conductor,
          insulation,
          armour: 'SWA',
          measuredLengthM: measVal,
          installationMethod: installVal,
          depthMm: depthVal,
          groupedWith,
          ambientTempC,
          // 1.0 K·m/W is the SANS default soil thermal resistivity used by
          // the existing addParallelCableSetAction + addEntityPanel flow.
          thermalResistivityKmw: 1.0,
          ohmPerKmOverride: ohmVal,
          notes: notesVal,
        })
        if (res.error) { setError(res.error); return }
      } else if (mode === 'edit-strand') {
        const res = await updateCableAction({
          cableId: cableId!,
          measuredLengthM: measVal,
          ohmPerKmOverride: ohmVal,
          tagOverride: tagVal,
          notes: notesVal,
          ambientTempC,
        })
        if (res.error) { setError(res.error); return }
      } else if (mode === 'edit-run') {
        // Two parallel calls — supply-level + shared-cable-fan-out.
        const sectionVal: 'NORMAL' | 'EMERGENCY' | null = section === '' ? null : section
        const designLoadVal = designLoadA === '' ? undefined : Number(designLoadA)
        const [supplyRes, fanRes] = await Promise.all([
          updateSupplyAction({
            supplyId: supplyId!,
            voltageV,
            designLoadA: designLoadVal,
            section: sectionVal,
          }),
          updateRunCableFieldsAction({
            supplyId: supplyId!,
            patch: {
              sizeMm2,
              cores,
              conductor,
              insulation,
              installationMethod: installVal,
              depthMm: depthVal,
              groupedWith,
              measuredLengthM: measVal,
            },
          }),
        ])
        if (supplyRes.error) { setError(`Supply update failed: ${supplyRes.error}`); return }
        if (fanRes.error) { setError(`Strand fan-out failed: ${fanRes.error}`); return }
        if (fanRes.errors && fanRes.errors.length > 0) {
          setError(`${fanRes.errors.length} strand(s) failed: ${fanRes.errors[0].error}`)
          return
        }
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const header = (() => {
    if (mode === 'add-run') return 'Add run (new supply + first strand)'
    if (mode === 'add-strand') return `Add strand to run ${run!.from_label} → ${run!.to_label}`
    if (mode === 'edit-strand') return `Edit strand #${strand!.cable_no} — ${runLabel}`
    return `Edit run ${run!.from_label} → ${run!.to_label} · ×${run!.parallel_count} strand${run!.parallel_count !== 1 ? 's' : ''}`
  })()

  const submitLabel = (() => {
    if (saving) return 'Saving…'
    if (mode === 'add-run') return '+ Create run'
    if (mode === 'add-strand') return 'Add strand'
    if (mode === 'edit-strand') return 'Save changes'
    return `Apply to all ${run!.parallel_count} strand${run!.parallel_count !== 1 ? 's' : ''}`
  })()

  // Field visibility flags.
  const showFromToFields = mode === 'add-run'
  const showSharedCableFields = mode === 'add-run' || mode === 'add-strand' || mode === 'edit-run'
  const showPerStrandFields = mode === 'add-run' || mode === 'add-strand' || mode === 'edit-strand'
  const showSupplyFields = mode === 'add-run' || mode === 'edit-run'

  // Inline variant gets a contained shell with its own border + bg.
  // Drawer variant's outer chrome is supplied by <CableFormDrawer>.
  const isDrawer = variant === 'drawer'
  const bodyMaxHeight = isDrawer ? undefined : '60vh'
  const containerStyle: React.CSSProperties = isDrawer
    ? { display: 'contents' }
    : {
        background: 'var(--c-panel)',
        border: '1px solid var(--c-amber-mid)',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }

  return (
    <div style={containerStyle}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 id="cable-form-title" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.3 }}>
            {header}
          </h2>
          <button type="button" onClick={onClose} disabled={saving}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-mid)', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>
            ✕
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{
          flex: isDrawer ? 1 : undefined,
          maxHeight: bodyMaxHeight,
          overflowY: 'auto',
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
          {showFromToFields && (
            <FieldGroup title="Route">
              <Row label="From (source or board)" error={validationErrors.fromNodeId}>
                <select className="ob-input" value={fromNodeId} onChange={(e) => setFromNodeId(e.target.value)} disabled={saving}>
                  <option value="">— Pick origin —</option>
                  {fromOptions.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.code} {n.kind === 'source' ? '(source)' : '(board)'}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="To (board)" error={validationErrors.toNodeId} hint={toOptions.length === 0 ? 'No boards in this revision yet — add one in Structure above.' : undefined}>
                <select className="ob-input" value={toNodeId} onChange={(e) => setToNodeId(e.target.value)} disabled={saving || toOptions.length === 0}>
                  <option value="">— Pick destination —</option>
                  {toOptions.map((n) => (
                    <option key={n.id} value={n.id}>{n.code}</option>
                  ))}
                </select>
              </Row>
            </FieldGroup>
          )}

          {showSupplyFields && (
            <FieldGroup title="Supply">
              <Row label="Voltage (V)" error={validationErrors.voltageV}>
                <select className="ob-input" value={voltageV} onChange={(e) => setVoltageV(Number(e.target.value))} disabled={saving}>
                  {VOLTAGE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Row>
              <Row label="Design load (A)" error={validationErrors.designLoadA}>
                <input className="ob-input" type="number" step="any" min={0} value={designLoadA} onChange={(e) => setDesignLoadA(e.target.value)} disabled={saving} />
              </Row>
              <Row label="Section">
                <select className="ob-input" value={section} onChange={(e) => setSection(e.target.value as 'NORMAL' | 'EMERGENCY' | '')} disabled={saving}>
                  {SECTION_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Row>
            </FieldGroup>
          )}

          {showSharedCableFields && (
            <FieldGroup title={
              mode === 'edit-run'
                ? `Shared cable properties (applies to all ${run!.parallel_count} strand${run!.parallel_count !== 1 ? 's' : ''})`
                : mode === 'add-run'
                  ? 'Cable properties (first strand)'
                  : 'Cable properties'
            }>
              <Row label="Size (mm²)" error={validationErrors.sizeMm2}>
                <select className="ob-input" value={sizeMm2} onChange={(e) => setSizeMm2(Number(e.target.value))} disabled={saving}>
                  {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Row>
              <Row label="Cores" error={validationErrors.cores}>
                <select className="ob-input" value={cores} onChange={(e) => setCores(e.target.value as EnrichedCable['cores'])} disabled={saving}>
                  <option value="3">3</option><option value="3+E">3+E</option><option value="4">4</option>
                </select>
              </Row>
              <Row label="Conductor" error={validationErrors.conductor}>
                <select className="ob-input" value={conductor} onChange={(e) => setConductor(e.target.value as EnrichedCable['conductor'])} disabled={saving}>
                  <option value="CU">Copper</option><option value="AL">Aluminium</option>
                </select>
              </Row>
              <Row label="Insulation" error={validationErrors.insulation}>
                <select className="ob-input" value={insulation} onChange={(e) => setInsulation(e.target.value as EnrichedCable['insulation'])} disabled={saving}>
                  <option value="XLPE">XLPE</option><option value="PVC">PVC</option><option value="PILC">PILC</option>
                </select>
              </Row>
              <Row label="Installation method" error={validationErrors.installMethod}>
                <select className="ob-input" value={installMethod} onChange={(e) => setInstallMethod(e.target.value)} disabled={saving}>
                  <option value="">— None —</option>
                  <option value="DIRECT_IN_GROUND">Direct in ground</option>
                  <option value="DUCT">Duct</option>
                  <option value="LADDER">Ladder</option>
                  <option value="TRAY">Tray</option>
                  <option value="CLIPPED">Clipped</option>
                </select>
              </Row>
              <Row label="Burial depth (mm)" error={validationErrors.depthMm} hint={installMethod === 'DIRECT_IN_GROUND' ? 'Required for direct-in-ground' : undefined}>
                <input className="ob-input" type="number" step="1" min={0} value={depthMm} onChange={(e) => setDepthMm(e.target.value)} disabled={saving} />
              </Row>
              <Row label="Grouped with (cables in same trench/duct)" error={validationErrors.groupedWith}>
                <input className="ob-input" type="number" step="1" min={1} value={groupedWith} onChange={(e) => setGroupedWith(Math.max(1, Number(e.target.value) || 1))} disabled={saving} />
              </Row>
              {mode === 'edit-run' && (
                <Row label="Measured length (m)" hint={`Fans out to all ${run!.parallel_count} strands. Per-strand override via expand drill-down.`} error={validationErrors.measuredLengthM}>
                  <input className="ob-input" type="number" step="0.1" min={0} value={measuredLengthM} onChange={(e) => setMeasuredLengthM(e.target.value)} disabled={saving} />
                </Row>
              )}
            </FieldGroup>
          )}

          {showPerStrandFields && (
            <FieldGroup title={
              mode === 'add-run' ? 'First strand'
                : mode === 'add-strand' ? 'This strand'
                : 'Strand'
            }>
              {mode === 'add-run' && (
                <Row label="Measured length (m)" error={validationErrors.measuredLengthM} hint="Optional — leave blank to start UNMEASURED.">
                  <input className="ob-input" type="number" step="0.1" min={0} value={measuredLengthM} onChange={(e) => setMeasuredLengthM(e.target.value)} disabled={saving} />
                </Row>
              )}
              {mode === 'add-strand' && (
                <Row label="Measured length (m)" error={validationErrors.measuredLengthM} hint="Defaults to head strand's length — adjust if this strand has a different route.">
                  <input className="ob-input" type="number" step="0.1" min={0} value={measuredLengthM} onChange={(e) => setMeasuredLengthM(e.target.value)} disabled={saving} />
                </Row>
              )}
              {mode === 'edit-strand' && (
                <Row label="Measured length (m)" error={validationErrors.measuredLengthM}>
                  <input className="ob-input" type="number" step="0.1" min={0} value={measuredLengthM} onChange={(e) => setMeasuredLengthM(e.target.value)} disabled={saving} />
                </Row>
              )}
              <Row label="Ω/km manual override" hint="Leave blank to use SANS auto-lookup." error={validationErrors.ohmPerKmOverride}>
                <input className="ob-input" type="number" step="any" min={0} value={ohmPerKmOverride} onChange={(e) => setOhmPerKmOverride(e.target.value)} disabled={saving} placeholder="(auto)" />
              </Row>
              {mode !== 'add-run' && (
                <Row label="Tag override" hint="Leave blank to use the auto-generated tag (FROM-TO-size-strand)">
                  <input className="ob-input" type="text" maxLength={40} value={tagOverride} onChange={(e) => setTagOverride(e.target.value)} disabled={saving} />
                </Row>
              )}
              <Row label="Ambient temp (°C)">
                <input className="ob-input" type="number" step="1" value={ambientTempC} onChange={(e) => setAmbientTempC(Number(e.target.value) || 30)} disabled={saving} />
              </Row>
              {mode !== 'add-run' && (
                <Row label="Notes">
                  <textarea className="ob-input" maxLength={2000} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
                </Row>
              )}
            </FieldGroup>
          )}

          {error && (
            <div role="alert" style={{ color: '#dc2626', fontSize: 12, padding: '8px 12px', background: 'rgba(220,38,38,0.08)', borderRadius: 6, border: '1px solid #dc2626' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer — sticky */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={saving} className="btn-primary-amber"
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="btn-primary-amber">
            {submitLabel}
          </button>
        </div>
    </div>
  )
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: '10px 12px', margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <legend style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-dim)', padding: '0 6px' }}>
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--c-text)' }}>
      <span>{label}</span>
      {children}
      {hint && !error && <span style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>{hint}</span>}
      {error && <span role="alert" style={{ fontSize: 10, color: '#dc2626' }}>{error}</span>}
    </label>
  )
}
