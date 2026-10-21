import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { rectToPoints, type ImageTextItem, type ShopReviewNode, type ShopReviewShape } from '@esite/shared/status-plans'
import type { CanvasShape } from '@/lib/status-plans/types'

// No jest-dom in this repo: assert on textContent / null.
const m = vi.hoisted(() => ({
  extract: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  create: vi.fn(),
  mask: vi.fn(),
  fill: vi.fn(),
  breadcrumb: vi.fn(),
}))
vi.mock('@/lib/status-plans/extract-page-text', () => ({ extractPageText: (...a: unknown[]) => m.extract(...a) }))
vi.mock('@/actions/status-plan-link.actions', () => ({
  linkShapesByLabelAction: (...a: unknown[]) => m.link(...a),
  unlinkShapesAction: (...a: unknown[]) => m.unlink(...a),
}))
vi.mock('@/actions/status-plan.actions', () => ({ createStatusPlanShapeAction: (...a: unknown[]) => m.create(...a) }))
vi.mock('@sentry/nextjs', () => ({ addBreadcrumb: (...a: unknown[]) => m.breadcrumb(...a) }))
vi.mock('@/lib/status-plans/fill-outline', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/status-plans/fill-outline')>()
  return {
    ...real,
    inkMaskFromImageData: (...a: unknown[]) => m.mask(...a),
    fillFromAnchor: (...a: unknown[]) => m.fill(...a),
  }
})

import { ShopsPanel, type ShopsPanelProps } from './ShopsPanel'

// Invented layout (public repo): one label per 1000 px cell, text height 10.
const t = (str: string, x: number, baseline: number): ImageTextItem =>
  ({ str, x, baseline, top: baseline - 10, width: str.length * 6, height: 10 })

const ITEMS: ImageTextItem[] = [
  t('SHOP 1', 100, 100), t('120 m²', 100, 130), // in unlinked s1 → link; drawing ≠ schedule
  t('SHOP 2', 1100, 100), // no shape → draw
  t('SHOP 3', 2100, 100), // in s3 linked to n3 → linked
  t('SHOP 4', 3100, 100), // in s4 linked to n5 → conflict
  t('SHOP 9', 4100, 100), // in unlinked s9 → link
  t('SHOP 6', 100, 1100), t('SHOP 6', 1100, 1100), // duplicate → needs you
  t('SHOP 31', 2100, 1100), // not on the schedule
  t('SHOP 8', 3100, 1100), // n8's shape s8 is elsewhere → linked outside, or moved on a replaced sheet
]

const node = (id: string, shop: string, name: string, scheduledM2: number | null = null): ShopReviewNode =>
  ({ id, kind: 'tenant_db', code: `DB-${shop}`, shop_number: shop, name, scheduledM2, decommissioned: false })
const NODES = [
  node('n1', '1', 'Alpha', 100), node('n2', '2', 'Bravo', 50), node('n3', '3', 'Charlie'), node('n4', '4', 'Delta'),
  node('n5', '5', 'Echo'), node('n6', '6', 'Foxtrot'), node('n8', '8', 'Hotel'), node('n9', '9', 'India'),
]

const canvasShape = (id: string, x0: number, y0: number, nodeId: string | null): CanvasShape => ({
  id, sheetId: 'sheet-1', shape: 'polygon', points: rectToPoints(x0, y0, x0 + 300, y0 + 300), nodeId, areaType: null,
  detectedTag: null, source: 'manual', updatedAt: `u-${id}`,
})
const CANVAS: CanvasShape[] = [
  canvasShape('s1', 0, 0, null),
  canvasShape('s3', 2000, 0, 'n3'),
  canvasShape('s4', 3000, 0, 'n5'),
  canvasShape('s9', 4000, 0, null),
  canvasShape('s8', 5000, 5000, 'n8'),
]
const toReview = (s: CanvasShape): ShopReviewShape => ({ id: s.id, points: s.points, nodeId: s.nodeId, areaType: s.areaType })

function props(over: Partial<ShopsPanelProps> = {}): ShopsPanelProps {
  return {
    sheetId: 'sheet-1', pageIndex: 1, pdfUrl: 'https://signed.example/floor.pdf', isPdf: true,
    nodes: NODES, shapes: CANVAS.map(toReview), shapesById: new Map(CANVAS.map((s) => [s.id, s])),
    pixelsPerMeter: 10, replaced: false, backing: null, canEdit: true, autoScan: false,
    onLinked: vi.fn(), onCreated: vi.fn(), onFocus: vi.fn(), onArmDraw: vi.fn(), onPreview: vi.fn(),
    ...over,
  }
}

const SUMMARY = '9 labels · 10 items read · 2 on the plan · 2 to link · 1 to draw · 1 conflict · 2 need you · 1 not on the schedule · 1 duplicate'

async function scan() {
  fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for shops' }))
  return screen.findByText(SUMMARY)
}

/** A page bitmap the panel can read: a real canvas element whose 2-D context is faked (jsdom has none). */
function fakeBacking(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 100
  c.height = 80
  return c
}

let getContext: { mockRestore: () => void }
beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset()
  m.extract.mockResolvedValue({ ok: true, items: ITEMS, allItems: ITEMS, rawItemCount: ITEMS.length, width: 6000, height: 6000 })
  m.mask.mockReturnValue({ width: 100, height: 80, ink: new Uint8Array(8000) })
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  } as unknown as CanvasRenderingContext2D)
})
afterEach(() => getContext.mockRestore())

describe('ShopsPanel', () => {
  it('scans on mount when autoScan and shows the summary and the Link button with the count', async () => {
    render(<ShopsPanel {...props({ autoScan: true })} />)
    expect(await screen.findByText(SUMMARY)).not.toBeNull()
    expect(m.extract).toHaveBeenCalledTimes(1)
    expect(m.extract).toHaveBeenCalledWith({ url: 'https://signed.example/floor.pdf' }, 1)
    expect(screen.getByRole('button', { name: 'Link 2 shapes' })).not.toBeNull()
    // The breadcrumb carries the counts only, never a tenant name.
    expect(m.breadcrumb).toHaveBeenCalledWith({
      category: 'status-plans', message: 'shops-scan',
      data: { linked: 1, linked_outside: 1, link: 2, conflict: 1, draw: 1, needs_you: 2, not_on_schedule: 1, moved: 0 },
    })
    // Area notes and the shapes with nothing inside are listed.
    expect(within(screen.getByRole('region', { name: 'Drawing ≠ schedule' })).getByText('SHOP 1: drawing says 120.00 m², schedule says 100.00 m²')).not.toBeNull()
    expect(m.link).not.toHaveBeenCalled()
    expect(m.create).not.toHaveBeenCalled()
  })

  it('zero labels shows the draw-by-hand sentence and no buttons', async () => {
    m.extract.mockResolvedValue({ ok: true, items: [t('MALL', 10, 10)], allItems: [t('MALL', 10, 10)], rawItemCount: 1, width: 100, height: 100 })
    render(<ShopsPanel {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for shops' }))
    expect(await screen.findByText('No SHOP labels found on this sheet; draw the shops by hand.')).not.toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Scan sheet for shops'])
  })

  it('reads every run on the page: a SHOP label turned -90° (only in allItems) is listed', async () => {
    // The rotated run's box is tall and narrow: font height wide, advance tall.
    const rotated: ImageTextItem = { str: 'SHOP 7', x: 500, top: 400, width: 10, height: 36, baseline: 436 }
    m.extract.mockResolvedValue({ ok: true, items: [], allItems: [rotated], rawItemCount: 1, width: 1000, height: 1000 })
    render(<ShopsPanel {...props({ nodes: [...NODES, node('n7', '7', 'Golf')], shapes: [], shapesById: new Map() })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for shops' }))
    expect(await screen.findByRole('button', { name: 'Draw SHOP 7' })).not.toBeNull()
    expect(screen.queryByText('No SHOP labels found on this sheet; draw the shops by hand.')).toBeNull()
  })

  it('Link N calls linkShapesByLabelAction with every link row and then offers Undo', async () => {
    const onLinked = vi.fn()
    const linked = [{ ...CANVAS[0]!, nodeId: 'n1', detectedTag: '1', updatedAt: 'v-s1' }, { ...CANVAS[3]!, nodeId: 'n9', detectedTag: '9', updatedAt: 'v-s9' }]
    m.link.mockResolvedValue({ ok: true, data: linked })
    const { rerender } = render(<ShopsPanel {...props({ onLinked })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Link 2 shapes' }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1))
    expect(m.link).toHaveBeenCalledWith({
      sheetId: 'sheet-1',
      links: [
        { shapeId: 's1', nodeId: 'n1', detectedTag: '1', expectedUpdatedAt: 'u-s1' },
        { shapeId: 's9', nodeId: 'n9', detectedTag: '9', expectedUpdatedAt: 'u-s9' },
      ],
    })
    expect(onLinked.mock.calls[0]![0]).toEqual(linked)

    // The workspace folds the linked shapes back in: the rows move to "on the plan".
    const live = CANVAS.map((s) => linked.find((l) => l.id === s.id) ?? s)
    rerender(<ShopsPanel {...props({ onLinked, shapes: live.map(toReview), shapesById: new Map(live.map((s) => [s.id, s])) })} />)
    expect(screen.queryByRole('button', { name: /^Link \d+ shapes?$/ })).toBeNull()
    expect(screen.getByText('Linked 2 shapes.')).not.toBeNull()

    m.unlink.mockResolvedValue({ ok: true, data: CANVAS.filter((s) => s.id === 's1' || s.id === 's9') })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(2))
    expect(m.unlink).toHaveBeenCalledWith({
      sheetId: 'sheet-1',
      unlinks: [{ shapeId: 's1', expectedUpdatedAt: 'v-s1' }, { shapeId: 's9', expectedUpdatedAt: 'v-s9' }],
    })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('Undo presents the updated_at the link returned and leaves out a shape re-linked since', async () => {
    const onLinked = vi.fn()
    const linked = [{ ...CANVAS[0]!, nodeId: 'n1', detectedTag: '1', updatedAt: 'v-s1' }, { ...CANVAS[3]!, nodeId: 'n9', detectedTag: '9', updatedAt: 'v-s9' }]
    m.link.mockResolvedValue({ ok: true, data: linked })
    const { rerender } = render(<ShopsPanel {...props({ onLinked })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Link 2 shapes' }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1))

    // After the link: s1 was reshaped (still n1, newer updated_at); s9 was re-assigned to another shop.
    const live = CANVAS.map((s) =>
      s.id === 's1' ? { ...linked[0]!, updatedAt: 'w-s1' }
      : s.id === 's9' ? { ...linked[1]!, nodeId: 'n4', updatedAt: 'w-s9' }
      : s)
    rerender(<ShopsPanel {...props({ onLinked, shapes: live.map(toReview), shapesById: new Map(live.map((s) => [s.id, s])) })} />)
    m.unlink.mockResolvedValue({ ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(m.unlink).toHaveBeenCalledTimes(1))
    expect(m.unlink).toHaveBeenCalledWith({ sheetId: 'sheet-1', unlinks: [{ shapeId: 's1', expectedUpdatedAt: 'v-s1' }] })
    expect((await screen.findByRole('alert')).textContent).toContain('changed by someone else')
    expect(onLinked).toHaveBeenCalledTimes(1)
  })

  it('Undo with every shape re-linked since sends nothing and says so', async () => {
    const onLinked = vi.fn()
    const linked = [{ ...CANVAS[0]!, nodeId: 'n1', detectedTag: '1', updatedAt: 'v-s1' }]
    m.link.mockResolvedValue({ ok: true, data: linked })
    const { rerender } = render(<ShopsPanel {...props({ onLinked })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Link SHOP 1' }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1))
    const live = CANVAS.map((s) => (s.id === 's1' ? { ...s, nodeId: null, updatedAt: 'w-s1' } : s))
    rerender(<ShopsPanel {...props({ onLinked, shapes: live.map(toReview), shapesById: new Map(live.map((s) => [s.id, s])) })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('alert').textContent).toBe('Nothing to undo: these shapes have been changed since they were linked.')
    expect(m.unlink).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('a suggestion is dropped and its outline cleared once its row is no longer to be drawn', async () => {
    const onPreview = vi.fn()
    const onFocus = vi.fn()
    const polygon = [1050, 50, 1150, 50, 1150, 100, 1050, 100] // 100 × 50 = 5,000 px
    m.fill.mockReturnValue({ kind: 'ok', pixels: 5000, grownPixels: 5200, polygon })
    const base = props({ onPreview, onFocus, backing: fakeBacking() })
    const { rerender } = render(<ShopsPanel {...base} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    expect(onPreview).toHaveBeenLastCalledWith(polygon)

    // The person draws SHOP 2 by hand (or the workspace folds a created shape in): the row is now linked.
    const drawn = { ...canvasShape('s21', 1000, 0, 'n2') }
    const live = [...CANVAS, drawn]
    rerender(<ShopsPanel {...base} shapes={live.map(toReview)} shapesById={new Map(live.map((s) => [s.id, s]))} />)
    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith(null))
    expect(screen.queryByRole('button', { name: 'Accept outline for SHOP 2' })).toBeNull()
    expect(screen.queryByText('Outline 50.0 m² vs GLA 50.0 m²')).toBeNull()

    // Show on the now-linked row focuses it and never re-previews the old outline.
    const previews = onPreview.mock.calls.length
    fireEvent.click(within(screen.getByRole('region', { name: 'On the plan' })).getByRole('button', { name: 'Show SHOP 2 on the drawing' }))
    expect(onFocus).toHaveBeenCalled()
    expect(onPreview.mock.calls.length).toBe(previews)
  })

  it('Draw arms the polygon tool with the node and tag and focuses the padded label box', async () => {
    const onArmDraw = vi.fn()
    const onFocus = vi.fn()
    render(<ShopsPanel {...props({ onArmDraw, onFocus })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Draw SHOP 2' }))
    expect(onArmDraw).toHaveBeenCalledWith({ nodeId: 'n2', detectedTag: '2' })
    // Label box 1100..1136 × 90..100, padded by 400 on every side.
    expect(onFocus).toHaveBeenCalledWith({ minX: 700, minY: -310, maxX: 1536, maxY: 500 })
    fireEvent.click(screen.getByRole('button', { name: 'Show SHOP 2 on the drawing' }))
    expect(onFocus).toHaveBeenCalledTimes(2)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('Suggest with no scale shows "Calibrate the sheet first." and never calls the fill', async () => {
    render(<ShopsPanel {...props({ pixelsPerMeter: null, backing: fakeBacking() })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    expect(screen.getByText('Calibrate the sheet first.')).not.toBeNull()
    expect(m.mask).not.toHaveBeenCalled()
    expect(m.fill).not.toHaveBeenCalled()
  })

  it('an offered suggestion previews, and Accept creates a detected polygon linked to the node', async () => {
    const onPreview = vi.fn()
    const onCreated = vi.fn()
    const polygon = [1050, 50, 1150, 50, 1150, 100, 1050, 100] // 100 × 50 = 5,000 px
    // The gate measures the polygon: 5,000 px at 10 px/m = 50 m², the GLA exactly.
    m.fill.mockReturnValue({ kind: 'ok', pixels: 5000, grownPixels: 5200, polygon })
    const created: CanvasShape = { ...canvasShape('s20', 1050, 50, 'n2'), points: polygon, source: 'detected', detectedTag: '2' }
    m.create.mockResolvedValue({ ok: true, data: created })
    render(<ShopsPanel {...props({ onPreview, onCreated, backing: fakeBacking() })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    expect(screen.getByText('Outline 50.0 m² vs GLA 50.0 m²')).not.toBeNull()
    expect(onPreview).toHaveBeenLastCalledWith(polygon)
    // The floor comes from the scale, not the label: max(100, 2 m² × 10² px/m²) = 200 px.
    expect(m.fill).toHaveBeenCalledWith(expect.anything(), { x: 1118, y: 95 }, { minPixels: 200 })
    expect(m.create).not.toHaveBeenCalled() // nothing is saved before Accept

    // The mask is built once per bitmap.
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    expect(m.mask).toHaveBeenCalledTimes(1)
    expect(m.fill).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Accept outline for SHOP 2' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
    expect(m.create).toHaveBeenCalledWith({
      sheetId: 'sheet-1', shape: 'polygon', points: polygon, nodeId: 'n2', detectedTag: '2', source: 'detected',
    })
    expect(onPreview).toHaveBeenLastCalledWith(null)
    expect(screen.queryByRole('button', { name: 'Accept outline for SHOP 2' })).toBeNull()
  })

  it('a refused suggestion shows the gate\'s reason and offers no Accept', async () => {
    m.fill.mockReturnValue({ kind: 'leak' })
    render(<ShopsPanel {...props({ backing: fakeBacking() })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    expect(screen.getByText('The fill ran into the mall; draw this shop by hand.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept outline for SHOP 2' })).toBeNull()
  })

  it('a suggestion that encloses another label is refused, naming that shop', async () => {
    const onPreview = vi.fn()
    // Covers SHOP 2's own label and SHOP 1's anchor (118, 95); its own label never counts.
    m.fill.mockReturnValue({ kind: 'ok', pixels: 5000, grownPixels: 5200, polygon: [0, 0, 1200, 0, 1200, 200, 0, 200] })
    render(<ShopsPanel {...props({ onPreview, backing: fakeBacking() })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    expect(screen.getByText('The fill covers SHOP 1 as well; draw this shop by hand.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept outline for SHOP 2' })).toBeNull()
    expect(onPreview).not.toHaveBeenCalledWith(expect.arrayContaining([1200]))
  })

  it('Suggest all runs every draw row and says how far it got', async () => {
    m.fill.mockReturnValue({ kind: 'ok', pixels: 5000, grownPixels: 5200, polygon: [0, 0, 100, 0, 100, 50, 0, 50] })
    render(<ShopsPanel {...props({ backing: fakeBacking() })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest all' }))
    expect(screen.getByRole('status').textContent).toBe('Suggesting 1 of 1')
    expect(await screen.findByText('Outline 50.0 m² vs GLA 50.0 m²')).not.toBeNull()
    expect(screen.queryByText(/^Suggesting/)).toBeNull()
    expect(m.fill).toHaveBeenCalledTimes(1)
  })

  it('Dismiss clears the preview and saves nothing', async () => {
    const onPreview = vi.fn()
    m.fill.mockReturnValue({ kind: 'ok', pixels: 5000, grownPixels: 5200, polygon: [0, 0, 100, 0, 100, 50, 0, 50] })
    render(<ShopsPanel {...props({ onPreview, backing: fakeBacking() })} />)
    await scan()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest outline for SHOP 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss outline for SHOP 2' }))
    expect(onPreview).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText('Outline 50.0 m² vs GLA 50.0 m²')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept outline for SHOP 2' })).toBeNull()
    expect(m.create).not.toHaveBeenCalled()
  })

  it('conflict rows render both names and no Link control', async () => {
    render(<ShopsPanel {...props()} />)
    await scan()
    const conflicts = screen.getByRole('region', { name: 'Conflicts' })
    expect(conflicts.textContent).toContain('Delta')
    expect(conflicts.textContent).toContain('Echo')
    expect(within(conflicts).queryByRole('button', { name: /^Link/ })).toBeNull()
    expect(within(conflicts).getByRole('button', { name: 'Show SHOP 4 on the drawing' })).not.toBeNull()
  })

  it('needs_you rows offer the candidate picker', async () => {
    const onArmDraw = vi.fn()
    render(<ShopsPanel {...props({ onArmDraw })} />)
    await scan()
    const needs = screen.getByRole('region', { name: 'Needs you' })
    const pickers = within(needs).getAllByRole('combobox', { name: 'Shop for SHOP 6' }) as HTMLSelectElement[]
    expect(pickers).toHaveLength(2)
    expect(within(pickers[0]!).getByRole('option', { name: '6 · Foxtrot' })).not.toBeNull()
    const draw = within(needs).getAllByRole('button', { name: 'Draw SHOP 6' })[0] as HTMLButtonElement
    fireEvent.change(pickers[0]!, { target: { value: 'n6' } })
    expect(draw.disabled).toBe(false)
    fireEvent.click(draw)
    expect(onArmDraw).toHaveBeenCalledWith({ nodeId: 'n6', detectedTag: '6' })
  })

  it('moved rows render only on a replaced sheet', async () => {
    const { unmount } = render(<ShopsPanel {...props()} />)
    await scan()
    expect(screen.queryByRole('region', { name: 'Moved' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'On the plan' })).getByText(/label outside the shape/)).not.toBeNull()
    unmount()

    const onArmDraw = vi.fn()
    const onFocus = vi.fn()
    render(<ShopsPanel {...props({ replaced: true, onArmDraw, onFocus })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan sheet for shops' }))
    const moved = await screen.findByRole('region', { name: 'Moved' })
    fireEvent.click(within(moved).getByRole('button', { name: 'Show SHOP 8 label' }))
    fireEvent.click(within(moved).getByRole('button', { name: 'Show SHOP 8 shape' }))
    expect(onFocus).toHaveBeenLastCalledWith({ minX: 5000, minY: 5000, maxX: 5300, maxY: 5300 })
    fireEvent.click(within(moved).getByRole('button', { name: 'Redraw SHOP 8' }))
    expect(onArmDraw).toHaveBeenCalledWith({ nodeId: 'n8', detectedTag: '8' })
  })
})
