'use client'
/** New case (functional spec §7.1): Manual size or a copy of an existing case. From layout arrives with Phase 5. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createSolarCaseAction } from '@/actions/solar-cases.actions'

type Start = 'manual' | 'copy'
const alert = { color: 'var(--c-red, #dc2626)', fontSize: 12 }

export function NewCaseDialog({ projectId, cases, onClose }: { projectId: string; cases: Array<{ id: string; name: string }>; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [start, setStart] = useState<Start>('manual')
  const [dc, setDc] = useState('')
  const [ac, setAc] = useState('')
  const [from, setFrom] = useState(cases[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErrors({}); setError(null)
    const r = await createSolarCaseAction({
      projectId, name,
      start: start === 'copy' ? { kind: 'copy', fromCaseId: from } : { kind: 'manual', dcKwp: Number(dc), acKw: Number(ac) },
    })
    setBusy(false)
    if ('ok' in r) { onClose(); router.push(`/projects/${projectId}/solar/yield?case=${r.caseId}`) }
    else if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else setError(r.error)
  }
  return (
    <div role="dialog" aria-label="New case" style={{ border: '1px solid var(--c-border, #e5e7eb)', borderRadius: 8, padding: 16, display: 'grid', gap: 10 }}>
      <label style={{ display: 'grid', gap: 2 }}>Name <input aria-label="Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      {errors.name && <span role="alert" style={alert}>{errors.name}</span>}
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 6 }}>
        <legend>Start from</legend>
        <label><input type="radio" name="start" aria-label="Manual size" checked={start === 'manual'} onChange={() => setStart('manual')} /> Manual size</label>
        {start === 'manual' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 2 }}>DC size (kWp) <input aria-label="DC size (kWp)" inputMode="decimal" value={dc} onChange={(e) => setDc(e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 2 }}>AC size (kW) <input aria-label="AC size (kW)" inputMode="decimal" value={ac} onChange={(e) => setAc(e.target.value)} /></label>
          </div>
        )}
        {errors.dcKwp && <span role="alert" style={alert}>{errors.dcKwp}</span>}
        {errors.acKw && <span role="alert" style={alert}>{errors.acKw}</span>}
        <label><input type="radio" name="start" aria-label="Copy of case" disabled={cases.length === 0} checked={start === 'copy'} onChange={() => setStart('copy')} /> Copy of case</label>
        {start === 'copy' && (
          <select aria-label="Case to copy" value={from} onChange={(e) => setFrom(e.target.value)}>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <label><input type="radio" name="start" aria-label="From layout" disabled /> From layout <span style={{ color: 'var(--c-text-dim)' }}>Arrives with the Layout tab</span></label>
      </fieldset>
      {error && <span role="alert" style={alert}>{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create case'}</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}
