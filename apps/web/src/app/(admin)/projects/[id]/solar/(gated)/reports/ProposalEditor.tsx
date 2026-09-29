'use client'
/** Draft editor (spec §9.3): structured fields, optional AI narrative (D-17), explicit Save (stale-guarded). */
import { useState } from 'react'
import { FINANCE_OPTION_KINDS, FINANCE_OPTION_LABELS, type FinanceOptionKind, type ProposalDraft } from '@esite/shared/solar-reports'
import { Button } from '@/components/ui/Button'
import { draftSolarProposalNarrativeAction, saveSolarProposalDraftAction } from '@/actions/solar-proposals.actions'

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

export function ProposalEditor({ projectId, proposalId, version, initial, updatedAt, narrative, onSaved }: {
  projectId: string; proposalId: string; version: number; initial: ProposalDraft; updatedAt: string
  narrative: { available: boolean; reason: string | null }; onSaved: (updatedAt: string) => void
}) {
  const [d, setD] = useState<ProposalDraft>(initial)
  const [inc, setInc] = useState(initial.inclusions.join('\n'))
  const [exc, setExc] = useState(initial.exclusions.join('\n'))
  const [stamp, setStamp] = useState(updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<null | 'save' | 'ai'>(null)
  const [message, setMessage] = useState<string | null>(null)
  const set = <K extends keyof ProposalDraft>(k: K, v: ProposalDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const field = (k: keyof ProposalDraft, label: string, rows = 3) => (
    <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
      {label}
      <textarea aria-label={label} rows={rows} value={d[k] as string} onChange={(e) => set(k, e.target.value as never)} />
      {errors[k] && <span role="alert" style={{ color: 'var(--c-danger, #b91c1c)' }}>{errors[k]}</span>}
    </label>
  )

  async function save() {
    setBusy('save'); setErrors({}); setMessage(null)
    const draft = { ...d, inclusions: lines(inc), exclusions: lines(exc) }
    const r = await saveSolarProposalDraftAction({ projectId, proposalId, draft, expectedUpdatedAt: stamp })
    setBusy(null)
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    if ('error' in r) { setMessage(r.error); return }
    setStamp(r.updatedAt); setMessage('Draft saved.'); onSaved(r.updatedAt)
  }
  async function ai() {
    setBusy('ai'); setMessage(null)
    const r = await draftSolarProposalNarrativeAction({ projectId, proposalId, expectedUpdatedAt: stamp })
    setBusy(null)
    if ('error' in r) { setMessage(r.error); return }
    set('narrative', r.narrative); setStamp(r.updatedAt); onSaved(r.updatedAt)
    setMessage('Narrative drafted and saved — edit it as you like.')
  }

  return (
    <div style={{ display: 'grid', gap: 8, padding: 8, border: '1px solid var(--c-border)', borderRadius: 6 }}>
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>
        Client name
        <input aria-label="Client name" value={d.clientName} onChange={(e) => set('clientName', e.target.value)} />
        {errors.clientName && <span role="alert" style={{ color: 'var(--c-danger, #b91c1c)' }}>{errors.clientName}</span>}
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}>Margin (%) <input aria-label="Margin (%)" type="number" min={0} max={100} step="0.1" value={d.marginPct} onChange={(e) => set('marginPct', Number(e.target.value))} /></label>
        <label style={{ fontSize: 12 }}>Validity (days) <input aria-label="Validity (days)" type="number" min={1} max={365} value={d.validityDays} onChange={(e) => set('validityDays', Math.trunc(Number(e.target.value)))} /></label>
      </div>
      {d.marginPct === 0 && <p style={{ fontSize: 12, margin: 0 }}>Margin is 0 % — set one here, or a default margin on the org rate card.</p>}
      {(errors.marginPct || errors.validityDays) && <span role="alert" style={{ fontSize: 12, color: 'var(--c-danger, #b91c1c)' }}>{errors.marginPct ?? errors.validityDays}</span>}
      <fieldset style={{ fontSize: 12 }}>
        <legend>Finance options offered</legend>
        {FINANCE_OPTION_KINDS.map((k: FinanceOptionKind) => (
          <label key={k} style={{ marginRight: 12 }}>
            <input type="checkbox" aria-label={FINANCE_OPTION_LABELS[k]} checked={d.financeOptions.includes(k)}
              onChange={(e) => set('financeOptions', e.target.checked ? FINANCE_OPTION_KINDS.filter((x) => x === k || d.financeOptions.includes(x)) : d.financeOptions.filter((x) => x !== k))} />
            {' '}{FINANCE_OPTION_LABELS[k]}
          </label>
        ))}
        <div style={{ color: 'var(--c-text-dim)' }}>Each option’s inputs come from the case’s Financials tab; the client price is the capex plus your margin.</div>
        {errors.financeOptions && <span role="alert" style={{ color: 'var(--c-danger, #b91c1c)' }}>{errors.financeOptions}</span>}
      </fieldset>
      {field('summary', 'Summary')}
      <div style={{ display: 'grid', gap: 4 }}>
        {field('narrative', 'About this proposal (narrative)', 5)}
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={!narrative.available || busy !== null} title={narrative.reason ?? undefined} onClick={ai}>
            {busy === 'ai' ? 'Drafting…' : 'Draft narrative'}
          </Button>
        </div>
      </div>
      {field('scope', 'Scope', 4)}
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Inclusions (one per line)<textarea aria-label="Inclusions (one per line)" rows={3} value={inc} onChange={(e) => setInc(e.target.value)} /></label>
      <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Exclusions (one per line)<textarea aria-label="Exclusions (one per line)" rows={3} value={exc} onChange={(e) => setExc(e.target.value)} /></label>
      {field('priceTerms', 'Price and payment terms')}
      {field('assumptions', 'Assumptions')}
      {field('terms', 'Terms and conditions', 5)}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button type="button" size="sm" disabled={busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`Draft v${version}`}</span>
      </div>
      {message && <p role="status" style={{ fontSize: 12, margin: 0 }}>{message}</p>}
    </div>
  )
}
