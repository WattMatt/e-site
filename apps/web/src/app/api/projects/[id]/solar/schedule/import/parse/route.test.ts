// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), level: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.level }))

import { POST } from './route'

const P = '11111111-1111-4111-8111-111111111111'
const req = (file: File | null) => {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request(`http://x/api/projects/${P}/solar/schedule/import/parse`, { method: 'POST', body: fd })
}
const ctx = { params: Promise.resolve({ id: P }) }
const errorOf = async (file: File | null) => (await (await POST(req(file) as never, ctx)).json()).error

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } })
  h.level.mockResolvedValue('edit')
})

describe('POST import/parse', () => {
  it('needs Edit (route handlers sit outside the gated layout)', async () => {
    h.level.mockResolvedValue('view')
    const res = await POST(req(new File(['Task,Start\nA,2026-10-01'], 'p.csv')) as never, ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You need Edit access to Solar on this project to import a programme.')
    h.level.mockResolvedValue(null)
    expect((await POST(req(new File(['Task,Start\nA,2026-10-01'], 'p.csv')) as never, ctx)).status).toBe(403)
  })
  it('401 when signed out', async () => {
    h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    expect((await POST(req(null) as never, ctx)).status).toBe(401)
  })
  it('400 for a project id that is not a uuid', async () => {
    expect((await POST(req(null) as never, { params: Promise.resolve({ id: 'x' }) })).status).toBe(400)
  })
  it('CSV → table + guessed mapping, and names the columns it did not recognise', async () => {
    const res = await POST(req(new File(['Task,Start,End,Budget\nA,2026-10-01,2026-10-02,5'], 'p.csv')) as never, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('table')
    expect(body.rows).toEqual([['Task', 'Start', 'End', 'Budget'], ['A', '2026-10-01', '2026-10-02', '5']])
    expect(body.mapping).toMatchObject({ name: 0, start: 1, end: 2 })
    expect(body.unrecognisedColumns).toEqual(['Budget'])
  })
  it('MS Project XML → a plan with issues', async () => {
    const xml = '<Project xmlns="http://schemas.microsoft.com/project"><Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-01T08:00:00</Start><Finish>2026-10-02T17:00:00</Finish></Task></Tasks></Project>'
    const body = await (await POST(req(new File([xml], 'p.xml')) as never, ctx)).json()
    expect(body.kind).toBe('plan')
    expect(body.plan.tasks[0]).toMatchObject({ key: 'uid:1', name: 'A', start: '2026-10-01', end: '2026-10-02' })
    expect(body.issues).toEqual([])
  })
  it('refuses other formats, empty files, foreign XML, too many rows and oversize files with sentences', async () => {
    expect(await errorOf(new File(['x'], 'p.xls'))).toBe('Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.')
    expect(await errorOf(new File(['Task,Start'], 'p.csv'))).toBe('The file has no tasks under its header row.')
    expect(await errorOf(new File(['<rss></rss>'], 'p.xml'))).toBe('That XML file is not a Microsoft Project file. In Project, use Save As → XML.')
    expect(await errorOf(null)).toBe('Choose a file to import.')
    const many = ['Task,Start', ...Array.from({ length: 2001 }, (_, i) => `T${i},2026-10-01`)].join('\n')
    expect(await errorOf(new File([many], 'p.csv'))).toBe('At most 2,000 tasks can be imported at once.')
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'p.csv')
    const res = await POST(req(big) as never, ctx)
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('That file is larger than 5 MB.')
  })
  it('a file that cannot be read is a sentence, not a stack trace', async () => {
    const res = await POST(req(new File(['not a zip'], 'p.xlsx')) as never, ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('That file could not be read. Check it opens in Excel and try again.')
  })
})
