import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase } from '@/test/fake-supabase'

const h = vi.hoisted(() => ({ gate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminPage: h.gate }))
vi.mock('./CalendarEditor', () => ({ CalendarEditor: () => <div>editor</div> }))
vi.mock('@/components/tariffs/TouCalendarDiagram', () => ({ TouCalendarDiagram: () => <div>diagram</div> }))

import CalendarsPage from './page'

describe('TOU calendars page', () => {
  it('a licensee with no calendar says so, and what its studies fall back to', async () => {
    h.gate.mockResolvedValue({ supabase: fakeSupabase({ tables: { 'tariffs.licensee': [
      { id: 'e1', name: 'Eskom', kind: 'eskom' }, { id: 'l1', name: 'City of Probe', kind: 'municipal' },
    ] } }).client, userId: 'a1' })
    render(await CalendarsPage({ searchParams: Promise.resolve({ licensee: 'l1', year: '2026' }) }))
    expect(screen.getByText("City of Probe has no TOU calendar yet: its studies use Eskom's hours, flagged as assumed. Add one below.")).toBeDefined()
  })
})
