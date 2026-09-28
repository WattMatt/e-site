'use client'
/**
 * Bill check (spec §5): one real bill entered by hand vs the engine's model
 * of that month; beyond ±5 % is amber. Deleting a past check is two-step.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EMPTY_BILL_CHECK_FORM, formatRandAmount, type BillCheckForm } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { deleteSolarBillCheckAction, recordSolarBillCheckAction, type BillCheckOutcome } from '@/actions/solar-tariff.actions'
import type { BillCheckRow } from '@/lib/solar/tariff/rows'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

function pct(x: number): string {
  return `${x > 0 ? '+' : ''}${x} %`
}

export function BillCheckPanel({ projectId, isTou, history, canRun }: { projectId: string; isTou: boolean; history: BillCheckRow[]; canRun: boolean }) {
  const router = useRouter()
  const [f, setF] = useState<BillCheckForm>({ ...EMPTY_BILL_CHECK_FORM })
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [result, setResult] = useState<BillCheckOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = (k: keyof BillCheckForm, label: string, placeholder?: string) => (
    <label style={{ display: 'grid', gap: 2 }}>{label}
      <input aria-label={label} value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )
  if (!canRun) return <p style={{ fontSize: 13 }}>Choose a tariff first.</p>
  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        {field('month', 'Billing month', 'YYYY-MM')}
        {isTou ? <>{field('peak', 'Peak kWh')}{field('standard', 'Standard kWh')}{field('offPeak', 'Off-peak kWh')}</> : field('totalKwh', 'Energy (kWh)')}
        {field('maxDemandKva', 'Maximum demand (kVA, optional)')}
        {field('actualTotal', 'Bill total excl. VAT (R)')}
        {field('note', 'Note (optional)')}
      </div>
      {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => <p key={k} role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{v}</p>)}
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
      <div><Button isLoading={busy} onClick={async () => {
        setBusy(true); setErrors({}); setError(null); setResult(null)
        const r = await recordSolarBillCheckAction({ projectId, form: f })
        setBusy(false)
        if ('fieldErrors' in r) setErrors(r.fieldErrors)
        else if ('error' in r) setError(r.error)
        else { setResult(r.result); router.refresh() }
      }}>Check this bill</Button></div>
      {result && (
        <div role="status" style={{ padding: '8px 10px', borderRadius: 6, background: result.warn ? 'var(--c-amber-dim)' : 'var(--c-green-dim)' }}>
          {result.warn && <strong style={{ display: 'block' }}>Model differs from the bill</strong>}
          <span>Modelled {formatRandAmount(result.modelled)} vs actual {formatRandAmount(result.actual)} ({pct(result.differencePct)})</span>
          {result.notModelled.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{result.notModelled.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
      {history.length === 0
        ? <p style={{ margin: 0, color: 'var(--c-text-dim)' }}>No bills checked yet. Enter one above to compare it with the model.</p>
        : (
          <table style={{ borderCollapse: 'collapse' }}>
            <thead><tr><th align="left">Month</th><th align="right">Actual (excl. VAT)</th><th align="right">Modelled (excl. VAT)</th><th align="right">Difference</th><th /></tr></thead>
            <tbody>{history.map((b) => <HistoryRow key={b.id} projectId={projectId} row={b} onError={setError} />)}</tbody>
          </table>
        )}
    </div>
  )
}

function HistoryRow({ projectId, row, onError }: { projectId: string; row: BillCheckRow; onError: (e: string) => void }) {
  const router = useRouter()
  const confirm = useArmedConfirm()
  const [busy, setBusy] = useState(false)
  return (
    <tr>
      <td>{row.month}</td><td align="right">{formatRandAmount(row.actual)}</td><td align="right">{formatRandAmount(row.modelled)}</td>
      <td align="right" style={{ color: Math.abs(row.differencePct) > 5 ? 'var(--c-amber)' : undefined }}>{pct(row.differencePct)}</td>
      <td>
        <Button variant={confirm.armed ? 'danger' : 'ghost'} size="sm" isLoading={busy}
          aria-label={confirm.armed ? `Confirm delete of the ${row.month} check` : `Delete the ${row.month} check`}
          onClick={async () => {
            if (!confirm.armed) return confirm.arm()
            confirm.disarm(); setBusy(true)
            const r = await deleteSolarBillCheckAction({ projectId, id: row.id })
            setBusy(false)
            if ('error' in r) onError(r.error); else router.refresh()
          }}>{confirm.armed ? 'Confirm delete' : 'Delete'}</Button>
      </td>
    </tr>
  )
}
