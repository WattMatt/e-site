'use client'
/** Compare 2–4 cases (functional spec §7.1): every stored KPI + a monthly energy chart; rand rows only for cost-view. */
import type { CompareColumn } from '@/lib/solar/cases/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { BarChart } from '@/components/solar/charts/BarChart'
import { kw, mwh, num, pct, rand, years } from '@/components/solar/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NO_FIN = 'Run financials first'
type Row = [string, (c: CompareColumn) => string]
const ENERGY: Row[] = [
  ['PV size', (c) => `${num(c.kpis.dcKwp)} kWp / ${num(c.kpis.acKw)} kW`],
  ['Battery', (c) => (c.kpis.batteryKwh === null ? '—' : `${num(c.kpis.batteryKwh)} kWh / ${num(c.kpis.batteryKw ?? 0)} kW`)],
  ['Specific yield', (c) => `${num(c.kpis.specificYieldKwhPerKwp, 0)} kWh/kWp`],
  ['Performance ratio', (c) => pct(c.kpis.performanceRatio)],
  ['Annual PV (AC)', (c) => mwh(c.kpis.pvAcKwh)],
  ['Self-consumed', (c) => mwh(c.kpis.selfConsumedKwh)],
  ['Export', (c) => mwh(c.kpis.exportKwh)],
  ['Curtailed', (c) => mwh(c.kpis.curtailedKwh)],
  ['Grid import after', (c) => mwh(c.kpis.importAfterKwh)],
  ['Solar fraction', (c) => pct(c.kpis.solarFraction)],
  ['Self-consumption', (c) => pct(c.kpis.selfConsumption)],
  ['Peak demand after', (c) => kw(c.kpis.peakDemandAfterKw)],
]
const MONEY: Row[] = [
  ['Year-1 saving', (c) => (c.money ? rand(c.money.year1SavingZar) : NO_FIN)],
  ['IRR', (c) => (c.money ? (c.money.irr === null ? 'n/a' : pct(c.money.irr)) : NO_FIN)],
  ['NPV', (c) => (c.money ? rand(c.money.npvZar) : NO_FIN)],
  ['Simple payback', (c) => (c.money ? years(c.money.simplePaybackYears) : NO_FIN)],
]
const cell = { textAlign: 'right', padding: '4px 8px' } as const

export function CompareView({ columns, showMoney }: { columns: CompareColumn[]; showMoney: boolean }) {
  const rows = showMoney ? [...ENERGY, ...MONEY] : ENERGY
  return (
    <Card><CardHeader><span className="data-panel-title">Compare cases</span></CardHeader><CardBody>
      {columns.length < 2
        ? <span>Only cases with a completed run can be compared — run at least two.</span>
        : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><th scope="col" style={{ ...cell, textAlign: 'left' }}>KPI</th>{columns.map((c) => <th key={c.caseId} scope="col" style={cell}>{c.name}</th>)}</tr></thead>
                <tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>{label}</th>{columns.map((c) => <td key={c.caseId} style={cell}>{f(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <BarChart title="Monthly PV energy by case" unit="MWh" seriesLabels={columns.map((c) => c.name)}
              groups={MONTHS.map((m, i) => ({ label: m, values: columns.map((c) => (c.monthlyPvKwh[i] ?? 0) / 1000) }))} />
          </div>
        )}
    </CardBody></Card>
  )
}
