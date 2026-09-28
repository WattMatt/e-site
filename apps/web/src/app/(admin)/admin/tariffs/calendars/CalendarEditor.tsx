'use client'
/** Edit one TOU calendar (spec §12): seasons, windows per season/day type, holiday treatment. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { saveTouCalendarAction } from '@/actions/tariff-calendar.actions'
import { validateCalendarForm, type CalendarForm, type CalendarWindowForm } from '@/lib/tariffs/calendar-form'

export interface EditableCalendar {
  id: string
  validFrom: string
  validTo: string
  highSeasonMonths: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | ''
  windows: CalendarWindowForm[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NEW_WINDOW: CalendarWindowForm = { season: 'high', dayType: 'weekday', start: '06:00', end: '08:00', period: 'peak' }

export function CalendarEditor({ licenseeId, calendar, eskomWindows }: {
  licenseeId: string; calendar: EditableCalendar | null; eskomWindows: CalendarWindowForm[]
}) {
  const router = useRouter()
  const [f, setF] = useState<CalendarForm>({
    licenseeId, validFrom: calendar?.validFrom ?? '', validTo: calendar?.validTo ?? '',
    highSeasonMonths: calendar?.highSeasonMonths ?? [6, 7, 8], source: calendar?.source ?? 'published',
    holidayTreatedAs: calendar?.holidayTreatedAs ?? 'sunday', windows: calendar?.windows ?? [],
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const setWindow = (i: number, patch: Partial<CalendarWindowForm>) =>
    setF({ ...f, windows: f.windows.map((w, k) => (k === i ? { ...w, ...patch } : w)) })

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label>Valid from <input aria-label="Valid from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></label>
        <label>Valid to (optional) <input aria-label="Valid to" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></label>
        <label>Hours come from <select aria-label="Hours come from" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value as CalendarForm['source'] })}>
          <option value="published">Published by the licensee</option><option value="assumed_eskom">Assumed equal to Eskom (municipal)</option>
        </select></label>
        <label>Public holidays billed as <select value={f.holidayTreatedAs} onChange={(e) => setF({ ...f, holidayTreatedAs: e.target.value as CalendarForm['holidayTreatedAs'] })}>
          <option value="sunday">Sunday</option><option value="saturday">Saturday</option><option value="">Their weekday</option>
        </select></label>
      </div>
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend>High-demand months</legend>
        {MONTHS.map((m, k) => (
          <label key={m} style={{ marginRight: 8 }}>
            <input type="checkbox" checked={f.highSeasonMonths.includes(k + 1)} onChange={(e) => setF({
              ...f, highSeasonMonths: e.target.checked ? [...f.highSeasonMonths, k + 1] : f.highSeasonMonths.filter((x) => x !== k + 1),
            })} /> {m}
          </label>
        ))}
        {errors.highSeasonMonths && <span role="alert"> {errors.highSeasonMonths}</span>}
      </fieldset>
      <div>
        <strong>Windows</strong> <span style={{ color: 'var(--c-text-dim)' }}>(minutes not covered are off-peak)</span>
        {f.windows.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <select value={w.season} onChange={(e) => setWindow(i, { season: e.target.value as CalendarWindowForm['season'] })}><option value="high">High</option><option value="low">Low</option></select>
            <select value={w.dayType} onChange={(e) => setWindow(i, { dayType: e.target.value as CalendarWindowForm['dayType'] })}><option value="weekday">Weekday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option></select>
            <input aria-label={`Window ${i + 1} start`} value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} style={{ width: 60 }} />
            <span>to</span>
            <input aria-label={`Window ${i + 1} end`} value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} style={{ width: 60 }} />
            <select value={w.period} onChange={(e) => setWindow(i, { period: e.target.value as CalendarWindowForm['period'] })}><option value="peak">Peak</option><option value="standard">Standard</option><option value="off_peak">Off-peak</option></select>
            <button type="button" aria-label={`Remove window ${i + 1}`} onClick={() => setF({ ...f, windows: f.windows.filter((_, k) => k !== i) })}>×</button>
            {errors[`windows.${i}`] && <span role="alert">{errors[`windows.${i}`]}</span>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <Button variant="secondary" size="sm" onClick={() => setF({ ...f, windows: [...f.windows, { ...NEW_WINDOW }] })}>Add window</Button>
          {eskomWindows.length > 0 && <Button variant="secondary" size="sm" onClick={() => setF({ ...f, windows: eskomWindows.map((w) => ({ ...w })), source: 'assumed_eskom' })}>Copy Eskom hours</Button>}
        </div>
        {errors.windows && <p role="alert" style={{ color: 'var(--c-red)' }}>{errors.windows}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={async () => {
          setMsg(null)
          const check = validateCalendarForm(f)
          if ('errors' in check) return setErrors(check.errors)
          setErrors({}); setBusy(true)
          const r = await saveTouCalendarAction({ calendarId: calendar?.id ?? null, form: f })
          setBusy(false)
          if ('fieldErrors' in r) setErrors(r.fieldErrors)
          else if ('error' in r) setMsg(r.error)
          else { setMsg('Saved.'); router.refresh() }
        }}>Save calendar</Button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </div>
  )
}
