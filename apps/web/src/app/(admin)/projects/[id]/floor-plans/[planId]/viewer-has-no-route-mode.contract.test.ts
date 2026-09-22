/**
 * Cable route tracing lives on the cable schedule's measure page, not on the
 * drawing viewer. This pins that down at the source level, because the split
 * is the whole point of the 2026-09-22 change and nothing at runtime would
 * notice route mode quietly growing back into the viewer.
 *
 * Two claims, both read from the files rather than from anyone's memory of
 * them:
 *  1. none of the three viewer files carries a route MODE — no `routeMode`
 *     prop, no cable picker, no `?mode=route`, no `'route'` in `ViewerMode`;
 *     the viewer may still DRAW routes (`routeOverlay`, `RouteLayer`).
 *  2. the route canvas and the markup canvas are built on the same three
 *     sheet primitives, so they cannot drift apart.
 *
 * Mutation-proven: reintroducing `routeMode?:` into MarkupCanvas fails (1);
 * dropping the `use-sheet-viewport` import from either canvas fails (2).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const viewerDir = resolve(__dirname)
const measureDir = resolve(__dirname, '../../cables/[revisionId]/measure')

const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the drawing viewer has no route mode', () => {
  const files = ['MarkupCanvas.tsx', 'DrawingViewer.tsx', 'page.tsx'].map((f) => ({ f, src: stripComments(read(resolve(viewerDir, f))) }))

  it.each(files)('$f carries no routeMode, cable picker or ?mode=route', ({ src }) => {
    expect(src).not.toMatch(/\brouteMode\b/)
    expect(src).not.toMatch(/\bcablePicker\b/)
    expect(src).not.toMatch(/mode=route/)
    expect(src).not.toMatch(/\bROUTE_TOOLS\b/)
  })

  it('ViewerMode is exactly view | markup | rfi', () => {
    const canvas = files.find((x) => x.f === 'MarkupCanvas.tsx')!.src
    expect(canvas).toMatch(/export type ViewerMode = 'view' \| 'markup' \| 'rfi'\n/)
  })

  it('still draws saved routes (the drawing is the record)', () => {
    const canvas = files.find((x) => x.f === 'MarkupCanvas.tsx')!.src
    expect(canvas).toMatch(/routeOverlay/)
    expect(canvas).toMatch(/<RouteLayer/)
  })
})

describe('both canvases stand on the same sheet primitives', () => {
  const primitives = ['@/lib/sheet/use-sheet-image', '@/lib/sheet/use-sheet-viewport', '@/lib/sheet/draft-store']

  it.each([
    ['MarkupCanvas.tsx', resolve(viewerDir, 'MarkupCanvas.tsx')],
    ['RouteCanvas.tsx', resolve(measureDir, 'RouteCanvas.tsx')],
  ])('%s imports every primitive', (_name, path) => {
    const src = read(path)
    for (const p of primitives) expect(src).toContain(`from '${p}'`)
  })

  it('the route canvas draws with RouteLayer and traces through the shared snap and history modules', () => {
    const src = read(resolve(measureDir, 'RouteCanvas.tsx'))
    expect(src).toMatch(/floor-plans\/\[planId\]\/RouteLayer'/)
    expect(src).toContain("from '@/lib/cable-route/snap'")
    expect(src).toContain("from '@/lib/cable-route/route-history'")
  })
})
