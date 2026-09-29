/** TOU calendar diagram (spec §5, §12): weekday/Saturday/Sunday x high/low season, 48 half-hours each. */
import { TOU_LABELS, minutesLabel, windowGrid, type TouCalendar, type TouPeriod } from '@esite/shared'

const COLOUR: Record<TouPeriod, string> = { peak: 'var(--c-red)', standard: 'var(--c-amber)', off_peak: 'var(--c-green)' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SEASON = { high: 'High season', low: 'Low season' } as const

export function TouCalendarDiagram({ calendar }: { calendar: TouCalendar }) {
  const grid = windowGrid(calendar)
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} colSpan={2} style={{ fontWeight: 400, padding: '0 1px' }}>{String(h).padStart(2, '0')}</th>)}</tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={`${row.season}-${row.dayType}`}>
                <th style={{ textAlign: 'left', fontWeight: 400, paddingRight: 8, whiteSpace: 'nowrap' }}>{SEASON[row.season]} {row.dayType}</th>
                {row.slots.map((p, k) => (
                  <td key={k} title={`${SEASON[row.season]} ${row.dayType} ${minutesLabel(k * 30)} ${TOU_LABELS[p]}`}
                    style={{ width: 8, height: 16, background: COLOUR[p], opacity: 0.8, border: '1px solid var(--c-panel)' }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, margin: 0 }}>
        High-demand months: {calendar.highSeasonMonths.map((m) => MONTHS[m - 1]).join(', ')}.
        {calendar.holidayTreatedAs ? ` Public holidays are billed as ${calendar.holidayTreatedAs === 'sunday' ? 'Sunday' : 'Saturday'}.` : ' Public holidays follow their weekday.'}
      </p>
      <p style={{ fontSize: 12, margin: 0 }}>
        <span style={{ color: COLOUR.peak }}>■</span> Peak <span style={{ color: COLOUR.standard }}>■</span> Standard <span style={{ color: COLOUR.off_peak }}>■</span> Off-peak
      </p>
    </div>
  )
}
