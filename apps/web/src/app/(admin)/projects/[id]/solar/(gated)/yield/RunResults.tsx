'use client'
/** Results of the stored run (functional spec §7.3). Formatting only — every figure is read from `run.outputs`. */
import { useState } from 'react'
import type { DayType, TouSplit } from '@esite/shared/solar-cases'
import { touHoursLabel } from '@esite/shared'
import type { RunView } from '@/lib/solar/cases/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LineChart } from '@/components/solar/charts/LineChart'
import { WaterfallChart } from '@/components/solar/charts/WaterfallChart'
import { kw, mwh, num, pct, sastDate, sastDateTime } from '@/components/solar/format'
import { AnnualChart } from './AnnualChart'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_LABEL: Record<DayType, string> = { all: 'day', weekday: 'weekday', saturday: 'Saturday', sunday: 'Sunday' }
const CHECK_VARIANT = { pass: 'success', warn: 'warning', fail: 'danger', 'n/a': 'ghost' } as const
const pso = (t: TouSplit) => [t.peak, t.standard, t.offPeak].map((v) => num(v / 1000)).join(' / ')
const th = { textAlign: 'right', padding: '4px 8px', fontWeight: 600, fontSize: 12 } as const
const td = { textAlign: 'right', padding: '4px 8px' } as const

export function RunResults({ projectId, caseId, run }: { projectId: string; caseId: string; run: RunView }) {
  const o = run.outputs, k = o.kpis, p = o.provenance
  const [month, setMonth] = useState(1)
  const [dayType, setDayType] = useState<DayType>('all')
  const day = o.typicalDays.find((d) => d.month === month && d.dayType === dayType)
  const kpis: Array<[string, string]> = [
    ['Specific yield', `${num(k.specificYieldKwhPerKwp, 0)} kWh/kWp`],
    ['Performance ratio', pct(k.performanceRatio)],
    ['Annual PV (AC)', mwh(k.pvAcKwh)],
    ['Self-consumed', mwh(k.selfConsumedKwh)],
    ['Export', mwh(k.exportKwh)],
    ['Curtailed', mwh(k.curtailedKwh)],
    ['Grid import before → after', `${mwh(k.importBeforeKwh)} → ${mwh(k.importAfterKwh)}`],
    ['Solar fraction', pct(k.solarFraction)],
    ['Self-consumption', pct(k.selfConsumption)],
    ['Peak demand before → after', `${kw(k.peakDemandBeforeKw)} → ${kw(k.peakDemandAfterKw)} (${k.peakDemandBasis})`],
  ]
  if (k.batteryKwh !== null) kpis.push(['Battery', `${num(k.batteryKwh)} kWh / ${num(k.batteryKw ?? 0)} kW`])
  const tou = o.monthly.length > 0 && o.monthly.every((m) => m.touImportBefore !== null && m.touImportAfter !== null)
  const base = `/api/projects/${projectId}/solar/cases/${caseId}/runs/${run.id}/export`
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card><CardHeader><span className="data-panel-title">Results</span></CardHeader><CardBody>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, margin: 0 }}>
          {kpis.map(([label, value]) => <div key={label}><dt style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{label}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd></div>)}
        </dl>
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Energy flow — typical day</span></CardHeader><CardBody>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Month</span>
            <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Day type</span>
            <select aria-label="Day type" value={dayType} onChange={(e) => setDayType(e.target.value as DayType)}>
              <option value="all">All days</option><option value="weekday">Weekday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option></select></label>
        </div>
        {day && <LineChart title={`Typical ${DAY_LABEL[dayType]} in ${MONTHS[month - 1]}`} unit="kW" xLabels={Array.from({ length: 24 }, (_, h) => String(h))}
          series={[{ label: 'PV', values: day.pv }, { label: 'Load', values: day.load }, { label: 'Import', values: day.import }, { label: 'Export', values: day.export }, { label: 'Battery (+ discharge)', values: day.batteryNet }]} />}
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Public holidays are not separated from their weekday.</span>
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Annual (8,760 hours)</span></CardHeader><CardBody>
        <AnnualChart projectId={projectId} caseId={caseId} runId={run.id} daily={o.daily} />
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Monthly</span></CardHeader><CardBody>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Month</th><th style={th}>PV (MWh)</th><th style={th}>Load (MWh)</th><th style={th}>Import before (MWh)</th><th style={th}>Import after (MWh)</th><th style={th}>Export (MWh)</th><th style={th}>Max demand before (kW)</th><th style={th}>Max demand after (kW)</th>
              {tou && <><th style={th}>Import before P/S/O (MWh)</th><th style={th}>Import after P/S/O (MWh)</th></>}
            </tr></thead>
            <tbody>{o.monthly.map((m) => (
              <tr key={m.month}>
                <td style={{ ...td, textAlign: 'left' }}>{MONTHS[m.month - 1]!.slice(0, 3)}</td><td style={td}>{num(m.pvKwh / 1000)}</td><td style={td}>{num(m.loadKwh / 1000)}</td><td style={td}>{num(m.importBeforeKwh / 1000)}</td><td style={td}>{num(m.importKwh / 1000)}</td><td style={td}>{num(m.exportKwh / 1000)}</td><td style={td}>{num(m.maxDemandBeforeKw)}</td><td style={td}>{num(m.maxDemandAfterKw)}</td>
                {tou && <><td style={td}>{pso(m.touImportBefore!)}</td><td style={td}>{pso(m.touImportAfter!)}</td></>}
              </tr>))}</tbody>
          </table>
        </div>
        {!tou && <span style={{ fontSize: 12 }}>TOU split needs a pinned tariff (Tariff tab).</span>}
        <div><a href={`${base}?kind=monthly`}>Download monthly CSV</a></div>
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Loss waterfall</span></CardHeader><CardBody>
        <WaterfallChart title="From irradiation to AC output" steps={o.waterfall} />
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Checks</span></CardHeader><CardBody>
        <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 4 }}>{o.checks.map((c) => <li key={c.id}><Badge variant={CHECK_VARIANT[c.status]}>{c.status}</Badge> <strong>{c.label}</strong> — <span>{c.detail}</span></li>)}</ul>
      </CardBody></Card>

      <footer role="contentinfo" style={{ fontSize: 12, color: 'var(--c-text-dim)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <span>{`Engine ${p.engineVersion}`}</span>
        <span>{`${p.weatherSource}${p.weatherFetchedAt ? `, fetched ${sastDate(p.weatherFetchedAt)}` : ''}`}</span>
        <span>{p.tariffRef ? `Tariff ${p.tariffRef.licenseeName} ${p.tariffRef.tariffName} ${p.tariffRef.financialYear}` : 'No tariff pinned'}</span>
        {touHoursLabel(p.tariffRef?.touHours) && <span>{touHoursLabel(p.tariffRef?.touHours)}</span>}
        <span>{`Load ${p.loadBasis} ${p.loadReferenceYear}`}</span>
        <span>{`Inputs ${p.inputsHash.slice(0, 12)}`}</span>
        <span>{`Run by ${run.runByName}`}</span>
        <span>{`Run at ${sastDateTime(run.finishedAt ?? run.startedAt)}`}</span>
      </footer>
    </div>
  )
}
