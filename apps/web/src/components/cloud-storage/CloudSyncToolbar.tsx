'use client'

/**
 * CloudSyncToolbar — surfaces the project's cloud-folder mapping + lets
 * the user re-pick the folder, sync now, or clear the mapping. Used on
 * both the /projects/[id]/documents and /projects/[id]/floor-plans pages.
 *
 * The same mapping feeds both tables. The `intent` prop tells the edge
 * function which table to target for THIS sync run, so files always land
 * on the tab the user clicked from regardless of extension/folder name.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CloudFolderPicker } from './CloudFolderPicker'
import {
  clearProjectCloudFolderAction,
  setProjectCloudFolderAction,
  syncProjectCloudFolderAction,
} from '@/actions/cloud-storage.actions'
import type { ProviderName } from '@esite/shared'

interface ConnectionOption {
  id: string
  provider: ProviderName
  account_email: string
}

interface Props {
  projectId: string
  connections: ConnectionOption[]
  mappedConnectionId: string | null
  cloudFolderPath: string | null
  lastSyncAt: string | null
  intent: 'drawings' | 'documents'
}

const PROVIDER_LABEL: Record<ProviderName, string> = {
  dropbox: 'Dropbox',
  google_drive: 'Google Drive',
  onedrive: 'OneDrive',
}

export function CloudSyncToolbar(props: Props) {
  const router = useRouter()
  const [pickerConnId, setPickerConnId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [pendingSync, startSyncTransition] = useTransition()
  const [pendingClear, startClearTransition] = useTransition()

  const mappedConn = props.connections.find((c) => c.id === props.mappedConnectionId)
  const pickerConn = props.connections.find((c) => c.id === pickerConnId)

  function onPickFolder(folderId: string, folderPath: string) {
    if (!pickerConnId) return
    startClearTransition(async () => {
      try {
        await setProjectCloudFolderAction({
          projectId: props.projectId,
          connectionId: pickerConnId,
          folderId,
          folderPath,
        })
        setPickerConnId(null)
        setFlash(`Folder set: ${folderPath}`)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to set folder')
      }
    })
  }

  function onSyncNow() {
    setError(null)
    setFlash(null)
    startSyncTransition(async () => {
      try {
        const r = await syncProjectCloudFolderAction(props.projectId, props.intent)
        setFlash(
          `Sync done — ${r.sent} new (${r.classified.documents} docs / ${r.classified.floor_plans} drawings), ${r.skipped} skipped, ${r.failed} failed.`,
        )
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sync failed')
      }
    })
  }

  function onClearMapping() {
    if (!confirm("Remove the cloud-folder mapping? Existing synced files stay; new ones won't be pulled.")) return
    setError(null)
    setFlash(null)
    startClearTransition(async () => {
      try {
        await clearProjectCloudFolderAction(props.projectId)
        setFlash('Cloud folder mapping cleared.')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to clear mapping')
      }
    })
  }

  return (
    <div className="data-panel" style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={label}>Cloud folder</div>
          {props.cloudFolderPath && mappedConn ? (
            <>
              <div style={{ color: 'var(--c-text)', fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {props.cloudFolderPath}
              </div>
              <div style={meta}>
                {PROVIDER_LABEL[mappedConn.provider]} · {mappedConn.account_email}
                {props.lastSyncAt && (
                  <>{' · '}Last sync {new Date(props.lastSyncAt).toLocaleString()}</>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--c-text-dim)', fontSize: 13, marginTop: 2 }}>
              Not mapped to a cloud folder yet.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {props.cloudFolderPath && (
            <button onClick={onSyncNow} disabled={pendingSync} style={btnPrimary}>
              {pendingSync ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          {props.connections.length === 0 ? (
            <Link href="/settings/integrations" style={btnGhostLink}>
              Connect cloud storage…
            </Link>
          ) : (
            <PickerLauncher connections={props.connections} onPick={(id) => setPickerConnId(id)} />
          )}
          {props.cloudFolderPath && (
            <button onClick={onClearMapping} disabled={pendingClear} style={btnGhost}>
              Clear mapping
            </button>
          )}
        </div>
      </div>

      {flash && <div style={flashStyle}>✓ {flash}</div>}
      {error && <div style={errorStyle}>✕ {error}</div>}

      {pickerConn && (
        <CloudFolderPicker
          open={true}
          connectionId={pickerConn.id}
          connectionLabel={`${PROVIDER_LABEL[pickerConn.provider]} · ${pickerConn.account_email}`}
          provider={pickerConn.provider}
          onClose={() => setPickerConnId(null)}
          onPick={({ folderId, folderPath }) => onPickFolder(folderId, folderPath)}
        />
      )}
    </div>
  )
}

function PickerLauncher({
  connections,
  onPick,
}: {
  connections: ConnectionOption[]
  onPick: (id: string) => void
}) {
  if (connections.length === 1) {
    return (
      <button onClick={() => onPick(connections[0]!.id)} style={btnGhost}>
        Set folder…
      </button>
    )
  }
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ ...btnGhost, listStyle: 'none', userSelect: 'none' }}>Set folder…</summary>
      <div style={popover}>
        {connections.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} style={popoverItem}>
            <strong>{PROVIDER_LABEL[c.provider]}</strong>
            <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>{c.account_email}</span>
          </button>
        ))}
      </div>
    </details>
  )
}

const panel: React.CSSProperties = { padding: 16, marginBottom: 16 }
const label: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)',
}
const meta: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 2 }
const btnPrimary: React.CSSProperties = {
  background: 'var(--c-amber)', border: '1px solid var(--c-amber)', color: 'var(--c-bg)',
  padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'none', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)',
  padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
}
const btnGhostLink: React.CSSProperties = { ...btnGhost, textDecoration: 'none', display: 'inline-block' }
const flashStyle: React.CSSProperties = {
  marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#4ade80',
  background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.3)',
}
const errorStyle: React.CSSProperties = {
  marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#f87171',
  background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.3)',
}
const popover: React.CSSProperties = {
  position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--c-panel)',
  border: '1px solid var(--c-border)', borderRadius: 6, minWidth: 220, zIndex: 10,
  display: 'flex', flexDirection: 'column',
}
const popoverItem: React.CSSProperties = {
  background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
  padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--c-text)', fontSize: 13,
}
