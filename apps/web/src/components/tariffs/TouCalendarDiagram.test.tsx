import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TouCalendarDiagram } from './TouCalendarDiagram'

describe('TouCalendarDiagram', () => {
  it('draws six rows of 48 half-hours with the period of each', () => {
    render(<TouCalendarDiagram calendar={{ highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
      windows: [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }] }} />)
    expect(screen.getAllByRole('row')).toHaveLength(7)   // header + 6
    expect(screen.getByTitle('High season weekday 06:00 Peak')).toBeDefined()
    expect(screen.getByTitle('High season weekday 05:30 Off-peak')).toBeDefined()
    expect(screen.getByText('High-demand months: Jun, Jul, Aug. Public holidays are billed as Sunday.')).toBeDefined()
  })
})
