'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addSourceAction,
  addBoardAction,
  addSupplyAction,
  addCableAction,
  addParallelCableAction,
} from '@/actions/cable-entities.actions'

export interface NodeOption {
  id: string
  code: string
  kind: 'source' | 'board'
}

export interface SupplyOption {
  id: string
  fromLabel: string
  toLabel: string
  voltage_v: number
  load_a: number
}

interface Props {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  supplies: SupplyOption[]
}

type Tab = 'source' | 'board' | 'supply' | 'cable'

const SIZE_DEFAULTS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
const VOLTAGE_DEFAULTS = [230, 400, 525, 1000, 3300, 6600, 11000]

export function AddEntityPanel({ revisionId, sources, boards, supplies }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('source')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  function submit(fn: () => Promise<{ error?: string }>, label: string) {
    setError(null); setFlash(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      setFlash(label + ' added.')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn-primary-amber" onClick={() => setOpen(true)}>
          + Add to schedule
        </button>
      </div>
    )
  }

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14, borderBottom: '1px solid var(--c-border)', paddingBottom: 10 }}>
        {(['source','board','supply','cable'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setError(null); setFlash(null) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '4px 0',
              color: tab === t ? 'var(--c-amber)' : 'var(--c-text-mid)',
              borderBottom: tab === t ? '2px solid var(--c-amber)' : '2px solid transparent',
            }}
          >
            {t === 'source' && '⚡ Source'}
            {t === 'board'  && '🟦 Board'}
            {t === 'supply' && '➜ Supply'}
            {t === 'cable'  && '─ Cable'}
          </button>
        ))}
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

      {tab === 'source' && <SourceForm revisionId={revisionId} pending={pending} onSubmit={submit} />}
      {tab === 'board'  && <BoardForm  revisionId={revisionId} boards={boards} pending={pending} onSubmit={submit} />}
      {tab === 'supply' && <SupplyForm revisionId={revisionId} sources={sources} boards={boards} pending={pending} onSubmit={submit} />}
      {tab === 'cable'  && <CableForm  supplies={supplies} pending={pending} onSubmit={submit} />}
    </div>
  )
}

// ─── source form ────────────────────────────────────────────────────

function SourceForm({
  revisionId, pending, onSubmit,
}: { revisionId: string; pending: boolean; onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void }) {
  const [code, setCode] = useState('')
  const [type, setType] = useState<'MINISUB'|'STANDBY'|'PV'|'UTILITY'|'RMU'>('MINISUB')
  const [ratingKva, setRatingKva] = useState('')
  const [voltageV, setVoltageV] = useState('400')

  function go() {
    onSubmit(
      () => addSourceAction({
        revisionId,
        code: code.trim(),
        type,
        ratingKva: ratingKva ? Number(ratingKva) : null,
        voltageV: voltageV ? Number(voltageV) : null,
      }),
      `Source "${code.trim()}"`,
    )
    setCode(''); setRatingKva('')
  }

  return (
    <Grid cols="repeat(auto-fit, minmax(180px, 1fr))">
      <Field label="Code *">
        <input className="ob-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MINI SUB 1" maxLength={80} />
      </Field>
      <Field label="Type *">
        <select className="ob-input" value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="MINISUB">Mini Sub</option>
          <option value="STANDBY">Standby</option>
          <option value="PV">PV plant</option>
          <option value="UTILITY">Utility</option>
          <option value="RMU">RMU</option>
        </select>
      </Field>
      <Field label="Rating (kVA)">
        <input className="ob-input" type="number" step="any" min="0" value={ratingKva} onChange={(e) => setRatingKva(e.target.value)} placeholder="1000" />
      </Field>
      <Field label="Voltage (V)">
        <input className="ob-input" type="number" step="any" min="0" value={voltageV} onChange={(e) => setVoltageV(e.target.value)} />
      </Field>
      <SubmitButton
        disabled={pending || code.trim().length < 1}
        pending={pending}
        label="Add source"
        onClick={go}
      />
    </Grid>
  )
}

// ─── board form ─────────────────────────────────────────────────────

function BoardForm({
  revisionId, boards, pending, onSubmit,
}: {
  revisionId: string
  boards: NodeOption[]
  pending: boolean
  onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void
}) {
  const [code, setCode] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [breaker, setBreaker] = useState('')
  const [pole, setPole] = useState<'SP'|'TP'|''>('TP')
  const [section, setSection] = useState<'NORMAL'|'EMERGENCY'|'MIXED'|''>('NORMAL')
  const [parentId, setParentId] = useState('')

  function go() {
    onSubmit(
      () => addBoardAction({
        revisionId,
        code: code.trim(),
        tenantName: tenantName.trim() || null,
        breakerRatingA: breaker ? Number(breaker) : null,
        poleConfig: (pole || null) as any,
        section: (section || null) as any,
        parentBoardId: parentId || null,
      }),
      `Board "${code.trim()}"`,
    )
    setCode(''); setTenantName(''); setBreaker(''); setParentId('')
  }

  return (
    <Grid cols="repeat(auto-fit, minmax(180px, 1fr))">
      <Field label="Code *">
        <input className="ob-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MAIN BOARD 1.1 / DB-12" maxLength={80} />
      </Field>
      <Field label="Tenant / label">
        <input className="ob-input" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Cashbuild" maxLength={200} />
      </Field>
      <Field label="Breaker (A)">
        <input className="ob-input" type="number" step="any" min="0" value={breaker} onChange={(e) => setBreaker(e.target.value)} />
      </Field>
      <Field label="Poles">
        <select className="ob-input" value={pole} onChange={(e) => setPole(e.target.value as any)}>
          <option value="">—</option>
          <option value="SP">SP</option>
          <option value="TP">TP</option>
        </select>
      </Field>
      <Field label="Section">
        <select className="ob-input" value={section} onChange={(e) => setSection(e.target.value as any)}>
          <option value="">—</option>
          <option value="NORMAL">Normal</option>
          <option value="EMERGENCY">Emergency</option>
          <option value="MIXED">Mixed</option>
        </select>
      </Field>
      <Field label="Parent board">
        <select className="ob-input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">(top-level)</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
        </select>
      </Field>
      <SubmitButton
        disabled={pending || code.trim().length < 1}
        pending={pending}
        label="Add board"
        onClick={go}
      />
    </Grid>
  )
}

// ─── supply form ────────────────────────────────────────────────────

function SupplyForm({
  revisionId, sources, boards, pending, onSubmit,
}: {
  revisionId: string
  sources: NodeOption[]
  boards: NodeOption[]
  pending: boolean
  onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void
}) {
  // origin is "source:<id>" | "board:<id>"
  const allOrigins = [
    ...sources.map((s) => ({ key: `source:${s.id}`, label: `⚡ ${s.code}` })),
    ...boards.map((b) => ({ key: `board:${b.id}`,  label: `🟦 ${b.code}` })),
  ]
  const [origin, setOrigin] = useState(allOrigins[0]?.key ?? '')
  const [toBoardId, setToBoardId] = useState(boards[0]?.id ?? '')
  const [voltage, setVoltage] = useState('400')
  const [load, setLoad] = useState('')
  const [section, setSection] = useState<'NORMAL'|'EMERGENCY'|''>('NORMAL')

  function go() {
    const [kind, id] = origin.split(':')
    onSubmit(
      () => addSupplyAction({
        revisionId,
        fromSourceId: kind === 'source' ? id! : null,
        fromBoardId:  kind === 'board'  ? id! : null,
        toBoardId,
        voltageV: Number(voltage),
        designLoadA: Number(load),
        section: (section || null) as any,
      }),
      'Supply',
    )
    setLoad('')
  }

  if (allOrigins.length === 0 || boards.length === 0) {
    return (
      <p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
        Add at least one source AND one board before creating a supply.
      </p>
    )
  }

  return (
    <Grid cols="repeat(auto-fit, minmax(180px, 1fr))">
      <Field label="From (origin) *">
        <select className="ob-input" value={origin} onChange={(e) => setOrigin(e.target.value)}>
          {allOrigins.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="To (destination board) *">
        <select className="ob-input" value={toBoardId} onChange={(e) => setToBoardId(e.target.value)}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
        </select>
      </Field>
      <Field label="Voltage *">
        <select className="ob-input" value={voltage} onChange={(e) => setVoltage(e.target.value)}>
          {VOLTAGE_DEFAULTS.map((v) => <option key={v} value={v}>{v} V</option>)}
        </select>
      </Field>
      <Field label="Design load (A) *">
        <input className="ob-input" type="number" step="any" min="0.1" value={load} onChange={(e) => setLoad(e.target.value)} />
      </Field>
      <Field label="Section">
        <select className="ob-input" value={section} onChange={(e) => setSection(e.target.value as any)}>
          <option value="">—</option>
          <option value="NORMAL">Normal</option>
          <option value="EMERGENCY">Emergency</option>
        </select>
      </Field>
      <SubmitButton
        disabled={pending || !load || !toBoardId}
        pending={pending}
        label="Add supply"
        onClick={go}
      />
    </Grid>
  )
}

// ─── cable form ─────────────────────────────────────────────────────

function CableForm({
  supplies, pending, onSubmit,
}: {
  supplies: SupplyOption[]
  pending: boolean
  onSubmit: (fn: () => Promise<{ error?: string }>, label: string) => void
}) {
  const [supplyId, setSupplyId] = useState(supplies[0]?.id ?? '')
  const [sizeMm2, setSizeMm2] = useState('25')
  const [cores, setCores] = useState<'3'|'3+E'|'4'>('4')
  const [conductor, setConductor] = useState<'CU'|'AL'>('CU')
  const [insulation, setInsulation] = useState<'PVC'|'XLPE'|'PILC'>('XLPE')
  const [measuredLengthM, setMeasuredLengthM] = useState('')
  const [installMethod, setInstallMethod] = useState<'DIRECT_IN_GROUND'|'DUCT'|'LADDER'|'TRAY'|'CLIPPED'>('DIRECT_IN_GROUND')
  const [depthMm, setDepthMm] = useState('500')
  const [groupedWith, setGroupedWith] = useState('1')
  const [ohmOverride, setOhmOverride] = useState('')

  function go() {
    onSubmit(
      () => addCableAction({
        supplyId,
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
      }),
      'Cable',
    )
    setMeasuredLengthM(''); setOhmOverride('')
  }

  if (supplies.length === 0) {
    return (
      <p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
        Add at least one supply before placing a cable on it.
      </p>
    )
  }

  return (
    <Grid cols="repeat(auto-fit, minmax(160px, 1fr))">
      <Field label="Supply *" wide>
        <select className="ob-input" value={supplyId} onChange={(e) => setSupplyId(e.target.value)}>
          {supplies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fromLabel} → {s.toLabel} ({s.voltage_v} V, {s.load_a} A)
            </option>
          ))}
        </select>
      </Field>
      <Field label="Size (mm²) *">
        <select className="ob-input" value={sizeMm2} onChange={(e) => setSizeMm2(e.target.value)}>
          {SIZE_DEFAULTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Cores">
        <select className="ob-input" value={cores} onChange={(e) => setCores(e.target.value as any)}>
          <option value="3">3</option>
          <option value="3+E">3+E</option>
          <option value="4">4</option>
        </select>
      </Field>
      <Field label="Conductor">
        <select className="ob-input" value={conductor} onChange={(e) => setConductor(e.target.value as any)}>
          <option value="CU">Cu</option>
          <option value="AL">Al</option>
        </select>
      </Field>
      <Field label="Insulation">
        <select className="ob-input" value={insulation} onChange={(e) => setInsulation(e.target.value as any)}>
          <option value="XLPE">XLPE</option>
          <option value="PVC">PVC</option>
          <option value="PILC">PILC</option>
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
      <Field label="Group size">
        <input className="ob-input" type="number" step="1" min="1" value={groupedWith} onChange={(e) => setGroupedWith(e.target.value)} />
      </Field>
      <Field label="Ω/km override">
        <input className="ob-input" type="number" step="any" min="0" value={ohmOverride} onChange={(e) => setOhmOverride(e.target.value)} placeholder="(auto from SANS)" />
      </Field>
      <SubmitButton
        disabled={pending || !supplyId || !sizeMm2}
        pending={pending}
        label="Add cable"
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
