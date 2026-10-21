import { describe, it, expect } from 'vitest'
import { canvasReducer, initialCanvasState, isIdle, dragVertex, type CanvasState, type CanvasEvent } from './canvas-reducer'

const TOL = 5
function run(state: CanvasState, events: CanvasEvent[]) {
  let s = state
  const commits = []
  for (const e of events) {
    const step = canvasReducer(s, e)
    s = step.state
    if (step.commit) commits.push(step.commit)
  }
  return { state: s, commits }
}
const press = (x: number, y: number): CanvasEvent => ({ type: 'press', x, y, tolPx: TOL })

describe('polygon tool', () => {
  it('clicks place corners; pressing the first corner closes and commits', () => {
    const { state, commits } = run(initialCanvasState('polygon'), [press(0, 0), press(100, 0), press(100, 50), press(2, 1)])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50], link: null }])
    expect(state.draft).toEqual([])
  })

  it('double-click (two presses on one spot, then finish) commits once without a zero-length edge', () => {
    const { commits } = run(initialCanvasState('polygon'), [
      press(0, 0), press(100, 0), press(100, 50), press(100.5, 50.5), { type: 'finish', tolPx: TOL },
    ])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50], link: null }])
  })

  it('finishing with fewer than 3 corners discards', () => {
    const { state, commits } = run(initialCanvasState('polygon'), [press(0, 0), press(10, 0), { type: 'finish', tolPx: TOL }])
    expect(commits).toEqual([])
    expect(state.draft).toEqual([])
  })

  it('undoPoint drops the last corner; escape drops the draft', () => {
    const a = run(initialCanvasState('polygon'), [press(0, 0), press(10, 0), { type: 'undoPoint' }])
    expect(a.state.draft).toEqual([0, 0])
    const b = run(a.state, [{ type: 'escape' }])
    expect(b.state.draft).toEqual([])
    expect(isIdle(b.state)).toBe(true)
  })
})

describe('rectangle tool', () => {
  it('press-drag-release commits a normalised rectangle', () => {
    const { commits, state } = run(initialCanvasState('rect'), [
      press(300, 260), { type: 'move', x: 200, y: 200 }, { type: 'release', x: 100, y: 100, tolPx: TOL },
    ])
    expect(commits).toEqual([{ shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260], link: null }])
    expect(state.rect).toBeNull()
  })

  it('a click without a drag commits nothing', () => {
    const { commits } = run(initialCanvasState('rect'), [press(10, 10), { type: 'release', x: 12, y: 11, tolPx: TOL }])
    expect(commits).toEqual([])
  })

  it('move without a press changes nothing (same state object)', () => {
    const s = initialCanvasState('rect')
    expect(canvasReducer(s, { type: 'move', x: 1, y: 1 }).state).toBe(s)
  })
})

describe('calibrate, select, pan and tool changes', () => {
  it('calibrate keeps two points; a third press starts over', () => {
    expect(run(initialCanvasState('calibrate'), [press(1, 2), press(3, 4)]).state.calib).toEqual([1, 2, 3, 4])
    expect(run(initialCanvasState('calibrate'), [press(1, 2), press(3, 4), press(5, 6)]).state.calib).toEqual([5, 6])
  })
  it('select and pan presses change nothing', () => {
    for (const tool of ['select', 'pan'] as const) {
      const s = initialCanvasState(tool)
      expect(canvasReducer(s, press(1, 1)).state).toBe(s)
    }
  })
  it('changing tool abandons anything in progress', () => {
    const a = run(initialCanvasState('polygon'), [press(0, 0), { type: 'tool', tool: 'rect' }])
    expect(a.state).toEqual(initialCanvasState('rect'))
  })
})

describe('dragVertex', () => {
  it('moves one polygon corner', () => {
    expect(dragVertex({ shape: 'polygon', points: [0, 0, 10, 0, 10, 10] }, 1, 12.5, -1)).toEqual([0, 0, 12.5, -1, 10, 10])
  })
  it('a rectangle stays a rectangle: the opposite corner is the anchor', () => {
    // TL,TR,BR,BL; drag BR (index 2) past TL
    expect(dragVertex({ shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260] }, 2, 50, 40))
      .toEqual([50, 40, 100, 40, 100, 100, 50, 100])
  })
})

describe('client-side shape check before commit', () => {
  it('a polygon that crosses itself keeps the draft and says why', () => {
    const start = run(initialCanvasState('polygon'), [press(0, 0), press(100, 100), press(100, 0), press(0, 100)]).state
    const step = canvasReducer(start, { type: 'finish', tolPx: TOL })
    expect(step.commit).toBeNull()
    expect(step.state.draft).toEqual([0, 0, 100, 100, 100, 0, 0, 100])
    expect(step.error).toBe('The outline crosses itself — redraw it without crossing lines.')
  })
  it('closing on the first corner is checked the same way', () => {
    const start = run(initialCanvasState('polygon'), [press(0, 0), press(100, 100), press(100, 0), press(0, 100)]).state
    const step = canvasReducer(start, press(1, 1))
    expect(step.commit).toBeNull()
    expect(step.state.draft).toHaveLength(8)
    expect(step.error).toMatch(/crosses itself/)
  })
  it('a good polygon commits, clears the draft and has no error', () => {
    const start = run(initialCanvasState('polygon'), [press(0, 0), press(100, 0), press(100, 50)]).state
    const step = canvasReducer(start, { type: 'finish', tolPx: TOL })
    expect(step.commit).toEqual({ shape: 'polygon', points: [0, 0, 100, 0, 100, 50], link: null })
    expect(step.state.draft).toEqual([])
    expect(step.error).toBeNull()
  })
})

describe('dragVertex to zero size', () => {
  it('yields points pointsError calls a rectangle with no area', async () => {
    const { pointsError } = await import('@esite/shared/status-plans')
    const pts = dragVertex({ shape: 'rect', points: [0, 0, 100, 0, 100, 50, 0, 50] }, 2, 0, 0)
    expect(pointsError('rect', pts)).toBe('The rectangle has no area — drag it larger.')
  })
})

describe('pending tenant link', () => {
  const link = { nodeId: 'n1', detectedTag: 'DB-12' }
  const triangle = [press(0, 0), press(100, 0), press(100, 50)]

  it('armDraw switches to polygon with the link pending', () => {
    const start = { ...initialCanvasState('rect'), draft: [1, 2], rect: { x0: 0, y0: 0, x1: 5, y1: 5 } }
    const step = canvasReducer(start, { type: 'armDraw', link })
    expect(step.commit).toBeNull()
    expect(step.state.tool).toBe('polygon')
    expect(step.state.draft).toEqual([])
    expect(step.state.rect).toBeNull()
    expect(step.state.pendingLink).toEqual(link)
  })

  it('a polygon commit carries the link and clears it', () => {
    const armed = canvasReducer(initialCanvasState('select'), { type: 'armDraw', link }).state
    const { state, commits } = run(armed, [...triangle, { type: 'finish', tolPx: TOL }])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50], link }])
    expect(state.pendingLink).toBeNull()
    expect(state.tool).toBe('polygon')
  })

  it('a refused polygon keeps the link pending', () => {
    const armed = canvasReducer(initialCanvasState('select'), { type: 'armDraw', link }).state
    const { state, commits } = run(armed, [press(0, 0), press(100, 100), press(100, 0), press(0, 100), { type: 'finish', tolPx: TOL }])
    expect(commits).toEqual([])
    expect(state.pendingLink).toEqual(link)
  })

  it('tool change and escape clear the pending link', () => {
    const armed = canvasReducer(initialCanvasState('select'), { type: 'armDraw', link }).state
    expect(canvasReducer(armed, { type: 'tool', tool: 'select' }).state.pendingLink).toBeNull()
    const drawing = run(armed, [press(0, 0)]).state
    expect(drawing.pendingLink).toEqual(link)
    expect(canvasReducer(drawing, { type: 'escape' }).state.pendingLink).toBeNull()
    expect(canvasReducer(armed, { type: 'escape' }).state.pendingLink).toBeNull()
  })

  it('a commit without armDraw carries link null', () => {
    const poly = run(initialCanvasState('polygon'), [...triangle, { type: 'finish', tolPx: TOL }])
    expect(poly.commits[0]!.link).toBeNull()
    const rect = run(initialCanvasState('rect'), [press(0, 0), { type: 'release', x: 50, y: 50, tolPx: TOL }])
    expect(rect.commits[0]!.link).toBeNull()
  })

  it('armDraw clears calibration points left by the calibrate tool', () => {
    const calibrating = run(initialCanvasState('calibrate'), [press(10, 10), press(200, 10)]).state
    expect(calibrating.calib).toEqual([10, 10, 200, 10])
    const armed = canvasReducer(calibrating, { type: 'armDraw', link }).state
    expect(armed.calib).toEqual([])
    expect(armed.tool).toBe('polygon')
  })

  it('a Redraw link (replaceShapeId) is carried through armDraw to the commit', () => {
    const redraw = { ...link, replaceShapeId: 's8' }
    const armed = canvasReducer(initialCanvasState('select'), { type: 'armDraw', link: redraw }).state
    expect(armed.pendingLink).toEqual(redraw)
    const { commits } = run(armed, [...triangle, { type: 'finish', tolPx: TOL }])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50], link: redraw }])
  })

  it('restoreDraft puts a refused polygon back with its link, only when nothing else was started', () => {
    const redraw = { ...link, replaceShapeId: 's8' }
    const armed = canvasReducer(initialCanvasState('select'), { type: 'armDraw', link: redraw }).state
    const done = run(armed, [...triangle, { type: 'finish', tolPx: TOL }])
    const back = canvasReducer(done.state, { type: 'restoreDraft', commit: done.commits[0]! }).state
    expect(back.draft).toEqual([0, 0, 100, 0, 100, 50])
    expect(back.pendingLink).toEqual(redraw)
    // Started another shape, or left the polygon tool, in the meantime: nothing is restored.
    const busy = run(done.state, [press(5, 5)]).state
    expect(canvasReducer(busy, { type: 'restoreDraft', commit: done.commits[0]! }).state).toBe(busy)
    const other = canvasReducer(done.state, { type: 'tool', tool: 'select' }).state
    expect(canvasReducer(other, { type: 'restoreDraft', commit: done.commits[0]! }).state).toBe(other)
  })

  it('a rectangle never takes the link', () => {
    const armed = canvasReducer(initialCanvasState('select'), { type: 'armDraw', link }).state
    const { commits } = run({ ...armed, tool: 'rect' }, [press(0, 0), { type: 'release', x: 50, y: 50, tolPx: TOL }])
    expect(commits[0]!.link).toBeNull()
  })
})
