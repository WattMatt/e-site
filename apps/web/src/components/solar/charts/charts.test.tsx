import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineChart } from './LineChart'
import { BarChart } from './BarChart'
import { WaterfallChart } from './WaterfallChart'
import { TornadoChart } from './TornadoChart'
import { CashflowChart } from './CashflowChart'

describe('solar charts', () => {
  it('LineChart: one path per series, labelled for assistive tech', () => {
    const { container } = render(<LineChart title="Typical day" unit="kW" xLabels={['0', '1', '2']} series={[{ label: 'PV', values: [0, 5, 3] }, { label: 'Load', values: [2, 2, 2] }]} />)
    expect(screen.getByRole('img', { name: 'Typical day' })).toBeTruthy()
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(2)
    expect(screen.getByText('PV')).toBeTruthy()
  })
  it('BarChart: groups × series rects', () => {
    const { container } = render(<BarChart title="Monthly" unit="MWh" groups={[{ label: 'Jan', values: [1, 2] }, { label: 'Feb', values: [3, 4] }]} seriesLabels={['A', 'B']} />)
    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(4)
  })
  it('WaterfallChart: one bar per step with its label', () => {
    const { container } = render(<WaterfallChart title="Losses" steps={[{ key: 'reference', label: 'Ref', kwh: 100, kind: 'start' }, { key: 'l', label: 'Loss', kwh: 10, kind: 'loss' }, { key: 'ac_output', label: 'AC', kwh: 90, kind: 'end' }]} />)
    expect(container.querySelectorAll('rect[data-step]')).toHaveLength(3)
    expect(screen.getByText('Loss')).toBeTruthy()
  })
  it('TornadoChart: two bars per variable', () => {
    const { container } = render(<TornadoChart title="Sensitivity" baseNpvZar={100} bars={[{ variable: 'capex', label: 'Capex', lowNpvZar: 50, highNpvZar: 150, spreadZar: 100 }]} />)
    expect(container.querySelectorAll('rect[data-side]')).toHaveLength(2)
  })
  it('CashflowChart: a bar per year and one cumulative line', () => {
    const { container } = render(<CashflowChart title="Cashflow" rows={[{ year: 0, netZar: -100, cumulativeZar: -100 }, { year: 1, netZar: 60, cumulativeZar: -40 }, { year: 2, netZar: 60, cumulativeZar: 20 }]} />)
    expect(container.querySelectorAll('rect[data-year]')).toHaveLength(3)
    expect(container.querySelectorAll('path[data-series="cumulative"]')).toHaveLength(1)
  })
  it('an empty series renders without NaN geometry', () => {
    const { container } = render(<LineChart title="Empty" unit="kW" xLabels={[]} series={[{ label: 'PV', values: [] }]} />)
    expect(container.innerHTML).not.toContain('NaN')
  })
})
