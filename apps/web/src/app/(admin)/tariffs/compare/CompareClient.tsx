'use client'
/**
 * One consumption profile priced across 2-4 tariffs (E7). Pricing runs in the
 * browser on the shared bill engine (compareTariffs); the selection lives in
 * the URL (?t=id,id) so a comparison can be shared. Results are ranked
 * cheapest first, each with its gap to the cheapest.
 */
import { useMemo, useState, useTransition, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { COMPONENT_LABELS, MAX_COMPARE, compareTariffs, formatRandAmount, validateProfile, type ConsumptionProfile, type LicenseeSearchItem, type Tariff } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/FormField'
import { listPublishedTariffsAction, type PickerTariff } from '@/actions/tariff-explorer.actions'
import { LicenseeSearch } from '../_components/LicenseeSearch'
import { MUTED, NUM } from '../_components/explorer-ui'

export interface CompareTariffInput { id: string; label: string; tariff: Tariff; highSeasonMonths: number[]; seasonsAssumed: boolean }

function num(s: string): number | null {
  const v = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(v) ? null : v
}

interface Fields { kwh: string; peak: string; standard: string; offPeak: string; md: string; nmd: string; pf: string; amps: string }

/** Starting points, not data: round figures that put each kind of tariff to work. */
export const PRESETS: ReadonlyArray<{ key: string; label: string; hint: string; fields: Fields }> = [
  { key: 'household', label: 'Household', hint: '800 kWh a month, 60 A', fields: { kwh: '800', peak: '20', standard: '50', offPeak: '30', md: '', nmd: '', pf: '0.95', amps: '60' } },
  { key: 'business', label: 'Small business', hint: '10 000 kWh, 50 kVA', fields: { kwh: '10000', peak: '20', standard: '50', offPeak: '30', md: '50', nmd: '60', pf: '0.95', amps: '' } },
  { key: 'industrial', label: 'Industrial', hint: '250 000 kWh, 800 kVA', fields: { kwh: '250000', peak: '18', standard: '42', offPeak: '40', md: '800', nmd: '1000', pf: '0.95', amps: '' } },
]

const DEFAULT: Fields = { ...PRESETS[1].fields, md: '', nmd: '' }
const SPLIT: ReadonlyArray<{ key: 'peak' | 'standard' | 'offPeak'; label: string; colour: string }> = [
  { key: 'peak', label: 'Peak', colour: 'var(--tou-peak)' },
  { key: 'standard', label: 'Standard', colour: 'var(--tou-standard)' },
  { key: 'offPeak', label: 'Off-peak', colour: 'var(--tou-off-peak)' },
]
const GROUP: CSSProperties = { border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 10, minWidth: 0 }

export function CompareClient({ selected, licensees, year }: { selected: CompareTariffInput[]; licensees: LicenseeSearchItem[]; year: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [f, setF] = useState<Fields>(DEFAULT)
  const set = (k: keyof Fields) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const [picking, setPicking] = useState<{ licensee: LicenseeSearchItem; tariffs: PickerTariff[] } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  const profile: ConsumptionProfile = {
    monthlyKwh: num(f.kwh) ?? Number.NaN,
    touSplit: { peak: (num(f.peak) ?? Number.NaN) / 100, standard: (num(f.standard) ?? Number.NaN) / 100, off_peak: (num(f.offPeak) ?? Number.NaN) / 100 },
    maxDemandKva: num(f.md), nmdKva: num(f.nmd), powerFactor: num(f.pf) ?? Number.NaN, ampsRating: num(f.amps),
  }
  const errors = validateProfile(profile)
  const results = useMemo(() => (errors.length || selected.length === 0 ? [] : compareTariffs(profile, selected.map((s) => ({ key: s.id, label: s.label, tariff: s.tariff, highSeasonMonths: s.highSeasonMonths })), year)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, selected, year, errors.length])

  const go = (ids: string[]) => start(() => router.push(ids.length ? `/tariffs/compare?t=${ids.join(',')}` : '/tariffs/compare'))
  const ids = selected.map((s) => s.id)
  const pickLicensee = async (l: LicenseeSearchItem) => {
    setPickError(null)
    const r = await listPublishedTariffsAction({ licenseeId: l.id })
    if ('error' in r) setPickError(r.error)
    else setPicking({ licensee: l, tariffs: r.tariffs })
  }
  const field = (label: string, k: keyof Fields, unit: string, width = 100) => (
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <TextInput inputMode="decimal" value={f[k]} onChange={(e) => set(k)(e.target.value)} aria-label={label} style={{ width }} />
        {unit && <span style={MUTED}>{unit}</span>}
      </span>
    </label>
  )
  const shares = SPLIT.map((s) => ({ ...s, v: Math.max(0, num(f[s.key]) ?? 0) }))
  const shareSum = shares.reduce((a, s) => a + s.v, 0)
  const activePreset = PRESETS.find((p) => (Object.keys(p.fields) as (keyof Fields)[]).every((k) => p.fields[k] === f[k]))?.key ?? null
  // A total that left charges out is a lower bound: it cannot win, and it is not compared. Fully priced first, cheapest first.
  const full = results.filter((r) => r.notModelled.length === 0)
  const partial = results.filter((r) => r.notModelled.length > 0)
  const ranked = [...full, ...partial]
  const cheapest = full[0]?.annualExclVat ?? 0
  const dearest = results.length ? Math.max(...results.map((r) => r.annualExclVat)) : 0

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section aria-label="Consumption profile" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <h3 style={{ fontSize: 13, margin: 0, marginRight: 4 }}>Consumption profile</h3>
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setF(p.fields)} aria-pressed={activePreset === p.key} title={p.hint}
              style={{ font: 'inherit', fontSize: 12, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${activePreset === p.key ? 'var(--c-amber)' : 'var(--c-border)'}`,
                background: activePreset === p.key ? 'var(--c-amber-dim)' : 'transparent', color: activePreset === p.key ? 'var(--c-amber)' : 'var(--c-text)' }}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}>
          <div style={GROUP}>
            <div style={{ fontSize: 11, ...MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Energy</div>
            {field('Energy per month', 'kwh', 'kWh', 130)}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {field('Peak share', 'peak', '%', 60)}
              {field('Standard share', 'standard', '%', 60)}
              {field('Off-peak share', 'offPeak', '%', 60)}
            </div>
            <div aria-label={`Time-of-use split: ${shares.map((x) => `${x.label} ${x.v} %`).join(', ')}`} role="img" style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', border: '1px solid var(--c-border)', background: 'var(--c-surface)' }}>
              {shares.map((s) => <span key={s.key} title={`${s.label} ${s.v} %`} style={{ width: `${shareSum > 0 ? (s.v / Math.max(shareSum, 100)) * 100 : 0}%`, background: s.colour }} />)}
            </div>
            <span style={{ fontSize: 11, color: Math.abs(shareSum - 100) < 0.01 ? 'var(--c-text-mid)' : 'var(--c-red)' }}>Shares total {Math.round(shareSum * 10) / 10} %</span>
          </div>
          <div style={GROUP}>
            <div style={{ fontSize: 11, ...MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Demand and supply</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {field('Maximum demand', 'md', 'kVA')}
              {field('Notified max. demand', 'nmd', 'kVA')}
              {field('Power factor', 'pf', '', 70)}
              {field('Supply rating', 'amps', 'A')}
            </div>
            <p style={{ fontSize: 11, ...MUTED, margin: 0 }}>Maximum demand is assumed to fall in the peak window. Leave a field blank and its charges are listed as not priced.</p>
          </div>
        </div>
        <p style={{ fontSize: 12, ...MUTED, margin: 0 }}>The same energy every month, split by the shares, priced over {year}.</p>
        {errors.length > 0 && <ul role="alert" style={{ fontSize: 12, color: 'var(--c-red)', margin: 0 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      {selected.length === 0
        ? <p style={{ fontSize: 13, margin: 0 }}>Add two to four tariffs to compare them.</p>
        : (
          <section aria-label="Results" style={{ display: 'grid', gap: 8 }}>
            <h3 style={{ fontSize: 13, margin: 0 }}>Cost per year, cheapest first</h3>
            {partial.length > 0 && results.length > 0 && (
              <p style={{ fontSize: 12, margin: 0, color: 'var(--c-amber)' }}>
                {partial.length === results.length ? 'No tariff could be priced in full' : `${partial.length} tariff${partial.length === 1 ? '' : 's'} could not be priced in full`}: those totals are a minimum and are listed last, out of the ranking. Fill in the demand fields to price them.
              </p>
            )}
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {(results.length ? ranked.map((r) => ({ r, s: selected.find((x) => x.id === r.key)! })) : selected.map((s) => ({ r: null, s }))).map(({ r, s }, i) => {
                const isPartial = r !== null && r.notModelled.length > 0
                const gap = r && !isPartial ? r.annualExclVat - cheapest : 0
                const tie = Math.abs(gap) < 0.005
                const first = r !== null && !isPartial && i === 0 && results.length > 1
                return (
                  <li key={s.id} style={{ border: `1px solid ${first ? 'var(--c-green)' : 'var(--c-border)'}`, borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 8, background: 'var(--c-surface)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '6px 12px' }}>
                      <span style={{ fontSize: 12, ...MUTED, ...NUM, minWidth: 18 }}>{r && !isPartial ? `${i + 1}.` : ''}</span>
                      <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</span>
                        {s.seasonsAssumed && <span style={{ display: 'block', fontSize: 11, ...MUTED }}>No calendar: June–August assumed as high season</span>}
                      </span>
                      <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
                        <span style={{ ...NUM, fontSize: 18, fontWeight: 700 }}>{r ? `${isPartial ? 'at least ' : ''}${formatRandAmount(r.annualExclVat)}` : '—'}</span>
                        <span style={{ fontSize: 11, ...MUTED }}>{isPartial ? 'per year, excl. VAT, not all charges priced' : 'per year, excl. VAT'}</span>
                      </span>
                    </div>
                    {r && (
                      <div aria-hidden style={{ height: 6, borderRadius: 3, background: 'var(--c-elevated)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${dearest > 0 ? Math.max(2, (r.annualExclVat / dearest) * 100) : 0}%`, background: first ? 'var(--c-green)' : isPartial ? 'var(--c-border-hi)' : 'var(--c-amber)' }} />
                      </div>
                    )}
                    {r && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', fontSize: 12 }}>
                        {first && <Badge variant="success">Cheapest</Badge>}
                        {!isPartial && i > 0 && (tie
                          ? <span style={MUTED}>Same as the cheapest</span>
                          : <span style={{ ...NUM, color: 'var(--c-red)' }}>+{formatRandAmount(gap)} ({cheapest > 0 ? ((gap / cheapest) * 100).toFixed(1) : '—'} %) more</span>)}
                        <span style={NUM}><span style={MUTED}>Incl. VAT </span>{formatRandAmount(r.annualInclVat)}</span>
                        <span style={NUM}><span style={MUTED}>Average </span>{r.effectiveCPerKwh !== null ? `${r.effectiveCPerKwh.toFixed(2)} c/kWh` : '—'}</span>
                        <span style={NUM}><span style={MUTED}>Per month </span>{formatRandAmount(r.annualExclVat / 12)}</span>
                        <span style={{ marginLeft: 'auto' }}><Button variant="ghost" size="sm" disabled={pending} onClick={() => go(ids.filter((x) => x !== s.id))}>Remove</Button></span>
                      </div>
                    )}
                    {!r && <span><Button variant="ghost" size="sm" disabled={pending} onClick={() => go(ids.filter((x) => x !== s.id))}>Remove</Button></span>}
                    {r && (r.notModelled.length
                      ? <p style={{ fontSize: 11, margin: 0, color: 'var(--c-amber)' }}>Not priced: {r.notModelled.map((n) => `${COMPONENT_LABELS[n.component]} (${n.reason})`).join('; ')}</p>
                      : <p style={{ fontSize: 11, margin: 0, ...MUTED }}>Everything priced</p>)}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

      {selected.length < MAX_COMPARE && (
        <section aria-label="Add a tariff" style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--c-border)', paddingTop: 14 }}>
          <h3 style={{ fontSize: 13, margin: 0 }}>Add a tariff <span style={{ ...MUTED, fontWeight: 400 }}>({selected.length} of {MAX_COMPARE})</span></h3>
          {picking
            ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <p style={{ fontSize: 13, margin: 0 }}>{picking.licensee.name} <Button variant="ghost" size="sm" onClick={() => setPicking(null)}>Choose another</Button></p>
                {picking.tariffs.length === 0
                  ? <p style={{ fontSize: 13, margin: 0 }}>{picking.licensee.name} has no published tariffs yet.</p>
                  : <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 300, overflowY: 'auto' }}>
                      {picking.tariffs.filter((t) => !ids.includes(t.id)).map((t) => (
                        <li key={t.id} style={{ fontSize: 13, borderTop: '1px solid var(--c-border)' }}>
                          <button type="button" disabled={pending} onClick={() => { setPicking(null); go([...ids, t.id]) }}
                            style={{ background: 'none', border: 'none', padding: '7px 0', cursor: 'pointer', color: 'inherit', textAlign: 'left', font: 'inherit', width: '100%' }}>
                            {t.name} <span style={MUTED}>({t.financialYear})</span>
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
