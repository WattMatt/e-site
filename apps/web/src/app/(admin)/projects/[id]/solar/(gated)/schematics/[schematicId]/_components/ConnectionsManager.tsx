'use client'
/** Connections manager (spec §13.2): the same lines as the canvas, as a table, with add and delete. */
import { useState } from 'react'
import type { SchematicLine } from '@/lib/solar/schematics/editor'
import type { EditorMeter } from '@/lib/solar/schematics/view-types'

export function ConnectionsManager({ lines, placed, meters, canEdit, onAdd, onDelete }: {
  lines: SchematicLine[]; placed: string[]; meters: Map<string, EditorMeter>; canEdit: boolean
  onAdd: (from: string, to: string, lineType: 'supply' | 'check') => void; onDelete: (key: string) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [type, setType] = useState<'supply' | 'check'>('supply')
  const name = (id: string) => meters.get(id)?.label ?? id
  return (
    <section aria-label="Connections" style={{ fontSize: 12 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Connections</h3>
      {lines.length === 0 ? <p style={{ margin: 0 }}>No connections yet.{canEdit ? ' Use Connect (C): click the parent meter, optional waypoints, then the child.' : ''}</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>{lines.map((l) => (
            <tr key={l.key}>
              <td>{`${name(l.fromMeterId)} → ${name(l.toMeterId)}`}</td>
              <td>{l.lineType === 'supply' ? 'Supply' : 'Check'}</td>
              <td>{canEdit && <button type="button" aria-label={`Delete ${name(l.fromMeterId)} to ${name(l.toMeterId)}`} onClick={() => onDelete(l.key)}>Delete</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {canEdit && placed.length >= 2 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <select aria-label="Connection from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">From…</option>{placed.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select>
          <select aria-label="Connection to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">To…</option>{placed.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select>
          <select aria-label="Line type" value={type} onChange={(e) => setType(e.target.value as 'supply' | 'check')}><option value="supply">Supply</option><option value="check">Check</option></select>
          <button type="button" disabled={!from || !to} onClick={() => { onAdd(from, to, type); setFrom(''); setTo('') }}>Add connection</button>
        </div>
      )}
    </section>
  )
}
