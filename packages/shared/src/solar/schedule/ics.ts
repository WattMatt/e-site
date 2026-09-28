/** RFC 5545 calendar of the schedule (spec §14.1 Export → calendar .ics). Plain text, no dependency. */
import { addCalendarDays, type CalendarDate } from './dates'
import { GANTT_STATUS_LABELS, type GanttStatus } from './status'

export interface IcsTask {
  id: string
  ref: string
  name: string
  start: CalendarDate
  end: CalendarDate
  isMilestone: boolean
  description: string
  status: GanttStatus
  ownerName: string | null
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const compact = (d: CalendarDate) => d.replace(/-/g, '')
const p2 = (n: number) => String(n).padStart(2, '0')

function stamp(now: Date): string {
  return `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`
}

/** Fold to 75 octets per physical line (continuations start with one space), never inside a UTF-8 sequence. */
function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out.push(cur)
      cur = ' '
      bytes = 1
      limit = 75
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n')
}

export function buildScheduleIcs(input: {
  calendarName: string
  tasks: readonly IcsTask[]
  now: Date
  uidDomain?: string
}): string {
  const domain = input.uidDomain ?? 'e-site.live'
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//E-Site//Solar schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${input.calendarName} Schedule`)}`,
  ]
  for (const t of input.tasks) {
    const details = [
      t.ownerName ? `Owner: ${t.ownerName}` : null,
      `Status: ${GANTT_STATUS_LABELS[t.status]}`,
      t.description || null,
    ].filter((x): x is string => x !== null).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:solar-task-${t.id}@${domain}`,
      `DTSTAMP:${stamp(input.now)}`,
      `DTSTART;VALUE=DATE:${compact(t.start)}`,
      `DTEND;VALUE=DATE:${compact(addCalendarDays(t.isMilestone ? t.start : t.end, 1))}`,
      `SUMMARY:${esc(`${t.ref} ${t.isMilestone ? 'Milestone: ' : ''}${t.name}`)}`,
      `DESCRIPTION:${esc(details)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
