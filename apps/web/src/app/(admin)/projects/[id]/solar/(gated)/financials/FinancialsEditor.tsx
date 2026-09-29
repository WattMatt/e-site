'use client'
/**
 * Financials inputs (functional spec §8). Money inputs only; the server validates, computes and stores.
 * The totals shown here are sums of the INPUT capex lines (not a result) — the stored result is on
 * FinancialResults.
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaseFinanceConfig, CapexLine } from '@esite/shared/solar-cases'
import { Button } from '@/components/ui/Button'
import { saveSolarFinancialsAction, applySolarRateCardAction, runSolarFinancialsAction, importLayoutBomAction } from '@/actions/solar-financials.actions'
import type { FinancialsPageData } from '@/lib/solar/cases/financials-page-data'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import { num, rand } from '@/components/solar/format'
import { Check, NumField, Section } from '../yield/editor-fields'

const CATEGORIES: Array<[CapexLine['category'], string]> = [
  ['modules', 'Modules'], ['inverters', 'Inverters'], ['mounting', 'Mounting'], ['dc_bos', 'DC BOS'], ['ac_bos', 'AC BOS'], ['battery', 'Battery'],
  ['grid_connection', 'Grid connection / protection'], ['civils', 'Civils'], ['labour', 'Labour'], ['design_fees', 'Design & professional fees'],
  ['project_management', 'Project management'], ['contingency', 'Contingency'], ['margin', 'Margin'],
]
const UNITS: CapexLine['unit'][] = ['Wp', 'kWp', 'kW', 'kWh', 'item', 'lot', 'm']
const SAVE_FIRST = 'Save the financials first.'

export function FinancialsEditor({ projectId, data }: { projectId: string; data: FinancialsPageData }) {
  const router = useRouter()
  const [cfg, setCfg] = useState<CaseFinanceConfig>(data.config)
  const [saved, setSaved] = useState<CaseFinanceConfig | null>(data.isDefault ? null : data.config)
  const [updatedAt, setUpdatedAt] = useState<string | null>(data.configUpdatedAt)
  const [busy, setBusy] = useState<'save' | 'apply' | 'run' | 'bom' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = useMemo(() => saved === null || JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved])
  useSolarDirtyGuard(saved !== null && dirty)
  const setGroup = <K extends 'opex' | 'analysis' | 'loadShedding'>(k: K, patch: Partial<CaseFinanceConfig[K]>) => setCfg((c) => ({ ...c, [k]: { ...c[k], ...patch } }))
  const setModel = <K extends keyof CaseFinanceConfig['models']>(k: K, patch: Partial<CaseFinanceConfig['models'][K]>) => setCfg((c) => ({ ...c, models: { ...c.models, [k]: { ...c.models[k], ...patch } } }))
  // Editing a line makes it the user's ('manual'), except pricing a BOM line: the BOM carries
  // quantities only, so a rate typed on it keeps it a BOM line (and survives a re-import).
  const setLine = (i: number, patch: Partial<CapexLine>) => setCfg((c) => ({ ...c, capex: c.capex.map((l, j) => (j === i
    ? { ...l, ...patch, source: l.source === 'layout_bom' && Object.keys(patch).every((k) => k === 'rateZar' || k === 'qualifies12b') ? 'layout_bom' : 'manual' }
    : l)) }))
  const nn = (v: number | null) => (v === null ? Number.NaN : v)
  // Field errors are keyed by dotted zod path; any error no rendered field claims is listed under the form.
  const claimed = new Set<string>()
  const err = (path: string) => { claimed.add(path); return errors[path] }

  const excl = cfg.capex.reduce((a, l) => a + l.qty * l.rateZar, 0)
  const wp = data.runSize ? data.runSize.dcKwp * 1000 : 0

  const save = async () => {
    setBusy('save'); setMsg(null); setErrors({})
    const r = await saveSolarFinancialsAction({ projectId, caseId: data.caseId!, config: cfg, expectedUpdatedAt: updatedAt })
    setBusy(null)
    if ('ok' in r) { setSaved(cfg); setUpdatedAt(r.updatedAt); setMsg('Saved.'); router.refresh() }
    else if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else setMsg(r.error)
  }
  const apply = async () => {
    setBusy('apply'); setMsg(null); setErrors({})
    const r = await applySolarRateCardAction({ projectId, caseId: data.caseId!, config: cfg })
    setBusy(null)
    if ('ok' in r) setCfg(r.config); else if ('fieldErrors' in r) setErrors(r.fieldErrors); else setMsg(r.error)
  }
  const importBom = async () => {
    setBusy('bom'); setMsg(null); setErrors({})
    const r = await importLayoutBomAction({ projectId, caseId: data.caseId!, config: cfg })
    setBusy(null)
    if ('ok' in r) setCfg(r.config); else if ('fieldErrors' in r) setErrors(r.fieldErrors); else setMsg(r.error)
  }
  const run = async () => {
    setBusy('run'); setMsg(null)
    const r = await runSolarFinancialsAction({ projectId, caseId: data.caseId! })
    setBusy(null)
    if ('ok' in r) router.refresh(); else setMsg(r.error)
  }
  const reasons = [...data.runReasons.filter((r) => !(r === SAVE_FIRST && !dirty)), ...(data.tariffReason ? [data.tariffReason] : [])]
  const runTitle = reasons[0] ?? (dirty ? SAVE_FIRST : undefined)
  const m = cfg.models, o = cfg.opex, a = cfg.analysis

  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 12 }}>
      <label>Case <select aria-label="Case" value={data.caseId ?? ''} onChange={(e) => router.push(`/projects/${projectId}/solar/financials?case=${e.target.value}`)}>
        {data.cases.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hasRun ? '' : ' (not run)'}</option>)}
      </select></label>
      {data.isDefault && <span>Using org defaults — review, then Save.</span>}

      <Section title="Capex">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" size="sm" variant="secondary" onClick={() => setCfg((c) => ({ ...c, capex: [...c.capex, { id: `l${Date.now().toString(36)}${c.capex.length}`, category: 'modules', description: '', qty: 0, unit: 'item', rateZar: 0, qualifies12b: true, source: 'manual' }] }))}>Add line</Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy !== null || !data.caseId} onClick={apply}>{busy === 'apply' ? 'Applying…' : 'Apply org rate card'}</Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy !== null || !data.caseId || !data.caseFromLayout}
            title={data.caseFromLayout ? undefined : 'This case is not built from a layout — choose From layout on Yield & Scenarios'} onClick={importBom}>{busy === 'bom' ? 'Importing…' : 'Import BOM from layout'}</Button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th scope="col">Category</th><th scope="col">Description</th><th scope="col">Qty</th><th scope="col">Unit</th><th scope="col">Rate (R)</th><th scope="col">Amount (R)</th><th scope="col">12B</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{cfg.capex.map((l, i) => (
              <tr key={l.id}>
                <td><select aria-label="Category" value={l.category} onChange={(e) => setLine(i, { category: e.target.value as CapexLine['category'] })}>{CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
                <td><input aria-label="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><input aria-label="Quantity" type="number" step="any" value={Number.isNaN(l.qty) ? '' : l.qty} onChange={(e) => setLine(i, { qty: e.target.value === '' ? Number.NaN : Number(e.target.value) })} /></td>
                <td><select aria-label="Unit" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as CapexLine['unit'] })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></td>
                <td><input aria-label="Rate (R)" type="number" step="any" value={Number.isNaN(l.rateZar) ? '' : l.rateZar} onChange={(e) => setLine(i, { rateZar: e.target.value === '' ? Number.NaN : Number(e.target.value) })} /></td>
                <td>{Number.isFinite(l.qty * l.rateZar) ? num(l.qty * l.rateZar, 0) : '—'}</td>
                <td><input type="checkbox" aria-label="Qualifies for 12B" checked={l.qualifies12b} onChange={(e) => setLine(i, { qualifies12b: e.target.checked })} /></td>
                <td><Button type="button" size="sm" variant="secondary" onClick={() => setCfg((c) => ({ ...c, capex: c.capex.filter((_, j) => j !== i) }))}>Delete line</Button></td>
              </tr>))}</tbody>
          </table>
        </div>
        {Number.isFinite(excl) && <>
          <span>{`Total excl. VAT ${rand(excl)}`}</span>
          <span>{`VAT (${num(data.vatRate * 100, 0)} %) ${rand(excl * data.vatRate)}`}</span>
          <span>{`Total incl. VAT ${rand(excl * (1 + data.vatRate))}`}</span>
          {wp > 0 && <span>{`R ${num(excl / wp, 2)}/Wp (capex ÷ DC Wp)`}</span>}
        </>}
      </Section>

      <Section title="Opex">
        <label>O&amp;M basis <select aria-label="O&M basis" value={o.omMode} onChange={(e) => setGroup('opex', { omMode: e.target.value as 'per_kwp' | 'pct_capex' })}><option value="per_kwp">R/kWp/yr</option><option value="pct_capex">% of capex per year</option></select></label>
        {o.omMode === 'per_kwp'
          ? <NumField label="O&M" unit="R/kWp/yr" value={o.omZarPerKwpYear} error={err('opex.omZarPerKwpYear')} onChange={(v) => setGroup('opex', { omZarPerKwpYear: nn(v) })} />
          : <NumField label="O&M" unit="% of capex/yr" value={o.omPctOfCapex} error={err('opex.omPctOfCapex')} onChange={(v) => setGroup('opex', { omPctOfCapex: nn(v) })} />}
        <NumField label="Insurance, per year" unit="% of capex" value={o.insurancePctOfCapex} error={err('opex.insurancePctOfCapex')} onChange={(v) => setGroup('opex', { insurancePctOfCapex: nn(v) })} />
        <NumField label="Monitoring / data" unit="R/yr" value={o.monitoringZarPerYear} error={err('opex.monitoringZarPerYear')} onChange={(v) => setGroup('opex', { monitoringZarPerYear: nn(v) })} />
        <NumField label="Inverter replacement year" unit="year" value={o.inverterReplacementYear} error={err('opex.inverterReplacementYear')} onChange={(v) => setGroup('opex', { inverterReplacementYear: v })} />
        <NumField label="Inverter replacement" unit="% of inverter cost" value={o.inverterReplacementPct} error={err('opex.inverterReplacementPct')} onChange={(v) => setGroup('opex', { inverterReplacementPct: nn(v) })} />
        <NumField label="Battery replacement year" unit="year" value={o.batteryReplacementYear} error={err('opex.batteryReplacementYear')} onChange={(v) => setGroup('opex', { batteryReplacementYear: v })} />
        <NumField label="Battery replacement" unit="% of battery cost" value={o.batteryReplacementPct} error={err('opex.batteryReplacementPct')} onChange={(v) => setGroup('opex', { batteryReplacementPct: nn(v) })} />
        <span>{`Opex escalates with CPI (${num(a.cpiPct, 0)} %/yr)`}</span>
      </Section>

      <Section title="Finance models">
        <Check label="Cash purchase" checked={m.cash.enabled} onChange={(v) => setModel('cash', { enabled: v })} />
        <Check label="Debt-financed" checked={m.debt.enabled} onChange={(v) => setModel('debt', { enabled: v })} />
        {m.debt.enabled && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NumField label="Loan share" unit="%" value={m.debt.loanPct} error={err('models.debt.loanPct')} onChange={(v) => setModel('debt', { loanPct: nn(v) })} />
          <NumField label="Interest rate" unit="%" value={m.debt.ratePct} error={err('models.debt.ratePct')} onChange={(v) => setModel('debt', { ratePct: nn(v) })} />
          <NumField label="Term" unit="years" value={m.debt.termYears} error={err('models.debt.termYears')} onChange={(v) => setModel('debt', { termYears: nn(v) })} />
          <NumField label="Grace" unit="months" value={m.debt.graceMonths} error={err('models.debt.graceMonths')} onChange={(v) => setModel('debt', { graceMonths: nn(v) })} />
        </div>}
        <Check label="PPA" checked={m.ppa.enabled} onChange={(v) => setModel('ppa', { enabled: v })} />
        {m.ppa.enabled && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NumField label="Starting tariff" unit="R/kWh" value={m.ppa.startTariffZarPerKwh} error={err('models.ppa.startTariffZarPerKwh')} onChange={(v) => setModel('ppa', { startTariffZarPerKwh: nn(v) })} />
          <NumField label="PPA escalation" unit="%/yr" value={m.ppa.escalationPct} error={err('models.ppa.escalationPct')} onChange={(v) => setModel('ppa', { escalationPct: nn(v) })} />
          <NumField label="PPA term" unit="years" value={m.ppa.termYears} error={err('models.ppa.termYears')} onChange={(v) => setModel('ppa', { termYears: nn(v) })} />
          <NumField label="Buy-out year" unit="year" value={m.ppa.buyoutYear} error={err('models.ppa.buyoutYear')} onChange={(v) => setModel('ppa', { buyoutYear: v })} />
          <NumField label="Buy-out price" unit="R" value={m.ppa.buyoutPriceZar} error={err('models.ppa.buyoutPriceZar')} onChange={(v) => setModel('ppa', { buyoutPriceZar: v })} />
        </div>}
        <Check label="Lease / rent-to-own" checked={m.lease.enabled} onChange={(v) => setModel('lease', { enabled: v })} />
        {m.lease.enabled && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <NumField label="Monthly payment" unit="R" value={m.lease.monthlyPaymentZar} error={err('models.lease.monthlyPaymentZar')} onChange={(v) => setModel('lease', { monthlyPaymentZar: nn(v) })} />
          <NumField label="Lease escalation" unit="%/yr" value={m.lease.escalationPct} error={err('models.lease.escalationPct')} onChange={(v) => setModel('lease', { escalationPct: nn(v) })} />
          <NumField label="Lease term" unit="years" value={m.lease.termYears} error={err('models.lease.termYears')} onChange={(v) => setModel('lease', { termYears: nn(v) })} />
          <NumField label="Residual / transfer value" unit="R" value={m.lease.residualZar} error={err('models.lease.residualZar')} onChange={(v) => setModel('lease', { residualZar: nn(v) })} />
        </div>}
        {err('models') && <span role="alert">{errors.models}</span>}
      </Section>

      <Section title="Analysis settings">
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <NumField label="Analysis period" unit="years" value={a.years} error={err('analysis.years')} onChange={(v) => setGroup('analysis', { years: nn(v) })} />
          <NumField label="Discount rate" unit="%" value={a.discountRatePct} error={err('analysis.discountRatePct')} onChange={(v) => setGroup('analysis', { discountRatePct: nn(v) })} />
          <NumField label="CPI" unit="%" value={a.cpiPct} error={err('analysis.cpiPct')} onChange={(v) => setGroup('analysis', { cpiPct: nn(v) })} />
          <NumField label="Tariff escalation, year 1" unit="%" value={a.escalationStartPct} error={err('analysis.escalationStartPct')} onChange={(v) => setGroup('analysis', { escalationStartPct: nn(v) })} />
          <NumField label="Tariff escalation, year 10" unit="%" value={a.escalationYear10Pct} error={err('analysis.escalationYear10Pct')} onChange={(v) => setGroup('analysis', { escalationYear10Pct: nn(v) })} />
          <NumField label="Tariff escalation after year 10 (CPI plus)" unit="%" value={a.escalationAfterCpiPlusPct} error={err('analysis.escalationAfterCpiPlusPct')} onChange={(v) => setGroup('analysis', { escalationAfterCpiPlusPct: nn(v) })} />
          <NumField label="Load growth" unit="%/yr" value={a.loadGrowthPct} error={err('analysis.loadGrowthPct')} onChange={(v) => setGroup('analysis', { loadGrowthPct: nn(v) })} />
        </div>
        <Check label="Apply company tax" checked={a.taxEnabled} onChange={(v) => setGroup('analysis', { taxEnabled: v, section12b: v ? a.section12b : false })} />
        <NumField label="Company tax rate" unit="%" value={a.companyTaxRatePct} disabled={!a.taxEnabled} error={err('analysis.companyTaxRatePct')} onChange={(v) => setGroup('analysis', { companyTaxRatePct: nn(v) })} />
        <Check label="Section 12B accelerated allowance" checked={a.section12b} disabled={!a.taxEnabled} onChange={(v) => setGroup('analysis', { section12b: v })} />
        <span style={{ fontSize: 12 }}>Escalation beyond the published tariff years; the published approved increases arrive with the Tariff tab.</span>
      </Section>

      {data.caseLoadSheddingEnabled && (
        <Section title="Load-shedding value">
          <NumField label="Value of load-shedding avoided" unit="R/kWh" value={cfg.loadShedding.valueZarPerKwh} error={err('loadShedding.valueZarPerKwh')} onChange={(v) => setGroup('loadShedding', { valueZarPerKwh: v })} />
          <span style={{ fontSize: 12 }}>Reported as a separate line, never in the IRR (D-14).</span>
        </Section>
      )}

      {Object.entries(errors).filter(([k]) => !claimed.has(k)).map(([k, v]) => <span key={k} role="alert">{`${k}: ${v}`}</span>)}
      {reasons.length > 0 && <ul aria-label="Before financials can run">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {msg && <span role={msg === 'Saved.' ? 'status' : 'alert'}>{msg}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" disabled={busy !== null || !data.caseId || (!dirty && !data.isDefault)} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save financials'}</Button>
        <Button type="button" title={runTitle} disabled={busy !== null || !data.caseId || dirty || reasons.length > 0} onClick={run}>{busy === 'run' ? 'Computing…' : 'Run financials'}</Button>
      </div>
    </form>
  )
}
