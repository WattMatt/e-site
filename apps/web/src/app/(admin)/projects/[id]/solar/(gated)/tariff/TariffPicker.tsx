'use client'
/**
 * Financial year + Tariff (spec §5): published years for the licensee
 * (superseded labelled); tariffs grouped by category, filtered by metering
 * and phase, eligible-only by NMD/voltage unless "Show all". Choosing saves.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  TARIFF_METERING, groupTariffs, yearOptionLabel,
  type SupplyFacts, type TariffListItem, type TariffMetering, type TariffStructure, type TariffYearOption,
} from '@esite/shared'
import { selectSolarTariffAction } from '@/actions/solar-tariff.actions'

const METERING_LABELS: Record<TariffMetering, string> = {
  prepaid: 'Prepaid', conventional: 'Conventional (credit)', both: 'Prepaid or conventional', unmetered: 'Unmetered',
}
const STRUCTURE_LABELS: Record<TariffStructure, string> = {
  flat: 'Flat rate', ibt: 'Inclining block', seasonal: 'Seasonal', seasonal_ibt: 'Seasonal, inclining block',
  tou: 'Time-of-use', tou_ibt: 'Time-of-use, inclining block',
}

export function TariffPicker({ projectId, years, selectedYearId, yearNote, tariffs, supply, pinnedTariffId, lockedReason, updatedAt }: {
  projectId: string
  years: TariffYearOption[]
  selectedYearId: string | null
  yearNote: string | null
  tariffs: TariffListItem[]
  supply: SupplyFacts
  pinnedTariffId: string | null
  lockedReason: string | null
  updatedAt: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [metering, setMetering] = useState<TariffMetering | ''>('')
  const [phase, setPhase] = useState<'single' | 'three' | ''>('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const g = groupTariffs(tariffs, { supply, showAll, query, metering: metering || null, phase: phase || null })
  const selectedFy = years.find((y) => y.id === selectedYearId)?.financialYear ?? ''

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <label>Financial year{' '}
        <select aria-label="Financial year" value={selectedFy} onChange={(e) => router.push(`/projects/${projectId}/solar/tariff?fy=${encodeURIComponent(e.target.value)}`)}>
          {years.map((y) => <option key={y.id} value={y.financialYear}>{yearOptionLabel(y)}</option>)}
        </select>
      </label>
      {yearNote && <p role="note" style={{ margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>{yearNote}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input aria-label="Search tariffs" placeholder="Search by name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Metering" value={metering} onChange={(e) => setMetering(e.target.value as TariffMetering | '')}>
          <option value="">Any metering</option>{TARIFF_METERING.map((m) => <option key={m} value={m}>{METERING_LABELS[m]}</option>)}
        </select>
        <select aria-label="Phase" value={phase} onChange={(e) => setPhase(e.target.value as 'single' | 'three' | '')}>
          <option value="">Any phase</option><option value="single">Single phase</option><option value="three">Three phase</option>
        </select>
        <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all</label>
      </div>
      {lockedReason && <p role="note" style={{ margin: 0 }}>{lockedReason}</p>}
      {g.groups.length === 0 && <p style={{ margin: 0 }}>No tariffs match. {g.hiddenCount > 0 ? 'Tick "Show all" to see tariffs outside this supply\'s NMD or voltage.' : ''}</p>}
      <div role="radiogroup" aria-label="Tariff" style={{ display: 'grid', gap: 8 }}>
        {g.groups.map((grp) => (
          <fieldset key={grp.category} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
            <legend style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{grp.label}</legend>
            {grp.tariffs.map((t) => (
              <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', opacity: t.eligible ? 1 : 0.7 }}>
                <input type="radio" name="tariff" value={t.id} checked={pinnedTariffId === t.id} disabled={Boolean(lockedReason) || busy !== null}
                  onChange={async () => {
                    setBusy(t.id); setError(null)
                    const r = await selectSolarTariffAction({ projectId, tariffId: t.id, expectedUpdatedAt: updatedAt })
                    setBusy(null)
                    if ('error' in r) setError(r.error); else router.refresh()
                  }} />
                <span>{t.name}{t.code ? ` (${t.code})` : ''} · {STRUCTURE_LABELS[t.structure] ?? t.structure}</span>
                {busy === t.id && <span role="status" style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Saving…</span>}
                {!t.eligible && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{t.reasons.join('; ')}</span>}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {g.hiddenCount > 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>{g.hiddenCount} more not eligible for this supply</p>}
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
    </div>
  )
}
