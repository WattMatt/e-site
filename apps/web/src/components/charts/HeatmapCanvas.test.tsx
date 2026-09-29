import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeatmapCanvas } from './HeatmapCanvas'

describe('HeatmapCanvas', () => {
  // jsdom has no canvas backend; the component tolerates a null context.
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null) })
  it('renders a labelled canvas and the colour-scale range with its unit', () => {
    render(<HeatmapCanvas title="Heatmap" rows={['2025-03-10', '2025-03-11']} cells={[[1, 2], [null, 4]]} unit="kW" />)
    expect(screen.getByRole('img', { name: 'Heatmap' })).toBeTruthy()
    expect(screen.getByText('1 kW')).toBeTruthy()
    expect(screen.getByText('4 kW')).toBeTruthy()
    expect(screen.getByText(/No data/)).toBeTruthy()
  })
})
