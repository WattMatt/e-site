'use client'

/**
 * HandoverCloudPicker — handover-specific cloud-folder mapping.
 *
 * Deliberately separate from the project's documents/drawings cloud
 * mapping (CloudSyncToolbar). Handover packs typically live in a
 * "HANDOVER" / "CLIENT PACK" folder that's different from the
 * "DRAWINGS/PDF/LATEST" folder the rest of the project syncs against,
 * and users expect to map them independently.
 *
 * Writes to projects.handover_cloud_folder_id / handover_cloud_folder_path
 * via setHandoverCloudFolderAction. Reuses CloudFolderPicker for the
 * actual browse modal so the picker UX is identical across surfaces.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CloudFolderPicker } from '@/components/cloud-storage/CloudFolderPicker'
import {
  clearHandoverCloudFolderAction,
  setHandoverCloudFolderAction,
  syncHandoverToCloudAction,
} from '@/actions/handover.actions'
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
  handoverFolderPath: string | null
}

const PROVIDER_LABEL: Record<ProviderName, string> = {
  dropbox: 'Dropbox',
  google_drive: 'Google Drive',
  onedrive: 'OneDrive',
}

export function HandoverCloudPicker(props: Props) {
  const router = useRouter()
  const [pickerConnId, setPickerConnId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const mappedConn = props.connections.find((c) => c.id === props.mappedConnectionId)
  const pickerConn = props.connections.find((c) => c.id === pickerConnId)

  function onPickFolder(folderId: string, folderPath: string) {
    if (!pickerConnId) return
    setError(null)
    setFlash(null)
    startTransition(async () => {
      const res = await setHandoverCloudFolderAction({
        projectId: props.projectId,
        connectionId: pickerConnId,
        folderId,
        folderPath,
      })
      if ('error' in res) {
        setError(res.error)
        return
      }
      setPickerConnId(null)
      setFlash(`Handover folder set: ${folderPath}`)
      router.refresh()
    })
  }

  function onSyncNow() {
    setError(null)
    setFlash(null)
    startTransition(async () => {
      const res = await syncHandoverToCloudAction(props.projectId)
      if ('error' in res) {
        setError(res.error)
        return
      }
      const parts: string[] = []
      if (res.foldersPushed > 0) parts.push(`${res.foldersPushed} folders`)
      if (res.filesPushed > 0) parts.push(`${res.filesPushed} files`)
      const pushed = parts.length > 0 ? parts.join(' + ') : 'nothing new'
      const remaining =
        res.foldersRemaining + res.filesRemaining > 0
          ? ` — ${res.foldersRemaining} folder${res.foldersRemaining === 1 ? '' : 's'} + ${res.filesRemaining} file${res.filesRemaining === 1 ? '' : 's'} still pending (re-click to continue)`
          : ' — fully in sync'
      const fail = res.failed > 0 ? `, ${res.failed} failed` : ''
      setFlash(`Pushed ${pushed}${remaining}${fail}.`)
      // Surface the first sample errors so the user can see WHY things
      // failed without diving into Vercel function logs.
      if (res.errors.length > 0) {
        setError(`First error${res.errors.length === 1 ? '' : 's'}: ${res.errors.join(' · ')}`)
      }
      router.refresh()
    })
  }

  function onClearMapping() {
    if (
      !confirm(
        'Clear the handover cloud-folder mapping? Files already mirrored stay where they are; new uploads will only land in E-Site until you remap.',
      )
    )
      return
    setError(null)
    setFlash(null)
    startTransition(async () => {
      const res = await clearHandoverCloudFolderAction(props.projectId)
      if ('error' in res) {
        setError(res.error)
        return
      }
      setFlash('Handover cloud mapping cleared.')
      router.refresh()
    })
  }

  return (
    <div className="data-panel" style={panel}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={label}>Handover cloud folder</div>
          {props.handoverFolderPath && mappedConn ? (
            <>
              <div style={{ color: 'var(--c-text)', fontSize: 14, fontWeight: 600, marginTop: 2 }}>
                {props.handoverFolderPath}
              </div>
              <div style={meta}>
                {PROVIDER_LABEL[mappedConn.provider]} · {mappedConn.account_email}
                {' · '}
                Independent from the Documents / Drawings folder mapping.
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--c-text-dim)', fontSize: 13, marginTop: 2 }}>
              Not mapped. Pick a dedicated folder in your cloud where this project's
              handover pack should be mirrored — separate from the documents folder.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {props.connections.length === 0 ? (
            <Link href="/settings/integrations" style={btnGhostLink}>
              Connect cloud storage…
            </Link>
          ) : (
            <PickerLauncher
              connections={props.connections}
              onPick={(id) => setPickerConnId(id)}
              hasMapping={!!props.handoverFolderPath}
            />
          )}
          {props.handoverFolderPath && (
            <button
              onClick={onSyncNow}
              disabled={pending}
              style={btnPrimary}
              type="button"
              title="Push every unsynced handover folder + file into the mapped cloud folder."
            >
              {pending ? 'Syncing…' : '↥ Sync to cloud'}
            </button>
          )}
          {props.handoverFolderPath && (
            <button
              onClick={onClearMapping}
              disabled={pending}
              style={btnGhost}
              type="button"
            >
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
  hasMapping,
}: {
  connections: ConnectionOption[]
  onPick: (id: string) => void
  hasMapping: boolean
}) {
  const label = hasMapping ? 'Change folder…' : 'Set handover folder…'
  if (connections.length === 1) {
    return (
      <button type="button" onClick={() => onPick(connections[0]!.id)} style={btnPrimary}>
        {label}
      </button>
    )
  }
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ ...btnPrimary, listStyle: 'none', userSelect: 'none' }}>{label}</summary>
      <div style={popover}>
        {connections.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id)}
            style={popoverItem}
          >
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
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--c-text-dim)',
}
const meta: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--c-text-dim)',
  marginTop: 2,
}
const btnPrimary: React.CSSProperties = {
  background: 'var(--c-amber)',
  border: '1px solid var(--c-amber)',
  color: 'var(--c-bg)',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--c-border)',
  color: 'var(--c-text-mid)',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
}
const btnGhostLink: React.CSSProperties = {
  ...btnGhost,
  textDecoration: 'none',
  display: 'inline-block',
}
const flashStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 12,
  color: '#4ade80',
  background: 'rgba(74, 222, 128, 0.08)',
  border: '1px solid rgba(74, 222, 128, 0.3)',
}
const errorStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 12,
  color: '#f87171',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.3)',
}
const popover: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 4px)',
  background: 'var(--c-panel)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 220,
  zIndex: 10,
  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
}
const popoverItem: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  padding: '8px 10px',
  cursor: 'pointer',
  fontSize: 12,
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  color: 'var(--c-text)',
}
