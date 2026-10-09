import { describe, it, expect } from 'vitest'
import { statusPlansHref, statusPlanHref, isPdfPath, isRenderableDrawing, fileLabel } from './plan-urls'

describe('status plan urls', () => {
  it('builds the list and plan routes', () => {
    expect(statusPlansHref('p1')).toBe('/projects/p1/status-plans')
    expect(statusPlanHref('p1', 'pl1')).toBe('/projects/p1/status-plans/pl1')
    expect(statusPlanHref('p1', 'pl1', 's1')).toBe('/projects/p1/status-plans/pl1?shape=s1')
    expect(statusPlanHref('p1', 'pl1', null)).toBe('/projects/p1/status-plans/pl1')
  })
  it('encodes ids so they cannot break out of the path', () => {
    expect(statusPlanHref('a/b', 'c?d', 'e&f')).toBe('/projects/a%2Fb/status-plans/c%3Fd?shape=e%26f')
  })
})

describe('drawing types', () => {
  it('knows what the canvas can render', () => {
    expect(isPdfPath('x/E-300.PDF')).toBe(true)
    expect(isRenderableDrawing('x/plan.webp')).toBe(true)
    expect(isRenderableDrawing('x/plan.dwg')).toBe(false)
  })
  it('labels a file by its last path segment', () => {
    expect(fileLabel('org/proj/drawings/643-E-300 rev B.pdf')).toBe('643-E-300 rev B.pdf')
    expect(fileLabel('plain.pdf')).toBe('plain.pdf')
  })
})
