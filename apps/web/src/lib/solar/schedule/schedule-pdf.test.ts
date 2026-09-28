// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildSchedulePdfModel, PDF_ROWS_PER_PAGE, PDF_TIMELINE_WIDTH } from './schedule-pdf'
import { renderSchedulePdf } from './render-schedule-pdf'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import { makeWorkCalendar, type ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from './types'

const task = (i: number, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id: `t${i}`, workItemId: `w${i}`, ref: `SOLAR-${i}`, name: `Task ${i}`, category: i % 2 ? 'Design' : 'Installation', zone: '',
  start: '2026-10-01', end: '2026-10-03', isMilestone: false, status: 'not_started', awaitingSignOff: false, progress: 0,
  colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann', sortOrder: i, description: '', updatedAt: 'U', segments: [], ...over,
})
const data = (tasks: ScheduleTaskView[], projectName = 'KINGSWALK ✓ Ω'): ScheduleData => ({
  projectId: 'p', projectName, canEdit: true, currentUserId: 'u1', today: '2026-09-28', tasks, links: [],
  owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
})
const allStrings = (m: ReturnType<typeof buildSchedulePdfModel>) =>
  [m.title, m.subtitle, ...m.pages.flatMap((p) => [...p.ticks.map((x) => x.label), ...p.rows.flatMap((r) => [r.label, r.ref, r.owner, r.start, r.end, r.days])])]

describe('buildSchedulePdfModel', () => {
  it('paginates, sanitises every string for WinAnsi, and keeps bars inside the timeline', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => task(i + 1, { name: `Ω test ≤ ${i}`, end: `2026-10-${String((i % 20) + 3).padStart(2, '0')}` }))
    const m = buildSchedulePdfModel(data(tasks), makeWorkCalendar('calendar'), '2026-09-28')
    const rowCount = m.pages.reduce((n, p) => n + p.rows.length, 0)
    expect(rowCount).toBe(102) // 100 tasks + 2 category headers
    expect(m.pages).toHaveLength(Math.ceil(102 / PDF_ROWS_PER_PAGE))
    for (const s of allStrings(m)) expect(isWinAnsiSafe(s), s).toBe(true)
    for (const r of m.pages.flatMap((p) => p.rows)) {
      expect(r.barX).toBeGreaterThanOrEqual(0)
      expect(r.barX + r.barW).toBeLessThanOrEqual(PDF_TIMELINE_WIDTH + 0.001)
    }
  })
  it('hostile non-WinAnsi input is replaced with readable text, not a wrong glyph', () => {
    const m = buildSchedulePdfModel(
      data([task(1, { name: 'Ω ≤ ✓ →', ownerName: 'Zoë → Ω', category: 'Cat ✓', ref: 'SOLAR-1 ≥' })], 'Ω ≤ ✓ →'),
      makeWorkCalendar('calendar'), '2026-09-28',
    )
    for (const s of allStrings(m)) expect(isWinAnsiSafe(s), s).toBe(true)
    expect(m.title).toBe('Ohm <= ? -> — Solar programme')
    const [group, row] = m.pages[0].rows
    expect(group.label).toBe('Cat ? (1)')
    expect(row.label).toBe('Ohm <= ? ->')
    expect(row.owner).toBe('Zoë -> Ohm') // ë is WinAnsi and survives
    expect(row.ref).toBe('SOLAR-1 >=')
  })
  it('an empty schedule still has one page', () => {
    const m = buildSchedulePdfModel(data([]), makeWorkCalendar('calendar'), '2026-09-28')
    expect(m.pages).toHaveLength(1)
    expect(m.pages[0].rows).toEqual([])
  })
})

describe('renderSchedulePdf', () => {
  it('renders A3 landscape pages', async () => {
    const d = data(Array.from({ length: 45 }, (_, i) => task(i + 1)))
    const buf = await renderSchedulePdf(d, makeWorkCalendar('calendar'), '2026-09-28')
    const pdf = await PDFDocument.load(buf)
    expect(pdf.getPageCount()).toBe(2)
    const { width, height } = pdf.getPage(0).getSize()
    expect(Math.round(width)).toBe(1191)
    expect(Math.round(height)).toBe(842)
  }, 30_000)
})
