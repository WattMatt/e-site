import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { DetectionOutcome, ImageTextItem } from '@esite/shared/status-plans'
import type { CanvasShape } from '@/lib/status-plans/types'

// No jest-dom in this repo: assert on textContent / null.
const { extractMock, acceptMock, detectionOverride } = vi.hoisted(() => ({
  extractMock: vi.fn(),
  acceptMock: vi.fn(),
  detectionOverride: { current: null as null | (() => unknown) },
}))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: (...a: unknown[]) => extractMock(...a) }))
vi.mock('@/actions/status-plan-detection.actions', () => ({ acceptDetectedBlocksAction: (...a: unknown[]) => acceptMock(...a) }))
vi.mock('@esite/shared/status-plans', async (importOriginal) => {
  const real = await importOriginal<typeof import('@esite/shared/status-plans')>()
  return {
    ...real,
    runDetection: (...a: Parameters<typeof real.runDetection>) =>
      (detectionOverride.current ? detectionOverride.current() : real.runDetection(...a)) as DetectionOutcome,
  }
})

import { DetectBlocksPanel, type DetectBlocksPanelProps } from './DetectBlocksPanel'

// Invented layout (public repo): text height 10, rows 16 apart, values 50 right.
const LABELS = ['NO:', 'NAME:', 'AREA:', 'RATING:', 'CABLE:', 'SERIAL:', 'CT:']
const t = (str: string, x: number, baseline: number): ImageTextItem =>
  ({ str, x, baseline, top: baseline - 10, width: str.length * 6, height: 10 })
const block = (x: number, y: number, values: string[]) =>
  LABELS.flatMap((l, row) => [t(l, x, y + row * 16), ...(values[row] ? [t(values[row]!, x + 50, y + row * 16)] : [])])

const ITEMS = [
  ...block(100, 100, ['DB-71', 'ALPHA STORE', '1m2', '60A TP', '4C', 'ZX-1', '-']),
  ...block(400, 100, ['MB-9.2', 'MAIN BOARD 9.2', '-', '800A TP', '-', 'ZX-2', '800/5A']),
  ...block(100, 400, ['DB-90/91', 'CHARLIE HALL', '2m2', '100A TP', '4C', 'ZX-3', '-']),
  ...block(400, 400, ['', 'FOXTROT', '3m2', '20A SP', '3C', '', '']),
]

const NODES = [
  { id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' },
  { id: 'n-mb', kind: 'main_board', code: null, shop_number: null, name: 'MAIN BOARD 9.2' },
  { id: 'n-75', kind: 'tenant_db', code: 'DB-75', shop_number: null, name: 'Echo Store' },
]

const shape = (id: string, nodeId: string | null, detectedTag: string | null): CanvasShape => ({
  id, shape: 'rect', points: [0, 0, 1, 0, 1, 1, 0, 1], nodeId, areaType: null, detectedTag, source: 'detected', updatedAt: 't',
})

function props(over: Partial<DetectBlocksPanelProps> = {}): DetectBlocksPanelProps {
  return {
    planId: 'plan-1', pageIndex: 1, pdfUrl: 'https://signed.example/plan.pdf', isPdf: true,
    nodes: NODES, existingShapes: [], canEdit: true, onAccepted: vi.fn(), ...over,
  }
}

const text = (s: string) => screen.queryByText(s)

beforeEach(() => {
  extractMock.mockReset()
  acceptMock.mockReset()
  detectionOverride.current = null
  extractMock.mockResolvedValue({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 1000, height: 1000 })
})

async function detect() {
  fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
  return screen.findByText('Detected 4 blocks — 2 matched · 1 needs you · 1 without a tag')
}

describe('DetectBlocksPanel', () => {
  it('renders nothing for a read-only role', () => {
    const { container } = render(<DetectBlocksPanel {...props({ canEdit: false })} />)
    expect(container.innerHTML).toBe('')
  })

  it('an image drawing gets a sentence, not a button', () => {
    render(<DetectBlocksPanel {...props({ isPdf: false })} />)
    expect(text('Block detection reads the text of a PDF drawing. This drawing is an image — draw blocks by hand.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Detect blocks' })).toBeNull()
  })

  it('reads the plan page and summarises; writes nothing until a click', async () => {
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    expect(extractMock).toHaveBeenCalledWith({ url: 'https://signed.example/plan.pdf' }, 1)
    expect(acceptMock).not.toHaveBeenCalled()
  })

  it('accepts every matched block in one click and hands the shapes to the canvas', async () => {
    const onAccepted = vi.fn()
    acceptMock.mockResolvedValue({ ok: true, data: [shape('s1', 'n-71', 'DB-71'), shape('s2', 'n-mb', 'MB-9.2')] })
    render(<DetectBlocksPanel {...props({ onAccepted })} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Accept 2 matched' }))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    const [{ planId, blocks }] = acceptMock.mock.calls[0]
    expect(planId).toBe('plan-1')
    expect(blocks.map((b: { nodeId: string; detectedTag: string; points: number[] }) => [b.nodeId, b.detectedTag, b.points.length]))
      .toEqual([['n-71', 'DB-71', 8], ['n-mb', 'MB-9.2', 8]])
    expect(onAccepted.mock.calls[0][0].map((s: CanvasShape) => s.id)).toEqual(['s1', 's2'])
    expect(screen.queryByRole('button', { name: 'Accept 2 matched' })).toBeNull()
  })

  it('a block that needs a person takes a picked board; boards claimed elsewhere are disabled', async () => {
    acceptMock.mockResolvedValue({ ok: true, data: [shape('s3', 'n-75', 'DB-90/91')] })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    const select = screen.getByRole('combobox', { name: 'Board for DB-90/91' }) as HTMLSelectElement
    const alpha = within(select).getByRole('option', { name: 'DB-71 · Alpha Store' }) as HTMLOptionElement
    expect(alpha.disabled).toBe(true) // still pending as a matched row
    fireEvent.change(select, { target: { value: 'n-75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add DB-90/91' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks).toEqual([expect.objectContaining({ nodeId: 'n-75', detectedTag: 'DB-90/91' })])
  })

  it('a block without a tag is added unlinked with its NAME as the hint', async () => {
    acceptMock.mockResolvedValue({ ok: true, data: [shape('s4', null, 'NAME: FOXTROT')] })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Add FOXTROT unlinked' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks).toEqual([expect.objectContaining({ nodeId: null, detectedTag: 'NAME: FOXTROT' })])
  })

  it('Skip removes a row without writing', async () => {
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Skip DB-90/91' }))
    expect(screen.queryByRole('combobox', { name: 'Board for DB-90/91' })).toBeNull()
    expect(acceptMock).not.toHaveBeenCalled()
  })

  it('a refused save shows the sentence and keeps the rows', async () => {
    acceptMock.mockResolvedValue({ ok: false, error: 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.' })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    fireEvent.click(screen.getByRole('button', { name: 'Accept 2 matched' }))
    expect((await screen.findByRole('alert')).textContent).toContain('One of these boards is already on this plan.')
    expect(screen.getByRole('button', { name: 'Accept 2 matched' })).not.toBeNull()
  })

  it('a page with no text layer says so', async () => {
    extractMock.mockResolvedValue({ ok: true, items: [], rawItemCount: 0, width: 1, height: 1 })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    expect(await screen.findByText('This page has no readable text — draw blocks by hand.')).not.toBeNull()
  })

  it('a re-run leaves out blocks already on the plan and says how many', async () => {
    render(<DetectBlocksPanel {...props({ existingShapes: [{ id: 'x', points: [90, 80, 150, 80, 150, 120, 90, 120], nodeId: 'n-71' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    expect(await screen.findByText('Detected 3 blocks — 1 matched · 1 needs you · 1 without a tag')).not.toBeNull()
    expect(text('1 block already on this plan was left out.')).not.toBeNull()
  })

  it('a proposal whose outline has no area is flagged, never offered for saving', async () => {
    const real = await vi.importActual<typeof import('@esite/shared/status-plans')>('@esite/shared/status-plans')
    const outcome = real.runDetection(ITEMS, NODES, [])
    if (outcome.kind !== 'review') throw new Error('fixture must review')
    const flat = outcome.review.rows.find((r) => r.block.tag === 'DB-71')!
    flat.block = { ...flat.block, points: [100, 90, 200, 90, 200, 90, 100, 90] }
    detectionOverride.current = () => outcome
    acceptMock.mockResolvedValue({ ok: true, data: [shape('s2', 'n-mb', 'MB-9.2')] })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Detect blocks' }))
    await screen.findByText('Detected 4 blocks — 2 matched · 1 needs you · 1 without a tag')
    expect(text('DB-71: The rectangle has no area — drag it larger. Draw this block by hand.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept 1 matched' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks.map((b: { detectedTag: string }) => b.detectedTag)).toEqual(['MB-9.2'])
  })
})
