import { StrictMode } from 'react'
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
  id, sheetId: 'sheet-1', shape: 'rect', points: [0, 0, 1, 0, 1, 1, 0, 1], nodeId, areaType: null, detectedTag, source: 'detected', updatedAt: 't',
})

function props(over: Partial<DetectBlocksPanelProps> = {}): DetectBlocksPanelProps {
  return {
    sheetId: 'sheet-1', pageIndex: 1, pdfUrl: 'https://signed.example/plan.pdf', isPdf: true,
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
  fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
  return screen.findByText('Scanned this sheet — 4 blocks: 2 matched · 1 needs you · 1 without a tag')
}

describe('DetectBlocksPanel', () => {
  it('renders nothing for a read-only role', () => {
    const { container } = render(<DetectBlocksPanel {...props({ canEdit: false })} />)
    expect(container.innerHTML).toBe('')
  })

  it('an image drawing gets a sentence, not a button', () => {
    render(<DetectBlocksPanel {...props({ isPdf: false })} />)
    expect(text('Block detection reads the text of a PDF drawing. This drawing is an image — draw blocks by hand.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Scan sheet for blocks' })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Accept all 2 matched' }))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1))
    const [{ sheetId, blocks }] = acceptMock.mock.calls[0]
    expect(sheetId).toBe('sheet-1')
    expect(blocks.map((b: { nodeId: string; detectedTag: string; points: number[] }) => [b.nodeId, b.detectedTag, b.points.length]))
      .toEqual([['n-71', 'DB-71', 8], ['n-mb', 'MB-9.2', 8]])
    expect(onAccepted.mock.calls[0][0].map((s: CanvasShape) => s.id)).toEqual(['s1', 's2'])
    expect(screen.queryByRole('button', { name: 'Accept all 2 matched' })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Accept all 2 matched' }))
    expect((await screen.findByRole('alert')).textContent).toContain('One of these boards is already on this plan.')
    expect(screen.getByRole('button', { name: 'Accept all 2 matched' })).not.toBeNull()
  })

  it('a page with no text layer says so', async () => {
    extractMock.mockResolvedValue({ ok: true, items: [], rawItemCount: 0, width: 1, height: 1 })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    expect(await screen.findByText('This page has no readable text — draw blocks by hand.')).not.toBeNull()
  })

  it('text found but none upright says to draw by hand', async () => {
    extractMock.mockResolvedValue({ ok: true, items: [], rawItemCount: 40, width: 1, height: 1 })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    expect(await screen.findByText('Text was found on this page, but none of it reads upright — draw the blocks by hand.')).not.toBeNull()
  })

  it('an unreadable or expired drawing link says to reload', async () => {
    extractMock.mockRejectedValue(new Error('UnexpectedResponseException'))
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The drawing link has expired or could not be read — reload the page and try again.')
  })

  it('a block without a tag can be linked to a picked board as well as added unlinked', async () => {
    acceptMock.mockResolvedValue({ ok: true, data: [shape('s5', 'n-75', 'NAME: FOXTROT')] })
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    expect(screen.getByRole('button', { name: 'Add FOXTROT unlinked' })).not.toBeNull()
    const addLinked = screen.getByRole('button', { name: 'Add FOXTROT' }) as HTMLButtonElement
    expect(addLinked.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: 'Board for FOXTROT' }), { target: { value: 'n-75' } })
    expect(addLinked.disabled).toBe(false)
    fireEvent.click(addLinked)
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks).toEqual([expect.objectContaining({ nodeId: 'n-75', detectedTag: 'NAME: FOXTROT' })])
  })

  it('a dots-only match arrives with its candidate preselected but not accepted', async () => {
    extractMock.mockResolvedValue({ ok: true, items: block(100, 100, ['DB-7.5', 'ECHO', '1m2', '10A', '2C', 'ZX', '-']), rawItemCount: 9, width: 1, height: 1 })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    const select = (await screen.findByRole('combobox', { name: 'Board for DB-7.5' })) as HTMLSelectElement
    expect(select.value).toBe('n-75')
    expect(acceptMock).not.toHaveBeenCalled()
  })

  it('a re-run leaves out blocks already on the plan and says how many', async () => {
    render(<DetectBlocksPanel {...props({ existingShapes: [{ id: 'x', points: [90, 80, 225, 80, 225, 210, 90, 210], nodeId: 'n-71' }] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    expect(await screen.findByText('Scanned this sheet — 3 blocks: 1 matched · 1 needs you · 1 without a tag')).not.toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    await screen.findByText('Scanned this sheet — 4 blocks: 2 matched · 1 needs you · 1 without a tag')
    expect(text('DB-71: The rectangle has no area — drag it larger. Draw this block by hand.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept all 1 matched' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks.map((b: { detectedTag: string }) => b.detectedTag)).toEqual(['MB-9.2'])
  })

  it('every reviewable row has Show, which hands the block\'s box to onFocus', async () => {
    const onFocus = vi.fn()
    render(<DetectBlocksPanel {...props({ onFocus })} />)
    await detect()
    for (const label of ['DB-71', 'DB-90/91', 'FOXTROT']) {
      expect(screen.getByRole('button', { name: `Show ${label} on the drawing` })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Show DB-71 on the drawing' }))
    const box = onFocus.mock.calls[0]![0] as { minX: number; minY: number; maxX: number; maxY: number }
    expect(box.minX).toBeLessThanOrEqual(100)
    expect(box.maxX).toBeGreaterThan(100)
    expect(box.minY).toBeLessThanOrEqual(100)
    expect(box.maxY).toBeGreaterThan(100)
  })

  it('autoScan reads the sheet on open, once, and leads with the headline and Accept all', async () => {
    let release: () => void = () => {}
    extractMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, items: ITEMS, rawItemCount: ITEMS.length, width: 1000, height: 1000 })
    }))
    const { rerender } = render(<DetectBlocksPanel {...props({ autoScan: true })} />)
    expect((await screen.findByRole('status')).textContent).toBe('Scanning sheet…')
    release()
    expect(await screen.findByText('Scanned this sheet — 4 blocks: 2 matched · 1 needs you · 1 without a tag')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Accept all 2 matched' })).not.toBeNull()
    rerender(<DetectBlocksPanel {...props({ autoScan: true, existingShapes: [] })} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(extractMock).toHaveBeenCalledTimes(1)
    expect(acceptMock).not.toHaveBeenCalled()
  })

  it('autoScan runs once under StrictMode (effects run twice in development)', async () => {
    render(<StrictMode><DetectBlocksPanel {...props({ autoScan: true })} /></StrictMode>)
    await screen.findByText('Scanned this sheet — 4 blocks: 2 matched · 1 needs you · 1 without a tag')
    expect(extractMock).toHaveBeenCalledTimes(1)
  })

  it('autoScan scans again only when a different sheet opens', async () => {
    const { rerender } = render(<DetectBlocksPanel {...props({ autoScan: true })} />)
    await screen.findByText('Scanned this sheet — 4 blocks: 2 matched · 1 needs you · 1 without a tag')
    rerender(<DetectBlocksPanel {...props({ autoScan: true, sheetId: 'sheet-2' })} />)
    await waitFor(() => expect(extractMock).toHaveBeenCalledTimes(2))
  })

  it('autoScan never runs for a read-only viewer', async () => {
    const { container } = render(<DetectBlocksPanel {...props({ autoScan: true, canEdit: false })} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(extractMock).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  it('an auto scan that cannot read the file shows the existing sentence', async () => {
    extractMock.mockRejectedValue(new Error('UnexpectedResponseException'))
    render(<DetectBlocksPanel {...props({ autoScan: true })} />)
    expect((await screen.findByRole('alert')).textContent).toBe('The drawing link has expired or could not be read — reload the page and try again.')
    expect(extractMock).toHaveBeenCalledTimes(1)
  })

  it('a main board\'s meter is listed as part of it, collapsed, out of Accept all, and can be added unlinked', async () => {
    const items = [
      ...ITEMS,
      ...block(700, 100, ['MB-9.2 BULK CHECK METER', 'MAIN BOARD 9.2', '-', '800A TP', '-', 'ZX-5', '800/5A']),
    ]
    extractMock.mockResolvedValue({ ok: true, items, rawItemCount: items.length, width: 1000, height: 1000 })
    acceptMock.mockResolvedValue({ ok: true, data: [shape('s7', null, 'MB-9.2 BULK CHECK METER')] })
    render(<DetectBlocksPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for blocks' }))
    await screen.findByText('Scanned this sheet — 5 blocks: 2 matched · 1 needs you · 1 part of a main board · 1 without a tag')
    const parts = screen.getByText('Parts of main boards (1)').closest('details')!
    expect(parts.open).toBe(false)
    expect(within(parts).getByText('Part of MB-9.2 — not a separate board.')).not.toBeNull()
    expect(within(parts).queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept all 2 matched' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks.map((b: { detectedTag: string }) => b.detectedTag)).toEqual(['DB-71', 'MB-9.2'])
    acceptMock.mockClear()
    fireEvent.click(within(parts).getByRole('button', { name: 'Add MB-9.2 BULK CHECK METER unlinked' }))
    await waitFor(() => expect(acceptMock).toHaveBeenCalledTimes(1))
    expect(acceptMock.mock.calls[0][0].blocks).toEqual([expect.objectContaining({ nodeId: null, detectedTag: 'MB-9.2 BULK CHECK METER' })])
  })

  it('without onFocus there is no Show button', async () => {
    render(<DetectBlocksPanel {...props()} />)
    await detect()
    expect(screen.queryByRole('button', { name: /^Show / })).toBeNull()
  })
})
