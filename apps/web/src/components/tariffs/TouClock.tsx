'use client'
/**
 * 24-hour TOU clock (E7): one ring per season x day type, midnight at the top.
 * Periods use the validated ordinal tokens (globals.css --tou-*). The hours
 * are also listed as text under the ring, so nothing depends on colour.
 */
import { useState } from 'react'
import { TOU_LABELS, annularSectorPath, clockSegments, minutesLabel, type TouCalendar, type TouPeriod, type WindowDayType } from '@esite/shared'

const FILL: Record<TouPeriod, string> = { peak: 'var(--tou-peak)', standard: 'var(--tou-standard)', off_peak: 'var(--tou-off-peak)' }
const SEASONS = [{ k: 'high', label: 'High demand (Jun–Aug)' }, { k: 'low', label: 'Low demand' }] as const
const DAYS = [{ k: 'weekday', label: 'Weekday' }, { k: 'saturday', label: 'Saturday' }, { k: 'sunday', label: 'Sunday' }] as const
const C = 130
const R0 = 62
const R1 = 108

function Toggle<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { k: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', border: '1px solid var(--c-border)', borderRadius: 6, overflow: 'hidden' }}>
      {options.map((o) => (
        <button key={o.k} type="button" aria-pressed={value === o.k} onClick={() => onChange(o.k)}
          style={{ padding: '4px 10px', fontSize: 12, border: 'none', cursor: 'pointer', color: 'var(--c-text)',
            background: value === o.k ? 'var(--c-amber-dim)' : 'transparent' }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TouClock({ calendar }: { calendar: TouCalendar }) {
  const [season, setSeason] = useState<'high' | 'low'>('high')
  const [day, setDay] = useState<WindowDayType>('weekday')
  const segs = clockSegments(calendar, season, day)
  const byPeriod = (p: TouPeriod) => segs.filter((s) => s.period === p).map((s) => `${minutesLabel(s.startMinute)}–${minutesLabel(s.endMinute)}`).join(', ')
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Toggle label="Season" options={SEASONS} value={season} onChange={setSeason} />
        <Toggle label="Day type" options={DAYS} value={day} onChange={setDay} />
      </div>
      <svg role="img" aria-label={`TOU clock, ${season} season ${day}`} viewBox={`0 0 ${2 * C} ${2 * C}`} style={{ width: '100%', maxWidth: 300, height: 'auto' }}>
        {segs.map((s) => (
          <path key={`${s.startMinute}`} d={annularSectorPath(C, C, R0, R1, s.startMinute, s.endMinute)} fill={FILL[s.period]}
            stroke="var(--c-panel)" strokeWidth={2} data-period={s.period}>
            <title>{`${minutesLabel(s.startMinute)}–${minutesLabel(s.endMinute)} ${TOU_LABELS[s.period]}`}</title>
          </path>
        ))}
        {Array.from({ length: 8 }, (_, i) => i * 3).map((h) => {
          const a = (h / 24) * 2 * Math.PI
          return (
            <text key={h} x={C + (R1 + 13) * Math.sin(a)} y={C - (R1 + 13) * Math.cos(a) + 4} fontSize={11} textAnchor="middle" fill="var(--c-text-mid)">
              {String(h).padStart(2, '0')}
            </text>
          )
        })}
        <text x={C} y={C - 4} fontSize={12} textAnchor="middle" fill="var(--c-text)">{season === 'high' ? 'High season' : 'Low season'}</text>
        <text x={C} y={C + 12} fontSize={12} textAnchor="middle" fill="var(--c-text-mid)">{DAYS.find((d) => d.k === day)?.label}</text>
      </svg>
      <dl style={{ margin: 0, fontSize: 12, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
        {(['peak', 'standard', 'off_peak'] as const).map((p) => (
          <div key={p} style={{ display: 'contents' }}>
            <dt><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: FILL[p], marginRight: 6, borderRadius: 2 }} />{TOU_LABELS[p]}</dt>
            <dd style={{ margin: 0, color: 'var(--c-text-mid)' }}>{byPeriod(p) || 'none'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
