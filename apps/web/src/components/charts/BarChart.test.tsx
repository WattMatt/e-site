import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart } from './BarChart'

describe('BarChart', () => {
  it('draws a bar per category per series with a hover title carrying the unit', () => {
    const { container } = render(<BarChart title="Monthly energy" yUnit="kWh" categories={['Jan', 'Feb']}
      series={[{ key: 'e', label: 'Energy', colour: '#2563eb', values: [100, 200] }]} />)
    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(2)
    expect(screen.getByText('Feb: 200 kWh')).toBeTruthy()
  })
})
