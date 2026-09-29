'use client'
/**
 * Export tariff per import tariff (spec §5 linked_tariff): the tariff a
 * project's exported kWh are credited at when its export rule is "linked
 * tariff". Choices are the other tariffs of this same year; export (SSEG)
 * tariffs are listed first.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setExportTariffAction } from '@/actions/tariff-review.actions'

export interface ExportLinkTariff {
  id: string
  name: string
  code: string | null
  category: string
  exportTariffId: string | null
  updatedAt: string
}

const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const label = (t: ExportLinkTariff) => `${t.name}${t.code ? ` (${t.code})` : ''}`

export function ExportTariffLinks({ tariffs, editable }: { tariffs: ExportLinkTariff[]; editable: boolean }) {
  if (tariffs.length < 2) {
    return <p style={{ fontSize: 13, margin: 0 }}>This year has only one tariff, so there is no export tariff to link it to.</p>
  }
  const rows = tariffs.filter((t) => t.category !== 'sseg')
  const choices = [...tariffs].sort((a, b) => Number(b.category === 'sseg') - Number(a.category === 'sseg'))
  if (rows.length === 0) return <p style={{ fontSize: 13, margin: 0 }}>Every tariff in this year is an export tariff: there is nothing to link.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>Tariff</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>Export tariff</th>
          <th />
        </tr></thead>
        <tbody>{rows.map((t) => <LinkRow key={t.id} tariff={t} choices={choices.filter((c) => c.id !== t.id)} editable={editable} />)}</tbody>
      </table>
    </div>
  )
}

function LinkRow({ tariff: t, choices, editable }: { tariff: ExportLinkTariff; choices: ExportLinkTariff[]; editable: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState(t.exportTariffId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = value !== (t.exportTariffId ?? '')
  const save = async () => {
    setBusy(true); setError(null)
    const r = await setExportTariffAction({ tariffId: t.id, exportTariffId: value || null, expectedUpdatedAt: t.updatedAt })
    setBusy(false)
    if ('error' in r) setError(r.error); else router.refresh()
  }
  return (
    <tr>
      <td style={TD}>{label(t)}</td>
      <td style={TD}>
        <select aria-label={`Export tariff for ${t.name}`} value={value} disabled={!editable || busy} onChange={(e) => setValue(e.target.value)}>
          <option value="">No export tariff</option>
          {choices.map((c) => <option key={c.id} value={c.id}>{label(c)}{c.category === 'sseg' ? ' — export tariff' : ''}</option>)}
        </select>
        {error && <div role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</div>}
      </td>
      <td style={TD}>
        {editable && changed && <Button size="sm" isLoading={busy} aria-label={`Save link for ${t.name}`} onClick={save}>Save</Button>}
      </td>
    </tr>
  )
}
