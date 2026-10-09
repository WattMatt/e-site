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
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50] }])
    expect(state.draft).toEqual([])
  })

  it('double-click (two presses on one spot, then finish) commits once without a zero-length edge', () => {
    const { commits } = run(initialCanvasState('polygon'), [
      press(0, 0), press(100, 0), press(100, 50), press(100.5, 50.5), { type: 'finish', tolPx: TOL },
    ])
    expect(commits).toEqual([{ shape: 'polygon', points: [0, 0, 100, 0, 100, 50] }])
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
    expect(commits).toEqual([{ shape: 'rect', points: [100, 100, 300, 100, 300, 260, 100, 260] }])
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
    expect(step.commit).toEqual({ shape: 'polygon', points: [0, 0, 100, 0, 100, 50] })
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
