import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(async () => ({})), level: vi.fn(async () => 'view'), load: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.level }))
vi.mock('@/lib/solar/schedule/loader', () => ({ loadScheduleData: h.load }))
vi.mock('./ScheduleClient', () => ({ ScheduleClient: (p: unknown) => { h.client(p); return null } }))

import Page from './page'
import { ScheduleLoadError, SCHEDULE_LOAD_ERROR } from '@/lib/solar/schedule/load-error'
import { render, screen } from '@testing-library/react'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Schedule page', () => {
  it('re-checks View and hands JSON-only data to the client', async () => {
    h.load.mockResolvedValue({ projectId: 'p1', tasks: [] })
    const el = await Page({ params: Promise.resolve({ id: 'p1' }) })
    expect(h.level).toHaveBeenCalledWith('p1', 'view', expect.anything())
    expect(h.load).toHaveBeenCalledWith('p1', expect.anything(), 'view', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(el.props.initial).toEqual({ projectId: 'p1', tasks: [] })
    // Every prop survives JSON (no functions, Dates, Maps or Sets cross the boundary — the #201 lesson).
    for (const v of Object.values(el.props)) expect(JSON.parse(JSON.stringify(v))).toEqual(v)
    expect(Object.values(el.props).some((v) => typeof v === 'function')).toBe(false)
  })
  it('a caller below View never reaches the loader', async () => {
    h.level.mockRejectedValueOnce(new Error('NEXT_REDIRECT'))
    await expect(Page({ params: Promise.resolve({ id: 'p1' }) })).rejects.toThrow('NEXT_REDIRECT')
    expect(h.load).not.toHaveBeenCalled()
  })
  it('a failed read shows a sentence, never an empty schedule the template could be applied on top of', async () => {
    h.load.mockRejectedValueOnce(new ScheduleLoadError('projects.work_items', 'timeout'))
    render(await Page({ params: Promise.resolve({ id: 'p1' }) }))
    expect(screen.getByRole('alert').textContent).toBe(SCHEDULE_LOAD_ERROR)
    expect(h.client).not.toHaveBeenCalled()
  })
})
