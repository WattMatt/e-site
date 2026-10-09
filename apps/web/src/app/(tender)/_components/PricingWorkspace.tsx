'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { parseRate } from '@/lib/tender/parse-rate'
import {
  acknowledgeAddendumAction,
  askQuestionAction,
  deleteDocumentAction,
  downloadPricingWorkbookAction,
  getDocumentUploadUrlAction,
  getPricedUploadUrlAction,
  importPricedWorkbookAction,
  recordDocumentAction,
  reopenSubmissionAction,
  saveRatesAction,
  setDeclarationsAction,
  submitTenderAction,
  type PricingState,
} from '@/actions/tender-submission.actions'

const money = (n: number) => `R ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
const cents = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))

type Msg = { ok: boolean; text: string } | null

export function PricingWorkspace({ tenderId, state }: { tenderId: string; state: PricingState }) {
  const router = useRouter()
  const open = state.tender.status === 'issued' && !!state.tender.closing_at && new Date(state.tender.closing_at) > new Date()
  const items = useMemo(() => state.items.filter((i) => i.kind !== 'total'), [state.items])
  const sheets = useMemo(() => Array.from(new Set(items.map((i) => i.sheet_name))), [items])
  const [sheet, setSheet] = useState(sheets[0])
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(state.lines).map(([id, l]) => [id, l.rate == null ? '' : String(l.rate)])),
  )
  const [notPriced, setNotPriced] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.entries(state.lines).map(([id, l]) => [id, l.not_priced])),
  )
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [excelMsg, setExcelMsg] = useState<{ ok: boolean; lines: string[] } | null>(null)
  const [question, setQuestion] = useState({ title: '', body: '' })
  const [decl, setDecl] = useState<Set<string>>(new Set(state.declarations))

  // Shown total (the database recomputes on save and submit).
  const total = useMemo(() => {
    let c = 0
    for (const i of state.items) {
      if (i.kind !== 'item') continue
      if (i.rate_cell_type === 'fixed') c += cents(Number(i.fixed_amount ?? 0))
      else if (i.rate_cell_type === 'priced' && i.quantity != null) {
        const r = parseRate(rates[i.id] ?? '')
        if (r.ok && r.value != null) c += cents(Number(i.quantity) * r.value)
      }
    }
    return c / 100
  }, [rates, state.items])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const saveRates = () =>
    run(async () => {
      const entries = []
      for (const id of Array.from(dirty)) {
        const parsed = parseRate(rates[id] ?? '')
        if (!parsed.ok) {
          const item = state.items.find((i) => i.id === id)
          return setMsg({ ok: false, text: `${item?.code ?? 'A row'}: ${parsed.error}` })
        }
        entries.push({ itemId: id, rate: parsed.value, notPriced: !!notPriced[id] })
      }
      const r = await saveRatesAction(tenderId, entries)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setDirty(new Set())
      setMsg({ ok: true, text: `Saved ${entries.length} row(s).` })
      router.refresh()
    })

  const submit = () =>
    run(async () => {
      if (dirty.size) return setMsg({ ok: false, text: 'Save your rates first.' })
      const r = await submitTenderAction(tenderId)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setMsg({ ok: true, text: `Submitted ${new Date(r.data.submittedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })} — tender total ${money(r.data.total)} excl. VAT. Sealed until closing.` })
      router.refresh()
    })

  const download = () =>
    run(async () => {
      const r = await downloadPricingWorkbookAction(tenderId)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      window.location.href = r.data.url
    })

  const uploadPriced = (file: File) =>
    run(async () => {
      setExcelMsg(null)
      const signed = await getPricedUploadUrlAction(tenderId, file.name)
      if ('error' in signed) return setExcelMsg({ ok: false, lines: [signed.error] })
      const { error } = await createClient().storage.from('tender-submissions').uploadToSignedUrl(signed.data.path, signed.data.token, file)
      if (error) return setExcelMsg({ ok: false, lines: ['Upload failed. Try again.'] })
      const r = await importPricedWorkbookAction(tenderId, signed.data.path)
      if ('error' in r) return setExcelMsg({ ok: false, lines: [r.error] })
      if (!r.data.ok) {
        return setExcelMsg({
          ok: false,
          lines: [
            'Nothing was saved: the workbook differs from the BOQ as issued. Price the copy you downloaded here without changing descriptions, units, quantities or rows.',
            ...r.data.changes.slice(0, 20).map((c) => `${c.sheet} row ${c.rowNumber} ${c.code ?? ''}: ${c.field} — expected “${c.expected ?? ''}”, found “${c.found ?? ''}”`),
          ],
        })
      }
      setExcelMsg({
        ok: true,
        lines: [
          `Saved ${r.data.saved} rate(s) from the workbook. Amounts are recalculated here from quantity × rate.`,
          ...r.data.arithmetic.slice(0, 10).map((a) => `${a.sheet} ${a.code ?? `row ${a.rowNumber}`}: your amount ${money(a.theirs)}, recalculated ${money(a.ours)}`),
          ...(r.data.ignoredFixedRates.length ? [`${r.data.ignoredFixedRates.length} rate(s) typed into fixed sums were ignored.`] : []),
        ],
      })
      router.refresh()
    })

  const uploadDoc = (requirementId: string, file: File) =>
    run(async () => {
      const signed = await getDocumentUploadUrlAction(tenderId, requirementId, file.name, file.size)
      if ('error' in signed) return setMsg({ ok: false, text: signed.error })
      const { error } = await createClient().storage.from('tender-submissions').uploadToSignedUrl(signed.data.path, signed.data.token, file)
      if (error) return setMsg({ ok: false, text: 'Upload failed. Try again.' })
      const r = await recordDocumentAction(tenderId, requirementId, signed.data.path, file.name)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      router.refresh()
    })

  const rows = items.filter((i) => i.sheet_name === sheet)
  const submitted = state.submission?.status === 'submitted'

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">Your submission</span></CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
            <div>
              Status: <strong>{submitted ? 'Submitted' : state.submission ? 'Draft (not submitted)' : 'Not started'}</strong>
              {submitted && state.submission?.submitted_at && ` · ${new Date(state.submission.submitted_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`}
              {' · '}Total {money(total)} excl. VAT
            </div>
            {!open && <div role="status">This tender is closed. Your last submission stands.</div>}
            {open && state.compliance.issues.length > 0 && (
              <details open={!submitted}>
                <summary>{state.compliance.issues.length} thing(s) to finish before you can submit</summary>
                <ul style={{ margin: '4px 0 0' }}>{state.compliance.issues.slice(0, 30).map((x, i) => <li key={i}>{x.message}</li>)}</ul>
              </details>
            )}
            {open && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button isLoading={busy} disabled={submitted && dirty.size === 0} onClick={submit}>{submitted ? 'Submitted' : 'Submit tender'}</Button>
                {submitted && <Button variant="secondary" disabled={busy} onClick={() => run(async () => { const r = await reopenSubmissionAction(tenderId); if ('error' in r) setMsg({ ok: false, text: r.error }); router.refresh() })}>Withdraw to edit</Button>}
              </div>
            )}
            {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Price the bill of quantities</span></CardHeader>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <Button variant="secondary" size="sm" disabled={busy} onClick={download}>Download BOQ (Excel)</Button>
            {open && (
              <label style={{ fontSize: 13 }}>
                Upload priced copy <input type="file" accept=".xlsx,.xlsm" disabled={busy} onChange={(e) => e.target.files?.[0] && uploadPriced(e.target.files[0])} />
              </label>
            )}
          </div>
          {excelMsg && (
            <div role={excelMsg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: excelMsg.ok ? 'inherit' : 'var(--c-red)', marginBottom: 8 }}>
              <ul style={{ margin: 0 }}>{excelMsg.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="tablist" aria-label="Bills">
            {sheets.map((s) => (
              <button key={s} role="tab" aria-selected={s === sheet} onClick={() => setSheet(s)} className={s === sheet ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}>{s}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
              <thead><tr><th>Item</th><th style={{ textAlign: 'left' }}>Description</th><th>Unit</th><th>Qty</th><th>Rate (R)</th><th>Amount</th></tr></thead>
              <tbody>
                {rows.map((i) => {
                  if (i.kind !== 'item') {
                    return (
                      <tr key={i.id}><td style={{ fontWeight: 600 }}>{i.code ?? ''}</td><td colSpan={5} style={{ fontWeight: i.kind === 'heading' ? 600 : 400, fontStyle: i.kind === 'note' ? 'italic' : 'normal' }}>{i.description}</td></tr>
                    )
                  }
                  const t = i.rate_cell_type
                  const r = rates[i.id] ?? ''
                  const amount =
                    t === 'fixed' ? Number(i.fixed_amount ?? 0)
                    : t === 'priced' && i.quantity != null && r !== '' && Number.isFinite(Number(r)) ? cents(Number(i.quantity) * Number(r)) / 100
                    : null
                  return (
                    <tr key={i.id}>
                      <td>{i.code ?? ''}</td>
                      <td>{i.description}</td>
                      <td>{i.unit ?? ''}</td>
                      <td style={{ textAlign: 'right' }}>{i.quantity ?? ''}</td>
                      <td>
                        {t === 'fixed' ? (
                          <span>Fixed</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                              aria-label={`Rate for ${i.code ?? i.description}`}
                              inputMode="decimal"
                              value={r}
                              disabled={!open || !!notPriced[i.id]}
                              onChange={(e) => {
                                setRates({ ...rates, [i.id]: e.target.value })
                                setDirty(new Set(dirty).add(i.id))
                              }}
                              style={{ width: 110 }}
                            />
                            {t === 'not_priced' && (
                              <label style={{ fontSize: 11 }}>
                                <input type="checkbox" disabled={!open} checked={!!notPriced[i.id]} onChange={(e) => {
                                  setNotPriced({ ...notPriced, [i.id]: e.target.checked })
                                  if (e.target.checked) setRates({ ...rates, [i.id]: '' })
                                  setDirty(new Set(dirty).add(i.id))
                                }} /> not priced
                              </label>
                            )}
                            {t === 'rate_only' && <span style={{ fontSize: 11 }}>rate only</span>}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{amount == null ? '' : money(amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {open && (
            <div style={{ position: 'sticky', bottom: 0, background: 'var(--c-panel, #fff)', padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button isLoading={busy} disabled={dirty.size === 0} onClick={saveRates}>Save rates{dirty.size ? ` (${dirty.size})` : ''}</Button>
              <span style={{ fontSize: 13 }}>Total {money(total)}</span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Documents and declarations</span></CardHeader>
        <CardBody>
          {state.requirements.length === 0 && <p style={{ margin: 0 }}>None requested.</p>}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {state.requirements.map((req) => {
              const docs = state.documents.filter((d) => d.requirement_id === req.id)
              return (
                <li key={req.id} style={{ fontSize: 14 }}>
                  {req.kind === 'declaration' ? (
                    <label>
                      <input
                        type="checkbox"
                        disabled={!open || busy}
                        checked={decl.has(req.id)}
                        onChange={(e) => {
                          const next = new Set(decl)
                          if (e.target.checked) next.add(req.id)
                          else next.delete(req.id)
                          setDecl(next)
                          run(async () => { const r = await setDeclarationsAction(tenderId, Array.from(next)); if ('error' in r) setMsg({ ok: false, text: r.error }); router.refresh() })
                        }}
                      />{' '}
                      {req.label}{req.mandatory ? ' (required)' : ''}{req.detail ? ` — ${req.detail}` : ''}
                    </label>
                  ) : (
                    <div>
                      <strong>{req.label}</strong>{req.mandatory ? ' (required)' : ' (optional)'}{req.detail ? ` — ${req.detail}` : ''}
                      <ul style={{ margin: '4px 0' }}>
                        {docs.map((d) => (
                          <li key={d.id}>
                            {d.file_name} ({Math.ceil(d.size_bytes / 1024)} KB){' '}
                            {open && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(async () => { const r = await deleteDocumentAction(tenderId, d.id); if ('error' in r) setMsg({ ok: false, text: r.error }); router.refresh() })}>Remove</button>}
                          </li>
                        ))}
                      </ul>
                      {open && <input type="file" aria-label={`Upload ${req.label}`} disabled={busy} onChange={(e) => e.target.files?.[0] && uploadDoc(req.id, e.target.files[0])} />}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Questions and addenda</span></CardHeader>
        <CardBody>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, fontSize: 14 }}>
            {state.clarifications.map((c) => (
              <li key={c.id} style={{ borderLeft: `3px solid ${c.kind === 'addendum' ? 'var(--c-amber)' : 'var(--c-border)'}`, paddingLeft: 8 }}>
                <strong>{c.kind === 'addendum' ? 'Addendum: ' : c.mine ? 'Your question: ' : 'Question: '}{c.title}</strong>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                {c.answer && <div style={{ whiteSpace: 'pre-wrap' }}><em>Answer:</em> {c.answer}</div>}
                {c.kind === 'question' && c.mine && !c.published_at && <div style={{ fontSize: 12 }}>{c.answer ? 'Answered privately.' : 'Awaiting an answer.'}</div>}
                {c.kind === 'addendum' && (
                  c.acknowledged ? <div style={{ fontSize: 12 }}>Acknowledged.</div>
                  : open && <Button size="sm" disabled={busy} onClick={() => run(async () => { const r = await acknowledgeAddendumAction(tenderId, c.id); if ('error' in r) setMsg({ ok: false, text: r.error }); router.refresh() })}>Acknowledge</Button>
                )}
              </li>
            ))}
          </ul>
          {open && (
            <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              <input placeholder="Question title" aria-label="Question title" value={question.title} onChange={(e) => setQuestion({ ...question, title: e.target.value })} />
              <textarea placeholder="Your question" aria-label="Your question" rows={3} value={question.body} onChange={(e) => setQuestion({ ...question, body: e.target.value })} />
              <div>
                <Button size="sm" disabled={busy || !question.title.trim() || !question.body.trim()} onClick={() => run(async () => {
                  const r = await askQuestionAction(tenderId, question.title, question.body)
                  if ('error' in r) return setMsg({ ok: false, text: r.error })
                  setQuestion({ title: '', body: '' })
                  router.refresh()
                })}>Ask the engineer</Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
