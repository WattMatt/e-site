'use client'

/**
 * CloudSyncToolbar — surfaces the project's cloud-folder mapping + keeps it
 * fresh. Used on both the /projects/[id]/documents and /projects/[id]/
 * floor-plans pages.
 *
 * Freshness protocol (2026-07-23, spec: docs/superpowers/specs/
 * 2026-07-23-floor-plan-sync-freshness.md): the page renders instantly from
 * the DB; on mount this component fires autoSyncCloudFolderAction, which
 * checks the mapped provider folder if the last completed check is older
 * than 5 minutes (stale-while-revalidate). The chip narrates the check —
 * "Checking Dropbox…" → "Up to date" / "N changes pulled" — and the list
 * refreshes itself when anything changed. Read-only members see the chip
 * too; only the write affordances (Sync now / Set folder / Clear) are
 * gated on canWrite.
 *
 * The same mapping feeds both tables. The `intent` prop tells the edge
 * function which table to target for THIS sync run, so files always land
 * on the tab the user clicked from regardless of extension/folder name.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CloudFolderPicker } from './CloudFolderPicker'
import {
  autoSyncCloudFolderAction,
  clearProjectCloudFolderAction,
  setProjectCloudFolderAction,
  syncProjectCloudFolderAction,
  type CloudSyncSummary,
} from '@/actions/cloud-storage.actions'
import type { ProviderName } from '@esite/shared'

interface ConnectionOption {
  id: string
  provider: ProviderName
  account_email: string
  needs_reauth?: boolean | null
}

interface Props {
  projectId: string
  connections: ConnectionOption[]
  mappedConnectionId: string | null
  cloudFolderPath: string | null
  lastSyncAt: string | null
  intent: 'drawings' | 'documents'
  canWrite: boolean
}

const PROVIDER_LABEL: Record<ProviderName, string> = {
  dropbox: 'Dropbox',
  google_drive: 'Google Drive',
  onedrive: 'OneDrive',
}

type FreshnessChip =
  | { kind: 'checking' }
  | { kind: 'fresh'; at: string | null }
  | { kind: 'updated'; changes: number; pendingAdopt: number }
  | { kind: 'error'; message: string }

function summarizeChanges(s: CloudSyncSummary): { changes: number; pendingAdopt: number } {
  return {
    changes: s.sent + s.updated + s.adopted + s.renamed + s.removed + s.newVersions,
    pendingAdopt: s.newVersions,
  }
}

export function CloudSyncToolbar(props: Props) {
  const router = useRouter()
  const [pickerConnId, setPickerConnId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [chip, setChip] = useState<FreshnessChip | null>(null)
  const [pendingSync, startSyncTransition] = useTransition()
  const [pendingClear, startClearTransition] = useTransition()
  const autoRanRef = useRef(false)

  const mappedConn = props.connections.find((c) => c.id === props.mappedConnectionId)
  const pickerConn = props.connections.find((c) => c.id === pickerConnId)
  const needsReauth = Boolean(mappedConn?.needs_reauth)

  // Stale-while-revalidate: check the provider folder once per tab open.
  // Skipped when unmapped (nothing to check) or the connection is flagged
  // for re-auth (the check would just fail — the warning row explains).
  useEffect(() => {
    if (autoRanRef.current) return
    if (!props.cloudFolderPath || needsReauth) return
    autoRanRef.current = true
    let cancelled = false
    setChip({ kind: 'checking' })
    autoSyncCloudFolderAction(props.projectId, props.intent)
      .then((r) => {
        if (cancelled) return
        if (r.status === 'fresh') {
          setChip({ kind: 'fresh', at: r.lastSyncAt })
        } else if (r.status === 'already_running') {
          // Another tab/user is mid-check; their run will land the changes.
          setChip({ kind: 'fresh', at: props.lastSyncAt })
        } else if (r.status === 'synced') {
          const { changes, pendingAdopt } = summarizeChanges(r.summary)
          if (changes > 0) {
            setChip({ kind: 'updated', changes, pendingAdopt })
            router.refresh()
          } else {
            setChip({ kind: 'fresh', at: new Date().toISOString() })
          }
        } else if (r.status === 'error') {
          setChip({ kind: 'error', message: r.message })
        } else {
          setChip(null) // unmapped — the empty-state row already covers it
        }
      })
      .catch(() => {
        if (!cancelled) setChip({ kind: 'error', message: 'Sync check failed' })
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        const bits = [
          `${r.sent} new`,
          `${r.adopted + r.updated} updated`,
          ...(r.newVersions > 0 ? [`${r.newVersions} awaiting Update (annotated)`] : []),
          ...(r.removed > 0 ? [`${r.removed} removed`] : []),
          `${r.skipped} unchanged`,
          ...(r.failed > 0 ? [`${r.failed} failed`] : []),
          ...(r.remaining > 0 ? [`${r.remaining} still queued — sync again`] : []),
        ]
        setFlash(`Sync done — ${bits.join(', ')}.`)
        setChip(null)
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
                  <>{' · '}Checked {new Date(props.lastSyncAt).toLocaleString()}</>
                )}
              </div>
            </>
          ) : props.cloudFolderPath ? (
            <div style={{ color: 'var(--c-text)', fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {props.cloudFolderPath}
            </div>
          ) : (
            <div style={{ color: 'var(--c-text-dim)', fontSize: 13, marginTop: 2 }}>
              Not mapped to a cloud folder yet.
            </div>
          )}
          {chip && <FreshnessChipRow chip={chip} />}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {props.canWrite && props.cloudFolderPath && (
            <button onClick={onSyncNow} disabled={pendingSync} style={btnPrimary}>
              {pendingSync ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          {props.canWrite && (props.connections.length === 0 ? (
            <Link href="/settings/integrations" style={btnGhostLink}>
              Connect cloud storage…
            </Link>
          ) : (
            <PickerLauncher connections={props.connections} onPick={(id) => setPickerConnId(id)} />
          ))}
          {props.canWrite && props.cloudFolderPath && (
            <button onClick={onClearMapping} disabled={pendingClear} style={btnGhost}>
              Clear mapping
            </button>
          )}
        </div>
      </div>

      {needsReauth && (
        <div style={warnStyle}>
          ⚠ The {mappedConn ? PROVIDER_LABEL[mappedConn.provider] : 'cloud'} connection needs to be
          re-authenticated — syncing is paused.{' '}
          <Link href="/settings/integrations" style={{ color: 'inherit', fontWeight: 600 }}>
            Reconnect under Settings → Integrations
          </Link>
        </div>
      )}

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

function FreshnessChipRow({ chip }: { chip: FreshnessChip }) {
  if (chip.kind === 'checking') {
    return (
      <div style={{ ...chipStyle, color: 'var(--c-text-dim)' }}>
        <span className="pulse-dot" aria-hidden="true">●</span> Checking cloud folder for updates…
      </div>
    )
  }
  if (chip.kind === 'fresh') {
    return (
      <div style={{ ...chipStyle, color: 'var(--c-text-dim)' }}>
        ✓ Up to date{chip.at ? ` · checked ${new Date(chip.at).toLocaleTimeString()}` : ''}
      </div>
    )
  }
  if (chip.kind === 'updated') {
    return (
      <div style={{ ...chipStyle, color: 'var(--c-green)' }}>
        ✓ {chip.changes} change{chip.changes !== 1 ? 's' : ''} pulled from the cloud folder
        {chip.pendingAdopt > 0
          ? ` — ${chip.pendingAdopt} annotated drawing${chip.pendingAdopt !== 1 ? 's' : ''} awaiting Update`
          : ''}
      </div>
    )
  }
  return (
    <div style={{ ...chipStyle, color: 'var(--c-red)' }}>
      ✕ Couldn&apos;t check the cloud folder: {chip.message}
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
const chipStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 6,
  display: 'inline-flex', alignItems: 'center', gap: 6,
}
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
  marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--c-green)',
  background: 'var(--c-green-dim)', border: '1px solid var(--c-green)',
}
const errorStyle: React.CSSProperties = {
  marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--c-red)',
  background: 'var(--c-red-dim)', border: '1px solid var(--c-red)',
}
const warnStyle: React.CSSProperties = {
  marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--c-amber)',
  background: 'var(--c-amber-mid)', border: '1px solid var(--c-amber)',
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
