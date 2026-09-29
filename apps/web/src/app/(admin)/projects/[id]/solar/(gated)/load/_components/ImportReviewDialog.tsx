'use client'
/**
 * Import review dialog (functional spec §4.3), one step per parsed file/sheet: what the parser found,
 * the choices it needs (date order, time-label convention, units — never defaulted on the generic path),
 * the identity panel, the validation summary, the meter (kind, tenant), and Accept / Skip. The server
 * re-parses on commit; this dialog never parses anything itself.
 */
import { useMemo, useState } from 'react'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { commitReview, parseFiles, type ParseOptionsInput } from '@/lib/solar/load/import-client'
import { METER_KIND_OPTIONS, UNIT_OPTIONS, type MeterKind, type NodeOption } from '@/lib/solar/load/view-types'
import { acceptBlockers, buildCommitBody, choicesForIdentity, initialChoices, optionsFrom, sameBodyConflict, type Choices } from './review-choices'

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)} %`)
const box = { border: '1px solid var(--c-border)', borderRadius: 6, padding: 10, marginTop: 10 } as const

export function ImportReviewDialog({ projectId, reviews, nodes, studyMeters, editMeterId, onClose, onFinished }: {
  projectId: string
  reviews: ReviewModel[]
  nodes: NodeOption[]
  studyMeters: Array<{ id: string; label: string; siteLabel: string | null }>
  editMeterId: string | null
  onClose: () => void
  onFinished: (s: { imported: number; skipped: number; registers: number }) => void
}) {
  const [index, setIndex] = useState(0)
  const [current, setCurrent] = useState<ReviewModel>(reviews[0])
  const [choices, setChoices] = useState<Choices>(() => initialChoices(reviews[0], nodes, editMeterId))
  // The pre-filled area (a file-name hint) counts as applied: it changes only the implied-density check,
  // so it must not force a re-run before the first Accept.
  const [applied, setApplied] = useState<ParseOptionsInput>(() => optionsFrom(initialChoices(reviews[0], nodes, editMeterId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tally, setTally] = useState({ imported: 0, skipped: 0, registers: 0 })
  // Meters this dialog created, by file: a later file of the same upload with the same data can link to one.
  const [created, setCreated] = useState<Record<string, { id: string; label: string }>>({})
  const set = <K extends keyof Choices>(k: K, v: Choices[K]) => setChoices((c) => ({ ...c, [k]: v }))
  const optionsDirty = JSON.stringify(optionsFrom(choices)) !== JSON.stringify(applied)
  const blockers = useMemo(() => acceptBlockers(current, choices, optionsDirty), [current, choices, optionsDirty])
  const r = current.report
  const primaryCh = current.channels.find((c) => c.column === choices.primary)
  const conflictMeters = (current.identity?.conflicts ?? []).flatMap((c) => {
    const id = c.meterId ?? (c.fileId ? created[c.fileId]?.id : undefined)
    return id ? [{ id, label: c.meterId ? c.message : `${created[c.fileId as string].label} (${c.message})` }] : []
  })
  const duplicate = sameBodyConflict(current.identity)

  function next(t: typeof tally) {
    setTally(t)
    if (index + 1 >= reviews.length) { onFinished(t); return }
    const n = reviews[index + 1]
    setIndex(index + 1)
    setCurrent(n)
    const init = initialChoices(n, nodes, editMeterId)
    setChoices(init)
    setApplied(optionsFrom(init))
    setError(null)
  }
  async function act(body: Record<string, unknown>, kind: 'imported' | 'skipped' | 'registers') {
    setBusy(true)
    setError(null)
    const res = await commitReview(projectId, body)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      // The server found a conflict the parse-time preview could not (e.g. another file of this upload,
      // committed since): show it, so the user can resolve it here instead of only skipping or closing.
      if (res.identity) {
        const identity = res.identity
        setCurrent((c) => ({ ...c, identity }))
        setChoices((c) => choicesForIdentity({ ...c, resolution: 'none' }, identity, editMeterId))
      }
      return
    }
    if (kind === 'imported' && res.meterId) setCreated((m) => ({ ...m, [current.fileId]: { id: res.meterId as string, label: res.meterLabel ?? 'the meter just imported' } }))
    next({ ...tally, [kind]: tally[kind] + 1 })
  }
  async function rerun() {
    setBusy(true)
    setError(null)
    const opts = optionsFrom(choices)
    const res = await parseFiles(projectId, [current.fileId], { [current.fileId]: opts })
    setBusy(false)
    const again = res.reviews.find((x) => x.sheetName === current.sheetName) ?? res.reviews[0]
    if (!again) { setError(res.failed[0]?.message ?? 'The preview could not be refreshed — try again.'); return }
    setCurrent(again)
    setApplied(opts)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Review meter import" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 920, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>{current.fileName}{current.sheetName ? ` — ${current.sheetName}` : ''}</h2>
          <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>File {index + 1} of {reviews.length}</span>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </header>

        <section style={box} aria-label="Detected format">
          <p style={{ margin: 0, fontSize: 13 }}><strong>Format:</strong> {r.formatLabel} · delimiter {r.delimiter ?? '—'} · header row {r.headerRow ?? '—'} · row order {r.rowOrder ?? '—'} · interval {r.intervalMin ?? '—'} min{r.dailyInterval ? ' (daily file: coverage only, never load)' : ''}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}><strong>Period:</strong> {r.periodStart?.slice(0, 10) ?? '—'} → {r.periodEnd?.slice(0, 10) ?? '—'} · time labels: {r.tsConvention === 'begin' ? 'interval-beginning' : r.tsConvention === 'end' ? 'interval-ending' : 'not set'}{r.tsConventionSource === 'format' ? ' (fixed by the format)' : ''}</p>
          {(r.dateOrderAmbiguous || current.choicesNeeded.includes('ambiguous_date_order')) && (
            <label style={{ display: 'block', marginTop: 6, fontSize: 13 }}>Date order (must be confirmed){' '}
              <select aria-label="Date order" value={choices.dateOrder} onChange={(e) => set('dateOrder', e.target.value as Choices['dateOrder'])}>
                <option value="">Choose…</option><option value="DMY">Day/Month/Year</option><option value="MDY">Month/Day/Year</option><option value="YMD">Year-Month-Day</option>
              </select>
            </label>
          )}
          {current.choicesNeeded.includes('convention_required') && (
            <label style={{ display: 'block', marginTop: 6, fontSize: 13 }}>Time labels mark the{' '}
              <select aria-label="Time-label convention" value={choices.tsConvention} onChange={(e) => set('tsConvention', e.target.value as Choices['tsConvention'])}>
                <option value="">Choose…</option><option value="begin">start of each interval</option><option value="end">end of each interval</option>
              </select>
            </label>
          )}
        </section>

        {current.outcome === 'series' && (
          <section style={box} aria-label="Channels">
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr><th align="left">Include</th><th align="left">Primary</th><th align="left">Column</th><th align="left">Quantity</th><th align="left">Direction</th><th align="left">Unit</th><th align="right">Completeness</th><th align="right">Max</th></tr></thead>
              <tbody>
                {current.channels.map((c) => {
                  const lagged = r.laggedChannels?.some((l) => l.column === c.column)
                  return (
                    <tr key={c.column}>
                      <td><input type="checkbox" aria-label={`Include ${c.column}`} checked={Boolean(choices.include[c.column])} onChange={(e) => set('include', { ...choices.include, [c.column]: e.target.checked })} /></td>
                      <td><input type="radio" name="primary" aria-label={`Primary ${c.column}`} disabled={lagged} checked={choices.primary === c.column} onChange={() => set('primary', c.column)} /></td>
                      <td>{c.column}{c.coverageOnly ? ' (daily)' : ''}{c.isCumulative ? ' (cumulative → interval)' : ''}</td>
                      <td>{c.quantity}</td>
                      <td>{c.direction}</td>
                      <td>
                        <select aria-label={`Unit for ${c.column}`} value={choices.units[c.column] ?? (c.sourceUnit === 'unknown' ? '' : c.sourceUnit)}
                          onChange={(e) => {
                            const unit = e.target.value
                            // Choosing a unit for a channel the parser could not type includes it (it was excluded only for want of a unit).
                            setChoices((s) => ({ ...s, units: { ...s.units, [c.column]: unit }, include: { ...s.include, [c.column]: true } }))
                          }}>
                          {c.sourceUnit === 'unknown' && !choices.units[c.column] && <option value="">Choose… {c.suggestedUnit ? `(maybe ${c.suggestedUnit})` : ''}</option>}
                          {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        {c.unitFromTable && !choices.units[c.column] && <span style={{ color: 'var(--c-text-dim)' }}> from the format</span>}
                      </td>
                      <td align="right">{pct(c.completeness)}</td>
                      <td align="right">{c.maxStored == null ? '—' : `${c.maxStored.toFixed(2)} ${c.storedUnit}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        {current.outcome === 'series' && (
          <section style={box} aria-label="Validation summary">
            <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Validation summary</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, columns: 2 }}>
              <li>Completeness (primary): {pct(primaryCh?.completeness)}</li>
              <li>Longest gap: {r.channels.find((c) => c.column === choices.primary)?.stats.longestGapHours?.toFixed(1) ?? '—'} h</li>
              <li>Zero runs ≥ 6 h: {r.channels.find((c) => c.column === choices.primary)?.stats.zeroRunsOver6h ?? '—'}</li>
              <li>Negatives: {(() => { const s = r.channels.find((c) => c.column === choices.primary)?.stats; return s ? s.tinyNegatives + s.largeNegatives : '—' })()}</li>
              <li>Reset pairs: {r.channels.find((c) => c.column === choices.primary)?.stats.resetPairs ?? '—'}</li>
              <li>Spikes: {r.channels.find((c) => c.column === choices.primary)?.stats.spikes ?? '—'}</li>
              <li>Level shifts / scale segments: {primaryCh?.levelShiftSegments ?? 0}</li>
              <li>Rollovers: {r.channels.find((c) => c.column === choices.primary)?.stats.rollovers ?? '—'}</li>
              <li>Duplicate timestamps: {r.duplicates}</li>
              <li>“24:00” rows: {r.twentyFourHundredRows}</li>
              <li>Estimated (Calc) share: {pct(r.calcShare)}</li>
              <li>Implied density: {r.impliedWPerM2 ? `${r.impliedWPerM2.value.toFixed(1)} W/m² over ${r.impliedWPerM2.areaM2} m²${r.impliedWPerM2.outOfBand ? ' — outside 2–150 W/m²' : ''}` : '—'}</li>
            </ul>
            {r.warnings.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--c-amber)' }}>{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
          </section>
        )}

        {current.identity && (current.identity.conflicts.length > 0 || current.identity.sourceSerials.length > 0) && (
          <section style={box} aria-label="Identity">
            <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Identity</h3>
            <p style={{ fontSize: 12, margin: 0 }}>Serial(s) in the file: {current.identity.sourceSerials.join(', ') || '—'}{current.identity.filenameSerial ? ` · file name says ${current.identity.filenameSerial}` : ''}</p>
            {current.identity.conflicts.map((c, i) => <p key={i} style={{ fontSize: 12, margin: '4px 0', color: '#b45309' }}>{c.message}</p>)}
            {duplicate && !editMeterId && (
              <p style={{ fontSize: 12, margin: '4px 0' }}>
                This is usually the portal returning another meter&apos;s data under this name. Skip it and download this meter again.
                Link it only if it really is the same meter (its readings are then not imported again); override only if these are two
                meters that truly recorded identical readings — importing both counts the load twice.
              </p>
            )}
            {current.identity.blocking && !editMeterId && (
              <fieldset style={{ border: 'none', padding: 0, fontSize: 13 }}>
                <label><input type="radio" name="res" checked={choices.resolution === 'skip'} onChange={() => {
                  setChoices((c) => ({ ...c, resolution: 'skip', skipReason: c.skipReason || `${duplicate ? 'Duplicate data' : 'Identity conflict'}: ${(duplicate ?? current.identity?.conflicts[0])?.message ?? ''}`.slice(0, 480) }))
                }} /> {duplicate ? 'Skip this file (recommended)' : 'Skip this file'}</label>{' '}
                <label><input type="radio" name="res" checked={choices.resolution === 'link'} onChange={() => { set('resolution', 'link'); set('meterMode', 'existing'); set('existingMeterId', conflictMeters[0]?.id ?? '') }} /> Link to existing meter</label>{' '}
                <label><input type="radio" name="res" checked={choices.resolution === 'override'} onChange={() => { set('resolution', 'override'); set('meterMode', 'new') }} /> Override with reason</label>
                {choices.resolution === 'override' && (
                  <input aria-label="Override reason" value={choices.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Why this is a different meter" style={{ display: 'block', width: '100%', marginTop: 4 }} />
                )}
              </fieldset>
            )}
          </section>
        )}

        {current.outcome === 'series' && !editMeterId && (
          <section style={box} aria-label="Meter">
            <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Meter</h3>
            {choices.meterMode === 'existing' ? (
              <label style={{ fontSize: 13 }}>Existing meter{' '}
                <select aria-label="Existing meter" value={choices.existingMeterId} onChange={(e) => set('existingMeterId', e.target.value)}>
                  <option value="">Choose…</option>
                  {[...conflictMeters, ...studyMeters.map((m) => ({ id: m.id, label: `${m.label}${m.siteLabel ? ` (${m.siteLabel})` : ''}` }))].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 13 }}>
                <label>Label <input aria-label="Meter label" value={choices.label} onChange={(e) => set('label', e.target.value)} /></label>
                <label>Kind <select aria-label="Meter kind" value={choices.kind} onChange={(e) => set('kind', e.target.value as MeterKind)}>
                  <option value="">Choose…</option>{METER_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select></label>
                <label>Site <input aria-label="Site label" value={choices.siteLabel} onChange={(e) => set('siteLabel', e.target.value)} /></label>
                <label>Shop no. <input aria-label="Shop number" value={choices.shopNo} onChange={(e) => set('shopNo', e.target.value)} /></label>
                <label>Area (m²) <input aria-label="Area m2" inputMode="decimal" value={choices.areaM2} onChange={(e) => set('areaM2', e.target.value)} /></label>
                <label>Link to tenant <select aria-label="Link to tenant" value={choices.nodeId} onChange={(e) => set('nodeId', e.target.value)}>
                  <option value="">None</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                </select></label>
              </div>
            )}
            {choices.kind === 'bulk' && <p style={{ fontSize: 12, color: 'var(--c-amber)', margin: '6px 0 0' }}>A bulk meter is used as the site supply only after you confirm it is the point of supply (meter details, after the reconciliation is shown).</p>}
            {['solar', 'generator', 'check', 'water'].includes(choices.kind) && <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '6px 0 0' }}>This kind is never counted as load.</p>}
          </section>
        )}

        {current.outcome === 'register' && (
          <section style={box} aria-label="Meter register">
            <p style={{ fontSize: 13, margin: 0 }}>This file is a meter register (consolidation summary) with {current.registerRows} rows. Rows matched by an LLM or marked UNMAPPED are imported as unconfirmed and never applied automatically.</p>
            <label style={{ fontSize: 13 }}>Site <input aria-label="Register site" value={choices.registerSite} onChange={(e) => set('registerSite', e.target.value)} /></label>
          </section>
        )}

        {current.blockingErrors.length > 0 && (
          <section style={{ ...box, borderColor: '#dc2626' }} aria-label="Errors">
            <p style={{ fontSize: 13, margin: 0, color: '#dc2626' }}>This file cannot be imported:</p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>{r.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </section>
        )}

        <section style={box} aria-label="Skip">
          <label style={{ fontSize: 13 }}>Reason to skip <input aria-label="Skip reason" value={choices.skipReason} onChange={(e) => set('skipReason', e.target.value)} style={{ width: '70%' }} /></label>
        </section>

        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        {current.outcome === 'series' && blockers.length > 0 && <ul style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}

        <footer style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          {current.outcome === 'series' && optionsDirty && <button type="button" disabled={busy} onClick={rerun}>Re-run preview</button>}
          <button type="button" disabled={busy || choices.skipReason.trim().length < 3}
            onClick={() => act({ mode: 'skip', fileId: current.fileId, reason: choices.skipReason.trim() }, 'skipped')}>Skip this file</button>
          {current.outcome === 'register' && (
            <button type="button" disabled={busy} onClick={() => act({ mode: 'register', fileId: current.fileId, siteLabel: choices.registerSite.trim() || null }, 'registers')}>
              {`Import register (${current.registerRows} rows)`}
            </button>
          )}
          {current.outcome === 'series' && (
            <button type="button" disabled={busy || blockers.length > 0} onClick={() => act(buildCommitBody(current, choices, applied), 'imported')}>
              {busy ? 'Importing…' : 'Accept & import'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
