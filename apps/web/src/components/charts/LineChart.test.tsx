import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LineChart } from './LineChart'

const series = [
  { key: 'a', label: 'Weekday', colour: '#2563eb', points: [{ x: 0, y: 1 }, { x: 1, y: null }, { x: 2, y: 3 }] },
  { key: 'b', label: 'Sunday', colour: '#d97706', points: [{ x: 0, y: 2 }, { x: 2, y: 2 }] },
]

describe('LineChart', () => {
  it('draws one path per visible series, breaking at null, and labels the unit', () => {
    const { container } = render(<LineChart title="Day types" series={series} yUnit="kW" xFormat={(x) => `${x}`} />)
    expect(container.querySelectorAll('path[data-series="a"]')).toHaveLength(1)
    expect(container.querySelector('path[data-series="a"]')?.getAttribute('d')).toMatch(/^M.*M/)
    expect(screen.getByText('kW')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Day types' })).toBeTruthy()
  })
  it('the legend toggles a series off and on', async () => {
    const { container } = render(<LineChart title="t" series={series} yUnit="kW" xFormat={(x) => `${x}`} />)
    await userEvent.click(screen.getByRole('button', { name: /Sunday/ }))
    expect(container.querySelector('path[data-series="b"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Sunday/ }))
    expect(container.querySelector('path[data-series="b"]')).not.toBeNull()
  })
  it('shades gaps and draws a min/max band', () => {
    const { container } = render(<LineChart title="t" yUnit="kW" xFormat={(x) => `${x}`} gaps={[{ from: 0.5, to: 1.5 }]}
      series={[{ ...series[0], band: [{ x: 0, lo: 0, hi: 2 }, { x: 2, lo: 2, hi: 4 }] }]} />)
    expect(container.querySelectorAll('rect[data-gap]')).toHaveLength(1)
    expect(container.querySelector('path[data-band="a"]')).not.toBeNull()
  })
})
