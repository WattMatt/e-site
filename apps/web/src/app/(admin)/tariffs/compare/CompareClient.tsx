'use client'
/**
 * One consumption profile priced across 2-4 tariffs (E7). Pricing runs in the
 * browser on the shared bill engine (compareTariffs); the selection lives in
 * the URL (?t=id,id) so a comparison can be shared.
 */
import { useMemo, useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { COMPONENT_LABELS, MAX_COMPARE, compareTariffs, formatRandAmount, validateProfile, type ConsumptionProfile, type LicenseeSearchItem, type Tariff } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/FormField'
import { listPublishedTariffsAction, type PickerTariff } from '@/actions/tariff-explorer.actions'
import { LicenseeSearch } from '../_components/LicenseeSearch'

export interface CompareTariffInput { id: string; label: string; tariff: Tariff; highSeasonMonths: number[]; seasonsAssumed: boolean }

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }
const NUM: CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function num(s: string): number | null {
  const v = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(v) ? null : v
}

export function CompareClient({ selected, licensees, year }: { selected: CompareTariffInput[]; licensees: LicenseeSearchItem[]; year: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [kwh, setKwh] = useState('10000')
  const [peak, setPeak] = useState('20')
  const [standard, setStandard] = useState('50')
  const [offPeak, setOffPeak] = useState('30')
  const [md, setMd] = useState('')
  const [nmd, setNmd] = useState('')
  const [pf, setPf] = useState('0.95')
  const [amps, setAmps] = useState('')
  const [picking, setPicking] = useState<{ licensee: LicenseeSearchItem; tariffs: PickerTariff[] } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  const profile: ConsumptionProfile = {
    monthlyKwh: num(kwh) ?? Number.NaN,
    touSplit: { peak: (num(peak) ?? Number.NaN) / 100, standard: (num(standard) ?? Number.NaN) / 100, off_peak: (num(offPeak) ?? Number.NaN) / 100 },
    maxDemandKva: num(md), nmdKva: num(nmd), powerFactor: num(pf) ?? Number.NaN, ampsRating: num(amps),
  }
  const errors = validateProfile(profile)
  const results = useMemo(() => (errors.length || selected.length === 0 ? [] : compareTariffs(profile, selected.map((s) => ({ key: s.id, label: s.label, tariff: s.tariff, highSeasonMonths: s.highSeasonMonths })), year)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kwh, peak, standard, offPeak, md, nmd, pf, amps, selected, year, errors.length])

  const go = (ids: string[]) => start(() => router.push(ids.length ? `/tariffs/compare?t=${ids.join(',')}` : '/tariffs/compare'))
  const ids = selected.map((s) => s.id)
  const pickLicensee = async (l: LicenseeSearchItem) => {
    setPickError(null)
    const r = await listPublishedTariffsAction({ licenseeId: l.id })
    if ('error' in r) setPickError(r.error)
    else setPicking({ licensee: l, tariffs: r.tariffs })
  }
  const field = (label: string, v: string, set: (s: string) => void, unit: string) => (
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <TextInput inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} aria-label={label} style={{ width: 110 }} />
        <span style={{ color: 'var(--c-text-mid)' }}>{unit}</span>
      </span>
    </label>
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section aria-label="Consumption profile" style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ fontSize: 13, margin: 0 }}>Consumption profile</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {field('Energy per month', kwh, setKwh, 'kWh')}
          {field('Peak share', peak, setPeak, '%')}
          {field('Standard share', standard, setStandard, '%')}
          {field('Off-peak share', offPeak, setOffPeak, '%')}
          {field('Maximum demand', md, setMd, 'kVA')}
          {field('Notified max. demand', nmd, setNmd, 'kVA')}
          {field('Power factor', pf, setPf, '')}
          {field('Supply rating', amps, setAmps, 'A')}
        </div>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>
          The same energy every month, split by the shares. Maximum demand is assumed to fall in the peak window. Leave a demand field blank and its charges are listed as not priced.
        </p>
        {errors.length > 0 && <ul role="alert" style={{ fontSize: 12, color: 'var(--c-red)', margin: 0 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      {selected.length === 0
        ? <p style={{ fontSize: 13, margin: 0 }}>Add two to four tariffs to compare them.</p>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Tariff</th><th style={{ ...TH, textAlign: 'right' }}>Per year, excl. VAT</th><th style={{ ...TH, textAlign: 'right' }}>Incl. VAT</th>
                <th style={{ ...TH, textAlign: 'right' }}>Average</th><th style={TH}>Not priced</th><th style={TH} />
              </tr></thead>
              <tbody>{(results.length ? results.map((r) => ({ r, s: selected.find((x) => x.id === r.key)! })) : selected.map((s) => ({ r: null, s }))).map(({ r, s }) => (
                <tr key={s.id}>
                  <td style={TD}>{s.label}{s.seasonsAssumed && <div style={{ fontSize: 11, color: 'var(--c-text-mid)' }}>No calendar: June–August assumed as high season</div>}</td>
                  <td style={NUM}>{r ? formatRandAmount(r.annualExclVat) : '—'}</td>
                  <td style={NUM}>{r ? formatRandAmount(r.annualInclVat) : '—'}</td>
                  <td style={NUM}>{r && r.effectiveCPerKwh !== null ? `${r.effectiveCPerKwh.toFixed(2)} c/kWh` : '—'}</td>
                  <td style={{ ...TD, fontSize: 12 }}>{r && r.notModelled.length ? r.notModelled.map((n) => `${COMPONENT_LABELS[n.component]}: ${n.reason}`).join('; ') : r ? 'Everything priced' : ''}</td>
                  <td style={TD}><Button variant="ghost" size="sm" disabled={pending} onClick={() => go(ids.filter((x) => x !== s.id))}>Remove</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

      {selected.length < MAX_COMPARE && (
        <section aria-label="Add a tariff" style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ fontSize: 13, margin: 0 }}>Add a tariff</h3>
          {picking
            ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <p style={{ fontSize: 13, margin: 0 }}>{picking.licensee.name} <Button variant="ghost" size="sm" onClick={() => setPicking(null)}>Choose another</Button></p>
                {picking.tariffs.length === 0
                  ? <p style={{ fontSize: 13, margin: 0 }}>{picking.licensee.name} has no published tariffs yet.</p>
                  : <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
                      {picking.tariffs.filter((t) => !ids.includes(t.id)).map((t) => (
                        <li key={t.id} style={{ fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--c-border)' }}>
                          <button type="button" disabled={pending} onClick={() => { setPicking(null); go([...ids, t.id]) }}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>
                            {t.name} <span style={{ color: 'var(--c-text-mid)' }}>({t.financialYear})</span>
                          </button>
                        </li>
                      ))}
                    </ul>}
              </div>
            )
            : <LicenseeSearch licensees={licensees} onPick={pickLicensee} />}
          {pickError && <p role="alert" style={{ fontSize: 12, color: 'var(--c-red)', margin: 0 }}>{pickError}</p>}
        </section>
      )}
    </div>
  )
}
