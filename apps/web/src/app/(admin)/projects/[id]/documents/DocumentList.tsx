'use client'

/**
 * DocumentList — flat sortable table of synced + locally-uploaded docs.
 * Phase 1 minimum: name, category, size, source, synced-at, download
 * link. Phase 2 polish: search/filter, multi-select bulk delete,
 * preview pane.
 */

import { useState, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const PROVIDER_BADGE: Record<string, string> = {
  dropbox: 'Dropbox',
  google_drive: 'Drive',
  onedrive: 'OneDrive',
}

export interface DocumentListItem {
  id: string
  name: string
  category: string | null
  sizeBytes: number | null
  mimeType: string | null
  storagePath: string
  sourceProvider: 'dropbox' | 'google_drive' | 'onedrive' | null
  sourcePath: string | null
  syncedAt: string | null
  createdAt: string
}

export function DocumentList({ documents }: { documents: DocumentListItem[] }) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return documents
    const q = filter.toLowerCase()
    return documents.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.category ?? '').toLowerCase().includes(q) ||
        (d.sourcePath ?? '').toLowerCase().includes(q),
    )
  }, [documents, filter])

  if (documents.length === 0) {
    return (
      <div className="data-panel" style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: 'var(--c-text-dim)', fontSize: 14, margin: 0 }}>
          No documents yet. Upload one or sync from your cloud folder.
        </p>
      </div>
    )
  }

  return (
    <>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter documents…"
        style={{
          width: '100%', padding: '8px 12px', marginBottom: 8,
          background: 'var(--c-panel)', border: '1px solid var(--c-border)',
          borderRadius: 6, color: 'var(--c-text)', fontSize: 13,
        }}
      />
      <div className="data-panel">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
              <th style={th}>Name</th>
              <th style={th}>Category</th>
              <th style={{ ...th, textAlign: 'right' }}>Size</th>
              <th style={th}>Source</th>
              <th style={th}>Added</th>
              <th style={{ ...th, width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => (
              <tr
                key={d.id}
                style={{ borderTop: i > 0 ? '1px solid var(--c-border)' : 'none' }}
              >
                <td style={td}>
                  <div style={{ color: 'var(--c-text)', fontWeight: 500 }}>{d.name}</div>
                  {d.sourcePath && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                      {d.sourcePath}
                    </div>
                  )}
                </td>
                <td style={td}>
                  {d.category && <span className="badge">{d.category}</span>}
                </td>
                <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {formatBytes(d.sizeBytes)}
                </td>
                <td style={td}>
                  {d.sourceProvider ? (
                    <span className="badge badge-amber">{PROVIDER_BADGE[d.sourceProvider]}</span>
                  ) : (
                    <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>Local</span>
                  )}
                </td>
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
                  {new Date(d.syncedAt ?? d.createdAt).toISOString().slice(0, 10)}
                </td>
                <td style={td}>
                  <DownloadLink path={d.storagePath} name={d.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function DownloadLink({ path, name }: { path: string; name: string }) {
  async function onClick() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data, error } = await supabase.storage
      .from('project-documents')
      .createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) {
      alert(`Cannot download: ${error?.message ?? 'no URL'}`)
      return
    }
    window.open(data.signedUrl, '_blank')
  }
  return (
    <button onClick={onClick} style={dlBtn} title={`Download ${name}`}>
      Download
    </button>
  )
}

function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontFamily: 'var(--font-mono)',
  fontSize: 10, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em',
}
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' }
const dlBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--c-border)', color: 'var(--c-amber)',
  padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
}
