'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAP_RULES, CARRY_FORWARD, CREDITING } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSsegRuleAction } from '@/actions/tariff-review.actions'
import type { SsegForm } from '@/lib/tariffs/sseg-form'

export function SsegRuleForm({ yearId, initial, editable, documents }: {
  yearId: string; initial: SsegForm; editable: boolean; documents: Array<{ id: string; title: string }>
}) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const sel = (k: keyof SsegForm, opts: readonly string[]) => (
    <select value={String(f[k])} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
  )
  const chk = (k: 'forfeit' | 'requiresTou' | 'requiresBidirectional') => (
    <input type="checkbox" checked={f[k]} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
  )
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      {!editable && <p>This year is published: the rule is read-only.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>Crediting {sel('crediting', CREDITING)}</label>
        <label>Carry forward {sel('carryForward', CARRY_FORWARD)}</label>
        <label>Financial year ends (month) {sel('fyEndMonth', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])}</label>
        <label>Cap {sel('capRule', CAP_RULES)}</label>
        <label>Maximum size (kVA) <input value={f.maxKva} disabled={!editable} onChange={(e) => setF({ ...f, maxKva: e.target.value })} /></label>
        <label>{chk('forfeit')} Credit forfeited on change of ownership</label>
        <label>{chk('requiresTou')} Requires a TOU tariff</label>
        <label>{chk('requiresBidirectional')} Requires a bidirectional meter</label>
        <label>Source document <select value={f.sourceDocumentId} disabled={!editable} onChange={(e) => setF({ ...f, sourceDocumentId: e.target.value })}>
          <option value="">None</option>{documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select></label>
        <label>Pages <input value={f.pages} disabled={!editable} onChange={(e) => setF({ ...f, pages: e.target.value })} placeholder="pp7-12" /></label>
      </div>
      {editable && <div>
        <Button isLoading={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          const r = await saveSsegRuleAction({ yearId, form: f })
          setBusy(false)
          if ('fieldErrors' in r) setMsg({ ok: false, text: Object.values(r.fieldErrors).join(' ') })
          else if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: true, text: 'Saved.' }); router.refresh() }
        }}>Save SSEG rule</Button>
      </div>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
