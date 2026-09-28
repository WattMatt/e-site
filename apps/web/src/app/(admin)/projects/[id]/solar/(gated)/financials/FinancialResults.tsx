'use client'
/** Stored financial results (functional spec §8 Results + Sensitivity). Formatting only — every figure comes from the stored row. */
import { useState } from 'react'
import type { FinancialResultsView } from '@/lib/solar/cases/financials-page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { CashflowChart } from '@/components/solar/charts/CashflowChart'
import { TornadoChart } from '@/components/solar/charts/TornadoChart'
import { num, pct, rand, sastDateTime, years } from '@/components/solar/format'

type Column = FinancialResultsView['columns'][number]

export function FinancialResults({ projectId, caseId, view }: { projectId: string; caseId: string; view: FinancialResultsView }) {
  const [key, setKey] = useState(view.columns[0]?.key ?? '')
  const col = view.columns.find((c) => c.key === key) ?? view.columns[0]
  const rows: Array<[string, (c: Column) => string]> = [
    ['Capex (excl. VAT)', () => rand(view.capex.exclVatZar)],
    ['Upfront (this party)', (c) => rand(c.upfrontZar)],
    ['Year-1 saving', () => rand(view.year1.savingZar)],
    ['Simple payback', (c) => years(c.simplePaybackYears)],
    ['Discounted payback', (c) => years(c.discountedPaybackYears)],
    ['IRR', (c) => (c.irr === null ? 'n/a' : pct(c.irr))],
    ['NPV', (c) => rand(c.npvZar)],
    ['LCOE', () => (view.lcoeZarPerKwh === null ? 'n/a' : `R ${num(view.lcoeZarPerKwh, 2)}/kWh`)],
    ['Cumulative saving', (c) => rand(c.cumulativeZar)],
  ]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card><CardHeader><span className="data-panel-title">Results</span></CardHeader><CardBody>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th scope="col">KPI</th>{view.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
            <tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row">{label}</th>{view.columns.map((c) => <td key={c.key}>{f(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p style={{ fontSize: 12 }}>{`Year-1 bill ${rand(view.year1.billBeforeZar)} → ${rand(view.year1.billAfterZar)} (excl. VAT); export credit used ${rand(view.year1.exportCreditUsedZar)}.`}</p>
        {view.loadShedding && <p>{`Load-shedding value (separate, not in IRR): ${rand(view.loadShedding.year1Zar)} in year 1, NPV ${rand(view.loadShedding.npvZar)}`}</p>}
        <a href={`/api/projects/${projectId}/solar/cases/${caseId}/financials/xlsx`}>Download XLSX</a>
      </CardBody></Card>

      {col && (
        <Card><CardHeader><span className="data-panel-title">Cashflow</span></CardHeader><CardBody>
          <label>Cashflow for <select aria-label="Cashflow for" value={col.key} onChange={(e) => setKey(e.target.value)}>{view.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <CashflowChart title={`Cashflow — ${col.label}`} rows={col.rows.map((r) => ({ year: r.year, netZar: r.netZar, cumulativeZar: r.cumulativeZar }))} />
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{['Year', 'Energy (kWh)', 'Energy saving (R)', 'Opex (R)', 'Replacements (R)', 'Finance (R)', 'Tax (R)', 'Net (R)', 'Cumulative (R)'].map((t) => <th key={t} scope="col">{t}</th>)}</tr></thead>
              <tbody>{col.rows.map((r) => <tr key={r.year}><td>{r.year}</td><td>{num(r.energyKwh, 0)}</td><td>{num(r.savingZar, 0)}</td><td>{num(r.opexZar, 0)}</td><td>{num(r.replacementZar, 0)}</td><td>{num(r.financeZar, 0)}</td><td>{num(r.taxZar, 0)}</td><td>{num(r.netZar, 0)}</td><td>{num(r.cumulativeZar, 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </CardBody></Card>
      )}

      <Card><CardHeader><span className="data-panel-title">Sensitivity</span></CardHeader><CardBody>
        <TornadoChart title={view.tornado.title} baseNpvZar={view.tornado.baseNpvZar} bars={view.tornado.bars} />
      </CardBody></Card>
      <footer style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{`Computed ${sastDateTime(view.computedAt)} · engine ${view.engineVersion} · tariff ${view.tariffLabel}`}</footer>
    </div>
  )
}
