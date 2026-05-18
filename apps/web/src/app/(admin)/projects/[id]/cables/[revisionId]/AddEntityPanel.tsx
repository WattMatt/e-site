'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  findOrCreateSupplyAction,
  addCableAction,
  previewParallelCableSet,
  addParallelCableSetAction,
  addBoardAction,
} from '@/actions/cable-entities.actions'
import { type NodeOption } from './CableScheduleGrid'

interface Props {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  /** When set (e.g. `source:<id>` / `board:<id>`), the form opens pre-seeded with this "From". */
  feedFromKey?: string | null
  /** Called once the pre-seeded feed has been used (submitted) so the caller can clear it. */
  onFeedConsumed?: () => void
}

const SIZE_DEFAULTS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const VOLTAGE_DEFAULTS = [230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000]
const BOARD_KIND_OPTIONS = [
  { value: 'SUB_BOARD', label: 'Sub board' },
  { value: 'MAIN_BOARD', label: 'Main board' },
  { value: 'TRANSFORMER', label: 'Transformer / Minisub' },
  { value: 'CONSUMER_RMU', label: 'Consumer RMU' },
]

export function AddEntityPanel({ revisionId, sources, boards, feedFromKey, onFeedConsumed }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    if (feedFromKey) setOpen(true)
  }, [feedFromKey])

  function submit(fn: () => Promise<{ error?: string }>, label: string) {
    setError(null); setFlash(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      setFlash(label + ' added.')
      router.refresh()
      onFeedConsumed?.()
    })
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn-primary-amber" onClick={() => setOpen(true)}>
          + Add cable
        </button>
      </div>
    )
  }

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 14, borderBottom: '1px solid var(--c-border)', paddingBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-amber)' }}>
          ─ Add cable
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: 'var(--c-text-dim)', fontSize: 18, cursor: 'pointer' }}
          aria-label="Close add panel"
        >
          ×
        </button>
      </div>

      {flash && (
        <div style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: 'rgba(34, 197, 94, 0.1)', color: '#16a34a', fontSize: 12 }}>
          ✓ {flash}
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626', fontSize: 12 }}>
          ✕ {error}
        </div>
      )}

      <CableForm revisionId={revisionId} sources={sources} boards={boards} pending={pending} onSubmit={submit} feedFromKey={feedFromKey} />
    </div>
  )
}

// ─── cable form ─────────────────────────────────────────────────────

function CableForm({
  revisionId, sources, boards, pending, onSubmit, feedFromKey,
}: {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  pending: boolean
  onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void
  feedFromKey?: string | null
}) {
  // From = sources + boards; To = boards only
  const allFrom = [
    ...sources.map((s) => ({ key: `source:${s.id}`, label: `⚡ ${s.code}` })),
    ...boards.map((b) => ({ key: `board:${b.id}`, label: `🟦 ${b.code}` })),
  ]

  const [showMore, setShowMore] = useState(false)

  const [fromKey, setFromKey] = useState(allFrom[0]?.key ?? '')
  const [toBoardId, setToBoardId] = useState(boards[0]?.id ?? '')
  const [voltage, setVoltage] = useState('400')
  const [load, setLoad] = useState('')
  const [section, setSection] = useState<'NORMAL'|'EMERGENCY'|''>('NORMAL')
  const [sizeMm2, setSizeMm2] = useState('25')
  const [cores, setCores] = useState<'3'|'3+E'|'4'>('4')
  const [conductor, setConductor] = useState<'CU'|'AL'>('CU')
  const [insulation, setInsulation] = useState<'PVC'|'XLPE'|'PILC'>('XLPE')
  const [measuredLengthM, setMeasuredLengthM] = useState('')
  const [installMethod, setInstallMethod] = useState<'DIRECT_IN_GROUND'|'DUCT'|'LADDER'|'TRAY'|'CLIPPED'>('DIRECT_IN_GROUND')
  const [depthMm, setDepthMm] = useState('500')
  const [groupedWith, setGroupedWith] = useState('1')
  const [ohmOverride, setOhmOverride] = useState('')
  const [newBoardCode, setNewBoardCode] = useState('')
  const [newBoardKind, setNewBoardKind] = useState('SUB_BOARD')

  const [preview, setPreview] = useState<{
    count: number
    perCableRatingA: number
    combinedRatingA: number
    insufficient: boolean
    mode: 'create-set' | 'add-single'
  } | null>(null)
  const [count, setCount] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (feedFromKey && allFrom.some((o) => o.key === feedFromKey)) {
      setFromKey(feedFromKey)
    }
  }, [feedFromKey])

  useEffect(() => {
    const [kind, id] = fromKey.split(':')
    const loadNum = Number(load)
    if (!kind || !id || !toBoardId || toBoardId === '__new__' || !loadNum || loadNum <= 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await previewParallelCableSet({
        revisionId,
        fromSourceId: kind === 'source' ? id! : null,
        fromBoardId: kind === 'board' ? id! : null,
        toBoardId,
        designLoadA: loadNum,
        sizeMm2: Number(sizeMm2),
        cores,
        conductor,
        insulation,
        installationMethod: installMethod,
        depthMm: depthMm ? Number(depthMm) : null,
        ambientTempC: 30,
        thermalResistivityKmw: 1.0,
      })
      if (cancelled) return
      if (res.error || res.count == null) {
        setPreview(null)
        return
      }
      const next = {
        count: res.count,
        perCableRatingA: res.perCableRatingA!,
        combinedRatingA: res.combinedRatingA!,
        insufficient: res.insufficient!,
        mode: res.mode!,
      }
      setPreview(next)
      // Pre-fill the count field only in create-set mode and only when the
      // user has not started editing it (empty string == untouched).
      setCount((prev) => (prev === '' && next.mode === 'create-set' && !next.insufficient
        ? String(next.count) : prev))
    }, 400)
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [revisionId, fromKey, toBoardId, load, sizeMm2, cores, conductor, insulation, installMethod, depthMm])

  function go() {
    // Note: preview.mode is a debounced snapshot — addParallelCableSetAction is the
    // real authority and re-checks supply state server-side, so it may create a
    // single cable even when this picked the create-set path.
    const [kind, id] = fromKey.split(':')
    const setCountNum = Number(count)
    const useSet =
      preview != null &&
      preview.mode === 'create-set' &&
      !preview.insufficient &&
      Number.isFinite(setCountNum) &&
      setCountNum >= 1

    if (useSet) {
      onSubmit(
        async () => {
          if (!kind || !id) return { error: 'Please select a valid From node' }
          let resolvedToBoardId = toBoardId
          if (toBoardId === '__new__') {
            const board = await addBoardAction({ revisionId, code: newBoardCode.trim(), kind: newBoardKind as never })
            if (board.error || !board.id) return { error: board.error ?? 'Could not create the board' }
            resolvedToBoardId = board.id
            // Point the form at the now-created board so a retry after a partial
            // failure (board created, feed failed) targets it instead of
            // creating a duplicate board.
            setToBoardId(board.id)
            setNewBoardCode('')
          }
          return addParallelCableSetAction({
            revisionId,
            fromSourceId: kind === 'source' ? id! : null,
            fromBoardId: kind === 'board' ? id! : null,
            toBoardId: resolvedToBoardId,
            voltageV: Number(voltage),
            designLoadA: Number(load),
            section: (section || null) as 'NORMAL' | 'EMERGENCY' | null | undefined,
            count: setCountNum,
            sizeMm2: Number(sizeMm2),
            cores,
            conductor,
            insulation,
            measuredLengthM: measuredLengthM ? Number(measuredLengthM) : null,
            installationMethod: installMethod,
            depthMm: depthMm ? Number(depthMm) : null,
            ambientTempC: 30,
            thermalResistivityKmw: 1.0,
            ohmPerKmOverride: ohmOverride ? Number(ohmOverride) : null,
          })
        },
        `${setCountNum} cable${setCountNum === 1 ? '' : 's'}`,
      )
    } else {
      onSubmit(
        async () => {
          if (!kind || !id) return { error: 'Please select a valid From node' }
          let resolvedToBoardId = toBoardId
          if (toBoardId === '__new__') {
            const board = await addBoardAction({ revisionId, code: newBoardCode.trim(), kind: newBoardKind as never })
            if (board.error || !board.id) return { error: board.error ?? 'Could not create the board' }
            resolvedToBoardId = board.id
            // Point the form at the now-created board so a retry after a partial
            // failure (board created, feed failed) targets it instead of
            // creating a duplicate board.
            setToBoardId(board.id)
            setNewBoardCode('')
          }
          const supplyResult = await findOrCreateSupplyAction({
            revisionId,
            fromSourceId: kind === 'source' ? id! : null,
            fromBoardId: kind === 'board' ? id! : null,
            toBoardId: resolvedToBoardId,
            voltageV: Number(voltage),
            designLoadA: Number(load),
            section: (section || null) as 'NORMAL' | 'EMERGENCY' | null | undefined,
          })
          if (supplyResult.error) return { error: supplyResult.error }
          return addCableAction({
            supplyId: supplyResult.supplyId!,
            sizeMm2: Number(sizeMm2),
            cores,
            conductor,
            insulation,
            measuredLengthM: measuredLengthM ? Number(measuredLengthM) : null,
            installationMethod: installMethod,
            depthMm: depthMm ? Number(depthMm) : null,
            groupedWith: Number(groupedWith),
            ambientTempC: 30,
            thermalResistivityKmw: 1.0,
            ohmPerKmOverride: ohmOverride ? Number(ohmOverride) : null,
          })
        },
        'Cable',
      )
    }
    setMeasuredLengthM(''); setOhmOverride('')
  }

  if (allFrom.length === 0 || boards.length === 0) {
    return (
      <p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
        Add at least one source and one board in the Structure panel above before placing a cable.
      </p>
    )
  }

  return (
    <Grid cols="repeat(auto-fit, minmax(160px, 1fr))">
      <Field label="From *">
        <select className="ob-input" value={fromKey} onChange={(e) => setFromKey(e.target.value)}>
          {allFrom.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="To (board) *">
        <select className="ob-input" value={toBoardId} onChange={(e) => setToBoardId(e.target.value)}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          <option value="__new__">+ new board…</option>
        </select>
        {toBoardId === '__new__' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input className="ob-input" style={{ flex: 1 }} value={newBoardCode} maxLength={80}
              placeholder="New board code" onChange={(e) => setNewBoardCode(e.target.value)} />
            <select className="ob-input" value={newBoardKind} onChange={(e) => setNewBoardKind(e.target.value)}>
              {BOARD_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
        )}
      </Field>
      <Field label="Voltage *">
        <select className="ob-input" value={voltage} onChange={(e) => setVoltage(e.target.value)}>
          {VOLTAGE_DEFAULTS.map((v) => <option key={v} value={v}>{v} V</option>)}
        </select>
      </Field>
      <Field label="Design load (A) *">
        <input className="ob-input" type="number" step="any" min="0.1" value={load} onChange={(e) => setLoad(e.target.value)} />
      </Field>
      <Field label="Size (mm²) *">
        <select className="ob-input" value={sizeMm2} onChange={(e) => setSizeMm2(e.target.value)}>
          {SIZE_DEFAULTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Conductor">
        <select className="ob-input" value={conductor} onChange={(e) => setConductor(e.target.value as any)}>
          <option value="CU">Cu</option>
          <option value="AL">Al</option>
        </select>
      </Field>
      {/* Insulation is PRIMARY, not "more detail" — it picks the SANS rating
          table (T6.2/T6.3 for PVC, T6.4/T6.5 for XLPE) so the preview rating
          changes ~30% across the dropdown. Hiding it behind +More meant
          engineers picked Size with the XLPE default and saw inflated ratings
          they couldn't explain. */}
      <Field label="Insulation *">
        <select className="ob-input" value={insulation} onChange={(e) => setInsulation(e.target.value as any)}>
          <option value="XLPE">XLPE</option>
          <option value="PVC">PVC</option>
          <option value="PILC">PILC</option>
        </select>
      </Field>
      <div style={{ gridColumn: '1 / -1' }}>
        <button type="button" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--c-text-mid)', fontSize: 12, fontFamily: 'var(--font-mono)',
            letterSpacing: '0.04em', padding: 0 }}>
          {showMore ? '− Less cable detail' : '+ More cable detail'}
        </button>
      </div>
      {showMore && (
        <>
          <Field label="Section">
            <select className="ob-input" value={section} onChange={(e) => setSection(e.target.value as any)}>
              <option value="">—</option>
              <option value="NORMAL">Normal</option>
              <option value="EMERGENCY">Emergency</option>
            </select>
          </Field>
          <Field label="Cores">
            <select className="ob-input" value={cores} onChange={(e) => setCores(e.target.value as any)}>
              <option value="3">3</option>
              <option value="3+E">3+E</option>
              <option value="4">4</option>
            </select>
          </Field>
          <Field label="Length (m)">
            <input className="ob-input" type="number" step="any" min="0" value={measuredLengthM} onChange={(e) => setMeasuredLengthM(e.target.value)} placeholder="scaled from drawing" />
          </Field>
          <Field label="Install method">
            <select className="ob-input" value={installMethod} onChange={(e) => setInstallMethod(e.target.value as any)}>
              <option value="DIRECT_IN_GROUND">Direct in ground</option>
              <option value="DUCT">Duct</option>
              <option value="LADDER">Ladder</option>
              <option value="TRAY">Tray</option>
              <option value="CLIPPED">Clipped</option>
            </select>
          </Field>
          <Field label="Depth (mm)">
            <input className="ob-input" type="number" step="50" min="0" value={depthMm} onChange={(e) => setDepthMm(e.target.value)} />
          </Field>
          {/* Manual group size only applies on the single-cable path. In the
              create-set parallel path addParallelCableSetAction sets grouped_with
              to the parallel count, so this control would be a no-op there. */}
          {!(preview && preview.mode === 'create-set' && !preview.insufficient) && (
            <Field label="Group size">
              <input className="ob-input" type="number" step="1" min="1" value={groupedWith} onChange={(e) => setGroupedWith(e.target.value)} />
            </Field>
          )}
          <Field label="Ω/km override">
            <input className="ob-input" type="number" step="any" min="0" value={ohmOverride} onChange={(e) => setOhmOverride(e.target.value)} placeholder="(auto from SANS)" />
          </Field>
        </>
      )}
      {preview && (
        <div style={{ gridColumn: '1 / -1', fontSize: 12, fontFamily: 'var(--font-mono)',
          padding: '8px 10px', borderRadius: 4, border: '1px solid var(--c-border)',
          background: 'var(--c-base)',
          color: preview.insufficient ? 'var(--c-red)' : 'var(--c-text-mid)' }}>
          {preview.insufficient
            ? `⚠ Even 16 in parallel won't carry ${Number(load)} A at this size — pick a larger cable.`
            : preview.mode === 'add-single'
              ? `This supply already has cables — Add will add 1 more. (≈${preview.count} recommended for ${Number(load)} A.)`
              : `${preview.count} × ${sizeMm2}mm² ${conductor === 'CU' ? 'Cu' : 'Al'} ${insulation} → combined ${Math.round(preview.combinedRatingA)} A (≥ ${Number(load)} A design load)`}
        </div>
      )}
      {preview && preview.mode === 'create-set' && !preview.insufficient && (
        <Field label="Cables in parallel" wide>
          <input className="ob-input" type="number" min="1" step="1" value={count}
            onChange={(e) => setCount(e.target.value)} />
          {Number(count) > 0 && Number(count) < preview.count && (
            <span style={{ fontSize: 11, color: 'var(--c-warning)', display: 'block', marginTop: 4 }}>
              Below recommended ({preview.count}).
            </span>
          )}
        </Field>
      )}
      <SubmitButton
        disabled={pending || !fromKey || !toBoardId || !load || !sizeMm2
          || (toBoardId === '__new__' && newBoardCode.trim().length < 1)}
        pending={pending}
        label={
          preview && preview.mode === 'create-set' && !preview.insufficient && Number(count) >= 1
            ? `Add ${Number(count)} cable${Number(count) === 1 ? '' : 's'}`
            : 'Add cable'
        }
        onClick={go}
      />
    </Grid>
  )
}

// ─── primitives ─────────────────────────────────────────────────────

function Grid({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10 }}>
      {children}
    </div>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

function SubmitButton({ disabled, pending, label, onClick }: {
  disabled: boolean
  pending: boolean
  label: string
  onClick: () => void
}) {
  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
      <button
        type="button"
        className="btn-primary-amber"
        disabled={disabled}
        onClick={onClick}
      >
        {pending ? 'Saving…' : label}
      </button>
    </div>
  )
}
