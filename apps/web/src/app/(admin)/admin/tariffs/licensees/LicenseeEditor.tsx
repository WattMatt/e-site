'use client'
/** Licensee registry (spec §12): add/edit name, kind, MDB code, province, NERSA licence no., aliases. */
import { useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { LICENSEE_KINDS } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { addLicenseeAliasAction, removeLicenseeAliasAction, saveLicenseeAction } from '@/actions/tariff-library.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'

export interface LicenseeRow {
  id: string
  name: string
  kind: string
  mdbCode: string
  province: string
  nersaLicenceNo: string
  updatedAt: string
  aliases: string[]
}

const PROVINCE_OPTIONS = ['', 'EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NW', 'NC', 'WC', 'national']
const TH: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '8px 10px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const EMPTY: LicenseeRow = { id: '', name: '', kind: 'municipal', mdbCode: '', province: '', nersaLicenceNo: '', updatedAt: '', aliases: [] }

export function LicenseeEditor({ rows }: { rows: LicenseeRow[] }) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<LicenseeRow | null>(null)
  const shown = useMemo(() => {
    const s = q.trim().toUpperCase()
    return s ? rows.filter((r) => r.name.toUpperCase().includes(s) || r.aliases.some((a) => a.includes(s)) || r.mdbCode.toUpperCase() === s) : rows
  }, [q, rows])
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {editing && <LicenseeForm initial={editing} onDone={() => setEditing(null)} />}
      <Card>
        <CardHeader>
          <span className="data-panel-title">Licensees ({rows.length})</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Search licensees" placeholder="Search name, alias or MDB code" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>Add licensee</Button>
          </span>
        </CardHeader>
        <CardBody>
          {rows.length === 0
            ? <p style={{ fontSize: 13 }}>No licensees yet. Seed the registry with <code>scripts/tariffs/seed-licensee-registry.ts</code>, or add one.</p>
            : <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={TH}>Name</th><th style={TH}>Kind</th><th style={TH}>MDB</th><th style={TH}>Province</th><th style={TH}>NERSA licence</th><th style={TH}>Aliases</th><th style={TH} /></tr></thead>
                  <tbody>{shown.map((r) => (
                    <tr key={r.id}>
                      <td style={TD}>{r.name}</td><td style={TD}>{r.kind}</td><td style={TD}>{r.mdbCode || '—'}</td>
                      <td style={TD}>{r.province || '—'}</td><td style={TD}>{r.nersaLicenceNo || '—'}</td>
                      <td style={TD}><Aliases licenseeId={r.id} aliases={r.aliases} /></td>
                      <td style={TD}><Button variant="secondary" size="sm" onClick={() => setEditing(r)}>Edit</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
        </CardBody>
      </Card>
    </div>
  )
}

function LicenseeForm({ initial, onDone }: { initial: LicenseeRow; onDone: () => void }) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof LicenseeRow) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{initial.id ? `Edit ${initial.name}` : 'Add licensee'}</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label>Name<input value={f.name} onChange={set('name')} />{errors.name && <span role="alert"> {errors.name}</span>}</label>
          <label>Kind<select value={f.kind} onChange={set('kind')}>{LICENSEE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label>MDB code<input value={f.mdbCode} onChange={set('mdbCode')} />{errors.mdbCode && <span role="alert"> {errors.mdbCode}</span>}</label>
          <label>Province<select value={f.province} onChange={set('province')}>{PROVINCE_OPTIONS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}</select></label>
          <label>NERSA licence no.<input value={f.nersaLicenceNo} onChange={set('nersaLicenceNo')} /></label>
        </div>
        {error && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button isLoading={busy} onClick={async () => {
            setBusy(true); setError(null); setErrors({})
            const r = await saveLicenseeAction({ id: f.id || null, name: f.name, kind: f.kind, mdbCode: f.mdbCode, province: f.province, nersaLicenceNo: f.nersaLicenceNo, expectedUpdatedAt: f.id ? f.updatedAt : null })
            setBusy(false)
            if ('fieldErrors' in r) setErrors(r.fieldErrors as Record<string, string>)
            else if ('error' in r) setError(r.error)
            else { onDone(); router.refresh() }
          }}>Save licensee</Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  )
}

/** Removing an alias is destructive (§0.4): first press arms, second removes. */
function AliasChip({ alias, onError }: { alias: string; onError: (m: string | null) => void }) {
  const router = useRouter()
  const { armed, arm, disarm } = useArmedConfirm()
  const [busy, setBusy] = useState(false)
  return (
    <span style={{ fontSize: 12 }}>
      {alias}{' '}
      <button type="button" disabled={busy} aria-label={armed ? `Confirm removing alias ${alias}` : `Remove alias ${alias}`} onClick={async () => {
        if (!armed) return arm()
        disarm(); setBusy(true); onError(null)
        const r = await removeLicenseeAliasAction({ alias })
        setBusy(false)
        if ('error' in r) onError(r.error); else router.refresh()
      }}>{armed ? 'Press again to remove' : '×'}</button>
    </span>
  )
}

function Aliases({ licenseeId, aliases }: { licenseeId: string; aliases: string[] }) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {aliases.map((a) => (
        <AliasChip key={a} alias={a} onError={setError} />
      ))}
      <span style={{ display: 'flex', gap: 4 }}>
        <input aria-label="New alias" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Sheet name as printed" style={{ fontSize: 12 }} />
        <button type="button" onClick={async () => {
          setError(null)
          const r = await addLicenseeAliasAction({ licenseeId, alias: value })
          if ('error' in r) setError(r.error); else { setValue(''); router.refresh() }
        }}>Add</button>
      </span>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
