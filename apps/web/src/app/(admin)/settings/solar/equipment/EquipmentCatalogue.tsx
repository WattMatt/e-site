'use client'
/** Equipment catalogue (functional spec §11): add, edit, retire (never delete), import from CSV. The server validates every spec. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { saveSolarEquipmentAction, retireSolarEquipmentAction, importSolarEquipmentCsvAction } from '@/actions/solar-equipment.actions'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'

type Kind = 'module' | 'inverter' | 'battery'
export interface EquipmentRowView { id: string; kind: Kind; make: string; model: string; specs: Record<string, number | boolean>; platform: boolean; retired: boolean; source: string; updatedAt: string }

const FIELDS: Record<Kind, Array<[string, string]>> = {
  module: [['pmaxW', 'Pmax (W)'], ['vocV', 'Voc (V)'], ['iscA', 'Isc (A)'], ['vmpV', 'Vmp (V)'], ['impA', 'Imp (A)'], ['gammaPmaxPctPerC', 'Temp. coefficient of Pmax (%/°C)'], ['betaVocPctPerC', 'Temp. coefficient of Voc (%/°C)'], ['gammaVmpPctPerC', 'Temp. coefficient of Vmp (%/°C)'], ['lengthMm', 'Length (mm)'], ['widthMm', 'Width (mm)']],
  inverter: [['acKw', 'AC rating (kW)'], ['euroEfficiencyPct', 'Euro efficiency (%)'], ['mppts', 'MPPTs'], ['vDcMax', 'Max DC voltage (V)'], ['vMpptMin', 'MPPT min (V)'], ['vMpptMax', 'MPPT max (V)'], ['iMpptMaxA', 'Max current per MPPT (A)']],
  battery: [['usableKwh', 'Usable capacity (kWh)'], ['powerKw', 'Power (kW)'], ['rtePct', 'Round-trip efficiency (%)'], ['warrantyCycles', 'Warranty cycles']],
}
const BOOL_FIELDS: Record<Kind, Array<[string, string]>> = { module: [['bifacial', 'Bifacial']], inverter: [], battery: [] }
const TABS: Array<[Kind, string]> = [['module', 'Modules'], ['inverter', 'Inverters'], ['battery', 'Batteries']]
const summary = (r: EquipmentRowView) => FIELDS[r.kind].filter(([k]) => r.specs[k] !== undefined).slice(0, 3).map(([k, l]) => `${l.replace(/ \(.*\)/, '')} ${r.specs[k]}`).join(' · ')
const readText = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(f) })

function Editor({ kind, row, onDone, onCancel }: { kind: Kind; row: EquipmentRowView | null; onDone: () => void; onCancel: () => void }) {
  const [make, setMake] = useState(row?.make ?? ''), [model, setModel] = useState(row?.model ?? '')
  const [specs, setSpecs] = useState<Record<string, string>>(Object.fromEntries(Object.entries(row?.specs ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, String(v)])))
  const [flags, setFlags] = useState<Record<string, boolean>>(Object.fromEntries(Object.entries(row?.specs ?? {}).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true); setError(null); setErrors({})
    const parsed = { ...Object.fromEntries(Object.entries(specs).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])), ...flags }
    const r = await saveSolarEquipmentAction({ id: row?.id ?? null, kind, make, model, specs: parsed, expectedUpdatedAt: row?.updatedAt ?? null })
    setBusy(false)
    if ('ok' in r) onDone(); else if ('fieldErrors' in r) setErrors(r.fieldErrors); else setError(r.error)
  }
  const claimed = new Set(['make', 'model', ...FIELDS[kind].map(([k]) => k)])
  return (
    <div role="group" aria-label="Equipment editor" style={{ display: 'grid', gap: 6, border: '1px solid var(--c-border, #e5e7eb)', padding: 10, borderRadius: 8 }}>
      <label>Make <input aria-label="Make" value={make} onChange={(e) => setMake(e.target.value)} /></label>
      {errors.make && <span role="alert">{errors.make}</span>}
      <label>Model <input aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} /></label>
      {errors.model && <span role="alert">{errors.model}</span>}
      {FIELDS[kind].map(([k, label]) => (
        <label key={k}>{label} <input aria-label={label} type="number" step="any" value={specs[k] ?? ''} onChange={(e) => setSpecs((s) => ({ ...s, [k]: e.target.value }))} />
          {errors[k] && <span role="alert">{errors[k]}</span>}</label>
      ))}
      {BOOL_FIELDS[kind].map(([k, label]) => (
        <label key={k}><input type="checkbox" aria-label={label} checked={flags[k] === true} onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))} /> {label}</label>
      ))}
      {Object.entries(errors).filter(([k]) => !claimed.has(k)).map(([k, v]) => <span key={k} role="alert">{`${k}: ${v}`}</span>)}
      {error && <span role="alert">{error}</span>}
      <div style={{ display: 'flex', gap: 6 }}>
        <Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save equipment'}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function Row({ r, onEdit }: { r: EquipmentRowView; onEdit: () => void }) {
  const router = useRouter()
  const confirm = useArmedConfirm()
  const [error, setError] = useState<string | null>(null)
  return (
    <tr>
      <td>{`${r.make} ${r.model}`}</td><td>{summary(r)}</td>
      <td>{r.platform ? <Badge variant="ghost">E-Site catalogue</Badge> : r.retired ? <Badge variant="warning">Retired</Badge> : <Badge variant="success">Active</Badge>}</td>
      <td>{!r.platform && !r.retired && <>
        <Button type="button" size="sm" variant="secondary" onClick={onEdit}>Edit</Button>{' '}
        <Button type="button" size="sm" variant="secondary" onClick={async () => {
          if (!confirm.armed) return confirm.arm()
          confirm.disarm()
          setError(null)
          const res = await retireSolarEquipmentAction({ id: r.id })
          if ('ok' in res) router.refresh(); else setError(res.error)
        }}>{confirm.armed ? `Retire ${r.make} ${r.model}?` : 'Retire'}</Button>
      </>}{error && <span role="alert">{error}</span>}</td>
    </tr>
  )
}

export function EquipmentCatalogue({ rows, csvHeader }: { rows: EquipmentRowView[]; csvHeader: string }) {
  const router = useRouter()
  const [tab, setTab] = useState<Kind>('module')
  const [editing, setEditing] = useState<EquipmentRowView | 'new' | null>(null)
  const [importMsg, setImportMsg] = useState<string[]>([])
  const done = () => { setEditing(null); router.refresh() }
  const onFile = async (input: HTMLInputElement) => {
    const f = input.files?.[0]
    if (!f) return
    setImportMsg([])
    const r = await importSolarEquipmentCsvAction({ text: await readText(f) })
    input.value = ''
    if ('ok' in r) { setImportMsg([`${r.added} added, ${r.skipped} already in the catalogue.`]); router.refresh() }
    else if ('errors' in r) setImportMsg(r.errors.map((e) => `Line ${e.line}: ${e.message}`))
    else setImportMsg([r.error])
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div role="tablist" aria-label="Equipment kind" style={{ display: 'flex', gap: 6 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setEditing(null) }}>{l}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button type="button" size="sm" onClick={() => setEditing('new')}>{`Add ${tab}`}</Button>
        <label>Import from CSV <input aria-label="Import from CSV" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.currentTarget)} /></label>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvHeader + '\n')}`} download="solar-equipment-template.csv">Download CSV template</a>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>PAN/OND import comes later.</span>
      </div>
      {importMsg.map((m) => <span key={m} role="status">{m}</span>)}
      {editing && <Editor key={editing === 'new' ? `new-${tab}` : editing.id} kind={editing === 'new' ? tab : editing.kind} row={editing === 'new' ? null : editing} onDone={done} onCancel={() => setEditing(null)} />}
      <table>
        <thead><tr><th scope="col">Equipment</th><th scope="col">Key specs</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.filter((r) => r.kind === tab).map((r) => <Row key={r.id} r={r} onEdit={() => setEditing(r)} />)}</tbody>
      </table>
    </div>
  )
}
