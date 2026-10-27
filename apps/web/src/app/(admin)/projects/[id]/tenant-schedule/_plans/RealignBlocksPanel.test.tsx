import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { rectToPoints, type ImageTextItem, type LineSegment } from '@esite/shared/status-plans'
import type { CanvasShape } from '@/lib/status-plans/types'

// No jest-dom in this repo: assert on textContent / null.
const { extractMock, realignMock } = vi.hoisted(() => ({ extractMock: vi.fn(), realignMock: vi.fn() }))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: (...a: unknown[]) => extractMock(...a) }))
vi.mock('@/actions/status-plan-realign.actions', () => ({ realignShapesAction: (...a: unknown[]) => realignMock(...a) }))

import { RealignBlocksPanel, type RealignBlocksPanelProps } from './RealignBlocksPanel'

// Invented layout (public repo): text height 10, rows 16 apart, values 50 right, 6 px a character.
const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:']
const t = (str: string, x: number, baseline: number): ImageTextItem =>
  ({ str, x, baseline, top: baseline - 10, width: str.length * 6, height: 10 })
const block = (x: number, y: number, values: string[]) =>
  LABELS.flatMap((l, row) => [t(l, x, y + row * 16), ...(values[row] ? [t(values[row]!, x + 50, y + row * 16)] : [])])
const hl = (at: number, from: number, to: number): LineSegment => ({ axis: 'h', at, from, to })
const vl = (at: number, from: number, to: number): LineSegment => ({ axis: 'v', at, from, to })
/** A table drawn left..right × top..bottom with a divider and row lines, NO: baseline at y. */
const table = (left: number, top: number, right: number, bottom: number, y: number): LineSegment[] => [
  hl(top, left, right), hl(bottom, left, right), vl(left, top, bottom), vl(left + 49, top, bottom), vl(right, top, bottom),
  ...Array.from({ length: 6 }, (_, r) => hl(y + r * 16 + 5, left, right)),
]

const ITEMS = [
  ...block(100, 100, ['DB-71', 'ALPHA STORE', '1m2', '60A TP', '4C', 'ZX-1', '-']),
  ...block(400, 100, ['DB-72', 'BRAVO SHOP', '2m2', '60A TP', '4C', 'ZX-2', '-']),
]
const LINES = [...table(97, 87, 240, 201, 100), ...table(397, 87, 540, 201, 100)]
const NODES = [
  { id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' },
  { id: 'n-72', kind: 'tenant_db', code: 'DB-72', shop_number: null, name: 'Bravo Shop' },
]

const shape = (id: string, points: number[], nodeId: string | null, updatedAt = `ts-${id}`): CanvasShape => ({
  id, sheetId: 'sheet-1', shape: 'rect', points, nodeId, areaType: null, detectedTag: null, source: 'manual', updatedAt,
})
const HAND_A = shape('a', rectToPoints(100, 92, 225, 205), 'n-71')
// Drawn over DB-72's table but linked to DB-71's board.
const HAND_B = shape('b', rectToPoints(401, 90, 530, 199), 'n-71')
const A_BORDER = rectToPoints(97, 87, 240, 201)
const B_BORDER = rectToPoints(397, 87, 540, 201)

function props(over: Partial<RealignBlocksPanelProps> = {}): RealignBlocksPanelProps {
  return {
    sheetId: 'sheet-1', pageIndex: 1, pdfUrl: 'https://signed.example/plan.pdf', isPdf: true,
    nodes: NODES, shapes: [HAND_A], onShapes: vi.fn(), onProposals: vi.fn(), ...over,
  }
}
const text = (s: string | RegExp) => screen.queryByText(s)
const button = (name: string) => screen.getByRole('button', { name })

beforeEach(() => {
  extractMock.mockReset()
  realignMock.mockReset()
  extractMock.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, lines: LINES, width: 1000, height: 1000 })
})

describe('RealignBlocksPanel', () => {
  it('scans, previews the proposed outlines, applies, then offers Undo with the previous points', async () => {
    const onShapes = vi.fn()
    const onProposals = vi.fn()
    render(<RealignBlocksPanel {...props({ onShapes, onProposals })} />)
    fireEvent.click(button('Re-align blocks to the drawing'))
    expect(await screen.findByText('1 will snap to their table (avg 15 px) · 0 already aligned · 0 left as they are')).not.toBeNull()
    expect(extractMock).toHaveBeenCalledWith({ url: 'https://signed.example/plan.pdf' }, 1)
    expect(onProposals).toHaveBeenLastCalledWith([A_BORDER])

    realignMock.mockResolvedValueOnce({ ok: true, data: [{ ...HAND_A, points: A_BORDER, updatedAt: 'ts-new' }] })
    fireEvent.click(button('Apply'))
    expect(await screen.findByText('Re-aligned 1 block')).not.toBeNull()
    expect(realignMock).toHaveBeenCalledWith({ sheetId: 'sheet-1', moves: [{ shapeId: 'a', expectedUpdatedAt: 'ts-a', points: A_BORDER }] })
    expect(onShapes).toHaveBeenLastCalledWith([{ ...HAND_A, points: A_BORDER, updatedAt: 'ts-new' }])
    expect(onProposals).toHaveBeenLastCalledWith([])

    realignMock.mockResolvedValueOnce({ ok: true, data: [HAND_A] })
    fireEvent.click(button('Undo'))
    expect(await screen.findByText('Put 1 block back where it was.')).not.toBeNull()
    expect(realignMock).toHaveBeenLastCalledWith({ sheetId: 'sheet-1', moves: [{ shapeId: 'a', expectedUpdatedAt: 'ts-new', points: HAND_A.points }] })
    expect(onShapes).toHaveBeenLastCalledWith([HAND_A])
  })

  it('Cancel drops the preview without writing', async () => {
    const onProposals = vi.fn()
    render(<RealignBlocksPanel {...props({ onProposals })} />)
    fireEvent.click(button('Re-align blocks to the drawing'))
    await screen.findByText(/will snap to their table/)
    fireEvent.click(button('Cancel'))
    expect(text(/will snap/)).toBeNull()
    expect(onProposals).toHaveBeenLastCalledWith([])
    expect(realignMock).not.toHaveBeenCalled()
  })

  it('a drawing with no line work says so', async () => {
    extractMock.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, lines: [], width: 1000, height: 1000 })
    render(<RealignBlocksPanel {...props()} />)
    fireEvent.click(button('Re-align blocks to the drawing'))
    expect(await screen.findByText('This drawing has no table lines to align to.')).not.toBeNull()
  })

  it('flags a link the table disagrees with, and never sends a link', async () => {
    render(<RealignBlocksPanel {...props({ shapes: [HAND_B] })} />)
    fireEvent.click(button('Re-align blocks to the drawing'))
    expect(await screen.findByText('Linked to DB-71 but the table reads DB-72')).not.toBeNull()
    realignMock.mockResolvedValueOnce({ ok: true, data: [{ ...HAND_B, points: B_BORDER, updatedAt: 'x' }] })
    fireEvent.click(button('Apply'))
    await waitFor(() => expect(realignMock).toHaveBeenCalledTimes(1))
    expect(Object.keys(realignMock.mock.calls[0][0].moves[0]).sort()).toEqual(['expectedUpdatedAt', 'points', 'shapeId'])
  })

  it('a refused apply shows the sentence and ends the preview', async () => {
    render(<RealignBlocksPanel {...props()} />)
    fireEvent.click(button('Re-align blocks to the drawing'))
    await screen.findByText(/will snap to their table/)
    realignMock.mockResolvedValueOnce({ ok: false, error: 'Someone changed 1 of these blocks — reload and try again. Nothing was moved.', conflict: true })
    fireEvent.click(button('Apply'))
    expect(await screen.findByText('Someone changed 1 of these blocks — reload and try again. Nothing was moved.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('a scan that finishes after the sheet changed is dropped', async () => {
    let release: () => void = () => {}
    extractMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, lines: LINES, width: 1000, height: 1000 })
    }))
    const onProposals = vi.fn()
    const { rerender } = render(<RealignBlocksPanel {...props({ onProposals })} />)
    fireEvent.click(button('Re-align blocks to the drawing'))
    rerender(<RealignBlocksPanel {...props({ onProposals, sheetId: 'sheet-2' })} />)
    await act(async () => { release(); await Promise.resolve() })
    expect(text(/will snap/)).toBeNull()
    expect(onProposals).not.toHaveBeenCalledWith([A_BORDER])
  })

  it('an image sheet says it has no table lines', () => {
    render(<RealignBlocksPanel {...props({ isPdf: false })} />)
    expect(text('This drawing has no table lines to align to.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-align blocks to the drawing' })).toBeNull()
  })
})
