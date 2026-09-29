'use client'
/**
 * Export / SSEG rule (spec §5; NERSA Net-Billing Rules). Eskom: the linked
 * Gen-offset tariff. Municipal: No export credit (R0) by default, or a
 * manual rate with a mandatory source note (stored in the money table
 * solar.study_export_rates, index D2b-2). The applicable crediting rules are
 * shown from the library's SSEG rule, else the Rules default (flagged).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  EXPORT_METHOD_LABELS, SEASON_LABELS, TOU_LABELS, exportMethodsFor, formatChargeAmount, validateExportRuleForm,
  type ExportMethod, type ExportRateRow, type ExportRule, type ExportRuleForm, type SsegRule, type TariffSeason, type TouOrAll,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSolarExportRuleAction } from '@/actions/solar-tariff.actions'
import type { PinnedCharge } from '@/lib/solar/tariff/rows'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
type RateForm = ExportRuleForm['rates'][number]
const NEW_RATE: RateForm = { season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '' }

function ssegLines(s: SsegRule): string[] {
  return [
    s.crediting === 'net_billing_tou' ? 'Net billing, credited per TOU period' : s.crediting === 'net_billing_flat' ? 'Net billing at a flat export rate' : 'No export crediting',
    'Settled monthly',
    s.carryForward === 'within_financial_year' ? `Carry forward to the end of the financial year (${MONTHS[s.fyEndMonth - 1]})` : 'No carry forward',
    s.capRule === 'kwh_per_tou_period' ? 'Credited kWh capped at the import kWh of the same TOU period' : s.capRule === 'value_per_tou_period' ? 'Credit capped at the energy value of each TOU period' : 'Credit capped at the energy charges',
    'Offsets energy charges only (no cash)',
    `Requires ${[s.requiresBidirectionalMeter ? 'a bidirectional' : null, s.requiresTou ? 'TOU' : null].filter(Boolean).join(' ') || 'a'} meter; generator up to ${s.maxKva} kVA`,
  ]
}

export function ExportRulePanel({ projectId, updatedAt, rule, rates, sourceNote, linkedExportTariff, sseg, ssegFromLibrary }: {
  projectId: string
  updatedAt: string
  rule: ExportRule | null
  rates: ExportRateRow[]
  sourceNote: string | null
  linkedExportTariff: { name: string; charges: PinnedCharge[] } | null
  sseg: SsegRule
  ssegFromLibrary: boolean
}) {
  const router = useRouter()
  const hasLinked = linkedExportTariff !== null
  const methods = exportMethodsFor(hasLinked)
  const initialMethod: ExportMethod = rule?.method && methods.includes(rule.method) ? rule.method : hasLinked ? 'linked_tariff' : 'none'
  const [method, setMethod] = useState<ExportMethod>(initialMethod)
  const [note, setNote] = useState(rule?.sourceNote ?? sourceNote ?? '')
  const [rows, setRows] = useState<RateForm[]>(rates.length ? rates.map((r) => ({ season: r.season, tou: r.tou, unit: r.unit, amount: String(r.amountExclVat) })) : [{ ...NEW_RATE }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const dropRates = useArmedConfirm()
  const drops = method !== 'manual' ? rates.length : 0
  const setRow = (i: number, p: Partial<RateForm>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      {rule?.method === 'linked_tariff' && !hasLinked && (
        <p role="note" style={{ margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>
          The saved rule credits exports at a linked export tariff, but the pinned tariff has none. Choose another method and save.
        </p>
      )}
      {!rule && <p role="note" style={{ margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>No export rule saved yet: the Tariff step stays incomplete until you save one.</p>}
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 4 }}>
        <legend>How exported energy is credited</legend>
        {methods.map((m) => (
          <label key={m}><input type="radio" name="export-method" aria-label={EXPORT_METHOD_LABELS[m]} checked={method === m} onChange={() => setMethod(m)} /> {EXPORT_METHOD_LABELS[m]}</label>
        ))}
      </fieldset>
      {method === 'linked_tariff' && linkedExportTariff && (
        <div>
          <strong>{linkedExportTariff.name}</strong>
          <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{linkedExportTariff.charges.filter((c) => c.component === 'export_credit' || c.component === 'energy').map((c) => (
            <li key={c.id}>{SEASON_LABELS[c.season as TariffSeason] ?? c.season} {TOU_LABELS[c.tou as TouOrAll] ?? c.tou}: {formatChargeAmount(c.amount, c.unit)}</li>
          ))}</ul>
        </div>
      )}
      {method === 'manual' && (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select aria-label={`Rate ${i + 1} season`} value={r.season} onChange={(e) => setRow(i, { season: e.target.value as RateForm['season'] })}>
                <option value="all">All year</option><option value="high">High demand (winter)</option><option value="low">Low demand (summer)</option>
              </select>
              <select aria-label={`Rate ${i + 1} period`} value={r.tou} onChange={(e) => setRow(i, { tou: e.target.value as RateForm['tou'] })}>
                <option value="all">All hours</option><option value="peak">Peak</option><option value="standard">Standard</option><option value="off_peak">Off-peak</option>
              </select>
              <input aria-label={`Rate ${i + 1} amount`} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ width: 90 }} />
              <select aria-label={`Rate ${i + 1} unit`} value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value as RateForm['unit'] })}>
                <option value="c_per_kWh">c/kWh</option><option value="R_per_kWh">R/kWh</option>
              </select>
              {rows.length > 1 && <button type="button" aria-label={`Remove rate ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>}
              {errors[`rates.${i}`] && <span role="alert" style={{ color: 'var(--c-red)' }}>{errors[`rates.${i}`]}</span>}
            </div>
          ))}
          <div><Button variant="secondary" size="sm" onClick={() => setRows([...rows, { ...NEW_RATE }])}>Add a rate</Button></div>
          <label>Source of the rate<textarea aria-label="Source of the rate" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="e.g. City of Tshwane SSEG schedule 2026/27 p4" style={{ width: '100%' }} /></label>
          {errors.sourceNote && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.sourceNote}</p>}
          {errors.rates && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.rates}</p>}
        </div>
      )}
      {errors.method && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.method}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={async () => {
          setMsg(null)
          const form: ExportRuleForm = { method, sourceNote: note, rates: method === 'manual' ? rows : [] }
          const check = validateExportRuleForm(form, hasLinked)
          if ('errors' in check) return setErrors(check.errors)
          setErrors({})
          // Leaving a manual rate drops the saved rates (00213 save_export_rule replaces them).
          if (drops > 0 && !dropRates.armed) return dropRates.arm()
          dropRates.disarm()
          setBusy(true)
          const r = await saveSolarExportRuleAction({ projectId, expectedUpdatedAt: updatedAt, form })
          setBusy(false)
          if ('fieldErrors' in r) setErrors(r.fieldErrors)
          else if ('error' in r) setMsg(r.error)
          else { setMsg('Saved.'); router.refresh() }
        }}>{dropRates.armed ? `Confirm save (drops ${drops} saved rate${drops === 1 ? '' : 's'})` : 'Save export rule'}</Button>
        {msg && <span role="status">{msg}</span>}
      </div>
      <div>
        <strong>Crediting rules that apply</strong>
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{ssegLines(sseg).map((l) => <li key={l}>{l}</li>)}</ul>
        {!ssegFromLibrary && <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>NERSA Net-Billing Rules default: no licensee-specific rule in the library (Rules approved 17 Dec 2024, pp7-12).</p>}
      </div>
    </div>
  )
}
