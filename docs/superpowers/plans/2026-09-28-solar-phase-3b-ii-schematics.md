# Solar Phase 3b-ii — Schematics tab (list, Konva editor, hierarchy, sheet export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/projects/[id]/solar/schematics` exactly as functional spec §13: a list of single-line diagrams (add from a project drawing **and page**, or a blank canvas; replace drawing; delete / delete selected; "No schematic required"), and a Konva editor on the sheet primitives (select/move/resize with snapping guides, place meter or create a meter stub, connect with waypoints and live anchors, include-in-load toggle, layers, pan/zoom/fit, undo/redo, explicit save with stale-write refusal and an IndexedDB draft, PDF sheet into `projects.reports` kind `solar_schematic_sheet`, SVG download with the background embedded). Then finish Phase 3b: three suites, build, two reviewers, push, draft PR.

**Architecture:** Pure editor state (`lib/solar/schematics/editor.ts`) holds cards and lines in drawing-image pixels and refuses loops with the shared `wouldCreateCycle` (the database refuses them too — 00215). The Konva canvas (`SchematicCanvas`) is a thin view over that state using `useSheetImage` + `useSheetViewport` (the same image space as markup and cable routes, so coordinates are stable across devices). Saves go through `public.solar_save_schematic` (replace-all, `40001` on stale). The hierarchy the lines define is already consumed by the Load builder (plan 3b-0 Task 12: double-count guard, parent reconciliation on Checks).

**Tech Stack:** Next.js 15, react-konva / konva (already in `apps/web`), pdf-lib (already used by the cable route sheet), `@esite/shared/solar-load`, Vitest + Testing Library.

**Prerequisites:** plans 3b-0 and 3b-i complete on `feat/solar-phase-3b` (same worktree).

---

## Ground rules

- Same as 3b-i: every page/action/route gates itself (`requireSolarLevel` / `requireSolarLevelAPI`); caller's client for every write except the report upload (service client after the gate, as `exportLayoutSheetAction` / `exportRouteSheetAction` do); JSON-only props across the server → client boundary; `useArmedConfirm` for destructive actions; `expectedUpdatedAt` on every save; strings reaching a PDF through `winAnsiSafe`; no `innerHTML` (SVG export is built as an escaped string and downloaded as a Blob).
- Konva: select on `mousedown` (Konva `click` is not synthesised reliably — CLAUDE.md); coordinates via `stage.getRelativePointerPosition()`; drag events bubble, so the stage's `onDragEnd` ignores child targets. `RouteCanvas`/`MarkupCanvas` have no component tests (Konva under jsdom); the same is accepted here and the **workspace** is tested with the canvas mocked.
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Design decisions (owner should see them)

1. **One card per meter per schematic**; a meter may appear on several schematics (a board on two sheets). The hierarchy is the union of every schematic's supply lines in the study; a loop anywhere is refused.
2. **Create meter stub** makes a library meter (`kind` chosen, default *Unknown*) linked to this study with no data — an unmetered point on the diagram. It shows in Load → Meters as "No data".
3. **Include-in-load** needs the meter linked to a tenant (`meters.node_id`); it writes that tenant's `tenant_load_basis.source` (`metered` with this meter / `excluded`). Unlinked meters show the toggle disabled with the reason.
4. **Blank canvas** is 2400 × 1600 image px (stored `canvas_w`/`canvas_h`).
5. **Replace drawing** keeps every card position and line waypoint in image pixels and shows "positions may need adjusting"; a schematic whose drawing file changed since it was anchored shows the same warning on open (00205 pattern) — it never auto-realigns.
6. **Line types:** `supply` (hierarchy) and `check` (a check meter beside a supply meter; excluded from the hierarchy and the double-count guard).
7. **Point-of-connection offer (§13.3 bullet 3) is deferred** to the Site & Supply follow-up: the connection graph exists (`schematic_lines`), but wiring it into the PoC select is a Site-tab change outside this phase. **Open question.**

## File structure

| File | Responsibility |
|---|---|
| `apps/web/src/lib/solar/schematics/editor.ts` (+ test) | Doc model, place/move/resize/remove, connect (loop-refusing), waypoints, anchors, snapping, history, save payload |
| `apps/web/src/lib/solar/schematics/svg.ts` (+ test) | SVG export string (escaped; background embedded as a data URL) |
| `apps/web/src/lib/solar/schematics/sheet-pdf.ts` (+ test) | PDF sheet (drawing crop + legend + title block) |
| `apps/web/src/lib/solar/schematics/load.ts` (+ test) | List and editor loaders |
| `apps/web/src/lib/solar/schematics/view-types.ts` | JSON view models |
| `apps/web/src/actions/solar-schematics.actions.ts` (+ test) | create / meta / replace / delete / waive / save / stub / include / export |
| `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schematics/page.tsx` | List |
| `…/schematics/_components/SchematicsList.tsx`, `AddSchematicDialog.tsx`, `DrawingPagePicker.tsx` (+ tests) | List UI |
| `…/schematics/[schematicId]/page.tsx` | Editor loader |
| `…/schematics/[schematicId]/_components/SchematicWorkspace.tsx` (+ test), `SchematicCanvas.tsx`, `PlaceMeterDialog.tsx`, `ConnectionsManager.tsx` | Editor UI |
| `apps/web/src/lib/reports/report-kind-access.contract.test.ts` | (already covers the kind — Task 6 of 3b-0) |
| `docs/rbac-matrix.md`, `docs/solar/03-data-model-and-security.md` | Rows and as-built notes |

---

### Task 1: Editor state (pure)

**Files:**
- Create: `apps/web/src/lib/solar/schematics/editor.ts`
- Test: `apps/web/src/lib/solar/schematics/editor.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  addLine, anchorOf, historyCommit, historyInit, historyRedo, historyUndo, linePoints, moveCard, placeCard, removeCard,
  removeLine, resizeCard, setWaypoints, snapCard, toSavePayload, type SchematicDoc,
} from './editor'

const empty: SchematicDoc = { cards: [], lines: [] }
const withTwo = (): SchematicDoc => ({
  cards: [
    { meterId: 'A', x: 0, y: 0, w: 180, h: 64, colour: null },
    { meterId: 'B', x: 400, y: 0, w: 180, h: 64, colour: null },
  ],
  lines: [],
})

describe('schematic editor', () => {
  it('places a card centred on the click, once per meter', () => {
    const r = placeCard(empty, 'A', { x: 100, y: 100 })
    expect(r.ok && r.doc.cards[0]).toEqual({ meterId: 'A', x: 10, y: 68, w: 180, h: 64, colour: null })
    const again = placeCard((r as { doc: SchematicDoc }).doc, 'A', { x: 0, y: 0 })
    expect(again).toEqual({ ok: false, reason: 'That meter is already on this schematic.' })
  })
  it('moves and resizes with limits', () => {
    const d = resizeCard(moveCard(withTwo(), 'A', 5, 6), 'A', 10, 99999)
    expect(d.cards[0]).toMatchObject({ x: 5, y: 6, w: 60, h: 5000 })
  })
  it('connects placed meters, refuses self, duplicates and loops (including other schematics’ lines)', () => {
    const d = withTwo()
    const r = addLine(d, { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, [])
    expect(r.ok).toBe(true)
    const d2 = (r as { doc: SchematicDoc }).doc
    expect(addLine(d2, { fromMeterId: 'A', toMeterId: 'A', waypoints: [], lineType: 'supply' }, [])).toMatchObject({ ok: false })
    expect(addLine(d2, { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, [])).toEqual({ ok: false, reason: 'Those meters are already connected.' })
    expect(addLine(d2, { fromMeterId: 'B', toMeterId: 'A', waypoints: [], lineType: 'supply' }, [])).toEqual({ ok: false, reason: 'That connection would make a loop in the supply hierarchy.' })
    expect(addLine(d, { fromMeterId: 'B', toMeterId: 'A', waypoints: [], lineType: 'supply' }, [{ fromMeterId: 'A', toMeterId: 'B' }])).toMatchObject({ ok: false })
    expect(addLine(d2, { fromMeterId: 'B', toMeterId: 'A', waypoints: [], lineType: 'check' }, []).ok).toBe(true)
    expect(addLine(d, { fromMeterId: 'A', toMeterId: 'Z', waypoints: [], lineType: 'supply' }, [])).toEqual({ ok: false, reason: 'Both meters must be placed first.' })
  })
  it('deleting a card deletes its lines', () => {
    const d = (addLine(withTwo(), { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, []) as { doc: SchematicDoc }).doc
    expect(removeCard(d, 'B')).toEqual({ cards: [d.cards[0]], lines: [] })
    expect(removeLine(d, d.lines[0].key).lines).toEqual([])
  })
  it('anchors follow the card (live), waypoints in between', () => {
    const d0 = (addLine(withTwo(), { fromMeterId: 'A', toMeterId: 'B', waypoints: [], lineType: 'supply' }, []) as { doc: SchematicDoc }).doc
    const d = setWaypoints(d0, d0.lines[0].key, [300, 200])
    expect(anchorOf(d.cards[0], { x: 1000, y: 32 })).toEqual({ x: 180, y: 32 })
    // A faces (300,200) with its bottom side, B faces it with its bottom side too (steep angle).
    expect(linePoints(d.lines[0], d)).toEqual([90, 64, 300, 200, 490, 64])
    const moved = moveCard(d, 'B', 400, 500)
    expect(linePoints(moved.lines[0], moved)?.slice(-2)).toEqual([490, 500])
    expect(() => setWaypoints(d, d.lines[0].key, [1, 2, 3])).toThrow(RangeError)
  })
  it('snaps a card to another card’s left edge or centre within the tolerance', () => {
    const s = snapCard({ meterId: 'X', x: 404, y: 203, w: 180, h: 64, colour: null }, withTwo().cards, 8)
    expect(s.x).toBe(400)
    expect(s.guides).toContainEqual({ axis: 'x', at: 400 })
  })
  it('history: commit, undo, redo; a new commit clears the future', () => {
    let h = historyInit(1)
    h = historyCommit(h, 2)
    h = historyCommit(h, 3)
    h = historyUndo(h)
    expect(h.present).toBe(2)
    h = historyRedo(h)
    expect(h.present).toBe(3)
    h = historyCommit(historyUndo(h), 9)
    expect(h.future).toEqual([])
  })
  it('save payload drops local keys', () => {
    const d = (addLine(withTwo(), { fromMeterId: 'A', toMeterId: 'B', waypoints: [1, 2], lineType: 'supply' }, []) as { doc: SchematicDoc }).doc
    expect(toSavePayload(d).lines).toEqual([{ fromMeterId: 'A', toMeterId: 'B', waypoints: [1, 2], lineType: 'supply' }])
    expect(toSavePayload(d).cards[0]).toEqual({ meterId: 'A', x: 0, y: 0, w: 180, h: 64, colour: null })
  })
})
```

Run: `pnpm --filter web test -- lib/solar/schematics/editor` → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/solar/schematics/editor.ts
/**
 * Schematic editor state (functional spec §13.2). Pure: every Konva gesture becomes one of these
 * operations, and history stores one snapshot per completed gesture. Coordinates are drawing-image
 * pixels (useSheetImage's image space), so they are identical across devices and sessions.
 * Loops in the supply hierarchy are refused here AND by the database (00215 schematic_lines_bind).
 */
import { wouldCreateCycle, type MeterLine } from '@esite/shared/solar-load'

export interface SchematicCard { meterId: string; x: number; y: number; w: number; h: number; colour: string | null }
export interface SchematicLine { key: string; fromMeterId: string; toMeterId: string; waypoints: number[]; lineType: 'supply' | 'check' }
export interface SchematicDoc { cards: SchematicCard[]; lines: SchematicLine[] }
export type EditResult = { ok: true; doc: SchematicDoc } | { ok: false; reason: string }

export const DEFAULT_CARD = { w: 180, h: 64 } as const
export const CARD_MIN = { w: 60, h: 30 } as const
export const CARD_MAX = 5000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lineKey = (l: Pick<SchematicLine, 'fromMeterId' | 'toMeterId' | 'lineType'>) => `${l.fromMeterId}>${l.toMeterId}:${l.lineType}`

export function placeCard(doc: SchematicDoc, meterId: string, at: { x: number; y: number }): EditResult {
  if (doc.cards.some((c) => c.meterId === meterId)) return { ok: false, reason: 'That meter is already on this schematic.' }
  return { ok: true, doc: { ...doc, cards: [...doc.cards, { meterId, x: at.x - DEFAULT_CARD.w / 2, y: at.y - DEFAULT_CARD.h / 2, w: DEFAULT_CARD.w, h: DEFAULT_CARD.h, colour: null }] } }
}

export function moveCard(doc: SchematicDoc, meterId: string, x: number, y: number): SchematicDoc {
  return { ...doc, cards: doc.cards.map((c) => (c.meterId === meterId ? { ...c, x, y } : c)) }
}

export function resizeCard(doc: SchematicDoc, meterId: string, w: number, h: number): SchematicDoc {
  return { ...doc, cards: doc.cards.map((c) => (c.meterId === meterId ? { ...c, w: clamp(w, CARD_MIN.w, CARD_MAX), h: clamp(h, CARD_MIN.h, CARD_MAX) } : c)) }
}

export function setCardColour(doc: SchematicDoc, meterId: string, colour: string | null): SchematicDoc {
  return { ...doc, cards: doc.cards.map((c) => (c.meterId === meterId ? { ...c, colour } : c)) }
}

export function removeCard(doc: SchematicDoc, meterId: string): SchematicDoc {
  return { cards: doc.cards.filter((c) => c.meterId !== meterId), lines: doc.lines.filter((l) => l.fromMeterId !== meterId && l.toMeterId !== meterId) }
}

export function addLine(doc: SchematicDoc, line: Omit<SchematicLine, 'key'>, external: MeterLine[]): EditResult {
  if (line.fromMeterId === line.toMeterId) return { ok: false, reason: 'A meter cannot feed itself.' }
  const placed = new Set(doc.cards.map((c) => c.meterId))
  if (!placed.has(line.fromMeterId) || !placed.has(line.toMeterId)) return { ok: false, reason: 'Both meters must be placed first.' }
  const key = lineKey(line)
  if (doc.lines.some((l) => l.key === key)) return { ok: false, reason: 'Those meters are already connected.' }
  const all: MeterLine[] = [...external, ...doc.lines.map((l) => ({ fromMeterId: l.fromMeterId, toMeterId: l.toMeterId, lineType: l.lineType }))]
  if (wouldCreateCycle(all, line)) return { ok: false, reason: 'That connection would make a loop in the supply hierarchy.' }
  return { ok: true, doc: { ...doc, lines: [...doc.lines, { ...line, key }] } }
}

export function setWaypoints(doc: SchematicDoc, key: string, waypoints: number[]): SchematicDoc {
  if (waypoints.length % 2 !== 0 || waypoints.length > 400 || waypoints.some((v) => !Number.isFinite(v))) throw new RangeError('waypoints must be up to 200 finite x,y pairs')
  return { ...doc, lines: doc.lines.map((l) => (l.key === key ? { ...l, waypoints } : l)) }
}

export function removeLine(doc: SchematicDoc, key: string): SchematicDoc {
  return { ...doc, lines: doc.lines.filter((l) => l.key !== key) }
}

/** The midpoint of the card side that faces `toward` — recomputed on every render, so anchors never go stale. */
export function anchorOf(c: SchematicCard, toward: { x: number; y: number }): { x: number; y: number } {
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (Math.abs(dx) * c.h >= Math.abs(dy) * c.w) return { x: dx >= 0 ? c.x + c.w : c.x, y: cy }
  return { x: cx, y: dy >= 0 ? c.y + c.h : c.y }
}

export function linePoints(l: SchematicLine, doc: SchematicDoc): number[] | null {
  const a = doc.cards.find((c) => c.meterId === l.fromMeterId)
  const b = doc.cards.find((c) => c.meterId === l.toMeterId)
  if (!a || !b) return null
  const firstTarget = l.waypoints.length >= 2 ? { x: l.waypoints[0], y: l.waypoints[1] } : { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const lastSource = l.waypoints.length >= 2 ? { x: l.waypoints[l.waypoints.length - 2], y: l.waypoints[l.waypoints.length - 1] } : { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const start = anchorOf(a, firstTarget)
  const end = anchorOf(b, lastSource)
  return [start.x, start.y, ...l.waypoints, end.x, end.y]
}

/** Shift-drag snapping: left edge or centre to another card's left edge or centre, per axis. */
export function snapCard(card: SchematicCard, others: SchematicCard[], tol: number): { x: number; y: number; guides: Array<{ axis: 'x' | 'y'; at: number }> } {
  let x = card.x
  let y = card.y
  const guides: Array<{ axis: 'x' | 'y'; at: number }> = []
  const rest = others.filter((o) => o.meterId !== card.meterId)
  for (const o of rest) {
    const candX: Array<[number, number]> = [[o.x, card.x], [o.x + o.w / 2, card.x + card.w / 2]]
    for (const [target, mine] of candX) {
      if (Math.abs(target - mine) <= tol && guides.every((g) => g.axis !== 'x')) { x = card.x + (target - mine); guides.push({ axis: 'x', at: target }) }
    }
    const candY: Array<[number, number]> = [[o.y, card.y], [o.y + o.h / 2, card.y + card.h / 2]]
    for (const [target, mine] of candY) {
      if (Math.abs(target - mine) <= tol && guides.every((g) => g.axis !== 'y')) { y = card.y + (target - mine); guides.push({ axis: 'y', at: target }) }
    }
  }
  return { x, y, guides }
}

export function toSavePayload(doc: SchematicDoc) {
  return {
    cards: doc.cards.map((c) => ({ meterId: c.meterId, x: c.x, y: c.y, w: c.w, h: c.h, colour: c.colour })),
    lines: doc.lines.map((l) => ({ fromMeterId: l.fromMeterId, toMeterId: l.toMeterId, waypoints: l.waypoints, lineType: l.lineType })),
  }
}

export interface History<T> { past: T[]; present: T; future: T[] }
const HISTORY_CAP = 100
export const historyInit = <T,>(present: T): History<T> => ({ past: [], present, future: [] })
export function historyCommit<T>(h: History<T>, next: T): History<T> {
  return { past: [...h.past, h.present].slice(-HISTORY_CAP), present: next, future: [] }
}
export function historyUndo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}
export function historyRedo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}
```

Worked numbers behind the anchor test: A (0,0,180×64) facing (1000,32) → right-side midpoint (180,32). Facing waypoint (300,200): dx = 210, dy = 168; 210·64 = 13 440 < 168·180 = 30 240, so the vertical side → bottom (90,64). B (400,0) facing (300,200): 190·64 < 168·180 → bottom (490,64). B moved to (400,500) facing (300,200): dy < 0 → top (490,500).

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- lib/solar/schematics/editor 2>&1 | tail -4
git add apps/web/src/lib/solar/schematics/editor.ts apps/web/src/lib/solar/schematics/editor.test.ts
git commit -m "feat(solar): schematic editor state — cards, loop-refusing lines, live anchors, snapping, history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (8 tests).

### Task 2: SVG export (escaped, background embedded)

**Files:**
- Create: `apps/web/src/lib/solar/schematics/svg.ts`
- Test: `apps/web/src/lib/solar/schematics/svg.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildSchematicSvg } from './svg'

const base = {
  width: 800, height: 600, backgroundDataUrl: 'data:image/jpeg;base64,AAAA',
  cards: [{ meterId: 'A', x: 10, y: 20, w: 180, h: 64, colour: '#2563eb', label: 'Shop <12> & "Co"', sublabel: 'tenant · 12', included: true }],
  lines: [{ points: [100, 100, 200, 200], lineType: 'supply' as const }, { points: [0, 0, 5, 5], lineType: 'check' as const }],
  layers: { background: true, meters: true, lines: true },
}

describe('buildSchematicSvg', () => {
  it('embeds the background as a data URL (never a public URL) and escapes every label', () => {
    const svg = buildSchematicSvg(base)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('href="data:image/jpeg;base64,AAAA"')
    expect(svg).toContain('Shop &lt;12&gt; &amp; &quot;Co&quot;')
    expect(svg).not.toContain('<12>')
    expect(svg).toContain('stroke-dasharray')
  })
  it('honours the layer toggles', () => {
    const svg = buildSchematicSvg({ ...base, layers: { background: false, meters: true, lines: false } })
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('<polyline')
  })
  it('refuses a non-data background URL', () => {
    expect(() => buildSchematicSvg({ ...base, backgroundDataUrl: 'https://x/y.png' })).toThrow(/data URL/)
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/solar/schematics/svg.ts
/**
 * SVG download of a schematic (functional spec §13.2 "Export"): drawing + cards + lines, with the
 * background EMBEDDED as a data URL (not a public URL — the drawings bucket is private). Built as an
 * escaped string and saved as a Blob; nothing is ever assigned to innerHTML.
 */
export interface SvgCard { meterId: string; x: number; y: number; w: number; h: number; colour: string | null; label: string; sublabel: string; included: boolean | null }
export interface SvgLine { points: number[]; lineType: 'supply' | 'check' }
export interface SvgInput {
  width: number
  height: number
  backgroundDataUrl: string | null
  cards: SvgCard[]
  lines: SvgLine[]
  layers: { background: boolean; meters: boolean; lines: boolean }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/

export function buildSchematicSvg(i: SvgInput): string {
  if (i.backgroundDataUrl !== null && !i.backgroundDataUrl.startsWith('data:image/')) throw new Error('The background must be a data URL.')
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(i.width)}" height="${n(i.height)}" viewBox="0 0 ${n(i.width)} ${n(i.height)}">`]
  parts.push(`<rect width="${n(i.width)}" height="${n(i.height)}" fill="#ffffff"/>`)
  if (i.layers.background && i.backgroundDataUrl) parts.push(`<image href="${esc(i.backgroundDataUrl)}" x="0" y="0" width="${n(i.width)}" height="${n(i.height)}"/>`)
  if (i.layers.lines) {
    for (const l of i.lines) {
      const pts = []
      for (let k = 0; k + 1 < l.points.length; k += 2) pts.push(`${n(l.points[k])},${n(l.points[k + 1])}`)
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${l.lineType === 'check' ? '#64748b' : '#d97706'}" stroke-width="3"${l.lineType === 'check' ? ' stroke-dasharray="8 6"' : ''}/>`)
    }
  }
  if (i.layers.meters) {
    for (const c of i.cards) {
      const colour = c.colour && COLOUR_RE.test(c.colour) ? c.colour : '#2563eb'
      parts.push(`<g><rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.w)}" height="${n(c.h)}" rx="6" fill="#ffffff" stroke="${colour}" stroke-width="2"${c.included === false ? ' stroke-dasharray="6 4"' : ''}/>`)
      parts.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="8" height="${n(c.h)}" fill="${colour}"/>`)
      parts.push(`<text x="${n(c.x + 14)}" y="${n(c.y + 24)}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#0f172a">${esc(c.label)}</text>`)
      parts.push(`<text x="${n(c.x + 14)}" y="${n(c.y + 46)}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#475569">${esc(c.sublabel)}${c.included === false ? ' · excluded from load' : ''}</text></g>`)
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- lib/solar/schematics/svg 2>&1 | tail -4
git add apps/web/src/lib/solar/schematics/svg.ts apps/web/src/lib/solar/schematics/svg.test.ts
git commit -m "feat(solar): schematic SVG export — escaped labels, embedded background, layers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (3 tests).

---

### Task 3: PDF sheet renderer

**Files:**
- Create: `apps/web/src/lib/solar/schematics/sheet-pdf.ts`
- Test: `apps/web/src/lib/solar/schematics/sheet-pdf.test.ts`

- [ ] **Step 1: Failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { JPEG_1PX } from '@/test/fixtures/jpeg-1px'
import { renderSchematicSheetPdf } from './sheet-pdf'

describe('renderSchematicSheetPdf', () => {
  it('renders an A3 landscape sheet and survives non-WinAnsi text (Ω, ≤, →)', async () => {
    const bytes = await renderSchematicSheetPdf({
      jpegBase64: JPEG_1PX, imageWidthPx: 1000, imageHeightPx: 700, projectName: 'Mall Ω', schematicName: 'MV → LV ≤ 11 kV',
      sourceLabel: 'SLD · page 2', version: 3, dateIso: '2026-09-28',
      legend: Array.from({ length: 50 }, (_, k) => ({ label: `Meter ${k}`, kind: 'tenant', tenant: `Shop ${k}`, included: k % 2 === 0 })),
      connections: 12, warnings: ['The drawing changed since this schematic was drawn.'],
    })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
    expect(Math.round(w)).toBe(1191)
    expect(Math.round(h)).toBe(842)
  })
})
```

If `apps/web/src/test/fixtures/jpeg-1px.ts` does not exist on this branch (Phase 5 adds the identical file — byte-identical so the later merge is clean), create it with exactly:

```ts
export const JPEG_1PX = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/fyiiigD/9k='
```

Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/solar/schematics/sheet-pdf.ts
/**
 * Schematic sheet (functional spec §13.2 "Export → PDF sheet"): the browser's raster of the drawing +
 * cards + lines, and a vector legend / title block computed on the server from the database. Every
 * string through winAnsiSafe (pdf-lib standard fonts throw on Ω, ≤, →).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { winAnsiSafe } from '@/lib/pdf/winansi'

export const A3_LANDSCAPE: [number, number] = [1190.55, 841.89]
const MAX_LEGEND = 40

export interface SchematicSheetInput {
  jpegBase64: string
  imageWidthPx: number
  imageHeightPx: number
  projectName: string
  schematicName: string
  sourceLabel: string
  version: number
  dateIso: string
  legend: Array<{ label: string; kind: string; tenant: string | null; included: boolean | null }>
  connections: number
  warnings: string[]
}

export async function renderSchematicSheetPdf(i: SchematicSheetInput): Promise<Uint8Array> {
  const T = (s: string) => winAnsiSafe(s)
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const jpg = await doc.embedJpg(i.jpegBase64)
  const [W, H] = A3_LANDSCAPE
  const page = doc.addPage(A3_LANDSCAPE)
  const m = 28
  const panel = 280
  const box = { x: m, y: m + 20, w: W - 2 * m - panel - 12, h: H - 2 * m - 20 }
  const s = Math.min(box.w / i.imageWidthPx, box.h / i.imageHeightPx)
  const dw = i.imageWidthPx * s
  const dh = i.imageHeightPx * s
  page.drawImage(jpg, { x: box.x + (box.w - dw) / 2, y: box.y + (box.h - dh) / 2, width: dw, height: dh })
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 })

  const px = W - m - panel
  let y = H - m - 14
  const line = (t: string, size = 9, f = font) => { page.drawText(T(t), { x: px, y, size, font: f, maxWidth: panel }); y -= size + 5 }
  line('Metering schematic', 14, bold)
  line(i.projectName, 10, bold)
  line(`Schematic: ${i.schematicName}`)
  line(`Sheet: ${i.sourceLabel}`)
  line(`Version ${i.version} - ${i.dateIso}`)
  line(`${i.legend.length} meters - ${i.connections} connections`)
  y -= 6
  line('Meters', 10, bold)
  for (const l of i.legend.slice(0, MAX_LEGEND)) {
    const inc = l.included === null ? '' : l.included ? ' - in load' : ' - excluded'
    line(`${l.label} (${l.kind})${l.tenant ? ` - ${l.tenant}` : ''}${inc}`, 8)
  }
  if (i.legend.length > MAX_LEGEND) line(`... and ${i.legend.length - MAX_LEGEND} more meters`, 8)
  line('Solid amber = supply; dashed grey = check meter; dashed card = excluded from load.', 7)
  for (const w of i.warnings) { y -= 4; page.drawText(T(w), { x: px, y, size: 8, font, color: rgb(0.7, 0.35, 0), maxWidth: panel }); y -= 12 }
  page.drawText(T('Positions are image pixels of the drawing page. Not for construction without verification.'), { x: m, y: m, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  return doc.save()
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- lib/solar/schematics/sheet-pdf 2>&1 | tail -4
git add apps/web/src/lib/solar/schematics/sheet-pdf.ts apps/web/src/lib/solar/schematics/sheet-pdf.test.ts apps/web/src/test/fixtures/jpeg-1px.ts
git commit -m "feat(solar): schematic PDF sheet (A3, legend, title block, WinAnsi-safe)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (1 test) — the page geometry, and no throw on Ω / ≤ / →.

---

### Task 4: View types and loaders

**Files:**
- Create: `apps/web/src/lib/solar/schematics/view-types.ts`
- Create: `apps/web/src/lib/solar/schematics/load.ts`
- Test: `apps/web/src/lib/solar/schematics/load.test.ts`

- [ ] **Step 1: View types**

```ts
// apps/web/src/lib/solar/schematics/view-types.ts
import type { SchematicDoc } from './editor'

export interface DrawingOption { id: string; name: string; isPdf: boolean }
export interface SchematicRowView {
  id: string
  name: string
  description: string | null
  kind: 'drawing' | 'blank'
  drawingName: string | null
  pageIndex: number
  placed: number
  updatedAt: string
}
export interface SchematicsListView {
  studyId: string | null
  studyUpdatedAt: string | null
  waived: boolean
  studyMeterCount: number
  schematics: SchematicRowView[]
  drawings: DrawingOption[]
}
export interface EditorMeter {
  id: string
  label: string
  kind: string
  tenantLabel: string | null
  nodeId: string | null
  /** true = in load, false = excluded, null = not linked to a tenant / not assigned. */
  included: boolean | null
}
export interface EditorView {
  schematic: { id: string; name: string; description: string | null; kind: 'drawing' | 'blank'; pageIndex: number; updatedAt: string; canvasW: number; canvasH: number; anchorChanged: boolean; floorPlanId: string | null }
  sheet: { planId: string; name: string; signedUrl: string | null; isPdf: boolean; widthPx: number | null; heightPx: number | null } | null
  doc: SchematicDoc
  meters: EditorMeter[]
  externalLines: Array<{ fromMeterId: string; toMeterId: string; lineType: 'supply' | 'check' }>
  drawings: DrawingOption[]
}
```

- [ ] **Step 2: Failing loader test**

```ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadSchematicEditor, loadSchematicsList } from './load'

const P = 'p1'
const tables = {
  'solar.studies': [{ id: 's1', project_id: P, schematic_waived: false, updated_at: 'T0' }],
  'solar.schematics': [
    { id: 'sc1', study_id: 's1', project_id: P, name: 'Main', description: null, kind: 'drawing', floor_plan_id: 'fp1', page_index: 2, file_path: 'o/p/sld-v1.pdf', canvas_w: 2400, canvas_h: 1600, updated_at: 'U1' },
    { id: 'sc2', study_id: 's1', project_id: P, name: 'Blank', description: null, kind: 'blank', floor_plan_id: null, page_index: 1, file_path: null, canvas_w: 2400, canvas_h: 1600, updated_at: 'U2' },
  ],
  'solar.schematic_cards': [
    { schematic_id: 'sc1', meter_id: 'm1', x: 1, y: 2, w: 180, h: 64, colour: null },
    { schematic_id: 'sc1', meter_id: 'm2', x: 300, y: 2, w: 180, h: 64, colour: '#dc2626' },
  ],
  'solar.schematic_lines': [
    { id: 'l1', schematic_id: 'sc1', project_id: P, from_meter_id: 'm1', to_meter_id: 'm2', waypoints: [10, 20], line_type: 'supply' },
    { id: 'l2', schematic_id: 'sc2', project_id: P, from_meter_id: 'm2', to_meter_id: 'm3', waypoints: [], line_type: 'supply' },
  ],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }, { study_id: 's1', meter_id: 'm3' }],
  'solar.meters': [
    { id: 'm1', label: 'Bulk', kind: 'bulk', node_id: null },
    { id: 'm2', label: 'Pep', kind: 'tenant', node_id: 'n1' },
    { id: 'm3', label: 'KFC', kind: 'tenant', node_id: 'n2' },
  ],
  'solar.tenant_load_basis': [{ study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm2', weight: 1 }] }, { study_id: 's1', node_id: 'n2', source: 'excluded', meters: [] }],
  'structure.nodes': [{ id: 'n1', project_id: P, shop_number: '12', shop_name: 'Pep', name: null, code: 'T1' }, { id: 'n2', project_id: P, shop_number: '13', shop_name: 'KFC', name: null, code: 'T2' }],
  'tenants.floor_plans': [{ id: 'fp1', project_id: P, name: 'SLD', file_path: 'o/p/sld-v2.pdf', is_active: true, width_px: null, height_px: null }],
}
const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed' } }) }) }
const client = () => Object.assign(fakeSupabase({ tables }).client, { storage }) as never

describe('schematic loaders', () => {
  it('list: rows with drawing names and placed counts; drawings for the add dialog', async () => {
    const v = await loadSchematicsList(client(), P)
    expect(v.schematics.map((s) => [s.name, s.drawingName, s.pageIndex, s.placed])).toEqual([['Blank', null, 1, 0], ['Main', 'SLD', 2, 2]])
    expect(v.studyMeterCount).toBe(3)
    expect(v.drawings).toEqual([{ id: 'fp1', name: 'SLD', isPdf: true }])
  })
  it('editor: doc, include states, other schematics’ lines, and the anchor-changed warning', async () => {
    const v = await loadSchematicEditor(client(), P, 'sc1')
    if (!v) throw new Error('expected a view')
    expect(v.schematic.anchorChanged).toBe(true)
    expect(v.sheet).toMatchObject({ planId: 'fp1', signedUrl: 'https://signed', isPdf: true })
    expect(v.doc.lines).toEqual([{ key: 'm1>m2:supply', fromMeterId: 'm1', toMeterId: 'm2', waypoints: [10, 20], lineType: 'supply' }])
    expect(v.externalLines).toEqual([{ fromMeterId: 'm2', toMeterId: 'm3', lineType: 'supply' }])
    expect(v.meters.find((m) => m.id === 'm2')).toMatchObject({ included: true, tenantLabel: '12 · Pep' })
    expect(v.meters.find((m) => m.id === 'm3')?.included).toBe(false)
    expect(v.meters.find((m) => m.id === 'm1')?.included).toBeNull()
  })
  it('editor: a schematic of another project is null', async () => {
    expect(await loadSchematicEditor(client(), 'other', 'sc1')).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 3: Implement `load.ts`**

```ts
// apps/web/src/lib/solar/schematics/load.ts
import 'server-only'
/** Loaders for the Schematics list and editor (caller's client; RLS decides). JSON out. */
import type { SupabaseClient } from '@supabase/supabase-js'
import { tenantLabel } from '@/lib/solar/load/gather'
import { lineKey, type SchematicDoc } from './editor'
import type { DrawingOption, EditorMeter, EditorView, SchematicsListView } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const SCHEMATIC_COLUMNS = 'id, study_id, name, description, kind, floor_plan_id, page_index, file_path, canvas_w, canvas_h, updated_at'
const isPdf = (p: string) => /\.pdf$/i.test(p)
const renderable = (p: string) => isPdf(p) || /\.(png|jpe?g|webp|svg)$/i.test(p)

async function drawings(supabase: AnyClient, projectId: string): Promise<DrawingOption[]> {
  const { data } = await supabase.schema('tenants').from('floor_plans').select('id, name, file_path').eq('project_id', projectId).eq('is_active', true).order('name')
  return ((data ?? []) as Array<{ id: string; name: string | null; file_path: string | null }>)
    .filter((p) => renderable(String(p.file_path ?? '')))
    .map((p) => ({ id: p.id, name: p.name ?? 'Drawing', isPdf: isPdf(String(p.file_path)) }))
}

export async function loadSchematicsList(supabase: AnyClient, projectId: string): Promise<SchematicsListView> {
  const { data: study } = await supabase.schema('solar').from('studies').select('id, schematic_waived, updated_at').eq('project_id', projectId).maybeSingle()
  const s = study as { id: string; schematic_waived: boolean; updated_at: string } | null
  const d = await drawings(supabase, projectId)
  if (!s) return { studyId: null, studyUpdatedAt: null, waived: false, studyMeterCount: 0, schematics: [], drawings: d }
  const [{ data: rows }, { data: links }] = await Promise.all([
    supabase.schema('solar').from('schematics').select(SCHEMATIC_COLUMNS).eq('study_id', s.id).order('name'),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', s.id),
  ])
  const list = (rows ?? []) as Array<{ id: string; name: string; description: string | null; kind: 'drawing' | 'blank'; floor_plan_id: string | null; page_index: number; updated_at: string }>
  const ids = list.map((r) => r.id)
  const { data: cards } = ids.length ? await supabase.schema('solar').from('schematic_cards').select('schematic_id, meter_id').in('schematic_id', ids) : { data: [] }
  const placed = new Map<string, number>()
  for (const c of (cards ?? []) as Array<{ schematic_id: string }>) placed.set(c.schematic_id, (placed.get(c.schematic_id) ?? 0) + 1)
  const planName = new Map(d.map((x) => [x.id, x.name]))
  return {
    studyId: s.id, studyUpdatedAt: s.updated_at, waived: s.schematic_waived,
    studyMeterCount: ((links ?? []) as unknown[]).length,
    schematics: list.map((r) => ({
      id: r.id, name: r.name, description: r.description, kind: r.kind, drawingName: r.floor_plan_id ? planName.get(r.floor_plan_id) ?? 'Drawing (retired)' : null,
      pageIndex: r.page_index, placed: placed.get(r.id) ?? 0, updatedAt: r.updated_at,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    drawings: d,
  }
}

export async function loadSchematicEditor(supabase: AnyClient, projectId: string, schematicId: string): Promise<EditorView | null> {
  const { data: row } = await supabase.schema('solar').from('schematics').select(`${SCHEMATIC_COLUMNS}, project_id`).eq('id', schematicId).eq('project_id', projectId).maybeSingle()
  const sc = row as { id: string; study_id: string; name: string; description: string | null; kind: 'drawing' | 'blank'; floor_plan_id: string | null; page_index: number; file_path: string | null; canvas_w: number; canvas_h: number; updated_at: string } | null
  if (!sc) return null
  const [{ data: cards }, { data: lines }, { data: links }, { data: basis }, d] = await Promise.all([
    supabase.schema('solar').from('schematic_cards').select('meter_id, x, y, w, h, colour').eq('schematic_id', sc.id),
    supabase.schema('solar').from('schematic_lines').select('id, schematic_id, from_meter_id, to_meter_id, waypoints, line_type').eq('project_id', projectId),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', sc.study_id),
    supabase.schema('solar').from('tenant_load_basis').select('node_id, source, meters').eq('study_id', sc.study_id),
    drawings(supabase, projectId),
  ])
  const meterIds = ((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
  const { data: meterRows } = meterIds.length ? await supabase.schema('solar').from('meters').select('id, label, kind, node_id').in('id', meterIds) : { data: [] }
  const ms = (meterRows ?? []) as Array<{ id: string; label: string; kind: string; node_id: string | null }>
  const nodeIds = [...new Set(ms.map((m) => m.node_id).filter((x): x is string => Boolean(x)))]
  const { data: nodes } = nodeIds.length ? await supabase.schema('structure').from('nodes').select('id, shop_number, shop_name, name, code').in('id', nodeIds) : { data: [] }
  const nodeLabel = new Map(((nodes ?? []) as Array<{ id: string; shop_number: string | null; shop_name: string | null; name: string | null; code: string | null }>).map((n) => [n.id, tenantLabel(n)]))
  const basisByNode = new Map(((basis ?? []) as Array<{ node_id: string; source: string; meters: Array<{ meter_id: string }> }>).map((b) => [b.node_id, b]))
  const meters: EditorMeter[] = ms.map((m) => {
    const b = m.node_id ? basisByNode.get(m.node_id) : undefined
    const included = !b ? null : b.source === 'excluded' ? false : b.source === 'metered' ? b.meters.some((x) => x.meter_id === m.id) : null
    return { id: m.id, label: m.label, kind: m.kind, nodeId: m.node_id, tenantLabel: m.node_id ? nodeLabel.get(m.node_id) ?? null : null, included }
  }).sort((a, b) => a.label.localeCompare(b.label))
  const all = (lines ?? []) as Array<{ schematic_id: string; from_meter_id: string; to_meter_id: string; waypoints: number[]; line_type: 'supply' | 'check' }>
  const doc: SchematicDoc = {
    cards: ((cards ?? []) as Array<{ meter_id: string; x: number; y: number; w: number; h: number; colour: string | null }>).map((c) => ({
      meterId: c.meter_id, x: Number(c.x), y: Number(c.y), w: Number(c.w), h: Number(c.h), colour: c.colour,
    })),
    lines: all.filter((l) => l.schematic_id === sc.id).map((l) => ({
      key: lineKey({ fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, lineType: l.line_type }),
      fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, waypoints: (l.waypoints ?? []).map(Number), lineType: l.line_type,
    })),
  }
  let sheet: EditorView['sheet'] = null
  let anchorChanged = false
  if (sc.kind === 'drawing' && sc.floor_plan_id) {
    const { data: plan } = await supabase.schema('tenants').from('floor_plans').select('id, name, file_path, width_px, height_px').eq('id', sc.floor_plan_id).maybeSingle()
    const p = plan as { id: string; name: string | null; file_path: string | null; width_px: number | null; height_px: number | null } | null
    if (p) {
      const path = String(p.file_path ?? '')
      const { data: signed } = renderable(path) ? await supabase.storage.from('drawings').createSignedUrl(path, 3600) : { data: null }
      sheet = { planId: p.id, name: p.name ?? 'Drawing', signedUrl: (signed as { signedUrl?: string } | null)?.signedUrl ?? null, isPdf: isPdf(path), widthPx: p.width_px, heightPx: p.height_px }
      anchorChanged = p.file_path !== sc.file_path
    }
  }
  return {
    schematic: { id: sc.id, name: sc.name, description: sc.description, kind: sc.kind, pageIndex: sc.page_index, updatedAt: sc.updated_at, canvasW: sc.canvas_w, canvasH: sc.canvas_h, anchorChanged, floorPlanId: sc.floor_plan_id },
    sheet,
    doc,
    meters,
    externalLines: all.filter((l) => l.schematic_id !== sc.id).map((l) => ({ fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, lineType: l.line_type })),
    drawings: d,
  }
}
```

(The editor reads `schematic_lines` by `project_id`: that is every line of the study's schematics, because a project has exactly one study.)

- [ ] **Step 4: Run, commit**

```bash
pnpm --filter web test -- lib/solar/schematics/load 2>&1 | tail -4
git add apps/web/src/lib/solar/schematics/view-types.ts apps/web/src/lib/solar/schematics/load.ts apps/web/src/lib/solar/schematics/load.test.ts
git commit -m "feat(solar): schematic list and editor loaders (include state, cross-sheet lines, anchor warning)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (3 tests).

### Task 5: Schematic server actions

**Files:**
- Create: `apps/web/src/actions/solar-schematics.actions.ts`
- Test: `apps/web/src/actions/solar-schematics.actions.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), emit: vi.fn(async () => {}), revalidate: vi.fn(), render: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.createServiceClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: h.emit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/schematics/sheet-pdf', () => ({ renderSchematicSheetPdf: h.render }))

import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import {
  createSchematicAction, deleteSchematicsAction, exportSchematicSheetAction, replaceSchematicDrawingAction,
  saveSchematicAction, setIncludeInLoadAction, setSchematicWaivedAction, createMeterStubAction,
} from './solar-schematics.actions'

const P = 'p1'
const STALE = 'Someone else changed this — reload to see their version.'
const tables: FakeOptions['tables'] = {
  'solar.studies': [{ id: 's1', project_id: P, updated_at: 'T0' }],
  'projects.projects': [{ id: P, organisation_id: 'o1', name: 'Mall' }],
  'solar.schematics': [{ id: 'sc1', study_id: 's1', project_id: P, organisation_id: 'o1', name: 'Main', kind: 'drawing', floor_plan_id: 'fp1', page_index: 1, updated_at: 'U0' }],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }],
  'solar.meters': [{ id: 'm1', label: 'Bulk', kind: 'bulk', node_id: null }, { id: 'm2', label: 'Pep', kind: 'tenant', node_id: 'n1' }],
  'solar.schematic_cards': [{ schematic_id: 'sc1', meter_id: 'm1' }, { schematic_id: 'sc1', meter_id: 'm2' }],
  'solar.schematic_lines': [{ schematic_id: 'sc1', project_id: P, from_meter_id: 'm1', to_meter_id: 'm2', line_type: 'supply' }],
  'solar.tenant_load_basis': [],
  'tenants.floor_plans': [{ id: 'fp1', project_id: P, name: 'SLD' }],
}
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', tables, ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit') })

describe('schematic actions', () => {
  it('every action re-checks Edit', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(deleteSchematicsAction({ projectId: P, ids: ['sc1'] })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })

  it('create: drawing + page, name required; a duplicate name has a sentence', async () => {
    const { calls } = setup({ writes: { 'solar.schematics:insert': { data: [{ id: 'sc9' }] } } })
    expect(await createSchematicAction({ projectId: P, name: '  ', description: null, source: { kind: 'blank' } })).toEqual({ error: 'Give the schematic a name.' })
    expect(await createSchematicAction({ projectId: P, name: 'MV', description: 'x', source: { kind: 'drawing', floorPlanId: 'fp1', pageIndex: 3 } })).toEqual({ ok: true, id: 'sc9' })
    expect(callsTo(calls, 'solar.schematics', 'insert')[0].payload).toEqual({ study_id: 's1', name: 'MV', description: 'x', kind: 'drawing', floor_plan_id: 'fp1', page_index: 3 })
    setup({ writes: { 'solar.schematics:insert': { data: null, error: { code: '23505', message: 'dup' } } } })
    expect(await createSchematicAction({ projectId: P, name: 'Main', description: null, source: { kind: 'blank' } })).toEqual({ error: 'A schematic with that name already exists.' })
  })

  it('replace drawing is stale-guarded', async () => {
    const { calls } = setup({ writes: { 'solar.schematics:update': { data: [] } } })
    expect(await replaceSchematicDrawingAction({ projectId: P, schematicId: 'sc1', floorPlanId: 'fp1', pageIndex: 2, expectedUpdatedAt: 'U0' })).toEqual({ error: STALE })
    expect(callsTo(calls, 'solar.schematics', 'update')[0].filters).toEqual([['eq', 'id', 'sc1'], ['eq', 'project_id', P], ['eq', 'updated_at', 'U0']])
  })

  it('delete reports the count', async () => {
    setup({ writes: { 'solar.schematics:delete': { data: [{ id: 'sc1' }] } } })
    expect(await deleteSchematicsAction({ projectId: P, ids: ['sc1'] })).toEqual({ ok: true, deleted: 1 })
  })

  it('waiver writes the study on its version', async () => {
    const { calls } = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T1' }] } } })
    expect(await setSchematicWaivedAction({ projectId: P, waived: true, expectedUpdatedAt: 'T0' })).toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.studies', 'update')[0].payload).toEqual({ schematic_waived: true })
  })

  it('save validates, calls the RPC, and maps stale / loop errors', async () => {
    setup({ rpc: { solar_save_schematic: { data: 'U1', error: null } } })
    const body = { projectId: P, schematicId: 'sc1', expectedUpdatedAt: 'U0', cards: [{ meterId: 'm1', x: 1, y: 2, w: 180, h: 64, colour: null }], lines: [] }
    expect(await saveSchematicAction(body)).toEqual({ ok: true, updatedAt: 'U1' })
    expect(await saveSchematicAction({ ...body, cards: [{ meterId: 'm1', x: NaN, y: 2, w: 180, h: 64, colour: null }] })).toEqual({ error: 'A card has an invalid position or size.' })
    expect(await saveSchematicAction({ ...body, lines: [{ fromMeterId: 'm1', toMeterId: 'm2', waypoints: [1], lineType: 'supply' }] })).toEqual({ error: 'A connection has an invalid route.' })
    setup({ rpc: { solar_save_schematic: { data: null, error: { code: '40001', message: 'stale schematic' } } } })
    expect(await saveSchematicAction(body)).toEqual({ error: STALE })
    setup({ rpc: { solar_save_schematic: { data: null, error: { code: '23514', message: 'this connection would make a loop in the supply hierarchy' } } } })
    expect(await saveSchematicAction(body)).toEqual({ error: 'That connection would make a loop in the supply hierarchy.' })
  })

  it('include-in-load needs a tenant link; including writes a metered basis with this meter', async () => {
    const { calls } = setup()
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm1', include: true })).toEqual({ error: 'Link this meter to a tenant first (Load → Meters → Details).' })
    expect(await setIncludeInLoadAction({ projectId: P, meterId: 'm2', include: true })).toEqual({ ok: true })
    expect(callsTo(calls, 'solar.tenant_load_basis', 'insert')[0].payload).toEqual({ study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm2', weight: 1 }] })
  })

  it('meter stub: a library meter linked to this study', async () => {
    const { calls } = setup({ writes: { 'solar.meters:insert': { data: [{ id: 'm9', label: 'DB-4', kind: 'unknown' }] } } })
    expect(await createMeterStubAction({ projectId: P, label: 'DB-4', kind: 'unknown' })).toEqual({ ok: true, meter: { id: 'm9', label: 'DB-4', kind: 'unknown' } })
    expect(callsTo(calls, 'solar.meters', 'insert')[0].payload).toEqual({ organisation_id: 'o1', label: 'DB-4', kind: 'unknown', serials: [] })
    expect(callsTo(calls, 'solar.study_meters', 'upsert')[0].payload).toEqual({ study_id: 's1', meter_id: 'm9' })
  })

  it('export: renders, stores the next version under kind solar_schematic_sheet, supersedes the prior', async () => {
    setup()
    const upload = vi.fn(async () => ({ error: null }))
    const svc = fakeSupabase({ tables: { 'projects.reports': [{ id: 'r1', project_id: P, kind: 'solar_schematic_sheet', source_id: 'sc1', status: 'issued', version: 2 }] }, writes: { 'projects.reports:insert': { data: [{ id: 'r2' }] } } })
    h.createServiceClient.mockReturnValue(Object.assign(svc.client, { storage: { from: () => ({ upload, remove: vi.fn() }) } }))
    const r = await exportSchematicSheetAction({ projectId: P, schematicId: 'sc1', jpegBase64: 'x'.repeat(200), crop: { w: 1000, h: 700 }, note: null })
    expect(r).toEqual({ ok: true, version: 3, reportId: 'r2' })
    expect(upload).toHaveBeenCalledWith('o1/p1/solar-schematic-sheets/sc1-v3.pdf', expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false })
    expect(callsTo(svc.calls, 'projects.reports', 'insert')[0].payload).toMatchObject({ kind: 'solar_schematic_sheet', source_table: 'solar.schematics', source_id: 'sc1', version: 3, status: 'issued' })
    expect(callsTo(svc.calls, 'projects.reports', 'update')[0].payload).toEqual({ status: 'superseded', superseded_by: 'r2' })
    expect(h.emit).toHaveBeenCalledWith({ actorId: 'u1', projectId: P, event: 'solar_schematic_sheet_exported' })
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement**

```ts
// apps/web/src/actions/solar-schematics.actions.ts
'use server'
/**
 * Schematics tab writes (functional spec §13). Each action re-checks Solar Edit and writes with the
 * caller's session, so 00215's RESTRICTIVE solar_can_edit policies and bind triggers decide (drawing on
 * this project and active, meter in this study, no loop). The report upload alone uses the service
 * client, after the gate, as every other sheet export does.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'
import { METER_KIND_OPTIONS, type MeterKind } from '@/lib/solar/load/view-types'
import { renderSchematicSheetPdf } from '@/lib/solar/schematics/sheet-pdf'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Err = { error: string }
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/
const listPath = (p: string) => `/projects/${p}/solar/schematics`

async function ctx(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}
async function studyOf(supabase: AnyClient, projectId: string) {
  const { data } = await supabase.schema('solar').from('studies').select('id, updated_at').eq('project_id', projectId).maybeSingle()
  return (data as { id: string; updated_at: string } | null) ?? null
}
async function ensureStudy(supabase: AnyClient, projectId: string) {
  const s = await studyOf(supabase, projectId)
  if (s) return s
  const { data } = await supabase.schema('solar').from('studies').insert({ project_id: projectId }).select('id, updated_at')
  return (Array.isArray(data) ? (data[0] as { id: string; updated_at: string } | undefined) : undefined) ?? (await studyOf(supabase, projectId))
}
function human(err: { code?: string; message?: string } | null): string {
  const m = (err?.message ?? '').toLowerCase()
  if (err?.code === '40001' || m.includes('stale')) return STALE_MESSAGE
  if (m.includes('loop')) return 'That connection would make a loop in the supply hierarchy.'
  if (m.includes('only a meter of this study')) return 'Only meters of this study can be placed.'
  if (m.includes('both meters must be placed')) return 'Both meters must be placed on this schematic.'
  if (m.includes('drawing belongs to another project')) return 'That drawing belongs to another project.'
  if (m.includes('no longer active')) return 'That drawing is no longer active — choose its current version.'
  if (err?.code === '23505') return m.includes('pair') ? 'Those meters are connected twice.' : 'A schematic with that name already exists.'
  if (err?.code === '42501') return 'You do not have permission to do that.'
  return GENERIC_ERROR
}

export type SchematicSource = { kind: 'drawing'; floorPlanId: string; pageIndex: number } | { kind: 'blank' }

export async function createSchematicAction(input: { projectId: string; name: string; description: string | null; source: SchematicSource }): Promise<{ ok: true; id: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = String(input.name ?? '').trim()
  if (name.length === 0 || name.length > 120) return { error: 'Give the schematic a name.' }
  const description = input.description == null ? null : String(input.description).slice(0, 2000)
  const src = input.source
  if (src?.kind === 'drawing' && !(typeof src.floorPlanId === 'string' && Number.isInteger(src.pageIndex) && src.pageIndex >= 1)) return { error: 'Choose a drawing and a page.' }
  const study = await ensureStudy(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const row = src?.kind === 'drawing'
    ? { study_id: study.id, name, description, kind: 'drawing', floor_plan_id: src.floorPlanId, page_index: src.pageIndex }
    : { study_id: study.id, name, description, kind: 'blank' }
  const { data, error } = await supabase.schema('solar').from('schematics').insert(row).select('id')
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (error || !id) return { error: human(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_created', objectRef: { schematicId: id } })
  revalidatePath(listPath(input.projectId))
  return { ok: true, id }
}

export async function updateSchematicMetaAction(input: { projectId: string; schematicId: string; name: string; description: string | null; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = String(input.name ?? '').trim()
  if (name.length === 0 || name.length > 120) return { error: 'Give the schematic a name.' }
  const { data, error } = await supabase.schema('solar').from('schematics').update({ name, description: input.description == null ? null : String(input.description).slice(0, 2000) })
    .eq('id', input.schematicId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath(listPath(input.projectId))
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function replaceSchematicDrawingAction(input: { projectId: string; schematicId: string; floorPlanId: string; pageIndex: number; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!(Number.isInteger(input.pageIndex) && input.pageIndex >= 1)) return { error: 'Choose a page.' }
  const { data, error } = await supabase.schema('solar').from('schematics').update({ floor_plan_id: input.floorPlanId, page_index: input.pageIndex })
    .eq('id', input.schematicId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_drawing_replaced', objectRef: { schematicId: input.schematicId, floorPlanId: input.floorPlanId, pageIndex: input.pageIndex } })
  revalidatePath(listPath(input.projectId))
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function deleteSchematicsAction(input: { projectId: string; ids: string[] }): Promise<{ ok: true; deleted: number } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const ids = [...new Set((input.ids ?? []).filter((x) => typeof x === 'string'))].slice(0, 200)
  if (ids.length === 0) return { error: 'Choose at least one schematic.' }
  const { data, error } = await supabase.schema('solar').from('schematics').delete().in('id', ids).eq('project_id', input.projectId).select('id')
  if (error) return { error: human(error) }
  const n = Array.isArray(data) ? data.length : 0
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematics_deleted', objectRef: { count: n } })
  revalidatePath(listPath(input.projectId))
  return { ok: true, deleted: n }
}

export async function setSchematicWaivedAction(input: { projectId: string; waived: boolean; expectedUpdatedAt: string | null }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const q = input.expectedUpdatedAt === null
    ? supabase.schema('solar').from('studies').insert({ project_id: input.projectId, schematic_waived: Boolean(input.waived) }).select('updated_at')
    : supabase.schema('solar').from('studies').update({ schematic_waived: Boolean(input.waived) }).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  const { data, error } = await q
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export interface SaveCard { meterId: string; x: number; y: number; w: number; h: number; colour: string | null }
export interface SaveLine { fromMeterId: string; toMeterId: string; waypoints: number[]; lineType: 'supply' | 'check' }

export async function saveSchematicAction(input: { projectId: string; schematicId: string; expectedUpdatedAt: string; cards: SaveCard[]; lines: SaveLine[] }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const cards = Array.isArray(input.cards) ? input.cards : []
  const lines = Array.isArray(input.lines) ? input.lines : []
  if (cards.length > 500 || lines.length > 1000) return { error: 'A schematic holds at most 500 meters and 1,000 connections.' }
  const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (cards.some((c) => typeof c.meterId !== 'string' || ![c.x, c.y, c.w, c.h].every(fin) || c.w <= 0 || c.h <= 0 || (c.colour !== null && !COLOUR_RE.test(String(c.colour))))) {
    return { error: 'A card has an invalid position or size.' }
  }
  if (lines.some((l) => typeof l.fromMeterId !== 'string' || typeof l.toMeterId !== 'string' || !Array.isArray(l.waypoints) || l.waypoints.length % 2 !== 0 || l.waypoints.length > 400 || !l.waypoints.every(fin) || !['supply', 'check'].includes(l.lineType))) {
    return { error: 'A connection has an invalid route.' }
  }
  const { data: sc } = await supabase.schema('solar').from('schematics').select('id').eq('id', input.schematicId).eq('project_id', input.projectId).maybeSingle()
  if (!sc) return { error: 'This schematic no longer exists — reload.' }
  const { data, error } = await supabase.rpc('solar_save_schematic', {
    p_schematic_id: input.schematicId, p_expected_updated_at: input.expectedUpdatedAt, p_cards: cards, p_lines: lines,
  })
  if (error) return { error: human(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_saved', objectRef: { schematicId: input.schematicId, cards: cards.length, lines: lines.length } })
  await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_schematic_saved' })
  return { ok: true, updatedAt: String(data) }
}

export async function createMeterStubAction(input: { projectId: string; label: string; kind: MeterKind }): Promise<{ ok: true; meter: { id: string; label: string; kind: string } } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const label = String(input.label ?? '').trim()
  if (label.length === 0 || label.length > 200) return { error: 'Name the meter.' }
  if (!METER_KIND_OPTIONS.some((k) => k.value === input.kind) || input.kind === 'water') return { error: 'Choose a meter kind.' }
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', input.projectId).maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  const study = await ensureStudy(supabase, input.projectId)
  if (!orgId || !study) return { error: GENERIC_ERROR }
  const { data, error } = await supabase.schema('solar').from('meters').insert({ organisation_id: orgId, label, kind: input.kind, serials: [] }).select('id, label, kind')
  const m = Array.isArray(data) ? (data[0] as { id: string; label: string; kind: string } | undefined) : undefined
  if (error || !m) return { error: human(error) }
  const link = await supabase.schema('solar').from('study_meters').upsert({ study_id: study.id, meter_id: m.id }, { onConflict: 'study_id,meter_id', ignoreDuplicates: true })
  if (link.error) return { error: human(link.error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meter_stub_created', objectRef: { meterId: m.id } })
  return { ok: true, meter: m }
}

export async function setIncludeInLoadAction(input: { projectId: string; meterId: string; include: boolean }): Promise<{ ok: true } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const { data: link } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', study.id).eq('meter_id', input.meterId).maybeSingle()
  if (!link) return { error: 'That meter is not in this study.' }
  const { data: meter } = await supabase.schema('solar').from('meters').select('node_id').eq('id', input.meterId).maybeSingle()
  const nodeId = (meter as { node_id?: string | null } | null)?.node_id
  if (!nodeId) return { error: 'Link this meter to a tenant first (Load → Meters → Details).' }
  const t = () => supabase.schema('solar').from('tenant_load_basis')
  const { data: row } = await t().select('id, source, meters').eq('study_id', study.id).eq('node_id', nodeId).maybeSingle()
  const b = row as { id: string; source: string; meters: Array<{ meter_id: string; weight: number }> } | null
  let res
  if (input.include) {
    const meters = b ? (b.meters.some((m) => m.meter_id === input.meterId) ? b.meters : [...b.meters, { meter_id: input.meterId, weight: 1 }]) : [{ meter_id: input.meterId, weight: 1 }]
    res = b ? await t().update({ source: 'metered', meters }).eq('id', b.id) : await t().insert({ study_id: study.id, node_id: nodeId, source: 'metered', meters })
  } else {
    res = b ? await t().update({ source: 'excluded' }).eq('id', b.id) : await t().insert({ study_id: study.id, node_id: nodeId, source: 'excluded', meters: [] })
  }
  if (res.error) return { error: human(res.error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: input.include ? 'meter_included_in_load' : 'meter_excluded_from_load', objectRef: { meterId: input.meterId, nodeId } })
  revalidatePath(`/projects/${input.projectId}/solar/load`)
  return { ok: true }
}

const MAX_CROP_PX = 20_000
export async function exportSchematicSheetAction(input: { projectId: string; schematicId: string; jpegBase64: string; crop: { w: number; h: number }; note: string | null }): Promise<{ ok: true; version: number; reportId: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (typeof input.jpegBase64 !== 'string' || input.jpegBase64.length < 100 || input.jpegBase64.length > 9_500_000) return { error: 'The sheet image could not be read — try again.' }
  const c = input.crop
  if (!c || ![c.w, c.h].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_CROP_PX)) return { error: 'The sheet image could not be read — try again.' }
  const { data: scRow } = await supabase.schema('solar').from('schematics').select('id, study_id, organisation_id, name, kind, floor_plan_id, page_index').eq('id', input.schematicId).eq('project_id', input.projectId).maybeSingle()
  const sc = scRow as { id: string; study_id: string; organisation_id: string; name: string; kind: string; floor_plan_id: string | null; page_index: number } | null
  if (!sc) return { error: 'This schematic no longer exists — reload.' }
  const [{ data: cards }, { data: lines }, { data: project }, { data: plan }] = await Promise.all([
    supabase.schema('solar').from('schematic_cards').select('meter_id').eq('schematic_id', sc.id),
    supabase.schema('solar').from('schematic_lines').select('from_meter_id').eq('schematic_id', sc.id),
    supabase.schema('projects').from('projects').select('name').eq('id', input.projectId).maybeSingle(),
    sc.floor_plan_id ? supabase.schema('tenants').from('floor_plans').select('name').eq('id', sc.floor_plan_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const meterIds = ((cards ?? []) as Array<{ meter_id: string }>).map((x) => x.meter_id)
  const { data: meters } = meterIds.length ? await supabase.schema('solar').from('meters').select('id, label, kind, node_id').in('id', meterIds) : { data: [] }
  const nodeIds = [...new Set(((meters ?? []) as Array<{ node_id: string | null }>).map((m) => m.node_id).filter((x): x is string => Boolean(x)))]
  const [{ data: nodes }, { data: basis }] = await Promise.all([
    nodeIds.length ? supabase.schema('structure').from('nodes').select('id, shop_number, shop_name, name, code').in('id', nodeIds) : Promise.resolve({ data: [] }),
    supabase.schema('solar').from('tenant_load_basis').select('node_id, source, meters').eq('study_id', sc.study_id),
  ])
  const nodeName = new Map(((nodes ?? []) as Array<{ id: string; shop_number: string | null; shop_name: string | null; name: string | null; code: string | null }>)
    .map((n) => [n.id, `${n.shop_number ? `${n.shop_number} ` : ''}${n.shop_name ?? n.name ?? n.code ?? ''}`.trim()]))
  const basisBy = new Map(((basis ?? []) as Array<{ node_id: string; source: string; meters: Array<{ meter_id: string }> }>).map((b) => [b.node_id, b]))
  const legend = ((meters ?? []) as Array<{ id: string; label: string; kind: string; node_id: string | null }>).map((m) => {
    const b = m.node_id ? basisBy.get(m.node_id) : undefined
    return {
      label: m.label, kind: m.kind, tenant: m.node_id ? nodeName.get(m.node_id) ?? null : null,
      included: !b ? null : b.source === 'excluded' ? false : b.source === 'metered' ? b.meters.some((x) => x.meter_id === m.id) : null,
    }
  })

  const service = createServiceClient() as unknown as AnyClient
  const { data: prior } = await service.schema('projects').from('reports').select('id, version')
    .eq('project_id', input.projectId).eq('kind', 'solar_schematic_sheet').eq('source_id', sc.id).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as { version: number }).version) + 1 : 1
  let pdf: Uint8Array
  try {
    pdf = await renderSchematicSheetPdf({
      jpegBase64: input.jpegBase64, imageWidthPx: c.w, imageHeightPx: c.h,
      projectName: (project as { name?: string } | null)?.name ?? '', schematicName: sc.name,
      sourceLabel: sc.kind === 'drawing' ? `${(plan as { name?: string } | null)?.name ?? 'Drawing'} - page ${sc.page_index}` : 'Blank canvas',
      version, dateIso: new Date().toISOString().slice(0, 10), legend, connections: ((lines ?? []) as unknown[]).length, warnings: [],
    })
  } catch {
    return { error: 'The sheet image could not be read — try again.' }
  }
  const storagePath = `${sc.organisation_id}/${input.projectId}/solar-schematic-sheets/${sc.id}-v${version}.pdf`
  const { error: upErr } = await service.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: 'Could not store the sheet — try again.' }
  // The kind is a LITERAL on purpose: report-kind-access.contract.test.ts finds writers by scanning for it.
  const { data: rep, error: insErr } = await service.schema('projects').from('reports').insert({
    organisation_id: sc.organisation_id,
    project_id: input.projectId,
    kind: 'solar_schematic_sheet',
    source_table: 'solar.schematics',
    source_id: sc.id,
    title: `Metering schematic — ${sc.name}`,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version,
    summary: { meters: meterIds.length, connections: ((lines ?? []) as unknown[]).length },
    note: input.note == null ? null : String(input.note).slice(0, 2000),
    generated_by: userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await service.storage.from('reports').remove([storagePath])
    return { error: 'Could not save the sheet — try again.' }
  }
  if (prior) await service.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', (prior as { id: string }).id)
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_sheet_exported', objectRef: { schematicId: sc.id, version } })
  await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_schematic_sheet_exported' })
  revalidatePath(`${listPath(input.projectId)}/${sc.id}`)
  return { ok: true, version, reportId }
}
```

- [ ] **Step 3: Run, type-check, commit**

```bash
pnpm --filter web test -- actions/solar-schematics report-kind-access 2>&1 | tail -4
pnpm --filter web type-check
git add apps/web/src/actions/solar-schematics.actions.ts apps/web/src/actions/solar-schematics.actions.test.ts
git commit -m "feat(solar): schematic actions — create/replace/delete/waive, save RPC, stub, include-in-load, PDF export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (9 tests); the report-kind contract test still green (the literal `kind: 'solar_schematic_sheet'` writer is declared in `SOLAR_READ_REPORT_KINDS`).

### Task 6: Schematics list page (add, replace drawing, delete, waiver, saved sheets)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schematics/page.tsx`
- Create: `…/schematics/_components/DrawingPagePicker.tsx`
- Create: `…/schematics/_components/AddSchematicDialog.tsx`
- Create: `…/schematics/_components/ReplaceDrawingDialog.tsx`
- Create: `…/schematics/_components/SchematicsList.tsx` (+ `SchematicsList.test.tsx`)

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ create: vi.fn(), del: vi.fn(), waive: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-schematics.actions', () => ({ createSchematicAction: h.create, deleteSchematicsAction: h.del, setSchematicWaivedAction: h.waive, replaceSchematicDrawingAction: h.replace }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))
vi.mock('@/components/reports/SavedReportsPanel', () => ({ SavedReportsPanel: ({ kind }: { kind: string }) => <div>saved:{kind}</div> }))
import { SchematicsList } from './SchematicsList'
import type { SchematicsListView } from '@/lib/solar/schematics/view-types'

const view: SchematicsListView = {
  studyId: 's1', studyUpdatedAt: 'T0', waived: false, studyMeterCount: 5,
  schematics: [
    { id: 'sc1', name: 'Main SLD', description: null, kind: 'drawing', drawingName: 'SLD', pageIndex: 2, placed: 3, updatedAt: 'U1' },
    { id: 'sc2', name: 'Blank', description: null, kind: 'blank', drawingName: null, pageIndex: 1, placed: 0, updatedAt: 'U2' },
  ],
  drawings: [{ id: 'fp1', name: 'SLD', isPdf: true }],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.create.mockResolvedValue({ ok: true, id: 'sc9' })
  h.del.mockResolvedValue({ ok: true, deleted: 2 })
  h.waive.mockResolvedValue({ ok: true, updatedAt: 'T1' })
})

describe('SchematicsList', () => {
  it('lists name, drawing and page, meters placed of total, and the saved sheets', () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    expect(screen.getByRole('link', { name: 'Main SLD' })).toHaveAttribute('href', '/projects/p1/solar/schematics/sc1')
    expect(screen.getByText('SLD · page 2')).toBeInTheDocument()
    expect(screen.getByText('3 / 5')).toBeInTheDocument()
    expect(screen.getByText('saved:solar_schematic_sheet')).toBeInTheDocument()
  })
  it('adds a schematic from a drawing and page, then opens it', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Add schematic' }))
    await userEvent.type(screen.getByLabelText('Name'), 'MV')
    await userEvent.selectOptions(screen.getByLabelText('Drawing'), 'fp1')
    await userEvent.clear(screen.getByLabelText('Page'))
    await userEvent.type(screen.getByLabelText('Page'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'MV', description: null, source: { kind: 'drawing', floorPlanId: 'fp1', pageIndex: 3 } })
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/schematics/sc9')
  })
  it('delete selected is two-step with the count', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByLabelText('Select Main SLD'))
    await userEvent.click(screen.getByLabelText('Select Blank'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))
    expect(h.del).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete 2 schematics?' }))
    expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', ids: ['sc1', 'sc2'] })
  })
  it('"No schematic required" saves the waiver', async () => {
    render(<SchematicsList projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByLabelText('No schematic required'))
    expect(h.waive).toHaveBeenCalledWith({ projectId: 'p1', waived: true, expectedUpdatedAt: 'T0' })
  })
  it('empty state; View hides every control', () => {
    const { unmount } = render(<SchematicsList projectId="p1" view={{ ...view, schematics: [] }} canEdit />)
    expect(screen.getByText("Add a single-line diagram from the project's drawings")).toBeInTheDocument()
    unmount()
    render(<SchematicsList projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Add schematic' })).toBeNull()
    expect(screen.queryByLabelText('No schematic required')).toBeNull()
    expect(screen.queryByLabelText('Select Main SLD')).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Implement the components**

```tsx
// …/schematics/_components/DrawingPagePicker.tsx
'use client'
import type { DrawingOption } from '@/lib/solar/schematics/view-types'

/** Choose a project drawing AND a page (all pages are available — WM offered page 1 only). */
export function DrawingPagePicker({ drawings, floorPlanId, page, onChange }: {
  drawings: DrawingOption[]; floorPlanId: string; page: string; onChange: (v: { floorPlanId: string; page: string }) => void
}) {
  if (drawings.length === 0) return <p style={{ fontSize: 13 }}>This project has no drawings yet — upload the single-line diagram on the Floor Plans page (Dropbox sync keeps it current).</p>
  const pdf = drawings.find((d) => d.id === floorPlanId)?.isPdf ?? false
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', fontSize: 13 }}>
      <label>Drawing<br />
        <select aria-label="Drawing" value={floorPlanId} onChange={(e) => onChange({ floorPlanId: e.target.value, page })}>
          <option value="">Choose…</option>
          {drawings.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <label>Page<br />
        <input aria-label="Page" inputMode="numeric" value={pdf ? page : '1'} disabled={!pdf} onChange={(e) => onChange({ floorPlanId, page: e.target.value })} style={{ width: 60 }} />
      </label>
      {pdf && <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>The editor shows the page count when the sheet opens.</span>}
    </div>
  )
}
```

```tsx
// …/schematics/_components/AddSchematicDialog.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSchematicAction } from '@/actions/solar-schematics.actions'
import type { DrawingOption } from '@/lib/solar/schematics/view-types'
import { DrawingPagePicker } from './DrawingPagePicker'

export function AddSchematicDialog({ projectId, drawings, onClose }: { projectId: string; drawings: DrawingOption[]; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<'drawing' | 'blank'>(drawings.length > 0 ? 'drawing' : 'blank')
  const [pick, setPick] = useState({ floorPlanId: '', page: '1' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const page = Number(pick.page)
  const ready = name.trim().length > 0 && (mode === 'blank' || (pick.floorPlanId !== '' && Number.isInteger(page) && page >= 1))
  return (
    <div role="dialog" aria-modal="true" aria-label="Add schematic" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Add schematic</h2>
        <label>Name <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
        <label>Description <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <fieldset style={{ border: 'none', padding: 0 }}>
          <label><input type="radio" name="src" checked={mode === 'drawing'} disabled={drawings.length === 0} onChange={() => setMode('drawing')} /> From a project drawing</label>{' '}
          <label><input type="radio" name="src" checked={mode === 'blank'} onChange={() => setMode('blank')} /> Blank canvas</label>
        </fieldset>
        {mode === 'drawing' && <DrawingPagePicker drawings={drawings} floorPlanId={pick.floorPlanId} page={pick.page} onChange={setPick} />}
        {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!ready || busy} onClick={async () => {
            setBusy(true); setError(null)
            const r = await createSchematicAction({
              projectId, name: name.trim(), description: description.trim() || null,
              source: mode === 'blank' ? { kind: 'blank' } : { kind: 'drawing', floorPlanId: pick.floorPlanId, pageIndex: page },
            })
            setBusy(false)
            if ('error' in r) { setError(r.error); return }
            router.push(`/projects/${projectId}/solar/schematics/${r.id}`)
          }}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}
```

```tsx
// …/schematics/_components/ReplaceDrawingDialog.tsx
'use client'
/** Replace drawing (spec §13.1): re-anchor to a new file/page; card positions are kept and may need adjusting. */
import { useState } from 'react'
import { replaceSchematicDrawingAction } from '@/actions/solar-schematics.actions'
import type { DrawingOption } from '@/lib/solar/schematics/view-types'
import { DrawingPagePicker } from './DrawingPagePicker'

export function ReplaceDrawingDialog({ projectId, schematicId, expectedUpdatedAt, drawings, onDone, onClose }: {
  projectId: string; schematicId: string; expectedUpdatedAt: string; drawings: DrawingOption[]
  onDone: (updatedAt: string) => void; onClose: () => void
}) {
  const [pick, setPick] = useState({ floorPlanId: '', page: '1' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const page = Number(pick.page)
  return (
    <div role="dialog" aria-modal="true" aria-label="Replace drawing" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, padding: 24 }}>
      <div style={{ maxWidth: 520, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, display: 'grid', gap: 10, fontSize: 13 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Replace drawing</h2>
        <p style={{ margin: 0, color: 'var(--c-amber)' }}>Meter cards keep their positions; positions may need adjusting on the new sheet.</p>
        <DrawingPagePicker drawings={drawings} floorPlanId={pick.floorPlanId} page={pick.page} onChange={setPick} />
        {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy || !pick.floorPlanId || !(Number.isInteger(page) && page >= 1)} onClick={async () => {
            setBusy(true); setError(null)
            const r = await replaceSchematicDrawingAction({ projectId, schematicId, floorPlanId: pick.floorPlanId, pageIndex: page, expectedUpdatedAt })
            setBusy(false)
            if ('error' in r) setError(r.error); else onDone(r.updatedAt)
          }}>{busy ? 'Replacing…' : 'Replace'}</button>
        </div>
      </div>
    </div>
  )
}
```

```tsx
// …/schematics/_components/SchematicsList.tsx
'use client'
/** Schematics list (functional spec §13.1). */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deleteSchematicsAction, setSchematicWaivedAction } from '@/actions/solar-schematics.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import type { SchematicsListView } from '@/lib/solar/schematics/view-types'
import { AddSchematicDialog } from './AddSchematicDialog'
import { ReplaceDrawingDialog } from './ReplaceDrawingDialog'

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-ZA') }

export function SchematicsList({ projectId, view, canEdit }: { projectId: string; view: SchematicsListView; canEdit: boolean }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [replacing, setReplacing] = useState<{ id: string; updatedAt: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [waived, setWaived] = useState(view.waived)
  const [version, setVersion] = useState(view.studyUpdatedAt)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const confirmDel = useArmedConfirm()
  const n = selected.size

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button type="button" onClick={() => setAdding(true)}>Add schematic</button>
          {n > 0 && (!confirmDel.armed
            ? <button type="button" onClick={confirmDel.arm}>{`Delete selected (${n})`}</button>
            : <button type="button" style={{ color: '#dc2626' }} disabled={busy} onClick={async () => {
                confirmDel.disarm(); setBusy(true); setError(null)
                const r = await deleteSchematicsAction({ projectId, ids: [...selected] })
                setBusy(false)
                if ('error' in r) setError(r.error); else { setSelected(new Set()); router.refresh() }
              }}>{`Delete ${n} schematic${n === 1 ? '' : 's'}?`}</button>)}
          <label style={{ marginLeft: 'auto' }}>
            <input type="checkbox" aria-label="No schematic required" checked={waived} disabled={busy} onChange={async (e) => {
              const next = e.target.checked
              setBusy(true); setError(null)
              const r = await setSchematicWaivedAction({ projectId, waived: next, expectedUpdatedAt: version })
              setBusy(false)
              if ('error' in r) { setError(r.error); return }
              setWaived(next); setVersion(r.updatedAt); router.refresh()
            }} /> No schematic required
          </label>
        </div>
      )}
      {!canEdit && view.waived && <p>Marked "No schematic required".</p>}
      {error && <p role="alert" style={{ color: '#dc2626' }}>{error}</p>}
      {view.schematics.length === 0 ? (
        <p style={{ color: 'var(--c-text-mid)' }}>Add a single-line diagram from the project's drawings</p>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr>{canEdit && <th />}<th align="left">Name</th><th align="left">Source drawing</th><th align="right">Meters placed</th><th align="left">Updated</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {view.schematics.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                {canEdit && <td><input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onChange={(e) => setSelected((p) => { const x = new Set(p); if (e.target.checked) x.add(s.id); else x.delete(s.id); return x })} /></td>}
                <td><Link href={`/projects/${projectId}/solar/schematics/${s.id}`}>{s.name}</Link>{s.description ? <span style={{ color: 'var(--c-text-dim)' }}> — {s.description}</span> : null}</td>
                <td>{s.kind === 'blank' ? 'Blank canvas' : `${s.drawingName} · page ${s.pageIndex}`}</td>
                <td align="right">{`${s.placed} / ${view.studyMeterCount}`}</td>
                <td>{when(s.updatedAt)}</td>
                {canEdit && <td>{s.kind === 'drawing' && <button type="button" onClick={() => setReplacing({ id: s.id, updatedAt: s.updatedAt })}>Replace drawing</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SavedReportsPanel projectId={projectId} kind="solar_schematic_sheet" canManage={canEdit} title="Exported schematic sheets" />
      {adding && <AddSchematicDialog projectId={projectId} drawings={view.drawings} onClose={() => setAdding(false)} />}
      {replacing && <ReplaceDrawingDialog projectId={projectId} schematicId={replacing.id} expectedUpdatedAt={replacing.updatedAt} drawings={view.drawings}
        onClose={() => setReplacing(null)} onDone={() => { setReplacing(null); router.refresh() }} />}
    </div>
  )
}
```

```tsx
// apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schematics/page.tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSchematicsList } from '@/lib/solar/schematics/load'
import { SchematicsList } from './_components/SchematicsList'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Schematics tab (functional spec §13.1). View reads; Edit changes. */
export default async function SolarSchematicsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  return <SchematicsList projectId={id} canEdit={level !== 'view'} view={await loadSchematicsList(supabase, id)} />
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter web test -- SchematicsList 2>&1 | tail -4
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schematics"
git commit -m "feat(solar): schematics list — add from drawing and page, replace drawing, delete selected, waiver, saved sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (5 tests).

### Task 7: The editor — Konva canvas, workspace, place-meter dialog, connections manager

**Files:**
- Create: `…/schematics/[schematicId]/page.tsx`
- Create: `…/schematics/[schematicId]/_components/SchematicCanvas.tsx`
- Create: `…/schematics/[schematicId]/_components/PlaceMeterDialog.tsx`
- Create: `…/schematics/[schematicId]/_components/ConnectionsManager.tsx`
- Create: `…/schematics/[schematicId]/_components/SchematicWorkspace.tsx` (+ `SchematicWorkspace.test.tsx`)

- [ ] **Step 1: Failing workspace test (the canvas is stubbed — Konva does not run under jsdom)**

```tsx
// …/schematics/[schematicId]/_components/SchematicWorkspace.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), stub: vi.fn(), include: vi.fn(), exportPdf: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-schematics.actions', () => ({
  saveSchematicAction: h.save, createMeterStubAction: h.stub, setIncludeInLoadAction: h.include, exportSchematicSheetAction: h.exportPdf,
  replaceSchematicDrawingAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/lib/sheet/draft-store', () => ({ getDraft: vi.fn(async () => null), setDraft: vi.fn(async () => {}), clearDraft: vi.fn(async () => {}) }))
vi.mock('@/components/reports/SavedReportsPanel', () => ({ SavedReportsPanel: () => null }))
vi.mock('next/dynamic', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: () => function StubCanvas(p: any) {
    return (
      <div>
        <button type="button" onClick={() => p.onPress({ kind: 'empty', x: 100, y: 100, shift: false })}>canvas-empty</button>
        {p.doc.cards.map((c: { meterId: string; x: number; y: number }) => (
          <button key={c.meterId} type="button" onClick={() => p.onPress({ kind: 'card', id: c.meterId, x: c.x, y: c.y, shift: false })}>{`card-${c.meterId}`}</button>
        ))}
      </div>
    )
  },
}))
import { SchematicWorkspace } from './SchematicWorkspace'
import type { EditorView } from '@/lib/solar/schematics/view-types'

const view: EditorView = {
  schematic: { id: 'sc1', name: 'Main', description: null, kind: 'blank', pageIndex: 1, updatedAt: 'U0', canvasW: 2400, canvasH: 1600, anchorChanged: false, floorPlanId: null },
  sheet: null,
  doc: { cards: [{ meterId: 'A', x: 0, y: 0, w: 180, h: 64, colour: null }, { meterId: 'B', x: 400, y: 0, w: 180, h: 64, colour: null }], lines: [] },
  meters: [
    { id: 'A', label: 'Bulk', kind: 'bulk', tenantLabel: null, nodeId: null, included: null },
    { id: 'B', label: 'Pep', kind: 'tenant', tenantLabel: '12 · Pep', nodeId: 'n1', included: true },
    { id: 'C', label: 'KFC', kind: 'tenant', tenantLabel: '13 · KFC', nodeId: 'n2', included: false },
  ],
  externalLines: [],
  drawings: [],
}
beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'U1' }) })

describe('SchematicWorkspace', () => {
  it('places an unplaced meter where the user clicked; undo and redo', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Place meter (P)' }))
    await userEvent.click(screen.getByText('canvas-empty'))
    const dialog = screen.getByRole('dialog', { name: 'Place meter' })
    expect(dialog).toHaveTextContent('KFC')
    expect(dialog).not.toHaveTextContent('Pep')
    await userEvent.click(screen.getByRole('button', { name: /KFC/ }))
    expect(screen.getByText('card-C')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo (⌘Z)' }))
    expect(screen.queryByText('card-C')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Redo (⇧⌘Z)' }))
    expect(screen.getByText('card-C')).toBeInTheDocument()
  })
  it('connects two cards (parent → child) and refuses the reverse loop', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Connect (C)' }))
    await userEvent.click(screen.getByText('card-A'))
    await userEvent.click(screen.getByText('card-B'))
    expect(screen.getByRole('region', { name: 'Connections' })).toHaveTextContent('Bulk → Pep')
    await userEvent.click(screen.getByText('card-B'))
    await userEvent.click(screen.getByText('card-A'))
    expect(screen.getByRole('alert')).toHaveTextContent('That connection would make a loop in the supply hierarchy.')
  })
  it('saves on the loaded version and reports a stale refusal', async () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Save (⌘S)' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', schematicId: 'sc1', expectedUpdatedAt: 'U0', cards: expect.any(Array), lines: [] })
    h.save.mockResolvedValue({ error: 'Someone else changed this — reload to see their version.' })
    await userEvent.click(screen.getByRole('button', { name: 'Save (⌘S)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this')
  })
  it('View level: no tools, no save; layers and exports still there', () => {
    render(<SchematicWorkspace projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Place meter (P)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save (⌘S)' })).toBeNull()
    expect(screen.getByLabelText('Meters layer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download SVG' })).toBeInTheDocument()
  })
})
```

Run → FAIL.

- [ ] **Step 2: Place-meter dialog and connections manager**

```tsx
// …/[schematicId]/_components/PlaceMeterDialog.tsx
'use client'
/** Place meter (spec §13.2 "P"): pick an unplaced study meter, or create a stub for an unmetered point. */
import { useState } from 'react'
import { createMeterStubAction } from '@/actions/solar-schematics.actions'
import { METER_KIND_OPTIONS, type MeterKind } from '@/lib/solar/load/view-types'
import type { EditorMeter } from '@/lib/solar/schematics/view-types'

export function PlaceMeterDialog({ projectId, unplaced, onPick, onCreated, onClose }: {
  projectId: string; unplaced: EditorMeter[]; onPick: (meterId: string) => void; onCreated: (m: EditorMeter) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<MeterKind>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = unplaced.filter((m) => `${m.label} ${m.tenantLabel ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div role="dialog" aria-modal="true" aria-label="Place meter" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, padding: 24 }}>
      <div style={{ maxWidth: 480, margin: '0 auto', background: 'var(--c-bg)', borderRadius: 8, padding: 16, fontSize: 13, display: 'grid', gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Place meter</h2>
        <input aria-label="Filter meters" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.length === 0 ? <p style={{ margin: 0 }}>Every study meter is on this schematic.</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 280, overflow: 'auto' }}>
            {shown.map((m) => (
              <li key={m.id}><button type="button" onClick={() => onPick(m.id)} style={{ width: '100%', textAlign: 'left' }}>
                {m.label} · {m.kind}{m.tenantLabel ? ` · ${m.tenantLabel}` : ''}
              </button></li>
            ))}
          </ul>
        )}
        <fieldset style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
          <legend>Create meter (unmetered point)</legend>
          <input aria-label="New meter label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. DB-4 incomer" />{' '}
          <select aria-label="New meter kind" value={kind} onChange={(e) => setKind(e.target.value as MeterKind)}>
            {METER_KIND_OPTIONS.filter((k) => k.value !== 'water').map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>{' '}
          <button type="button" disabled={busy || !label.trim()} onClick={async () => {
            setBusy(true); setError(null)
            const r = await createMeterStubAction({ projectId, label: label.trim(), kind })
            setBusy(false)
            if ('error' in r) { setError(r.error); return }
            onCreated({ id: r.meter.id, label: r.meter.label, kind: r.meter.kind, tenantLabel: null, nodeId: null, included: null })
          }}>Create meter</button>
        </fieldset>
        {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ textAlign: 'right' }}><button type="button" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}
```

```tsx
// …/[schematicId]/_components/ConnectionsManager.tsx
'use client'
/** Connections manager (spec §13.2): the same lines as the canvas, as a table, with add and delete. */
import { useState } from 'react'
import type { SchematicLine } from '@/lib/solar/schematics/editor'
import type { EditorMeter } from '@/lib/solar/schematics/view-types'

export function ConnectionsManager({ lines, placed, meters, canEdit, onAdd, onDelete }: {
  lines: SchematicLine[]; placed: string[]; meters: Map<string, EditorMeter>; canEdit: boolean
  onAdd: (from: string, to: string, lineType: 'supply' | 'check') => void; onDelete: (key: string) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [type, setType] = useState<'supply' | 'check'>('supply')
  const name = (id: string) => meters.get(id)?.label ?? id
  return (
    <section aria-label="Connections" style={{ fontSize: 12 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Connections</h3>
      {lines.length === 0 ? <p style={{ margin: 0 }}>No connections yet. Use Connect (C): click the parent meter, optional waypoints, then the child.</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>{lines.map((l) => (
            <tr key={l.key}>
              <td>{`${name(l.fromMeterId)} → ${name(l.toMeterId)}`}</td>
              <td>{l.lineType === 'supply' ? 'Supply' : 'Check'}</td>
              <td>{canEdit && <button type="button" aria-label={`Delete ${name(l.fromMeterId)} to ${name(l.toMeterId)}`} onClick={() => onDelete(l.key)}>Delete</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {canEdit && placed.length >= 2 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          <select aria-label="Connection from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">From…</option>{placed.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select>
          <select aria-label="Connection to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">To…</option>{placed.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select>
          <select aria-label="Line type" value={type} onChange={(e) => setType(e.target.value as 'supply' | 'check')}><option value="supply">Supply</option><option value="check">Check</option></select>
          <button type="button" disabled={!from || !to} onClick={() => { onAdd(from, to, type); setFrom(''); setTo('') }}>Add connection</button>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 3: The Konva canvas**

```tsx
// …/[schematicId]/_components/SchematicCanvas.tsx
'use client'
/**
 * Schematic canvas (spec §13.2) on the shared sheet primitives: useSheetImage (image space = the
 * drawing page rasterised at scale 2, or the image's natural size) and useSheetViewport (wheel,
 * pinch, space-drag, middle-drag, F/0 fit, +/- zoom). Presses are handled on mousedown/touchstart
 * (Konva `click` is not synthesised reliably). Everything drawn comes from props; state lives in the
 * workspace.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { isPrimaryDrawPress, isTouchEvent } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { backingSize, useSheetImage } from '@/lib/sheet/use-sheet-image'
import { useSheetViewport } from '@/lib/sheet/use-sheet-viewport'
import { linePoints, type SchematicDoc } from '@/lib/solar/schematics/editor'
import type { EditorMeter, EditorView } from '@/lib/solar/schematics/view-types'

export type Tool = 'select' | 'place' | 'connect'
export interface Layers { background: boolean; meters: boolean; lines: boolean }
export interface CanvasHandle {
  exportJpeg: () => { base64: string; w: number; h: number } | null
  backgroundDataUrl: () => string | null
  size: () => { w: number; h: number }
}
export interface PressEvent { kind: 'empty' | 'card' | 'line'; id?: string; x: number; y: number; shift: boolean }
export interface SchematicCanvasProps {
  sheet: EditorView['sheet']
  pageIndex: number
  blank: { w: number; h: number }
  doc: SchematicDoc
  meters: Map<string, EditorMeter>
  tool: Tool
  layers: Layers
  editable: boolean
  selectedCard: string | null
  selectedLine: string | null
  connectFrom: string | null
  draftWaypoints: number[]
  guides: Array<{ axis: 'x' | 'y'; at: number }>
  onPress: (e: PressEvent) => void
  onCardDrag: (meterId: string, x: number, y: number, shift: boolean, end: boolean) => void
  onResize: (meterId: string, w: number, h: number, end: boolean) => void
  onWaypointDrag: (key: string, index: number, x: number, y: number, end: boolean) => void
  onToggleInclude: (meterId: string) => void
  onPageInfo?: (page: number, count: number) => void
}

const CARD_COLOUR = '#2563eb'

export const SchematicCanvas = forwardRef<CanvasHandle, SchematicCanvasProps>(function SchematicCanvas(p, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const { img, loadError, currentPage, pageCount } = useSheetImage({
    planId: p.sheet?.planId ?? 'blank', signedUrl: p.sheet?.signedUrl ?? null, isPdf: p.sheet?.isPdf ?? false, initialPage: p.pageIndex,
  })
  const [iw, ih] = backingSize(img)
  const w = p.sheet ? iw || p.sheet.widthPx || p.blank.w : p.blank.w
  const h = p.sheet ? ih || p.sheet.heightPx || p.blank.h : p.blank.h
  const image = useMemo(() => (p.sheet ? (img ? { w: iw, h: ih } : null) : { w: p.blank.w, h: p.blank.h }), [p.sheet, img, iw, ih, p.blank.w, p.blank.h])
  const vp = useSheetViewport({ containerRef, image, resetKey: `${p.sheet?.planId ?? 'blank'}:${currentPage}` })
  const onPageInfo = p.onPageInfo
  useEffect(() => { onPageInfo?.(currentPage, pageCount) }, [onPageInfo, currentPage, pageCount])

  useImperativeHandle(ref, () => ({
    size: () => ({ w, h }),
    backgroundDataUrl: () => {
      if (!img) return null
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img as CanvasImageSource, 0, 0, w, h)
      return c.toDataURL('image/jpeg', 0.85)
    },
    exportJpeg: () => {
      const stage = stageRef.current
      if (!stage) return null
      // Render the whole sheet at its own pixel size, independent of the current zoom/pan.
      const prev = { x: stage.x(), y: stage.y(), sx: stage.scaleX(), sy: stage.scaleY(), w: stage.width(), h: stage.height() }
      stage.position({ x: 0, y: 0 }); stage.scale({ x: 1, y: 1 }); stage.size({ width: w, height: h })
      const url = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.85, pixelRatio: Math.min(1, 6000 / Math.max(w, h)) })
      stage.position({ x: prev.x, y: prev.y }); stage.scale({ x: prev.sx, y: prev.sy }); stage.size({ width: prev.w, height: prev.h })
      return { base64: url.slice(url.indexOf(',') + 1), w, h }
    },
  }), [img, w, h])

  const press = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, kind: PressEvent['kind'], id?: string) => {
    if (!isPrimaryDrawPress(e.evt) || vp.panningRef.current) return
    if (isTouchEvent(e.evt) && vp.touchCountRef.current > 1) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    e.cancelBubble = true
    p.onPress({ kind, id, x: pos.x, y: pos.y, shift: 'shiftKey' in e.evt ? Boolean((e.evt as MouseEvent).shiftKey) : false })
  }
  const s = vp.scale

  if (p.sheet && !p.sheet.signedUrl) return <div style={{ padding: 32 }}>This drawing cannot be shown here (PDF, PNG, JPG, WebP or SVG only).</div>
  if (loadError) return <div role="alert" style={{ padding: 32, color: '#dc2626' }}>{loadError}</div>
  return (
    <div ref={containerRef} style={{ width: '100%', height: '70vh', border: '1px solid var(--c-border)', overflow: 'hidden', touchAction: 'none', background: '#f8fafc' }}>
      {p.sheet && !img ? <div style={{ padding: 32 }}>{p.sheet.isPdf ? 'Rendering PDF…' : 'Loading drawing…'}</div> : (
        <Stage ref={stageRef} width={vp.viewport.w} height={vp.viewport.h} scaleX={s} scaleY={s} x={vp.offset.x} y={vp.offset.y}
          draggable={p.tool === 'select' && !p.selectedCard && !vp.gestureActive}
          onDragEnd={(e) => { if (e.target !== e.target.getStage()) return; const t = e.target as Konva.Stage; vp.setOffsetFromStage({ x: t.x(), y: t.y() }) }}
          onMouseDown={(e) => { if (e.target === e.target.getStage()) press(e, 'empty') }}
          onTouchStart={(e) => { if (e.target === e.target.getStage()) press(e, 'empty') }}
          style={{ cursor: vp.panning ? 'grabbing' : p.tool === 'select' ? 'default' : 'crosshair' }}>
          <Layer listening={false}>
            <Rect x={0} y={0} width={w} height={h} fill="#ffffff" />
            {p.layers.background && img && <KonvaImage image={img} width={w} height={h} />}
          </Layer>
          {p.layers.lines && (
            <Layer>
              {p.doc.lines.map((l) => {
                const pts = linePoints(l, p.doc)
                if (!pts) return null
                const sel = p.selectedLine === l.key
                return (
                  <Group key={l.key}>
                    <Line points={pts} stroke={l.lineType === 'check' ? '#64748b' : '#d97706'} strokeWidth={(sel ? 5 : 3) / Math.max(s, 0.2)} dash={l.lineType === 'check' ? [8, 6] : undefined} hitStrokeWidth={14 / Math.max(s, 0.2)}
                      onMouseDown={(e) => press(e, 'line', l.key)} onTouchStart={(e) => press(e, 'line', l.key)} />
                    {sel && p.editable && Array.from({ length: l.waypoints.length / 2 }, (_, i) => (
                      <Circle key={i} x={l.waypoints[2 * i]} y={l.waypoints[2 * i + 1]} radius={6 / Math.max(s, 0.2)} fill="#ffffff" stroke="#d97706" draggable
                        onDragMove={(e) => p.onWaypointDrag(l.key, i, e.target.x(), e.target.y(), false)}
                        onDragEnd={(e) => { e.cancelBubble = true; p.onWaypointDrag(l.key, i, e.target.x(), e.target.y(), true) }} />
                    ))}
                  </Group>
                )
              })}
              {p.connectFrom && p.draftWaypoints.length >= 2 && (() => {
                const c = p.doc.cards.find((x) => x.meterId === p.connectFrom)
                return c ? <Line points={[c.x + c.w / 2, c.y + c.h / 2, ...p.draftWaypoints]} stroke="#d97706" dash={[4, 4]} strokeWidth={2 / Math.max(s, 0.2)} listening={false} /> : null
              })()}
            </Layer>
          )}
          {p.layers.meters && (
            <Layer>
              {p.doc.cards.map((c) => {
                const m = p.meters.get(c.meterId)
                const colour = c.colour ?? CARD_COLOUR
                const sel = p.selectedCard === c.meterId || p.connectFrom === c.meterId
                return (
                  <Group key={c.meterId} x={c.x} y={c.y} draggable={p.editable && p.tool === 'select'}
                    onMouseDown={(e) => press(e, 'card', c.meterId)} onTouchStart={(e) => press(e, 'card', c.meterId)}
                    onDragMove={(e) => p.onCardDrag(c.meterId, e.target.x(), e.target.y(), Boolean((e.evt as MouseEvent)?.shiftKey), false)}
                    onDragEnd={(e) => { e.cancelBubble = true; p.onCardDrag(c.meterId, e.target.x(), e.target.y(), Boolean((e.evt as MouseEvent)?.shiftKey), true) }}>
                    <Rect width={c.w} height={c.h} cornerRadius={6} fill="#ffffff" stroke={sel ? '#d97706' : colour} strokeWidth={(sel ? 3 : 2) / Math.max(s, 0.2)} dash={m?.included === false ? [6, 4] : undefined} />
                    <Rect width={8} height={c.h} fill={colour} />
                    <Text x={14} y={8} width={c.w - 40} text={m?.label ?? 'Meter'} fontSize={16} fill="#0f172a" ellipsis wrap="none" />
                    <Text x={14} y={30} width={c.w - 20} text={`${m?.kind ?? ''}${m?.tenantLabel ? ` · ${m.tenantLabel}` : ''}`} fontSize={12} fill="#475569" ellipsis wrap="none" />
                    <Circle x={c.w - 14} y={14} radius={8} fill={m?.included === true ? '#16a34a' : m?.included === false ? '#e2e8f0' : '#f8fafc'} stroke="#64748b" strokeWidth={1}
                      onMouseDown={(e) => { e.cancelBubble = true; if (p.editable) p.onToggleInclude(c.meterId) }} />
                    {p.editable && p.selectedCard === c.meterId && (
                      <Rect x={c.w - 6} y={c.h - 6} width={12} height={12} fill="#d97706" draggable
                        onMouseDown={(e) => { e.cancelBubble = true }}
                        onDragMove={(e) => { e.cancelBubble = true; p.onResize(c.meterId, e.target.x() + 6, e.target.y() + 6, false) }}
                        onDragEnd={(e) => { e.cancelBubble = true; p.onResize(c.meterId, e.target.x() + 6, e.target.y() + 6, true) }} />
                    )}
                  </Group>
                )
              })}
              {p.guides.map((g, i) => g.axis === 'x'
                ? <Line key={i} points={[g.at, 0, g.at, h]} stroke="#7c3aed" dash={[4, 4]} strokeWidth={1 / Math.max(s, 0.2)} listening={false} />
                : <Line key={i} points={[0, g.at, w, g.at]} stroke="#7c3aed" dash={[4, 4]} strokeWidth={1 / Math.max(s, 0.2)} listening={false} />)}
            </Layer>
          )}
        </Stage>
      )}
    </div>
  )
})
```

- [ ] **Step 4: The workspace**

```tsx
// …/[schematicId]/_components/SchematicWorkspace.tsx
'use client'
/**
 * Schematic editor (functional spec §13.2): tools V/P/C, Del, ⌘Z / ⇧⌘Z, ⌘S; layers; connections
 * manager; explicit save with stale-write refusal and an IndexedDB draft between saves; PDF sheet
 * export (projects.reports kind solar_schematic_sheet) and SVG download with the background embedded.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { exportSchematicSheetAction, saveSchematicAction, setIncludeInLoadAction } from '@/actions/solar-schematics.actions'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { downloadBlob } from '@/components/charts/export'
import { clearDraft, getDraft, setDraft } from '@/lib/sheet/draft-store'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import {
  addLine, historyCommit, historyInit, historyRedo, historyUndo, linePoints, moveCard, placeCard, removeCard, removeLine, resizeCard,
  setWaypoints, snapCard, toSavePayload, type History, type SchematicDoc,
} from '@/lib/solar/schematics/editor'
import { buildSchematicSvg } from '@/lib/solar/schematics/svg'
import type { EditorMeter, EditorView } from '@/lib/solar/schematics/view-types'
import { ReplaceDrawingDialog } from '../../_components/ReplaceDrawingDialog'
import type { CanvasHandle, Layers, PressEvent, SchematicCanvasProps, Tool } from './SchematicCanvas'
import { ConnectionsManager } from './ConnectionsManager'
import { PlaceMeterDialog } from './PlaceMeterDialog'

const SchematicCanvas = dynamic(() => import('./SchematicCanvas').then((m) => m.SchematicCanvas), {
  ssr: false,
  loading: () => <div style={{ padding: 32 }}>Loading editor…</div>,
}) as unknown as ForwardRefExoticComponent<SchematicCanvasProps & RefAttributes<CanvasHandle>>

const SNAP_TOL = 8

export function SchematicWorkspace({ projectId, view, canEdit }: { projectId: string; view: EditorView; canEdit: boolean }) {
  const router = useRouter()
  const draftKey = `solar-schematic:${view.schematic.id}`
  const canvasRef = useRef<CanvasHandle | null>(null)
  const [history, setHistory] = useState<History<SchematicDoc>>(() => historyInit(view.doc))
  const [live, setLive] = useState<SchematicDoc | null>(null)
  const doc = live ?? history.present
  const [meters, setMeters] = useState<EditorMeter[]>(view.meters)
  const meterMap = useMemo(() => new Map(meters.map((m) => [m.id, m])), [meters])
  const [tool, setTool] = useState<Tool>('select')
  const [layers, setLayers] = useState<Layers>({ background: true, meters: true, lines: true })
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [selectedLine, setSelectedLine] = useState<string | null>(null)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [draft, setDraftPts] = useState<number[]>([])
  const [guides, setGuides] = useState<Array<{ axis: 'x' | 'y'; at: number }>>([])
  const [placeAt, setPlaceAt] = useState<{ x: number; y: number } | null>(null)
  const [version, setVersion] = useState(view.schematic.updatedAt)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [restorable, setRestorable] = useState<SchematicDoc | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [pageInfo, setPageInfo] = useState<{ page: number; count: number } | null>(null)
  useSolarDirtyGuard(dirty)

  // A draft saved against THIS version (a crash or tab close) can be restored.
  useEffect(() => {
    if (!canEdit) return
    void getDraft<{ doc: SchematicDoc; basedOn: string }>(draftKey).then((d) => {
      if (d && d.basedOn === view.schematic.updatedAt && JSON.stringify(d.doc) !== JSON.stringify(view.doc)) setRestorable(d.doc)
    })
  }, [canEdit, draftKey, view.schematic.updatedAt, view.doc])

  const commit = useCallback((next: SchematicDoc) => {
    setHistory((h) => historyCommit(h, next))
    setLive(null)
    setDirty(true)
    void setDraft(draftKey, { doc: next, basedOn: version })
  }, [draftKey, version])
  const fail = (text: string) => setMsg({ ok: false, text })

  const onPress = useCallback((e: PressEvent) => {
    setMsg(null)
    if (tool === 'place') {
      if (e.kind === 'empty') setPlaceAt({ x: e.x, y: e.y })
      return
    }
    if (tool === 'connect') {
      if (e.kind === 'card' && e.id) {
        if (!connectFrom) { setConnectFrom(e.id); setDraftPts([]); return }
        if (e.id === connectFrom) return
        const r = addLine(doc, { fromMeterId: connectFrom, toMeterId: e.id, waypoints: draft, lineType: 'supply' }, view.externalLines)
        setConnectFrom(null); setDraftPts([])
        if (!r.ok) { fail(r.reason); return }
        commit(r.doc)
        return
      }
      if (e.kind === 'empty' && connectFrom) setDraftPts((d) => [...d, e.x, e.y])
      return
    }
    if (e.kind === 'card') { setSelectedCard(e.id ?? null); setSelectedLine(null) }
    else if (e.kind === 'line') { setSelectedLine(e.id ?? null); setSelectedCard(null) }
    else { setSelectedCard(null); setSelectedLine(null) }
  }, [tool, connectFrom, doc, draft, view.externalLines, commit])

  const undo = useCallback(() => { setLive(null); setHistory((h) => historyUndo(h)); setDirty(true) }, [])
  const redo = useCallback(() => { setLive(null); setHistory((h) => historyRedo(h)); setDirty(true) }, [])
  const del = useCallback(() => {
    if (selectedCard) { commit(removeCard(doc, selectedCard)); setSelectedCard(null) }
    else if (selectedLine) { commit(removeLine(doc, selectedLine)); setSelectedLine(null) }
  }, [selectedCard, selectedLine, doc, commit])

  const save = useCallback(async () => {
    setBusy(true); setMsg(null)
    const payload = toSavePayload(history.present)
    const r = await saveSchematicAction({ projectId, schematicId: view.schematic.id, expectedUpdatedAt: version, cards: payload.cards, lines: payload.lines })
    setBusy(false)
    if ('error' in r) { fail(r.error); return }
    setVersion(r.updatedAt)
    setDirty(false)
    void clearDraft(draftKey)
    setMsg({ ok: true, text: 'Saved. The Load tab uses the new hierarchy at the next rebuild.' })
  }, [history.present, projectId, view.schematic.id, version, draftKey])

  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod) return
      if (e.key === 'v' || e.key === 'V') setTool('select')
      else if (e.key === 'p' || e.key === 'P') setTool('place')
      else if (e.key === 'c' || e.key === 'C') setTool('connect')
      else if (e.key === 'Escape') { setConnectFrom(null); setDraftPts([]); setPlaceAt(null) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit, save, undo, redo, del])

  const placedIds = doc.cards.map((c) => c.meterId)
  const unplaced = meters.filter((m) => !placedIds.includes(m.id))
  const tb = (label: string, active: boolean, onClick: () => void, disabled = false) => (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick}
      style={{ background: active ? 'var(--c-amber-mid)' : undefined, fontSize: 12 }}>{label}</button>
  )

  async function exportPdf() {
    const shot = canvasRef.current?.exportJpeg()
    if (!shot) { fail('The sheet is still loading — try again in a moment.'); return }
    setBusy(true); setMsg(null)
    const r = await exportSchematicSheetAction({ projectId, schematicId: view.schematic.id, jpegBase64: shot.base64, crop: { w: shot.w, h: shot.h }, note: null })
    setBusy(false)
    if ('error' in r) { fail(r.error); return }
    setMsg({ ok: true, text: `Sheet version ${r.version} saved to Exported schematic sheets.` })
    setReloadKey((k) => k + 1)
  }
  function exportSvg() {
    const size = canvasRef.current?.size() ?? { w: view.schematic.canvasW, h: view.schematic.canvasH }
    const svg = buildSchematicSvg({
      width: size.w, height: size.h, backgroundDataUrl: canvasRef.current?.backgroundDataUrl() ?? null, layers,
      cards: doc.cards.map((c) => {
        const m = meterMap.get(c.meterId)
        return { ...c, label: m?.label ?? 'Meter', sublabel: `${m?.kind ?? ''}${m?.tenantLabel ? ` · ${m.tenantLabel}` : ''}`, included: m?.included ?? null }
      }),
      lines: doc.lines.map((l) => ({ points: linePoints(l, doc) ?? [], lineType: l.lineType })),
    })
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${view.schematic.name.replace(/[^A-Za-z0-9._ -]+/g, '_')}.svg`)
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>{view.schematic.name}</h2>
        {view.sheet && <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{view.sheet.name} · page {view.schematic.pageIndex}{pageInfo ? ` of ${pageInfo.count}` : ''}</span>}
        {canEdit && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 12 }}>
            {tb('Select (V)', tool === 'select', () => setTool('select'))}
            {tb('Place meter (P)', tool === 'place', () => setTool('place'))}
            {tb('Connect (C)', tool === 'connect', () => { setTool('connect'); setConnectFrom(null); setDraftPts([]) })}
            {tb('Undo (⌘Z)', false, undo, history.past.length === 0)}
            {tb('Redo (⇧⌘Z)', false, redo, history.future.length === 0)}
            {tb('Delete (Del)', false, del, !selectedCard && !selectedLine)}
            {tb(busy ? 'Saving…' : 'Save (⌘S)', false, () => void save(), busy)}
            {view.schematic.kind === 'drawing' && tb('Replace drawing', false, () => setReplacing(true))}
          </span>
        )}
        <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto', fontSize: 12 }}>
          {(['meters', 'lines', 'background'] as const).map((k) => (
            <label key={k}><input type="checkbox" aria-label={`${k[0].toUpperCase()}${k.slice(1)} layer`} checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {k}</label>
          ))}
          {canEdit && <button type="button" disabled={busy} onClick={() => void exportPdf()}>Export PDF sheet</button>}
          <button type="button" onClick={exportSvg}>Download SVG</button>
        </span>
      </header>
      {view.schematic.anchorChanged && <p role="status" style={{ background: 'var(--c-amber-dim)', padding: '6px 10px', borderRadius: 6, fontSize: 13, margin: 0 }}>The drawing has a newer file than the one this schematic was drawn on — positions may need adjusting.</p>}
      {restorable && canEdit && (
        <p role="status" style={{ fontSize: 13, margin: 0 }}>Unsaved changes from an earlier session were found.{' '}
          <button type="button" onClick={() => { commit(restorable); setRestorable(null) }}>Restore</button>{' '}
          <button type="button" onClick={() => { void clearDraft(draftKey); setRestorable(null) }}>Discard</button>
        </p>
      )}
      {tool === 'connect' && canEdit && <p style={{ fontSize: 12, margin: 0, color: 'var(--c-text-mid)' }}>{connectFrom ? `From ${meterMap.get(connectFrom)?.label}: click empty space to add waypoints, then the child meter. Esc cancels.` : 'Click the parent (supply) meter.'}</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--c-text-mid)' : '#dc2626', fontSize: 13, margin: 0 }}>{msg.text}</p>}
      <SchematicCanvas
        ref={canvasRef}
        sheet={view.sheet}
        pageIndex={view.schematic.pageIndex}
        blank={{ w: view.schematic.canvasW, h: view.schematic.canvasH }}
        doc={doc}
        meters={meterMap}
        tool={canEdit ? tool : 'select'}
        layers={layers}
        editable={canEdit}
        selectedCard={selectedCard}
        selectedLine={selectedLine}
        connectFrom={connectFrom}
        draftWaypoints={draft}
        guides={guides}
        onPress={onPress}
        onPageInfo={(page, count) => setPageInfo((p) => (p && p.page === page && p.count === count ? p : { page, count }))}
        onCardDrag={(id, x, y, shift, end) => {
          const card = history.present.cards.find((c) => c.meterId === id)
          if (!card) return
          const snapped = shift ? snapCard({ ...card, x, y }, history.present.cards, SNAP_TOL) : { x, y, guides: [] }
          setGuides(end ? [] : snapped.guides)
          const next = moveCard(history.present, id, snapped.x, snapped.y)
          if (end) commit(next); else setLive(next)
        }}
        onResize={(id, w, h, end) => { const next = resizeCard(history.present, id, w, h); if (end) commit(next); else setLive(next) }}
        onWaypointDrag={(key, i, x, y, end) => {
          const l = history.present.lines.find((z) => z.key === key)
          if (!l) return
          const wp = [...l.waypoints]; wp[2 * i] = x; wp[2 * i + 1] = y
          const next = setWaypoints(history.present, key, wp)
          if (end) commit(next); else setLive(next)
        }}
        onToggleInclude={async (meterId) => {
          const m = meterMap.get(meterId)
          if (!m) return
          if (!m.nodeId) { fail('Link this meter to a tenant first (Load → Meters → Details).'); return }
          const include = m.included !== true
          const r = await setIncludeInLoadAction({ projectId, meterId, include })
          if ('error' in r) { fail(r.error); return }
          setMeters((ms) => ms.map((x) => (x.id === meterId ? { ...x, included: include } : x)))
          setMsg({ ok: true, text: `${m.label} ${include ? 'included in' : 'excluded from'} the site load — rebuild the site profile to apply.` })
        }}
      />
      <ConnectionsManager lines={doc.lines} placed={placedIds} meters={meterMap} canEdit={canEdit}
        onDelete={(key) => commit(removeLine(doc, key))}
        onAdd={(from, to, lineType) => {
          const r = addLine(doc, { fromMeterId: from, toMeterId: to, waypoints: [], lineType }, view.externalLines)
          if (!r.ok) fail(r.reason); else commit(r.doc)
        }} />
      <SavedReportsPanel projectId={projectId} kind="solar_schematic_sheet" source={{ table: 'solar.schematics', id: view.schematic.id }} canManage={canEdit} title="Exported sheets of this schematic" reloadKey={reloadKey} />
      {placeAt && (
        <PlaceMeterDialog projectId={projectId} unplaced={unplaced} onClose={() => setPlaceAt(null)}
          onPick={(meterId) => { const r = placeCard(doc, meterId, placeAt); setPlaceAt(null); if (r.ok) commit(r.doc); else fail(r.reason) }}
          onCreated={(m) => { setMeters((ms) => [...ms, m]); const r = placeCard(doc, m.id, placeAt); setPlaceAt(null); if (r.ok) commit(r.doc) }} />
      )}
      {replacing && (
        <ReplaceDrawingDialog projectId={projectId} schematicId={view.schematic.id} expectedUpdatedAt={version} drawings={view.drawings}
          onClose={() => setReplacing(false)} onDone={() => { setReplacing(false); router.refresh() }} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: The editor page**

```tsx
// …/schematics/[schematicId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSchematicEditor } from '@/lib/solar/schematics/load'
import { SchematicWorkspace } from './_components/SchematicWorkspace'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Schematic editor (functional spec §13.2). View reads the diagram; Edit changes it. */
export default async function SchematicEditorPage({ params }: { params: Promise<{ id: string; schematicId: string }> }) {
  const { id, schematicId } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const view = await loadSchematicEditor(supabase, id, schematicId)
  if (!view) notFound()
  return (
    <div>
      <Link href={`/projects/${id}/solar/schematics`} style={{ fontSize: 12 }}>← All schematics</Link>
      <SchematicWorkspace key={`${view.schematic.id}:${view.schematic.floorPlanId}:${view.schematic.pageIndex}`} projectId={id} view={view} canEdit={level !== 'view'} />
    </div>
  )
}
```

- [ ] **Step 6: Run, type-check, commit**

```bash
pnpm --filter web test -- SchematicWorkspace 2>&1 | tail -4
pnpm --filter web type-check
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schematics"
git commit -m "feat(solar): schematic editor — Konva canvas on the sheet primitives, tools, history, save, draft, exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: PASS (4 tests), type-check clean. The dirty guard's "Discard unsaved changes?" comes from the shared tab bar.

### Task 8: RBAC rows and as-built notes

**Files:**
- Modify: `docs/rbac-matrix.md`
- Modify: `docs/solar/03-data-model-and-security.md`

- [ ] **Step 1: RBAC rows**

In the Solar route table (after the `/solar/load` row from 3b-i):

```md
| `/projects/[id]/solar/schematics` and `/solar/schematics/[schematicId]` | W | W | W | R (diagram, layers, SVG download, saved sheets; no tools, save, export PDF, waiver, delete) | → locked | → locked | → locked |
```

In "Solar server actions":

```md
| `createSchematicAction`, `updateSchematicMetaAction`, `replaceSchematicDrawingAction`, `deleteSchematicsAction`, `setSchematicWaivedAction` (`solar-schematics.actions.ts`) | `requireSolarLevel(project, 'edit')`; `expectedUpdatedAt` on meta / replace / waiver | `schematics_*_authz` (RESTRICTIVE, `solar_can_edit`); `schematics_bind` stamps the anchor and refuses a drawing of another project or an inactive one |
| `saveSchematicAction` | Solar Edit; payload shape checked | `public.solar_save_schematic` (SECURITY INVOKER; `40001` on a stale version); card bind: only study meters; line bind: both placed, no loop in the study's supply hierarchy |
| `createMeterStubAction`, `setIncludeInLoadAction` | Solar Edit; include needs the meter linked to a tenant of this project | library RLS (`library_orgs('edit')`) + `study_meters_*_authz`; `tenant_load_basis_*_authz` |
| `exportSchematicSheetAction` | Solar Edit; image size capped | renders server-side; stored with the service client after the gate in `reports` bucket, `projects.reports` kind `solar_schematic_sheet` (read: `SOLAR_READ_REPORT_KINDS` → Solar View; `user_can_read_report_kind` 00215; delete needs Solar Edit) |
```

And one sentence under the Solar section notes:

```md
> `cloud-sync-project`'s `isAnnotated()` treats a drawing with a Solar schematic, meter card or supply line as annotated (00215), so a newer Dropbox file is never auto-adopted under it. **Deploy the edge function only after 00215 is applied** — before, the three lookups error and fail closed (every drawing reads as annotated).
```

- [ ] **Step 2: As-built notes** in `docs/solar/03-data-model-and-security.md` §3, replace the three schematic rows with:

```md
| `schematics` | study_id, name (unique per study), description, kind (drawing/blank), floor_plan_id (NO ACTION) + page_index, file_path + source_revision_id (stamped by trigger; compared on open), canvas_w/h (blank) | Replace drawing re-stamps the anchor and carries floor_plan_id to cards and lines (00215) |
| `schematic_cards` | schematic_id, meter_id (a study meter; one card per meter per schematic), x, y, w, h (image px), colour, floor_plan_id (denormalised by trigger) | **In `isAnnotated()`** (00215) |
| `schematic_lines` | schematic_id, from_meter_id, to_meter_id, waypoints jsonb (flat image px, even length ≤ 400), line_type (supply/check), floor_plan_id (denormalised) | Supply lines define the meter hierarchy; a loop anywhere in the study is refused; deleting a card deletes its lines; **in `isAnnotated()`** |
| `load_check_acks` | study_id, check_key (unique per study), note, acknowledged_by/at (stamped) | Load → Checks "Mark as acknowledged" (00215); no UPDATE |
```

and add to `studies` key columns: `load_growth_pct, monthly_bills jsonb (S4 input), schematic_waived`.

- [ ] **Step 3: Commit**

```bash
git add docs/rbac-matrix.md docs/solar/03-data-model-and-security.md
git commit -m "docs(solar): RBAC rows for Schematics; 03 rows as built (00215)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verify everything, two reviewers, push, draft PR

**Files:** none (evidence goes in the PR body).

- [ ] **Step 1: The full gate** (from the worktree root)

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-3b
pnpm --filter @esite/shared test 2>&1 | tail -4 | tee "$SCRATCH/3b-final.txt"
pnpm --filter web test 2>&1 | tail -4 | tee -a "$SCRATCH/3b-final.txt"
pnpm --filter @esite/db test:ci 2>&1 | tail -4 | tee -a "$SCRATCH/3b-final.txt"
pnpm --filter @esite/shared type-check && pnpm --filter web type-check && echo "type-check ok" | tee -a "$SCRATCH/3b-final.txt"
pnpm --filter @esite/shared lint 2>&1 | tail -3; pnpm --filter web lint 2>&1 | tail -3
pnpm --filter web build 2>&1 | tail -20 | tee -a "$SCRATCH/3b-final.txt"
```

Expected: every suite green with counts above the Task 1 baseline of 3b-0; type-check, lint clean; `next build` exit 0. Any red: fix at the cause, re-run the whole block. Do not proceed on red.

- [ ] **Step 2: Re-run the migration dry run on the final file** (the migration may have changed during review)

```bash
M=apps/edge-functions/supabase/migrations
cat $M/00208_solar_foundation.sql $M/00209_solar_org_settings.sql $M/00210_tariffs_schema.sql $M/00211_solar_meter_data.sql $M/00215_solar_schematics.sql > "$SCRATCH/3b-green.sql"
scripts/db/dry-run-migration.sh "$SCRATCH/3b-green.sql" scripts/db/assert-solar-schematics-roles.sql | tee "$SCRATCH/3b-dry-final.txt"
grep "| f" "$SCRATCH/3b-dry-final.txt" || echo "all rows ok"
```

Expected: 43 rows, "all rows ok".

- [ ] **Step 3: Two reviewers, in the foreground, in parallel**

Dispatch two `superpowers:code-reviewer` agents in ONE message (`run_in_background: false`), each given the branch diff `git diff origin/feat/solar-integration...HEAD` and the three plan files:

1. **Security / data reviewer:** 00215 (per-verb RLS, FORCE, no RESTRICTIVE read policy, anon revokes spelled out, INVOKER read RPCs cannot widen reads, the save RPC's stale and permission checks, `user_can_read_report_kind` keeps every 00183/00212 branch, the product-events CHECK keeps every prior value), `isAnnotated()` fail-closed shape, every route/action gate (level + study-link checks), no service key outside audit/product events/report upload, no rand values at View, no `innerHTML`, WinAnsi in the PDF.
2. **Behaviour / UX reviewer:** spec §4 and §13 control by control against the UI (hidden-not-disabled above level, two-step destructive confirms, `expectedUpdatedAt` everywhere, human sentences, empty states, units on every number), the builder's semantics (S1/S2/S3/S4, double-count guard, BO-date handling, reconciliation tolerances), the Konva conventions (mousedown selection, bubbling drag ends, image space), and test quality ("what would this fixture have to look like for the test to fail?").

Fix every confirmed finding in new commits (never amend), re-run Step 1, and record each finding with its fix in `$SCRATCH/3b-evidence.md`.

- [ ] **Step 4: Push**

```bash
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-3b
```

(SSH works; the gh-token HTTPS URL lacks workflow scope — CLAUDE.md.)

- [ ] **Step 5: Draft PR against the integration branch**

```bash
gh pr create --draft --base feat/solar-integration --head feat/solar-phase-3b \
  --title "Solar Phase 3b — Load tab UI + Schematics tab (migration 00215)" \
  --body-file "$SCRATCH/3b-pr-body.md"
```

Write `$SCRATCH/3b-pr-body.md` first with these sections, filled from the evidence files:
- **What** — Load tab (Meters · Tenants · Site profile · Checks), Schematics tab (list + Konva editor + PDF/SVG export), migration `00215_solar_schematics.sql`, `isAnnotated()` coverage, pure `@esite/shared/solar-load` builder/charts/hierarchy/auto-match.
- **Design decisions** — the lists at the top of plans 3b-0, 3b-i, 3b-ii.
- **Migration evidence** — green row count (43), and the five mutations with the rows each turned red; `@esite/db` guards green.
- **Suites** — before/after counts for shared / web / db; type-check; lint; `next build` exit 0.
- **Review findings** — each with its fix commit.
- **Owner steps (not done here)** — (1) claim the migration number at apply time (ledger, `origin/main`, open-PR filenames) and apply `00215` through the deploy workflow **after 00208–00211**; (2) **then** deploy `cloud-sync-project` (`apps/edge-functions/deploy.sh`), and read `verify_jwt`/version back from the Management API; (3) the signed-in walk: Load → upload a meter export → review → Accept → Tenants assign → Site profile rebuild → charts; Schematics → add from drawing + page → place, connect, save, reload, export PDF + SVG; (4) the open questions below.
- **Not verified** — the signed-in walk; Konva components have no component tests; touch/tablet untested; `packages/db/src/types.ts` not regenerated.
- End the body with the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Hand-off**

Report: PR URL, the three suite counts, the dry-run result, the review findings and fixes, and the owner steps. Do not apply the migration, do not deploy the edge function, do not merge.

---

## Self-review (done)

- Spec §13.1: list (name, source drawing + page, placed/total, updated; row → editor; empty state) — Task 6; Add from drawing AND page, or blank — Task 6; Replace drawing (positions kept + warning) — Tasks 6/7 and 00215 propagation; Delete / Delete selected (two-step, count, cascade) — Task 6 + 00215 cascades; "No schematic required" — Task 6 + readiness (3b-0 Task 14).
- §13.2: select/move/resize with shift-snap guides (Tasks 1, 7); Place meter + Create meter stub (Task 7); Connect with waypoints, Esc cancels, live anchors (Tasks 1, 7); edit waypoints (Task 7); connections manager (Task 7); include-in-load toggle (Tasks 5, 7); Delete card deletes lines (Task 1 + 00215 trigger); layers (Task 7); pan/zoom/fit via `use-sheet-viewport` (Task 7); undo/redo (Task 1/7); Save with stale refusal + IndexedDB draft (Tasks 5/7); PDF into `projects.reports` `solar_schematic_sheet` + SVG with embedded background (Tasks 2, 3, 5, 7).
- §13.3: reconciliation and the double-count guard consume `schematic_lines` (3b-0 Task 12, shown on Load → Checks / Site profile); the PoC offer is deferred (open question).
- 03 §3 tables in `isAnnotated()` + schema-derived contract test (3b-0 Task 5); edge deploy ordered after the apply (Task 9 owner steps).
- Placeholders: none. Names match 3b-0/3b-i (`wouldCreateCycle`, `MeterLine`, `tenantLabel`, `METER_KIND_OPTIONS`, `SOLAR_READ_REPORT_KINDS`, `downloadBlob`).

