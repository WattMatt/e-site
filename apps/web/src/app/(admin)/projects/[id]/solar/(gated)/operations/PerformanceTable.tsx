/** Monthly performance (spec §10): one row per month from the shared calculation; the month link selects it. */
import Link from 'next/link'
import { monthLabel } from '@esite/shared/solar-operations/client'
import type { PerformanceRow } from '@esite/shared/solar-operations'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { kwh, pctSigned } from '@/components/solar/ops-format'

interface Props { projectId: string; rows: PerformanceRow[]; selectedMonth: string | null; note?: string | null }

export function PerformanceTable({ projectId, rows, selectedMonth, note = null }: Props) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Monthly performance</span></CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>{note ?? 'Set the commissioning date and import generation data to see monthly performance.'}</p>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Month</th><th align="right">Expected kWh</th><th align="right">Excluded kWh</th><th align="right">Guarantee kWh</th>
                <th align="right">Actual kWh</th><th align="right">Variance</th><th align="right">PR</th><th align="right">Irradiation-corrected kWh</th>
                <th align="right">Downtime h</th><th align="right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} aria-label={monthLabel(r.month)} style={r.month === selectedMonth ? { background: 'var(--c-panel)' } : undefined}>
                  <td><Link href={`/projects/${projectId}/solar/operations?month=${r.month}`}>{monthLabel(r.month)}</Link></td>
                  <td align="right">{kwh(r.expectedKwh)}</td>
                  <td align="right">{kwh(r.excludedKwh)}</td>
                  <td align="right">{kwh(r.guaranteeKwh)}</td>
                  <td align="right">{r.actualKwh === null ? 'no data' : kwh(r.actualKwh)}</td>
                  <td align="right">{pctSigned(r.variancePct)}</td>
                  <td align="right">{r.performanceRatio === null ? '—' : r.performanceRatio.toFixed(2)}</td>
                  <td align="right">{kwh(r.correctedExpectedKwh)}</td>
                  <td align="right">{`${r.downtimeHours.toFixed(1)}${r.excludedHours > 0 ? ` (${r.excludedHours.toFixed(1)} excl.)` : ''}`}</td>
                  <td align="right">{r.coveragePct === null ? '—' : `${r.coveragePct.toFixed(1)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  )
}
