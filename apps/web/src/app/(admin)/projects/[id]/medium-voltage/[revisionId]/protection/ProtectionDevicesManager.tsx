'use client'

/**
 * Client shell for the protection-device register: a table of devices + the
 * add/edit form (ProtectionDeviceForm). Owns only the edit selection; the form
 * persists and the page refresh keeps the table current. Mirrors
 * FaultSourcesManager.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { ProtectionDeviceForm, type AttachOption, type ExistingDevice } from './ProtectionDeviceForm'

interface Props {
  revisionId: string
  devices: ExistingDevice[]
  attachOptions: AttachOption[]
  attachLabels: Record<string, string>
  locked: boolean
}

export function ProtectionDevicesManager({ revisionId, devices, attachOptions, attachLabels, locked }: Props) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = editingId ? devices.find((d) => d.id === editingId) ?? null : null

  const attachLabel = (d: ExistingDevice): string => {
    const key = d.nodeId ? `node:${d.nodeId}` : d.supplyId ? `supply:${d.supplyId}` : ''
    return attachLabels[key] ?? key
  }

  function onSaved() {
    setEditingId(null)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {devices.length > 0 && (
        <div className="data-panel" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--c-base)' }}>
                <Th>Protects</Th>
                <Th>Role</Th>
                <Th>Type</Th>
                <Th>Device</Th>
                <Th>Curve</Th>
                <Th align="right">Pickup (A)</Th>
                {!locked && <Th align="right">Edit</Th>}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <Td><strong>{attachLabel(d)}</strong></Td>
                  <Td><Badge variant="info">{d.deviceRole.replace(/_/g, ' ')}</Badge></Td>
                  <Td mono>{d.deviceType}</Td>
                  <Td>{[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</Td>
                  <Td mono>{summariseCurve(d)}</Td>
                  <Td align="right" mono>{d.settings.pickupA ?? '—'}</Td>
                  {!locked && (
                    <Td align="right">
                      <button
                        type="button"
                        onClick={() => setEditingId(d.id)}
                        style={{
                          background: 'var(--c-panel)', border: '1px solid var(--c-border)',
                          color: 'var(--c-text-mid)', borderRadius: 4, padding: '4px 10px',
                          fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {locked ? (
        <p style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
          Revision is read-only — start a new revision to change the device register.
        </p>
      ) : (
        <div>
          {editing && (
            <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Editing existing device</span>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                style={{
                  background: 'none', border: '1px solid var(--c-border)', color: 'var(--c-text-dim)',
                  borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                }}
              >
                + New instead
              </button>
            </div>
          )}
          <ProtectionDeviceForm
            key={editingId ?? 'new'}
            revisionId={revisionId}
            attachOptions={attachOptions}
            initial={editing}
            locked={locked}
            onSaved={onSaved}
          />
        </div>
      )}
    </div>
  )
}

function summariseCurve(d: ExistingDevice): string {
  const s = d.settings
  if (!s.std) return '—'
  if (s.std === 'DT') return `DT ${s.dtS ?? '?'}s`
  const timing = s.std === 'IEC' ? `TMS ${s.tms ?? '?'}` : `TD ${s.td ?? '?'}`
  return `${s.std} ${s.curve ?? '?'} · ${timing}`
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-dim)',
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({
  children, align, mono,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'middle',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      fontSize: 12, color: 'var(--c-text)', whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}
