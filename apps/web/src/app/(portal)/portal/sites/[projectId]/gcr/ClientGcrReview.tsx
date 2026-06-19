'use client'

import { useMemo, useState, useTransition } from 'react'
import type {
  ClientGcrReviewPayload,
  GcrChangeRequestField,
  GcrChangeRequestInput,
  GeneratorParticipation,
  ShopCategory,
} from '@esite/shared'
import { submitGcrChangeRequestsAction } from '../../../../portal-gcr.actions'

interface Props {
  projectId: string
  payload: ClientGcrReviewPayload
  /** shopNumber -> live structure.nodes.id, so a proposal targets the real node. */
  nodeIdByShop: Record<string, string>
}

const PARTICIPATION: GeneratorParticipation[] = ['shared', 'own', 'none']
const CATEGORY: ShopCategory[] = ['standard', 'fast_food', 'restaurant', 'national', 'other']

// ZAR formatting mirrors the admin rates/cable modules (Intl en-ZA currency).
const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 2 })
const fmtZar = (v: number) => zar.format(v)
const fmtNum = (v: number) => num.format(v)

/** A single per-tenant draft. Only INPUT fields are proposable (never outputs). */
interface Draft {
  participation?: GeneratorParticipation
  category?: ShopCategory
  areaM2?: number
  comment?: string
}

export function ClientGcrReview({ projectId, payload, nodeIdByShop }: Props) {
  // Ephemeral play state — drafts NEVER persist. Keyed by shopNumber.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function patch(shop: string, p: Partial<Draft>) {
    setDone(null)
    setDrafts((prev) => ({ ...prev, [shop]: { ...prev[shop], ...p } }))
  }

  /** Build the captured proposals: only fields whose draft differs from the snapshot. */
  const batch = useMemo<GcrChangeRequestInput[]>(() => {
    const out: GcrChangeRequestInput[] = []
    for (const t of payload.tenants) {
      const d = drafts[t.shopNumber]
      if (!d) continue
      const nodeId = nodeIdByShop[t.shopNumber]
      if (!nodeId) continue
      const comment = d.comment?.trim() ? d.comment.trim() : null

      const push = (field: GcrChangeRequestField, oldValue: string, newValue: string) => {
        out.push({ nodeId, field, oldValue, newValue, comment })
      }

      if (d.participation !== undefined && d.participation !== t.participation) {
        push('participation', t.participation, d.participation)
      }
      if (d.category !== undefined) {
        // category is not in the outputs-only snapshot, so any chosen value is a proposal
        push('category', '', d.category)
      }
      if (d.areaM2 !== undefined && Number.isFinite(d.areaM2) && d.areaM2 !== t.areaM2) {
        push('area', String(t.areaM2), String(d.areaM2))
      }
    }
    return out
  }, [drafts, payload.tenants, nodeIdByShop])

  /** Per-row captured proposals, for the inline old→new chips. */
  function proposalsFor(shop: string): string[] {
    return batch
      .filter((b) => nodeIdByShop[shop] && b.nodeId === nodeIdByShop[shop])
      .map((b) => `${b.field}: ${b.oldValue || '—'} → ${b.newValue || '—'}`)
  }

  function handleSubmit() {
    if (batch.length === 0) {
      setError('Change a value to propose before submitting.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await submitGcrChangeRequestsAction(projectId, batch)
      if ('error' in res) {
        setError(res.error)
      } else {
        setDone(res.submitted)
        setDrafts({}) // clear local play after a successful submit
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 88 }}>
      {/* Read-only requests banner */}
      <div
        style={{
          background: 'var(--c-amber-dim)',
          border: '1px solid var(--c-amber-mid)',
          borderRadius: 6,
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--c-text-mid)',
        }}
      >
        This is a review. Any change you make is a <strong>request</strong> to your project
        team — nothing is saved to the live schedule until they accept it.
      </div>

      {/* Generator banks */}
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>Generator banks</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {payload.banks.map((b) => (
            <div
              key={b.zoneName}
              style={{ border: '1px solid var(--c-border)', background: 'var(--c-panel)', borderRadius: 6, padding: 12, minWidth: 180 }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-text)' }}>{b.zoneName}</div>
              <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                {b.installedKva !== null ? `${fmtNum(b.installedKva)} kVA installed` : '— kVA'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                {b.utilisationPercent !== null ? `${b.utilisationPercent}% utilised` : '— utilised'}
              </div>
            </div>
          ))}
          {payload.banks.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>No generator banks configured.</div>
          )}
        </div>
      </section>

      {/* Per-tenant table */}
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>Tenants</h2>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)' }}>
                <th style={cellHead}>Shop</th>
                <th style={cellHead}>Area m²</th>
                <th style={cellHead}>Load kW</th>
                <th style={cellHead}>Participation</th>
                <th style={cellHead}>Category</th>
                <th style={cellHeadRight}>Share %</th>
                <th style={cellHeadRight}>Monthly</th>
                <th style={cellHeadRight}>R/m²</th>
                <th style={cellHead}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {payload.tenants.map((t) => {
                const d = drafts[t.shopNumber] ?? {}
                const props = proposalsFor(t.shopNumber)
                return (
                  <tr key={t.shopNumber} style={{ borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }}>
                    <td style={cell}>
                      <div style={{ fontWeight: 600, color: 'var(--c-text)' }}>{t.shopName}</div>
                      <div style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>{t.shopNumber}</div>
                      {props.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {props.map((p) => (
                            <span
                              key={p}
                              style={{
                                fontSize: 10,
                                color: 'var(--c-amber)',
                                background: 'var(--c-amber-dim)',
                                border: '1px solid var(--c-amber-mid)',
                                borderRadius: 4,
                                padding: '1px 6px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={cell}>
                      <input
                        type="number"
                        aria-label={`area-${t.shopNumber}`}
                        value={d.areaM2 ?? t.areaM2}
                        onChange={(e) => patch(t.shopNumber, { areaM2: e.target.value === '' ? undefined : Number(e.target.value) })}
                        style={inputNum}
                      />
                    </td>
                    <td style={cell}>{fmtNum(t.loadingKw)}</td>
                    <td style={cell}>
                      <select
                        aria-label={`participation-${t.shopNumber}`}
                        value={d.participation ?? t.participation}
                        onChange={(e) => patch(t.shopNumber, { participation: e.target.value as GeneratorParticipation })}
                        style={select}
                      >
                        {PARTICIPATION.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td style={cell}>
                      <select
                        aria-label={`category-${t.shopNumber}`}
                        value={d.category ?? ''}
                        onChange={(e) => patch(t.shopNumber, { category: e.target.value === '' ? undefined : (e.target.value as ShopCategory) })}
                        style={select}
                      >
                        <option value="">—</option>
                        {CATEGORY.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td style={cellRight}>{t.portionPercent}%</td>
                    <td style={cellRight}>{fmtZar(t.monthly)}</td>
                    <td style={cellRight}>{fmtZar(t.ratePerSqm)}</td>
                    <td style={cell}>
                      <input
                        aria-label={`comment-${t.shopNumber}`}
                        value={d.comment ?? ''}
                        onChange={(e) => patch(t.shopNumber, { comment: e.target.value })}
                        placeholder="Why?"
                        style={{ ...inputNum, width: 140 }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Scheme summary (outputs only) */}
      <section style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--c-text-mid)', flexWrap: 'wrap' }}>
        <div>
          <span style={{ color: 'var(--c-text-dim)' }}>Scheme monthly recovery: </span>
          {fmtZar(payload.scheme.monthlyCapitalRepayment)}
        </div>
        <div>
          <span style={{ color: 'var(--c-text-dim)' }}>Billed tariff: </span>
          {fmtZar(payload.scheme.finalTariff)}/kWh
        </div>
      </section>

      {/* Sticky submit bar */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--c-panel)',
          borderTop: '1px solid var(--c-border)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          {error && <span style={{ color: 'var(--c-red)' }}>{error}</span>}
          {!error && done !== null && (
            <span style={{ color: 'var(--c-amber)' }}>
              {done} request{done === 1 ? '' : 's'} submitted — your project team will respond.
            </span>
          )}
          {!error && done === null && (
            <span>
              {batch.length === 0
                ? 'Change a value above to propose it.'
                : `${batch.length} request${batch.length === 1 ? '' : 's'} ready.`}
            </span>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={pending || batch.length === 0}
          style={{
            background: 'var(--c-amber)',
            color: '#0D0B09',
            border: 'none',
            borderRadius: 6,
            padding: '9px 18px',
            fontWeight: 600,
            fontSize: 13,
            cursor: pending || batch.length === 0 ? 'not-allowed' : 'pointer',
            opacity: pending || batch.length === 0 ? 0.5 : 1,
          }}
        >
          {pending
            ? 'Submitting…'
            : `Submit ${batch.length} request${batch.length === 1 ? '' : 's'} to admin`}
        </button>
      </div>
    </div>
  )
}

const cellHead: React.CSSProperties = { padding: '6px 8px', fontWeight: 500 }
const cellHeadRight: React.CSSProperties = { ...cellHead, textAlign: 'right' }
const cell: React.CSSProperties = { padding: '8px', color: 'var(--c-text-mid)' }
const cellRight: React.CSSProperties = { ...cell, textAlign: 'right' }
const inputNum: React.CSSProperties = {
  width: 72,
  padding: '4px 6px',
  fontSize: 12,
  background: 'var(--c-base)',
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  color: 'var(--c-text)',
}
const select: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: 12,
  background: 'var(--c-base)',
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  color: 'var(--c-text)',
}
