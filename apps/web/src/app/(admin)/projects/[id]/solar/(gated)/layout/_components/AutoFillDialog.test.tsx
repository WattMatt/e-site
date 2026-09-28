import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { GENERIC_MODULE_550 as M, type RoofObject } from '@esite/shared'

const h = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/lib/solar/auto-fill-plan', async (orig) => {
  const real = await orig<typeof import('@/lib/solar/auto-fill-plan')>()
  return { ...real, planAutoFill: (...a: Parameters<typeof real.planAutoFill>) => { h.calls++; return real.planAutoFill(...a) } }
})

import { AutoFillDialog } from './AutoFillDialog'

const roof: RoofObject = { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] },
  props: { name: 'Flat', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } }

/** Mirrors how LayoutWorkspace hosts the dialog: preview state in the parent, a fresh id on every render. */
function Host({ onPlace }: { onPlace: (id: string) => void }) {
  const [, setPreview] = useState<number[][] | null>(null)
  const renders = useRef(0)
  renders.current++
  return (
    <AutoFillDialog roof={roof} obstructions={[]} sheetPixelsPerMeter={10} latDeg={-26.2} northBearingDeg={0} module={M}
      defaultTiltDeg={15} shadeFree={{ fromHour: 9, toHour: 15 }} newId={`id-${renders.current}`}
      // A safety valve so a regression fails the assertion below instead of hanging the runner.
      onPreview={(q) => { if (renders.current < 30) setPreview(q) }}
      onPlace={(plan) => onPlace(plan.object.id)} onClose={() => {}} />
  )
}

describe('AutoFillDialog (review fix: no render loop)', () => {
  it('plans a bounded number of times however often the host re-renders', async () => {
    h.calls = 0
    const onPlace = vi.fn()
    render(<Host onPlace={onPlace} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(h.calls).toBeLessThanOrEqual(2)
    expect(screen.getByText(/48 modules/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Place' }))
    expect(onPlace).toHaveBeenCalledTimes(1)
    expect(onPlace.mock.calls[0]![0]).toMatch(/^id-\d+$/)
  })
})
