'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CAP_RULES, CARRY_FORWARD, CREDITING, SSEG_CAP_RULE_LABELS, SSEG_CARRY_FORWARD_LABELS, SSEG_CREDITING_LABELS,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSsegRuleAction } from '@/actions/tariff-review.actions'
import type { SsegForm } from '@/lib/tariffs/sseg-form'

const MONTHS: Record<string, string> = Object.fromEntries(
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => [String(i + 1), m]),
)

export function SsegRuleForm({ yearId, initial, initialUpdatedAt, editable, documents }: {
  yearId: string; initial: SsegForm; initialUpdatedAt: string | null; editable: boolean; documents: Array<{ id: string; title: string }>
}) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const sel = (k: keyof SsegForm, opts: readonly string[], labels?: Record<string, string>) => (
    <select value={String(f[k])} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{opts.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}</select>
  )
  const chk = (k: 'forfeit' | 'requiresTou' | 'requiresBidirectional') => (
    <input type="checkbox" checked={f[k]} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
  )
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      {!editable && <p>This year is published: the rule is read-only.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label>Crediting {sel('crediting', CREDITING, SSEG_CREDITING_LABELS)}</label>
        <label>Carry forward {sel('carryForward', CARRY_FORWARD, SSEG_CARRY_FORWARD_LABELS)}</label>
        <label>Financial year ends (month) {sel('fyEndMonth', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], MONTHS)}</label>
        <label>Cap {sel('capRule', CAP_RULES, SSEG_CAP_RULE_LABELS)}</label>
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
          const r = await saveSsegRuleAction({ yearId, expectedUpdatedAt: updatedAt, form: f })
          setBusy(false)
          if ('fieldErrors' in r) setMsg({ ok: false, text: Object.values(r.fieldErrors).join(' ') })
          else if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setUpdatedAt(r.updatedAt); setMsg({ ok: true, text: 'Saved.' }); router.refresh() }
        }}>Save SSEG rule</Button>
      </div>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
