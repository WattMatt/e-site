/**
 * A3 landscape programme PDF (spec §14.1 "PDF (A3 landscape, server-rendered)").
 * The MODEL is pure and tested; every string goes through winAnsiSafe because
 * react-pdf's standard fonts silently draw the wrong glyph otherwise (Ω → ©,
 * ≤ → d — CLAUDE.md 2026-08-13). Rows are grouped by category; the timeline is
 * scaled to fit one page width; critical tasks are drawn red.
 */
import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  GANTT_STATUS_LABELS, addCalendarDays, buildScheduleRows, criticalPath, daysBetween, formatCalendarDate, maxCalendarDate,
  minCalendarDate, spanDays, weekdayOf, type CalendarDate, type WorkCalendar,
} from '@esite/shared'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import type { ScheduleData } from './types'

export const PDF_ROWS_PER_PAGE = 40
export const PDF_TIMELINE_WIDTH = 660

export interface SchedulePdfRow {
  kind: 'task' | 'group'
  label: string
  ref: string
  owner: string
  start: string
  end: string
  days: string
  barX: number
  barW: number
  isMilestone: boolean
  critical: boolean
  colour: string
  progress: number
}
export interface SchedulePdfPage { rows: SchedulePdfRow[]; ticks: Array<{ x: number; label: string }> }
export interface SchedulePdfModel { title: string; subtitle: string; pages: SchedulePdfPage[] }

/**
 * react-pdf path: { collapseWhitespace: false } (the module's rule for react-pdf).
 * Every cell here is a single line in a fixed-height row, so line breaks are
 * folded to a space first, deliberately, rather than by the sanitiser.
 */
const safe = (s: string) => winAnsiSafe(s.replace(/\s*[\r\n\t]+\s*/g, ' '), { collapseWhitespace: false })

export function buildSchedulePdfModel(data: ScheduleData, cal: WorkCalendar, generatedOn: CalendarDate): SchedulePdfModel {
  const rows = buildScheduleRows(data.tasks, 'category', new Set())
  const cpm = criticalPath(data.tasks, data.links, cal)
  const lo = minCalendarDate(data.tasks.map((t) => t.start)) ?? generatedOn
  const hi = maxCalendarDate(data.tasks.map((t) => t.end)) ?? addCalendarDays(generatedOn, 30)
  const days = daysBetween(lo, hi) + 1
  const px = PDF_TIMELINE_WIDTH / days
  const ticks: Array<{ x: number; label: string }> = []
  for (let d = lo; d <= hi; d = addCalendarDays(d, 1)) {
    if (days > 62 ? d.endsWith('-01') : weekdayOf(d) === 1) {
      const [dd, mon, yr] = formatCalendarDate(d).split(' ')
      ticks.push({ x: daysBetween(lo, d) * px, label: safe(days > 62 ? `${mon} ${yr}` : `${dd} ${mon}`) })
    }
  }
  const out: SchedulePdfRow[] = rows.map((r) => {
    if (r.kind === 'group') {
      return { kind: 'group', label: safe(`${r.label} (${r.count})`), ref: '', owner: '', start: '', end: '', days: '', barX: 0, barW: 0, isMilestone: false, critical: false, colour: '#000000', progress: 0 }
    }
    const t = r.task
    const x = Math.max(0, daysBetween(lo, t.start) * px)
    return {
      kind: 'task', label: safe(t.name), ref: safe(t.ref), owner: safe(t.ownerName),
      start: safe(formatCalendarDate(t.start)), end: safe(formatCalendarDate(t.end)),
      days: t.isMilestone ? safe('Milestone') : String(spanDays(cal, t.start, t.end)),
      barX: x, barW: t.isMilestone ? 0 : Math.max(0, Math.min(PDF_TIMELINE_WIDTH - x, (daysBetween(t.start, t.end) + 1) * px)),
      isMilestone: t.isMilestone, critical: cpm.ok && cpm.critical.has(t.id),
      colour: /^#[0-9a-fA-F]{6}$/.test(t.colour) ? t.colour : '#3b82f6',
      progress: t.status === 'done' ? 100 : Math.max(0, Math.min(100, t.progress)),
    }
  })
  const pages: SchedulePdfPage[] = []
  for (let i = 0; i < out.length; i += PDF_ROWS_PER_PAGE) pages.push({ rows: out.slice(i, i + PDF_ROWS_PER_PAGE), ticks })
  if (pages.length === 0) pages.push({ rows: [], ticks })
  const mode = data.settings.durationMode === 'working' ? 'working days (weekends and SA public holidays excluded)' : 'calendar days'
  return {
    title: safe(`${data.projectName} — Solar programme`),
    subtitle: safe(`Generated ${formatCalendarDate(generatedOn)} · durations in ${mode} · critical path in red · ${data.tasks.length} tasks · statuses: ${Object.values(GANTT_STATUS_LABELS).join(', ')}`),
    pages,
  }
}

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 7, fontFamily: 'Helvetica' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 8, color: '#555555', marginBottom: 8 },
  head: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#999999', paddingBottom: 2, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', height: 16, alignItems: 'center', borderBottomWidth: 0.25, borderColor: '#dddddd' },
  group: { fontFamily: 'Helvetica-Bold', backgroundColor: '#f3f4f6' },
  timeline: { width: PDF_TIMELINE_WIDTH, height: 16, position: 'relative', marginLeft: 10 },
  footer: { position: 'absolute', bottom: 14, left: 30, right: 30, fontSize: 7, color: '#777777', textAlign: 'right' },
})
const COLS = [['Ref', 55], ['Task', 190], ['Owner', 95], ['Start', 55], ['End', 55]] as const

export function SchedulePdfDocument({ model }: { model: SchedulePdfModel }) {
  return (
    <Document title={model.title}>
      {model.pages.map((p, pi) => (
        <Page key={pi} size="A3" orientation="landscape" style={s.page}>
          <Text style={s.title}>{model.title}</Text>
          <Text style={s.subtitle}>{model.subtitle}</Text>
          <View style={s.head}>
            {COLS.map(([h, w]) => <Text key={h} style={{ width: w }}>{h}</Text>)}
            <View style={s.timeline}>
              {p.ticks.map((t) => <Text key={`${t.x}`} style={{ position: 'absolute', left: t.x, top: 4 }}>{t.label}</Text>)}
            </View>
          </View>
          {p.rows.length === 0 && <Text style={{ marginTop: 12 }}>There are no tasks in this programme yet.</Text>}
          {p.rows.map((r, ri) => (
            <View key={ri} style={r.kind === 'group' ? [s.row, s.group] : s.row}>
              <Text style={{ width: COLS[0][1] }}>{r.ref}</Text>
              <Text style={{ width: COLS[1][1] }}>{r.label}</Text>
              <Text style={{ width: COLS[2][1] }}>{r.owner}</Text>
              <Text style={{ width: COLS[3][1] }}>{r.start}</Text>
              <Text style={{ width: COLS[4][1] }}>{r.end}</Text>
              <View style={s.timeline}>
                {r.kind === 'task' && !r.isMilestone && (
                  <View style={{ position: 'absolute', left: r.barX, top: 4, height: 8, width: Math.max(r.barW, 1.5), backgroundColor: r.critical ? '#dc2626' : r.colour }}>
                    <View style={{ height: 8, width: `${r.progress}%`, backgroundColor: '#00000033' }} />
                  </View>
                )}
                {r.kind === 'task' && r.isMilestone && (
                  <View style={{ position: 'absolute', left: r.barX - 3, top: 4, width: 7, height: 7, transform: 'rotate(45deg)', backgroundColor: r.critical ? '#dc2626' : '#111827' }} />
                )}
              </View>
            </View>
          ))}
          <Text style={s.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
        </Page>
      ))}
    </Document>
  )
}
