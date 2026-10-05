import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { CheckResult, TenderBoqDiff, TenderReconciliation } from '@/lib/tender/types'
import { formatRand } from './format'

function Checks({ title, rows }: { title: string; rows: CheckResult[] }) {
  if (rows.length === 0) return null
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr><th style={{ textAlign: 'left' }}>{title}</th><th>Computed</th><th>Stated</th><th>Difference</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td style={{ textAlign: 'right' }}>{formatRand(c.computed)}</td>
              <td style={{ textAlign: 'right' }}>{c.stated == null ? 'not stated' : formatRand(c.stated)}</td>
              <td style={{ textAlign: 'right' }}>{c.differenceCents == null ? '—' : formatRand(c.differenceCents / 100)}</td>
              <td>{c.matched ? <Badge variant="success">match</Badge> : <Badge variant="danger">mismatch</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Report({ label, rec }: { label: string; rec: TenderReconciliation }) {
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 15, display: 'flex', gap: 8, alignItems: 'center' }}>
        {label} {rec.matched ? <Badge variant="success">reconciles to the cent</Badge> : <Badge variant="danger">does not reconcile</Badge>}
      </h3>
      <Checks title="Sheet" rows={rec.sheets} />
      <Checks title="Summary line" rows={[...rec.summaryLines, ...(rec.subtotal ? [rec.subtotal] : [])]} />
      {rec.arithmeticErrors.length > 0 && (
        <div>
          <strong style={{ fontSize: 13 }}>Lines where quantity × rate is not the amount ({rec.arithmeticErrors.length})</strong>
          <ul style={{ fontSize: 13, margin: '4px 0 0' }}>
            {rec.arithmeticErrors.slice(0, 50).map((e) => (
              <li key={`${e.sheet}!${e.rowNumber}`}>
                {e.sheet} row {e.rowNumber} {e.code ?? ''}: {e.quantity} × {e.rate} = {formatRand(e.expected)}, workbook says {formatRand(e.amount)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rec.warnings.length > 0 && (
        <details>
          <summary style={{ fontSize: 13 }}>{rec.warnings.length} note(s)</summary>
          <ul style={{ fontSize: 13 }}>{rec.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </section>
  )
}

export function ReconciliationView({
  source,
  estimate,
  diff,
}: {
  source: TenderReconciliation
  estimate: TenderReconciliation | null
  diff: (TenderBoqDiff & { unmatchedEstimateRows?: number }) | null
}) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Reconciliation</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 20 }}>
          <Report label="Tender BOQ" rec={source} />
          {estimate && <Report label="Internal estimate" rec={estimate} />}
          {diff && (
            <section>
              <h3 style={{ margin: 0, fontSize: 15, display: 'flex', gap: 8, alignItems: 'center' }}>
                Tender vs estimate structure{' '}
                {diff.identical ? <Badge variant="success">identical</Badge> : <Badge variant="danger">differs</Badge>}
              </h3>
              {!diff.identical && (
                <ul style={{ fontSize: 13 }}>
                  {diff.removed.map((r) => <li key={`r${r.sheet}${r.code}`}>Only in the tender: {r.sheet} {r.code} {r.description}</li>)}
                  {diff.added.map((r) => <li key={`a${r.sheet}${r.code}`}>Only in the estimate: {r.sheet} {r.code} {r.description}</li>)}
                  {diff.changed.map((c, i) => (
                    <li key={`c${i}`}>{c.sheet} {c.code}: {c.field} “{String(c.before ?? '')}” in the tender, “{String(c.after ?? '')}” in the estimate</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
