'use client'
/** Org handover template (spec §10: "template editable in org settings"). Owner/admin; checked again by the action and 00217. */
import { useState } from 'react'
import type { HandoverTemplate } from '@esite/shared/solar-operations/client'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput } from '@/components/ui/FormField'
import { saveHandoverTemplateAction } from '@/actions/solar-handover.actions'

export function HandoverTemplateForm({ initial, updatedAt }: { initial: HandoverTemplate; updatedAt: string | null }) {
  const [name, setName] = useState(initial.name)
  const [items, setItems] = useState(initial.items.map((i) => ({ ...i })))
  const [version, setVersion] = useState(updatedAt)
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: number, patch: Partial<HandoverTemplate['items'][number]>) => setItems((xs) => xs.map((x, i) => (i === k ? { ...x, ...patch } : x)))
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Solar handover checklist template</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>New installations copy these items. Each item is later linked to one file in the project’s Documents.</p>
        <FormField label="Template name" htmlFor="ho-name"><TextInput id="ho-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <table style={{ width: '100%', fontSize: 13, marginTop: 12, borderCollapse: 'collapse' }}>
          <thead><tr><th align="left">Key</th><th align="left">Label</th><th align="left">Required</th><th /></tr></thead>
          <tbody>
            {items.map((it, k) => (
              <tr key={k}>
                <td><TextInput aria-label={`Key of item ${k + 1}`} value={it.key} onChange={(e) => set(k, { key: e.target.value })} /></td>
                <td><TextInput aria-label={`Label of item ${k + 1}`} value={it.label} onChange={(e) => set(k, { label: e.target.value })} /></td>
                <td><input type="checkbox" aria-label={`Item ${k + 1} required`} checked={it.required} onChange={(e) => set(k, { required: e.target.checked })} /></td>
                <td><Button size="sm" variant="ghost" onClick={() => setItems((xs) => xs.filter((_, i) => i !== k))}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <Button size="sm" variant="secondary" onClick={() => setItems((xs) => [...xs, { key: '', label: '', required: true }])}>Add item</Button>
          <Button onClick={async () => {
            const r = await saveHandoverTemplateAction({ name, items, expectedUpdatedAt: version })
            if ('fieldErrors' in r) { setMsg(Object.values(r.fieldErrors).join(' ')); return }
            if ('error' in r) { setMsg(r.error); return }
            setVersion(r.updatedAt)
            setMsg('Saved.')
          }}>Save handover template</Button>
          {msg ? <span role="status" style={{ fontSize: 13 }}>{msg}</span> : null}
        </div>
      </CardBody>
    </Card>
  )
}
