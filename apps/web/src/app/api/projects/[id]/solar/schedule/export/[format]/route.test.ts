// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), level: vi.fn(), load: vi.fn(), pdf: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.level }))
vi.mock('@/lib/solar/schedule/loader', () => ({ loadScheduleData: h.load }))
vi.mock('@/lib/solar/schedule/render-schedule-pdf', () => ({ renderSchedulePdf: h.pdf }))

import { GET } from './route'
import { ScheduleLoadError } from '@/lib/solar/schedule/load-error'

const P = '11111111-1111-4111-8111-111111111111'
const call = (format: string, id = P) => GET(new Request('http://x') as never, { params: Promise.resolve({ id, format }) })
const data = {
  projectId: P, projectName: 'Kings Walk / Phase 2', canEdit: false, currentUserId: 'u1', today: '2026-09-28',
  tasks: [{
    id: 't1', workItemId: 'w1', ref: 'SOLAR-1', name: 'Design', category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-02',
    isMilestone: false, status: 'not_started', awaitingSignOff: false, gatekeeperId: null, progress: 0, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
    sortOrder: 1, description: '', updatedAt: 'U', segments: [],
  }],
  links: [], owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } })
  h.level.mockResolvedValue('view')
  h.load.mockResolvedValue(data)
  h.pdf.mockResolvedValue(Buffer.from('%PDF-1.7'))
})

describe('GET schedule export', () => {
  it('View level may export; no level → 403 and nothing is loaded (the route is its own gate)', async () => {
    expect((await call('ics')).status).toBe(200)
    expect(h.load).toHaveBeenCalledWith(P, expect.anything(), 'view', expect.any(String))
    h.load.mockClear()
    h.level.mockResolvedValue(null)
    const res = await call('ics')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You do not have access to this schedule.')
    expect(h.load).not.toHaveBeenCalled()
  })
  it('401 when signed out; 400 for a bad project id', async () => {
    expect((await call('xlsx', 'nope')).status).toBe(400)
    h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    expect((await call('xlsx')).status).toBe(401)
    expect(h.load).not.toHaveBeenCalled()
  })
  it.each([
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'kings-walk-phase-2-programme.xlsx'],
    ['ics', 'text/calendar; charset=utf-8', 'kings-walk-phase-2-programme.ics'],
    ['pdf', 'application/pdf', 'kings-walk-phase-2-programme.pdf'],
  ])('%s → content type and a safe filename', async (format, type, file) => {
    const res = await call(format)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(type)
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${file}"`)
  })
  it('the calendar is a real VCALENDAR of the tasks', async () => {
    const text = await (await call('ics')).text()
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('SUMMARY:SOLAR-1 Design')
    expect(text).toContain('DTSTART;VALUE=DATE:20261001')
  })
  it('there is no Word export (owner decision Q7), and other unknown formats are 404', async () => {
    expect((await call('docx')).status).toBe(404)
    expect((await call('png')).status).toBe(404)
  })
  it('a render failure is a sentence', async () => {
    h.pdf.mockRejectedValue(new Error('layout exploded'))
    const res = await call('pdf')
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('The export could not be produced. Try again.')
  })
  it('a failed read is a 500 with a sentence, never an empty file', async () => {
    for (const f of ['xlsx', 'ics', 'pdf']) {
      h.load.mockRejectedValueOnce(new ScheduleLoadError('solar.schedule_tasks', 'timeout'))
      const res = await call(f)
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('The schedule could not be loaded, so nothing was exported. Try again.')
    }
  })
})
