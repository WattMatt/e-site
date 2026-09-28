'use client'
/** "Import from Dropbox folder" (spec §4.3): browse the project's mapped folder, tick meter files, copy them into Solar storage, review. */
import { useCallback, useEffect, useState } from 'react'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { parseFiles } from '@/lib/solar/load/import-client'
import { loadErrorMessage } from '@/lib/solar/load/messages'

/** Files under 1 MB read in kB; "0.0 MB" says nothing. */
const sizeLabel = (b: number) => (b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1_048_576).toFixed(1)} MB`)

interface Item { id: string; name: string; type: 'file' | 'folder'; size: number | null }

export function CloudImportDialog({ projectId, onReviews, onClose }: { projectId: string; onReviews: (r: ReviewModel[]) => void; onClose: () => void }) {
  const [stack, setStack] = useState<Array<{ id: string | null; name: string }>>([{ id: null, name: 'Mapped folder' }])
  const [items, setItems] = useState<Item[]>([])
  const [picked, setPicked] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const folder = stack[stack.length - 1]

  const load = useCallback(async (folderId: string | null) => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/cloud-files${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`)
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(loadErrorMessage(body.error === 'no_mapping' ? 'no_mapping' : 'commit_failed')); return }
    setItems(body.items as Item[])
  }, [projectId])
  useEffect(() => { void load(folder.id) }, [folder.id, load])

  async function doImport() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/cloud-files/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [...picked].map(([id, name]) => ({ id, name })) }),
    })
    const body = await res.json().catch(() => ({ results: [] }))
    const ids: string[] = []
    const out: string[] = []
    for (const r of (body.results ?? []) as Array<{ name: string; fileId?: string; error?: string; meters?: Array<{ label: string; siteLabel: string | null }> }>) {
      if (r.error === 'duplicate_in_other_project') out.push(`${r.name}: Same data as ${r.meters?.[0]?.label ?? 'a meter'}${r.meters?.[0]?.siteLabel ? ` at ${r.meters[0].siteLabel}` : ''} — use Copy from org meter library.`)
      else if (r.error) out.push(`${r.name}: ${loadErrorMessage(r.error)}`)
      else if (r.fileId) ids.push(r.fileId)
    }
    if (ids.length > 0) {
      const parsed = await parseFiles(projectId, ids)
      out.push(...parsed.failed.map((f) => f.message))
      setNotes(out)
      setBusy(false)
      if (parsed.reviews.length > 0) onReviews(parsed.reviews)
      return
    }
    setNotes(out)
    setBusy(false)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Import from Dropbox folder" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 640, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16 }}>
        <header style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Import from Dropbox folder</h2>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </header>
        <nav aria-label="Folder path" style={{ fontSize: 12, margin: '8px 0' }}>
          {stack.map((f, i) => (
            <span key={`${f.id}-${i}`}>{i > 0 && ' / '}
              <button type="button" disabled={i === stack.length - 1} onClick={() => setStack(stack.slice(0, i + 1))} style={{ background: 'none', border: 'none', color: 'var(--c-amber)', cursor: 'pointer' }}>{f.name}</button>
            </span>
          ))}
        </nav>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        {!error && items.length === 0 && !busy && <p style={{ fontSize: 13 }}>No meter files (.csv, .txt, .xlsx, .xls) in this folder.</p>}
        <ul style={{ listStyle: 'none', padding: 0, maxHeight: 360, overflow: 'auto', fontSize: 13 }}>
          {items.map((it) => (
            <li key={it.id} style={{ padding: '3px 0' }}>
              {it.type === 'folder' ? (
                <button type="button" onClick={() => setStack([...stack, { id: it.id, name: it.name }])} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>📁 {it.name}</button>
              ) : (
                <label><input type="checkbox" aria-label={it.name} checked={picked.has(it.id)} disabled={!picked.has(it.id) && picked.size >= 20}
                  onChange={(e) => setPicked((p) => { const n = new Map(p); if (e.target.checked) n.set(it.id, it.name); else n.delete(it.id); return n })} /> {it.name}{it.size ? ` · ${sizeLabel(it.size)}` : ''}</label>
              )}
            </li>
          ))}
        </ul>
        {notes.length > 0 && <ul style={{ fontSize: 12 }}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', alignSelf: 'center' }}>Up to 20 files at a time</span>
          <button type="button" disabled={busy || picked.size === 0} onClick={doImport}>{busy ? 'Working…' : `Import ${picked.size} file${picked.size === 1 ? '' : 's'}`}</button>
        </footer>
      </div>
    </div>
  )
}
