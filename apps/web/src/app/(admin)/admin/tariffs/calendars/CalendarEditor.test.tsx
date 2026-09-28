import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-calendar.actions', () => ({ saveTouCalendarAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { CalendarEditor } from './CalendarEditor'

const LIC = '11111111-1111-1111-1111-111111111111'
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, id: 'cal1' }) })

describe('CalendarEditor', () => {
  it('copies Eskom hours into a municipal calendar, flagged assumed_eskom', async () => {
    const user = userEvent.setup()
    render(<CalendarEditor licenseeId={LIC} calendar={null}
      eskomWindows={[{ season: 'high', dayType: 'weekday', start: '06:00', end: '08:00', period: 'peak' }]} />)
    await user.click(screen.getByRole('button', { name: 'Copy Eskom hours' }))
    expect((screen.getByLabelText('Hours come from') as HTMLSelectElement).value).toBe('assumed_eskom')
    fireEvent.change(screen.getByLabelText('Valid from'), { target: { value: '2025-07-01' } })
    await user.click(screen.getByRole('button', { name: 'Save calendar' }))
    expect(h.save).toHaveBeenCalledWith({ calendarId: null, form: expect.objectContaining({
      licenseeId: LIC, source: 'assumed_eskom', validFrom: '2025-07-01',
      windows: [{ season: 'high', dayType: 'weekday', start: '06:00', end: '08:00', period: 'peak' }],
    }) })
  })
  it('shows an overlap before saving, and does not save', async () => {
    const user = userEvent.setup()
    render(<CalendarEditor licenseeId={LIC} calendar={{ id: 'cal1', validFrom: '2025-04-01', validTo: '', highSeasonMonths: [6, 7, 8], source: 'published', holidayTreatedAs: 'sunday',
      windows: [
        { season: 'high', dayType: 'weekday', start: '06:00', end: '09:00', period: 'peak' },
        { season: 'high', dayType: 'weekday', start: '08:00', end: '10:00', period: 'standard' },
      ] }} eskomWindows={[]} />)
    await user.click(screen.getByRole('button', { name: 'Save calendar' }))
    expect(screen.getByText('High season weekday: 06:00-09:00 overlaps 08:00-10:00')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
  })
})
