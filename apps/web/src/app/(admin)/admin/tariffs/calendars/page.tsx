import Link from 'next/link'
import { calendarFromRows, minutesLabel } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { TouCalendarDiagram } from '@/components/tariffs/TouCalendarDiagram'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { CalendarEditor, type EditableCalendar } from './CalendarEditor'
import type { CalendarWindowForm } from '@/lib/tariffs/calendar-form'

export const dynamic = 'force-dynamic'
type Row = Record<string, unknown>

function toWindows(rows: Row[]): CalendarWindowForm[] {
  return rows.map((w) => ({
    season: w.season as CalendarWindowForm['season'], dayType: w.day_type as CalendarWindowForm['dayType'],
    start: minutesLabel(Number(w.start_minute)), end: minutesLabel(Number(w.end_minute)), period: w.period as CalendarWindowForm['period'],
  }))
}

export default async function CalendarsPage({ searchParams }: { searchParams: Promise<{ licensee?: string; year?: string }> }) {
  const { supabase } = await requirePlatformTariffAdminPage()
  const sp = await searchParams
  const t = supabase.schema('tariffs')
  const { data: lics } = await t.from('licensee').select('id, name, kind').order('name')
  const licensees = (lics ?? []) as Array<{ id: string; name: string; kind: string }>
  const eskom = licensees.find((l) => l.kind === 'eskom')
  const selected = licensees.find((l) => l.id === sp.licensee) ?? eskom ?? licensees[0]
  const year = Number(sp.year) || new Date().getUTCFullYear()
  if (!selected) return <Card><CardBody><p style={{ fontSize: 13 }}>Add a licensee first.</p></CardBody></Card>

  const calQuery = (licenseeId: string) => t.from('tou_calendar')
    .select('id, updated_at, valid_from, valid_to, high_season_months, source, tou_window(season, day_type, start_minute, end_minute, period), holiday_rule(treated_as)')
    .eq('licensee_id', licenseeId).order('valid_from', { ascending: false })
  const [{ data: cals }, eskomCals, { data: hols }] = await Promise.all([
    calQuery(selected.id),
    eskom && eskom.id !== selected.id ? calQuery(eskom.id) : Promise.resolve({ data: [] as Row[] }),
    supabase.schema('projects').from('public_holidays').select('d, name').gte('d', `${year}-01-01`).lte('d', `${year}-12-31`).order('d'),
  ])
  const calendars = (cals ?? []) as Row[]
  const eskomWindows = toWindows(((((eskomCals.data ?? []) as Row[])[0]?.tou_window ?? []) as Row[]))
  const holidays = (hols ?? []) as Array<{ d: string; name: string }>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">TOU calendars</span></CardHeader>
        <CardBody>
          <form style={{ display: 'flex', gap: 8, fontSize: 13 }}>
            <select name="licensee" defaultValue={selected.id}>{licensees.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <button type="submit">Show</button>
          </form>
        </CardBody>
      </Card>
      {calendars.map((c) => {
        const holidayRule = (c.holiday_rule as { treated_as: 'saturday' | 'sunday' } | null)
        const editable: EditableCalendar = {
          id: String(c.id), updatedAt: String(c.updated_at ?? ''), validFrom: String(c.valid_from), validTo: (c.valid_to as string | null) ?? '',
          highSeasonMonths: (c.high_season_months as number[]) ?? [], source: c.source as EditableCalendar['source'],
          holidayTreatedAs: holidayRule?.treated_as ?? '', windows: toWindows((c.tou_window ?? []) as Row[]),
        }
        const cal = calendarFromRows(
          { id: editable.id, licenseeId: selected.id, validFrom: editable.validFrom, validTo: editable.validTo || null,
            highSeasonMonths: editable.highSeasonMonths, source: editable.source, holidayTreatedAs: holidayRule?.treated_as ?? null },
          ((c.tou_window ?? []) as Row[]).map((w) => ({ season: w.season as 'high' | 'low', dayType: w.day_type as 'weekday' | 'saturday' | 'sunday', startMinute: Number(w.start_minute), endMinute: Number(w.end_minute), period: w.period as 'peak' | 'standard' | 'off_peak' })),
        )
        return (
          <Card key={editable.id}>
            <CardHeader><span className="data-panel-title">{selected.name}: from {editable.validFrom}{editable.validTo ? ` to ${editable.validTo}` : ''} ({editable.source === 'assumed_eskom' ? 'hours assumed equal to Eskom' : 'published hours'})</span></CardHeader>
            <CardBody><div style={{ display: 'grid', gap: 12 }}><TouCalendarDiagram calendar={cal} /><CalendarEditor licenseeId={selected.id} calendar={editable} eskomWindows={eskomWindows} /></div></CardBody>
          </Card>
        )
      })}
      <Card>
        <CardHeader><span className="data-panel-title">New calendar for {selected.name}</span></CardHeader>
        <CardBody><CalendarEditor licenseeId={selected.id} calendar={null} eskomWindows={selected.kind === 'eskom' ? [] : eskomWindows} /></CardBody>
      </Card>
      <Card>
        <CardHeader>
          <span className="data-panel-title">Public holidays {year}</span>
          <span style={{ fontSize: 13 }}><Link href={`/admin/tariffs/calendars?licensee=${selected.id}&year=${year - 1}`}>{year - 1}</Link> · <Link href={`/admin/tariffs/calendars?licensee=${selected.id}&year=${year + 1}`}>{year + 1}</Link></span>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 12, marginTop: 0 }}>From the platform holiday table (read-only). Each calendar says whether a holiday bills as Saturday or Sunday.</p>
          {holidays.length === 0 ? <p style={{ fontSize: 13 }}>No holidays seeded for {year}.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{holidays.map((h) => <li key={h.d}>{h.d} {h.name}</li>)}</ul>}
        </CardBody>
      </Card>
    </div>
  )
}
