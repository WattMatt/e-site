'use client'
/**
 * Review queue (spec §12): each charge beside its source (PDF page crop or
 * workbook cell); Approve / Edit / Reject; the automatic checks inline.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  COMPONENT_LABELS, SEASON_LABELS, TARIFF_UNITS, TOU_LABELS, UNIT_LABELS, formatChargeAmount,
  type TariffSeason, type TariffUnit, type TouOrAll,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { SourceViewer } from '@/components/tariffs/SourceViewer'
import { approveChargeAction, deleteTariffAction, editChargeAction, rejectChargeAction } from '@/actions/tariff-review.actions'
import { getTariffSourceUrlAdminAction } from '@/actions/tariff-library.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import type { ReviewCharge, ReviewIssue, ReviewTariff } from './review-model'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const SEV: Record<ReviewIssue['severity'], 'danger' | 'warning' | 'ghost'> = { block: 'danger', review: 'warning', warn: 'ghost' }

export function ReviewQueue({ tariffs, editable }: { tariffs: ReviewTariff[]; editable: boolean }) {
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [viewing, setViewing] = useState<{ title: string; charge: ReviewCharge } | null>(null)
  const shown = onlyOpen
    ? tariffs.filter((t) => t.issues.length > 0 || t.charges.some((c) => c.needsReview || c.issues.length > 0))
    : tariffs
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only tariffs with open checks</label>
      {shown.length === 0 && <p style={{ fontSize: 13 }}>Nothing left to review.</p>}
      {shown.map((t) => (
        <section key={t.id} aria-label={t.name} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{t.name}{t.code ? ` (${t.code})` : ''} · {t.structure}</strong>
            {editable && <DeleteTariff tariffId={t.id} />}
          </div>
          {t.issues.map((i, k) => <p key={k} style={{ margin: '4px 0', fontSize: 12 }}><Badge variant={SEV[i.severity]}>{i.severity}</Badge> <span>{i.message}</span></p>)}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Component</th><th style={TH}>Season</th><th style={TH}>Period</th><th style={TH}>Block (kWh)</th><th style={TH}>Amount</th><th style={TH}>VAT</th><th style={TH}>Checks</th><th style={TH} /></tr></thead>
              <tbody>{t.charges.map((c) => (
                <ChargeRow key={c.id} charge={c} editable={editable} onView={() => setViewing({ title: `${t.name} — ${COMPONENT_LABELS[c.component]}`, charge: c })} />
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
      {viewing && (
        <SourceViewer
          title={viewing.title}
          locator={viewing.charge.locator}
          loadUrl={() => viewing.charge.sourceDocumentId
            ? getTariffSourceUrlAdminAction({ sourceDocumentId: viewing.charge.sourceDocumentId })
            : Promise.resolve({ error: 'No source document is recorded for this charge.' })}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}

function ChargeRow({ charge: c, editable, onView }: { charge: ReviewCharge; editable: boolean; onView: () => void }) {
  const router = useRouter()
  const reject = useArmedConfirm()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(c.amount))
  const [unit, setUnit] = useState<TariffUnit | ''>(c.unit)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<{ ok: true } | { error: string } | { fieldErrors: Record<string, string | undefined> }>) => {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if ('error' in r) setError(r.error)
    else if ('fieldErrors' in r) setError(Object.values(r.fieldErrors).filter(Boolean).join(' '))
    else { setEditing(false); router.refresh() }
  }
  return (
    <tr>
      <td style={TD}>{COMPONENT_LABELS[c.component]}</td>
      <td style={TD}>{SEASON_LABELS[c.season as TariffSeason] ?? c.season}</td>
      <td style={TD}>{TOU_LABELS[c.tou as TouOrAll] ?? c.tou}{c.dayType !== 'all' ? ` (${c.dayType})` : ''}</td>
      <td style={TD}>{c.blockMin === null ? '—' : `${c.blockMin}–${c.blockMax ?? '∞'}`}</td>
      <td style={TD}>
        {editing
          ? <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
              <input aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
              <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as TariffUnit)}>
                {TARIFF_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
              </select>
              {c.unitInferred && <label style={{ fontSize: 12 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Unit confirmed against the source</label>}
            </span>
          : formatChargeAmount(c.amount, c.unit)}
      </td>
      <td style={TD}>{c.vatBasis}</td>
      <td style={TD}>
        {c.unitInferred && <div style={{ fontSize: 12 }}><Badge variant={c.reviewedAt ? 'success' : 'warning'}>{c.reviewedAt ? 'reviewed' : 'inferred unit'}</Badge> <span>{c.inferenceReason}</span></div>}
        {c.issues.map((i, k) => <div key={k} style={{ fontSize: 12 }}><Badge variant={SEV[i.severity]}>{i.severity}</Badge> <span>{i.message}</span></div>)}
        {error && <div role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</div>}
      </td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <Button variant="ghost" size="sm" onClick={onView}>View source</Button>
        {editable && !editing && <>
          {!c.reviewedAt && <Button variant="secondary" size="sm" isLoading={busy} onClick={() => act(() => approveChargeAction({ chargeId: c.id }))}>Approve</Button>}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="danger" size="sm" isLoading={busy}
            onClick={() => {
              if (!reject.armed) return reject.arm()
              reject.disarm()
              void act(() => rejectChargeAction({ chargeId: c.id }))
            }}>
            {reject.armed ? 'Confirm reject' : 'Reject'}
          </Button>
        </>}
        {editable && editing && <>
          <Button size="sm" isLoading={busy} onClick={() => act(() => editChargeAction({ chargeId: c.id, amount, unit, unitConfirmed: confirmed }))}>Save</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </>}
      </td>
    </tr>
  )
}

function DeleteTariff({ tariffId }: { tariffId: string }) {
  const router = useRouter()
  const armed = useArmedConfirm()
  const [error, setError] = useState<string | null>(null)
  return (
    <span>
      <Button variant="danger" size="sm" onClick={async () => {
        if (!armed.armed) return armed.arm()
        armed.disarm()
        const r = await deleteTariffAction({ tariffId })
        if ('error' in r) setError(r.error); else router.refresh()
      }}>{armed.armed ? 'Confirm delete tariff' : 'Delete tariff'}</Button>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}> {error}</span>}
    </span>
  )
}
