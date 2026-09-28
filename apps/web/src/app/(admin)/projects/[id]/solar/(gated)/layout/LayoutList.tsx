'use client'
/** Layout list (functional spec §6.2): several design options per project. */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GENERIC_MODULE_550, type LayoutModuleSpec } from '@esite/shared'
import { createLayoutAction, deleteLayoutAction, duplicateLayoutAction, renameLayoutAction } from '@/actions/solar-layout.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

type Row = { id: string; name: string; roofSourceId: string; dcKwp: number | null; moduleCount: number | null; updatedAt: string }
type Source = { id: string; label: string; pixelsPerMeter: number | null }

const MODULE_FIELDS: Array<{ key: keyof LayoutModuleSpec; label: string }> = [
  { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'powerW', label: 'Power W' },
  { key: 'lengthM', label: 'Length m' }, { key: 'widthM', label: 'Width m' }, { key: 'vocStc', label: 'Voc V' },
  { key: 'vmpStc', label: 'Vmp V' }, { key: 'iscStc', label: 'Isc A' }, { key: 'betaVocPerC', label: 'β Voc /°C' }, { key: 'gammaVmpPerC', label: 'γ Vmp /°C' },
]

function DeleteButton({ onConfirm }: { onConfirm(): void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return armed ? <button type="button" onClick={() => { disarm(); onConfirm() }} style={{ color: '#dc2626' }}>Confirm delete</button>
    : <button type="button" onClick={arm}>Delete</button>
}

export function LayoutList({ projectId, canEdit, layouts, sources }: { projectId: string; canEdit: boolean; layouts: Row[]; sources: Source[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [tilt, setTilt] = useState('10')
  const [module, setModule] = useState<LayoutModuleSpec>(GENERIC_MODULE_550)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; updatedAt: string } | null>(null)
  const label = new Map(sources.map((s) => [s.id, s.label]))

  async function create() {
    setErrors({}); setError(null)
    const res = await createLayoutAction({ projectId, name, roofSourceId: sourceId, module, defaultTiltDeg: Number(tilt) })
    if ('fieldErrors' in res) setErrors(res.fieldErrors)
    else if ('error' in res) setError(res.error)
    else router.push(`/projects/${projectId}/solar/layout/${res.id}`)
  }
  async function act(p: Promise<{ ok: true } | { error: string } | { fieldErrors: Record<string, string> }>) {
    const res = await p
    if ('error' in res) setError(res.error)
    else if ('fieldErrors' in res) setError(Object.values(res.fieldErrors)[0] ?? 'Could not save.')
    else { setRenaming(null); router.refresh() }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {sources.length === 0 && <p>Add a roof source in Site &amp; Supply first.</p>}
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead><tr><th align="left">Layout</th><th align="left">Roof source</th><th align="right">DC</th><th align="right">Updated</th><th /></tr></thead>
        <tbody>
          {layouts.map((l) => (
            <tr key={l.id}>
              <td>{renaming?.id === l.id
                ? <><input aria-label="New name" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                    <button type="button" onClick={() => void act(renameLayoutAction({ projectId, layoutId: l.id, name: renaming.name, expectedUpdatedAt: renaming.updatedAt }))}>Save name</button></>
                : <Link href={`/projects/${projectId}/solar/layout/${l.id}`}>{l.name}</Link>}</td>
              <td>{label.get(l.roofSourceId) ?? '—'}</td>
              <td align="right">{l.dcKwp === null ? '—' : `${l.dcKwp.toFixed(2)} kWp`}</td>
              <td align="right">{new Date(l.updatedAt).toLocaleDateString('en-ZA')}</td>
              <td align="right">{canEdit && <>
                <button type="button" onClick={() => void act(duplicateLayoutAction({ projectId, layoutId: l.id, name: `${l.name} (copy)` }))}>Duplicate</button>{' '}
                <button type="button" onClick={() => setRenaming({ id: l.id, name: l.name, updatedAt: l.updatedAt })}>Rename</button>{' '}
                <DeleteButton onConfirm={() => void act(deleteLayoutAction({ projectId, layoutId: l.id }))} />
              </>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && sources.length > 0 && !creating && <button type="button" onClick={() => setCreating(true)}>New layout</button>}
      {creating && (
        <div role="dialog" aria-label="New layout" style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, display: 'grid', gap: 6, fontSize: 13 }}>
          <label>Name <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          {errors.name && <span role="alert" style={{ color: '#dc2626' }}>{errors.name}</span>}
          <label>Roof source <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.label}{s.pixelsPerMeter === null ? ' (no scale yet)' : ''}</option>)}</select></label>
          <fieldset style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}><legend>Module</legend>
            {MODULE_FIELDS.map((f) => (
              <label key={f.key}>{f.label} <input value={String(module[f.key])} onChange={(e) => setModule({ ...module, [f.key]: typeof GENERIC_MODULE_550[f.key] === 'number' ? Number(e.target.value) : e.target.value })} style={{ width: 110 }} /></label>
            ))}
          </fieldset>
          {errors.module && <span role="alert" style={{ color: '#dc2626' }}>{errors.module}</span>}
          <label>Default tilt ° <input value={tilt} onChange={(e) => setTilt(e.target.value)} style={{ width: 60 }} /></label>
          {errors.defaultTiltDeg && <span role="alert" style={{ color: '#dc2626' }}>{errors.defaultTiltDeg}</span>}
          <div><button type="button" onClick={() => void create()}>Create</button> <button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </div>
      )}
      {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
    </div>
  )
}
