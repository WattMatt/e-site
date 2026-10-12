import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TenantPlansSection } from './TenantPlansSection'
import type { TenantPlanCard } from '@/lib/status-plans/plan-cards'

const cards = (fp: Partial<TenantPlanCard> = {}, ld: Partial<TenantPlanCard> = {}): TenantPlanCard[] => [
  { purpose: 'tenant_layout', planId: null, sheets: 0, shapes: 0, linked: 0, ...fp },
  { purpose: 'distribution_schematic', planId: null, sheets: 0, shapes: 0, linked: 0, ...ld },
]
const card = (name: string) => screen.getByRole('article', { name })
const links = (name: string) => within(card(name)).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

describe('TenantPlansSection', () => {
  it('exactly two cards: Floor plan and Line diagram', () => {
    render(<TenantPlansSection projectId="p1" cards={cards()} canWrite />)
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Floor plan', 'Line diagram'])
  })

  it('a writer with nothing loaded gets Upload', () => {
    render(<TenantPlansSection projectId="p1" cards={cards()} canWrite />)
    expect(links('Floor plan')).toEqual([['Upload', '/projects/p1/tenant-schedule/floor-plan']])
    expect(links('Line diagram')).toEqual([['Upload', '/projects/p1/tenant-schedule/line-diagram']])
  })

  it('a writer with a plan loaded gets the counts, Open and Upload / Replace', () => {
    render(<TenantPlansSection projectId="p1" cards={cards({ planId: 'fp', sheets: 3, shapes: 41, linked: 38 })} canWrite />)
    expect(within(card('Floor plan')).getByText('3 sheets · 41 shapes · 38 shops linked')).toBeTruthy()
    expect(links('Floor plan')).toEqual([
      ['Open', '/projects/p1/tenant-schedule/floor-plan'],
      ['Upload / Replace', '/projects/p1/tenant-schedule/floor-plan'],
    ])
  })

  it('a read-only role sees Open only, and nothing to click when nothing is loaded', () => {
    render(<TenantPlansSection projectId="p1" cards={cards({}, { planId: 'ld', sheets: 1, shapes: 9, linked: 7 })} canWrite={false} />)
    expect(links('Floor plan')).toEqual([])
    expect(within(card('Floor plan')).getByText('Nothing uploaded yet.')).toBeTruthy()
    expect(links('Line diagram')).toEqual([['Open', '/projects/p1/tenant-schedule/line-diagram']])
    expect(within(card('Line diagram')).getByText('1 sheet · 9 shapes · 7 boards linked')).toBeTruthy()
  })
})
