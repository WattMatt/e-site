// apps/web/src/app/(admin)/projects/[id]/items/[ref]/page.tsx
// Minimal work-item page: the "Open in E-Site" target until the Inbox (Q1 items 5/6)
// supersedes it. Every read goes through the caller's RLS: an item they cannot
// read is a 404.
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { stateLabel, type WorkItemStatus } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { noteText, logRows } from '@/lib/whatsapp/item-page-data'

interface Props { params: Promise<{ id: string; ref: string }> }

export default async function WorkItemPage({ params }: Props) {
  const { id: projectId, ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef)
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.schema('projects').from('work_items')
    .select('id, ref, title, item_type, status, due_date, assignee_id, gatekeeper_id, ball_in_court_id')
    .eq('project_id', projectId).eq('ref', ref).maybeSingle()
  if (!item) notFound()

  const [people, notes, atts, outbox, inbound] = await Promise.all([
    sb.from('profiles').select('id, full_name').in('id', [item.assignee_id, item.gatekeeper_id]),
    sb.schema('projects').from('work_item_notes').select('id, body, redacted_at, via, created_at, author_id').eq('work_item_id', item.id).order('created_at'),
    sb.schema('projects').from('work_item_attachments').select('id, bucket, storage_path, role, via, redacted_at, created_at').eq('work_item_id', item.id).order('created_at'),
    sb.schema('whatsapp').from('outbox').select('id, trigger, status, error_text, created_at, sent_at').eq('work_item_id', item.id),
    sb.schema('whatsapp').from('inbound').select('id, kind, outcome, outcome_reason, received_at').eq('resolved_item_id', item.id),
  ])
  const name = (uid: string) => (people.data ?? []).find((p: { id: string }) => p.id === uid)?.full_name ?? '—'
  const visibleAtts = (atts.data ?? []).filter((a: { redacted_at: string | null }) => !a.redacted_at)
  const signed = await Promise.all(visibleAtts.map(async (a: { bucket: string; storage_path: string; id: string; role: string }) => {
    const { data } = await supabase.storage.from(a.bucket).createSignedUrl(a.storage_path, 600)
    return { ...a, url: data?.signedUrl ?? null }
  }))
  const log = logRows(outbox.data ?? [], inbound.data ?? [])

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">{item.ref} · {item.title}</h1>
        <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          {stateLabel(item.item_type, item.status as WorkItemStatus)} · due {item.due_date} · assignee {name(item.assignee_id)} · signs off {name(item.gatekeeper_id)}
        </div>
      </div>

      <Card>
        <CardHeader><h2 style={{ margin: 0, fontSize: 14 }}>Notes</h2></CardHeader>
        <CardBody>
          {(notes.data ?? []).length === 0 ? <p style={{ fontSize: 12 }}>No notes yet.</p> : (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
              {(notes.data ?? []).map((n: { id: string; body: string; redacted_at: string | null; via: string; created_at: string }) => (
                <li key={n.id}>{noteText(n)} <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>{n.via === 'whatsapp' ? 'via WhatsApp · ' : ''}{new Date(n.created_at).toLocaleString('en-ZA')}</span></li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 style={{ margin: 0, fontSize: 14 }}>Photos</h2></CardHeader>
        <CardBody>
          {signed.length === 0 ? <p style={{ fontSize: 12 }}>No photos yet.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {signed.map((a) => a.url && (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={`${a.role} photo`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', background: '#000' }} />
                </a>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 style={{ margin: 0, fontSize: 14 }}>WhatsApp log</h2></CardHeader>
        <CardBody>
          {log.length === 0 ? <p style={{ fontSize: 12 }}>No WhatsApp messages for this item.</p> : (
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.at).toLocaleString('en-ZA')}</td>
                    <td>{r.direction === 'out' ? '→ sent' : '← received'}</td>
                    <td>{r.label}</td>
                    <td>{r.status}</td>
                    <td style={{ color: 'var(--c-text-dim)' }}>{r.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
