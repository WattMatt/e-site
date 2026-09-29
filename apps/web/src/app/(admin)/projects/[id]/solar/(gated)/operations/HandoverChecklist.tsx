'use client'
/**
 * Handover checklist (spec §10): each item links ONE file in E-Site Documents (tenants.documents of this
 * project) or is marked N/A. Upload happens in the Documents module; nothing here depends on folder names.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { OperationsView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/FormField'
import { linkHandoverDocumentAction, setHandoverNotApplicableAction, syncHandoverItemsAction } from '@/actions/solar-handover.actions'

interface Props { projectId: string; installationId: string; canEdit: boolean; handover: OperationsView['handover'] }

export function HandoverChecklist({ projectId, installationId, canEdit, handover }: Props) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const c = handover.completion
  const after = (r: { ok: true } | { error: string }) => { if ('error' in r) setMsg(r.error); else router.refresh() }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{`Handover — ${handover.templateName || 'checklist'}`}</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, marginTop: 0 }}>{`${c.done} of ${c.total} items (${c.pct} %) · ${c.requiredDone} of ${c.requiredTotal} required`}</p>
        <div role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, background: 'var(--c-border)', borderRadius: 3, marginBottom: 12 }}>
          <div style={{ width: `${c.pct}%`, height: 6, background: 'var(--c-amber)', borderRadius: 3 }} />
        </div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {handover.items.map((i) => (
              <tr key={i.id}>
                <td>{i.label}{i.required ? <span style={{ color: 'var(--c-amber)', marginLeft: 4 }}>*</span> : null}</td>
                <td>
                  {canEdit ? (
                    <Select aria-label={`Document for ${i.label}`} value={i.documentId ?? ''} disabled={i.notApplicable}
                      onChange={async (e) => after(await linkHandoverDocumentAction({ projectId, itemId: i.id, documentId: e.target.value || null }))}>
                      <option value="">No document linked</option>
                      {handover.documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </Select>
                  ) : (i.notApplicable ? 'Not applicable' : (i.documentName ?? 'Missing'))}
                </td>
                <td>
                  {canEdit ? (
                    <label style={{ fontSize: 12 }}>
                      <input type="checkbox" aria-label={`${i.label} not applicable`} checked={i.notApplicable}
                        onChange={async (e) => after(await setHandoverNotApplicableAction({ projectId, itemId: i.id, notApplicable: e.target.checked, note: i.note ?? '' }))} />
                      {' N/A'}
                    </label>
                  ) : null}
                </td>
                <td style={{ color: 'var(--c-text-dim)' }}>{i.completedAt ? 'Complete' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <Link href={`/projects/${projectId}/documents`}>Upload to Documents</Link>
          {canEdit ? <Button size="sm" variant="secondary" onClick={async () => {
            const r = await syncHandoverItemsAction({ projectId, installationId })
            if ('error' in r) setMsg(r.error)
            else { setMsg(r.added === 0 ? 'The checklist already has every template item.' : `${r.added} item(s) added.`); router.refresh() }
          }}>Add missing items from the template</Button> : null}
        </div>
        {msg ? <p role="status" style={{ fontSize: 13 }}>{msg}</p> : null}
      </CardBody>
    </Card>
  )
}
