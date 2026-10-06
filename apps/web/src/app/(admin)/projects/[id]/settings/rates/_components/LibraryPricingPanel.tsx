'use client'

/**
 * LibraryPricingPanel — "Price from library" on the project Rates tab.
 *
 * Two directions, one panel (collapsed by default behind a single button):
 *
 *   1. Price from library — preview what the organisation's rate library would
 *      put on each BOQ line (median or P75), untick any line to keep, then apply.
 *      The apply action recomputes every proposal server-side; this component
 *      only sends the chosen boq_item ids and the statistic the preview used.
 *      Changing the statistic discards the preview, so what is applied is
 *      always what was shown.
 *   2. Add this BOQ to the rate library — feeds the project's contractor-priced
 *      BOQ into the library (the opposite direction).
 *
 * Apply overwrites rates, so it is a two-step inline confirm (first press arms,
 * second applies, auto-disarms after 4 s). Never window.confirm — Safari
 * suppresses it silently.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BudgetStatistic, SkipReason } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { TableScrollX } from '@/components/ui/TableScrollX'
import {
  addProjectBoqToLibraryAction,
  applyPriceFromLibraryAction,
  previewPriceFromLibraryAction,
  type PricePreviewRow,
} from '@/actions/rate-catalogue.actions'
import { fmtRate } from './format'

const ARM_TIMEOUT_MS = 4000

const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  no_library_item: 'no matching catalogue item',
  no_split_in_library: 'library has no supply/install split',
  no_observations: 'item has no rates yet',
  variation_item: 'variation item',
  not_a_rate: 'not a unit rate',
  amount_only: 'amount-only line',
  cannot_escalate: 'cannot escalate',
}

function skipLabel(reason: string | null): string {
  return (reason && SKIP_REASON_LABELS[reason as SkipReason]) || reason || 'skipped'
}

interface Preview {
  statistic: BudgetStatistic
  rows: PricePreviewRow[]
  priced: number
  skipped: Record<string, number>
}

const th: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: 'var(--c-text)',
  fontFamily: 'var(--font-sans)',
  verticalAlign: 'top',
}

const tdNum: React.CSSProperties = {
  ...td,
  fontFamily: 'var(--font-mono)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  color: 'var(--c-text-mid)',
}

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
  fontFamily: 'var(--font-sans)',
}

const hint: React.CSSProperties = { fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-sans)' }

const errorLine: React.CSSProperties = { fontSize: 12, color: 'var(--c-red)', fontFamily: 'var(--font-sans)', opacity: 0.85 }

const okLine: React.CSSProperties = { fontSize: 12, color: 'var(--c-green)', fontFamily: 'var(--font-sans)' }

const input: React.CSSProperties = {
  background: 'var(--c-input-bg)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  color: 'var(--c-text)',
  fontFamily: 'var(--font-sans)',
  minWidth: 0,
}

/** A rate triple as one figure (single-rate) or a supply / install pair. */
function Rates({ r }: { r: { supplyRate: number | null; installRate: number | null; rate: number | null } | null }) {
  if (!r) return <>—</>
  if (r.supplyRate === null && r.installRate === null) return <>{fmtRate(r.rate)}</>
  return (
    <>
      <div>S {fmtRate(r.supplyRate)}</div>
      <div>I {fmtRate(r.installRate)}</div>
    </>
  )
}

export function LibraryPricingPanel({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // ── Price from library ────────────────────────────────────────────────────
  const [statistic, setStatistic] = useState<BudgetStatistic>('median')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [showSkipped, setShowSkipped] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [previewing, startPreview] = useTransition()
  const [applying, startApply] = useTransition()

  // ── Add to library ────────────────────────────────────────────────────────
  const [contractor, setContractor] = useState('')
  const [pricedOn, setPricedOn] = useState('')
  const [libError, setLibError] = useState<string | null>(null)
  const [libNotice, setLibNotice] = useState<string | null>(null)
  const [adding, startAdd] = useTransition()

  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current) }, [])

  const pricedRows = useMemo(() => preview?.rows.filter((r) => r.status === 'priced') ?? [], [preview])
  const skippedRows = useMemo(() => preview?.rows.filter((r) => r.status === 'skipped') ?? [], [preview])
  const skippedTotal = skippedRows.length
  const selectedCount = pricedRows.filter((r) => checked.has(r.boqItemId)).length
  const allChecked = pricedRows.length > 0 && selectedCount === pricedRows.length

  function disarm() {
    if (armTimer.current) clearTimeout(armTimer.current)
    armTimer.current = null
    setArmed(false)
  }

  function chooseStatistic(next: BudgetStatistic) {
    if (next === statistic) return
    setStatistic(next)
    // The preview was computed with the other statistic; applying it now would
    // write figures nobody saw. Discard it.
    setPreview(null)
    setChecked(new Set())
    setNotice(null)
    disarm()
  }

  function runPreview() {
    setError(null)
    setNotice(null)
    disarm()
    const stat = statistic
    startPreview(async () => {
      const res = await previewPriceFromLibraryAction(projectId, stat)
      if (!res.ok) {
        setError(res.error)
        setPreview(null)
        return
      }
      setPreview({ statistic: stat, ...res.data })
      setChecked(new Set(res.data.rows.filter((r) => r.status === 'priced').map((r) => r.boqItemId)))
      setShowSkipped(false)
    })
  }

  function toggleRow(id: string) {
    disarm()
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    disarm()
    setChecked(allChecked ? new Set() : new Set(pricedRows.map((r) => r.boqItemId)))
  }

  function pressApply() {
    if (!preview || selectedCount === 0) return
    if (!armed) {
      setArmed(true)
      armTimer.current = setTimeout(() => { armTimer.current = null; setArmed(false) }, ARM_TIMEOUT_MS)
      return
    }
    disarm()
    setError(null)
    // Send back exactly what was shown: the server refuses if the library has changed since.
    const shown = pricedRows.filter((r) => checked.has(r.boqItemId)).map((r) => ({ boqItemId: r.boqItemId, proposed: r.proposed! }))
    const stat = preview.statistic
    startApply(async () => {
      const res = await applyPriceFromLibraryAction(projectId, stat, shown)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setNotice(`Updated ${res.data.updated} ${res.data.updated === 1 ? 'line' : 'lines'}`)
      // The previewed "current" rates are now stale; preview again to compare.
      setPreview(null)
      setChecked(new Set())
      router.refresh()
    })
  }

  function addToLibrary(e: React.FormEvent) {
    e.preventDefault()
    setLibError(null)
    setLibNotice(null)
    const name = contractor.trim()
    if (name.length < 2) {
      setLibError('Name the contractor who priced this BOQ')
      return
    }
    startAdd(async () => {
      const res = await addProjectBoqToLibraryAction(projectId, pricedOn ? { contractorName: name, pricedOn } : { contractorName: name })
      if (!res.ok) {
        setLibError(res.error)
        return
      }
      if (res.data.alreadyImported) {
        setLibNotice('Already in the library')
        return
      }
      const c = res.data.counts
      setLibNotice(
        `Added ${c.lines} lines to the library: ${c.autoConfirmed} matched automatically, ${c.suggested} suggested for review, ` +
          `${c.unmatched} unmatched and ${c.excluded} excluded; ${c.newItems} new catalogue items and ${c.observations} rate observations recorded.`,
      )
    })
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Price from library
        </Button>
      </div>
    )
  }

  const busy = previewing || applying

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
            Price from library
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Statistic + preview */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <div role="radiogroup" aria-label="Statistic" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={label}>Statistic</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['median', 'p75'] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={statistic === s}
                    variant={statistic === s ? 'primary' : 'secondary'}
                    onClick={() => chooseStatistic(s)}
                    disabled={busy}
                  >
                    {s === 'median' ? 'Median' : 'P75'}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={runPreview} isLoading={previewing} disabled={applying}>
              Preview
            </Button>
          </div>
          <div style={hint}>Median is the default; P75 is the more cautious figure.</div>

          {error && <div role="alert" style={errorLine}>{error}</div>}
          {notice && <div role="status" style={okLine}>{notice}</div>}

          {preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--c-text)', fontFamily: 'var(--font-sans)' }}>
                {preview.priced} {preview.priced === 1 ? 'line' : 'lines'} can be priced from the library; {skippedTotal}{' '}
                {skippedTotal === 1 ? 'line' : 'lines'} skipped
              </div>
              {skippedTotal > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Object.entries(preview.skipped)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, n]) => (
                      <li key={reason} style={hint}>
                        {n} — {skipLabel(reason)}
                      </li>
                    ))}
                </ul>
              )}

              {pricedRows.length > 0 && (
                <TableScrollX>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                        <th style={{ ...th, width: 28 }}>
                          <input type="checkbox" aria-label="Select all priced lines" checked={allChecked} onChange={toggleAll} disabled={busy} />
                        </th>
                        <th style={th}>Heading</th>
                        <th style={th}>Description</th>
                        <th style={th}>Unit</th>
                        <th style={{ ...th, textAlign: 'right' }}>Current (R)</th>
                        <th style={{ ...th, textAlign: 'right' }}>Proposed (R)</th>
                        <th style={{ ...th, textAlign: 'right' }}>n</th>
                        <th style={th}>Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricedRows.map((r) => (
                        <tr key={r.boqItemId} data-testid="priced-row" style={{ borderBottom: '1px solid var(--c-border)' }}>
                          <td style={td}>
                            <input
                              type="checkbox"
                              aria-label={`Apply library rate to ${r.description}`}
                              checked={checked.has(r.boqItemId)}
                              onChange={() => toggleRow(r.boqItemId)}
                              disabled={busy}
                            />
                          </td>
                          <td style={{ ...td, color: 'var(--c-text-mid)' }}>{r.heading}</td>
                          <td style={{ ...td, minWidth: 180 }}>{r.description}</td>
                          <td style={{ ...td, color: 'var(--c-text-mid)' }}>{r.unit ?? '—'}</td>
                          <td style={tdNum}><Rates r={r.current} /></td>
                          <td style={{ ...tdNum, color: 'var(--c-text)' }}><Rates r={r.proposed} /></td>
                          <td style={tdNum}>{r.n}</td>
                          <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>{r.itemCode ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollX>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {pricedRows.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={armed ? 'danger' : 'primary'}
                    onClick={pressApply}
                    isLoading={applying}
                    disabled={selectedCount === 0 || previewing}
                  >
                    {armed
                      ? `Confirm — overwrite ${selectedCount} ${selectedCount === 1 ? 'rate' : 'rates'}`
                      : `Apply to ${selectedCount} ${selectedCount === 1 ? 'line' : 'lines'}`}
                  </Button>
                )}
                {skippedTotal > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowSkipped((v) => !v)} aria-expanded={showSkipped}>
                    {showSkipped ? 'Hide skipped' : 'Show skipped'}
                  </Button>
                )}
              </div>

              {showSkipped && skippedTotal > 0 && (
                <TableScrollX>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                        <th style={th}>Heading</th>
                        <th style={th}>Description</th>
                        <th style={th}>Unit</th>
                        <th style={th}>Why skipped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skippedRows.map((r) => (
                        <tr key={r.boqItemId} data-testid="skipped-row" style={{ borderBottom: '1px solid var(--c-border)' }}>
                          <td style={{ ...td, color: 'var(--c-text-mid)' }}>{r.heading}</td>
                          <td style={{ ...td, minWidth: 180 }}>{r.description}</td>
                          <td style={{ ...td, color: 'var(--c-text-mid)' }}>{r.unit ?? '—'}</td>
                          <td style={{ ...td, color: 'var(--c-text-dim)' }}>{skipLabel(r.reason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScrollX>
              )}
            </div>
          )}

          {/* Add this BOQ to the library (the opposite direction) */}
          <form
            onSubmit={addToLibrary}
            noValidate
            style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', fontFamily: 'var(--font-sans)' }}>
              Add this BOQ to the rate library
            </div>
            <div style={hint}>Records this project&apos;s contractor-priced rates so future projects can be priced from them.</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
                <span style={label}>Contractor name</span>
                <input
                  type="text"
                  value={contractor}
                  onChange={(e) => setContractor(e.target.value)}
                  required
                  style={input}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 170px', minWidth: 0 }}>
                <span style={label}>Priced on (optional)</span>
                <input type="date" value={pricedOn} onChange={(e) => setPricedOn(e.target.value)} style={input} />
              </label>
              <Button type="submit" variant="secondary" size="sm" isLoading={adding}>
                Add to library
              </Button>
            </div>
            {libError && <div role="alert" style={errorLine}>{libError}</div>}
            {libNotice && <div role="status" style={okLine}>{libNotice}</div>}
          </form>
        </div>
      </CardBody>
    </Card>
  )
}
