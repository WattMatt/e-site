'use client'
/** Checks sub-tab (spec §4.6): every site-level check from the last build and every import report; Edit may acknowledge a warning. */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { acknowledgeCheckAction, unacknowledgeCheckAction } from '@/actions/solar-load.actions'
import { loadHref } from '@/lib/solar/load/subtabs'
import type { ChecksView } from '@/lib/solar/load/view-types'

const COLOUR = { error: '#dc2626', warning: '#b45309', info: 'var(--c-text-mid)' } as const

export function ChecksPanel({ projectId, view, canEdit }: { projectId: string; view: ChecksView; canEdit: boolean }) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function ack(key: string) {
    setBusy(key); setError(null)
    const r = await acknowledgeCheckAction({ projectId, checkKey: key, note: notes[key]?.trim() || null })
    setBusy(null)
    if ('error' in r) setError(r.error); else router.refresh()
  }
  async function unack(key: string) {
    setBusy(key); setError(null)
    const r = await unacknowledgeCheckAction({ projectId, checkKey: key })
    setBusy(null)
    if ('error' in r) setError(r.error); else router.refresh()
  }

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      <section aria-label="Site checks">
        <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Site checks{view.builtAt ? ` (profile built ${new Date(view.builtAt).toLocaleString('en-ZA')})` : ''}</h3>
        {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
        {view.checks.length === 0 ? <p>{view.builtAt ? 'No checks raised.' : 'Build the site profile (Site profile tab) to run the checks.'}</p> : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {view.checks.map((c) => (
                <tr key={c.key} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td style={{ color: COLOUR[c.severity], textTransform: 'uppercase', fontSize: 11, width: 70 }}>{c.severity}</td>
                  <td>{c.message}{' '}
                    {c.meterId && <Link href={loadHref(projectId, 'meters', { meter: c.meterId })}>Open meter</Link>}
                    {c.nodeId && <Link href={loadHref(projectId, 'tenants')}>Open tenants</Link>}
                  </td>
                  <td style={{ width: 280 }}>
                    {c.ack ? (
                      <span>Acknowledged {c.ack.at.slice(0, 10)}{c.ack.note ? ` — ${c.ack.note}` : ''}
                        {canEdit && <> <button type="button" disabled={busy === c.key} onClick={() => unack(c.key)}>Undo</button></>}
                      </span>
                    ) : canEdit && c.severity !== 'info' ? (
                      <span>
                        <input aria-label={`Note for ${c.key}`} placeholder="Note (optional)" value={notes[c.key] ?? ''} onChange={(e) => setNotes({ ...notes, [c.key]: e.target.value })} style={{ width: 130 }} />{' '}
                        <button type="button" disabled={busy === c.key} onClick={() => ack(c.key)}>{busy === c.key ? 'Saving…' : 'Mark as acknowledged'}</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Import reports">
        <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Import reports</h3>
        {view.imports.length === 0 ? <p>No imported meter files in this study.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {view.imports.map((f) => (
              <li key={f.fileId}>
                <strong>{f.fileName}</strong> · format {f.format ?? '—'} · {f.acceptedAt ? `accepted ${f.acceptedAt.slice(0, 10)}` : 'not accepted'}
                {(f.errors.length > 0 || f.warnings.length > 0) && (
                  <ul style={{ fontSize: 12 }}>
                    {f.errors.map((e, i) => <li key={`e${i}`} style={{ color: '#dc2626' }}>{e.message}</li>)}
                    {f.warnings.map((w, i) => <li key={`w${i}`} style={{ color: '#b45309' }}>{w.message}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
