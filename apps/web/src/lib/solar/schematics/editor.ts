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

/**
 * The card's include-in-load circle toggles only with the Select tool on an editable canvas. With
 * Connect or Place active, a press on the circle is a press on the card (pick it as a line end),
 * never a silent include/exclude write.
 */
export function includeToggleActive(editable: boolean, tool: 'select' | 'place' | 'connect'): boolean {
  return editable && tool === 'select'
}
