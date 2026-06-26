'use client'

/**
 * CloudFolderPicker — modal dialog that browses a connected cloud-storage
 * folder hierarchy and returns the user's selection. Driven by
 * listCloudFolderAction; only renders folders (files are filtered out
 * because the picker selects A FOLDER per project, not individual files).
 *
 * Phase 1 minimum-viable UI: list the immediate children of the current
 * folder, breadcrumb up the chain, "Select this folder" button. No fuzzy
 * search yet — that's a Phase 3 polish.
 */

import { useEffect, useState, useTransition } from 'react'
import type { CloudItem, ProviderName } from '@esite/shared'
import { listCloudFolderAction } from '@/actions/cloud-storage.actions'

interface PickedFolder {
  folderId: string
  folderPath: string
}

interface BreadcrumbEntry {
  id: string | null
  name: string
}

interface Props {
  connectionId: string
  /** Display label for the connection — e.g. "Dropbox · arno@dropbox.com". */
  connectionLabel: string
  provider: ProviderName
  open: boolean
  onClose: () => void
  onPick: (folder: PickedFolder) => void
}

export function CloudFolderPicker({
  connectionId,
  connectionLabel,
  provider,
  open,
  onClose,
  onPick,
}: Props) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([{ id: null, name: 'Root' }])
  const [items, setItems] = useState<CloudItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined)

  const currentFolder = breadcrumbs[breadcrumbs.length - 1]!

  // Load children whenever the current folder changes.
  useEffect(() => {
    if (!open) return
    setError(null)
    setItems([])
    setNextPageToken(undefined)
    startTransition(async () => {
      try {
        const r = await listCloudFolderAction({
          connectionId,
          folderId: currentFolder.id,
        })
        // Filter to folders only — picker is for selecting a folder.
        setItems(r.items.filter((i) => i.type === 'folder'))
        setNextPageToken(r.nextPageToken)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to list folder')
      }
    })
  }, [connectionId, currentFolder.id, open])

  function loadMore() {
    if (!nextPageToken) return
    startTransition(async () => {
      try {
        const r = await listCloudFolderAction({
          connectionId,
          folderId: currentFolder.id,
          pageToken: nextPageToken,
        })
        setItems((prev) => [...prev, ...r.items.filter((i) => i.type === 'folder')])
        setNextPageToken(r.nextPageToken)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to list folder')
      }
    })
  }

  function pickHere() {
    if (currentFolder.id === null) {
      setError('Cannot select the root — pick a sub-folder.')
      return
    }
    onPick({
      folderId: currentFolder.id,
      folderPath: breadcrumbs
        .slice(1)
        .map((b) => b.name)
        .join('/'),
    })
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Pick a cloud folder"
      style={overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={modal}>
        <header style={header}>
          <div>
            <h2 style={title}>Pick a {providerLabel(provider)} folder</h2>
            <p style={subtitle}>{connectionLabel}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>
            ×
          </button>
        </header>

        {/* Breadcrumb path */}
        <nav style={breadcrumbsBar} aria-label="Folder path">
          {breadcrumbs.map((b, i) => (
            <span key={`${b.id ?? 'root'}-${i}`}>
              {i > 0 && <span style={sep}>/</span>}
              <button
                style={i === breadcrumbs.length - 1 ? crumbActive : crumb}
                onClick={() => {
                  if (i < breadcrumbs.length - 1) {
                    setBreadcrumbs(breadcrumbs.slice(0, i + 1))
                  }
                }}
                disabled={i === breadcrumbs.length - 1}
              >
                {b.name}
              </button>
            </span>
          ))}
        </nav>

        {/* Items list */}
        <div style={listArea}>
          {pending && items.length === 0 && <p style={dim}>Loading…</p>}
          {error && <p style={errorText}>{error}</p>}
          {!pending && !error && items.length === 0 && (
            <p style={dim}>No sub-folders here.</p>
          )}
          <ul style={list}>
            {items.map((it) => (
              <li key={it.id}>
                <button
                  style={folderRow}
                  onClick={() => setBreadcrumbs([...breadcrumbs, { id: it.id, name: it.name }])}
                >
                  📁 {it.name}
                </button>
              </li>
            ))}
          </ul>
          {nextPageToken && (
            <button onClick={loadMore} disabled={pending} style={loadMoreBtn}>
              {pending ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>

        <footer style={footer}>
          <button onClick={onClose} style={btnGhost}>
            Cancel
          </button>
          <button onClick={pickHere} disabled={currentFolder.id === null} style={btnPrimary}>
            Use this folder
          </button>
        </footer>
      </div>
    </div>
  )
}

function providerLabel(p: ProviderName): string {
  return p === 'dropbox' ? 'Dropbox' : p === 'google_drive' ? 'Google Drive' : 'OneDrive'
}

// ---------------------------------------------------------------------------
// Inline styles — mapped onto the app's theme CSS variables so the picker
// adapts to light/dark. The overlay scrim stays a fixed translucent black.
// ---------------------------------------------------------------------------

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const modal: React.CSSProperties = {
  background: 'var(--c-panel)', color: 'var(--c-text)', border: '1px solid var(--c-border)',
  borderRadius: 12, width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
}
const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '16px 20px', borderBottom: '1px solid var(--c-border)',
}
const title: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--c-text)' }
const subtitle: React.CSSProperties = { margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }
const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--c-text-mid)', fontSize: 24, cursor: 'pointer',
  width: 28, height: 28, lineHeight: 1,
}
const breadcrumbsBar: React.CSSProperties = {
  padding: '10px 20px', borderBottom: '1px solid var(--c-border)', fontSize: 12,
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
}
const crumb: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--c-amber)', cursor: 'pointer',
  padding: '2px 4px', fontSize: 12,
}
const crumbActive: React.CSSProperties = { ...crumb, color: 'var(--c-text)', cursor: 'default' }
const sep: React.CSSProperties = { color: 'var(--c-text-dim)', margin: '0 2px' }
const listArea: React.CSSProperties = { padding: '12px 20px', overflowY: 'auto', flex: 1 }
const list: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0 }
const folderRow: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'none', border: '1px solid transparent',
  color: 'var(--c-text)', cursor: 'pointer', padding: '8px 12px', borderRadius: 6, fontSize: 14,
}
const dim: React.CSSProperties = { color: 'var(--c-text-mid)', fontSize: 13, margin: '8px 0' }
const errorText: React.CSSProperties = { color: 'var(--c-red)', fontSize: 13, margin: '8px 0' }
const loadMoreBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--c-border)', color: 'var(--c-amber)', cursor: 'pointer',
  padding: '6px 12px', borderRadius: 6, fontSize: 12, marginTop: 8,
}
const footer: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '12px 20px', borderTop: '1px solid var(--c-border)',
}
const btnGhost: React.CSSProperties = {
  background: 'none', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)',
  padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
}
const btnPrimary: React.CSSProperties = {
  background: 'var(--c-amber-fill)', border: '1px solid var(--c-amber-fill)', color: 'var(--c-on-amber)',
  padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
}
