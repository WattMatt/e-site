/**
 * Editing operations on a layout's object list (functional spec §6.3). Pure:
 * the workspace owns the state, this owns the rules (the lib/cable-route/
 * route-history.ts split). Every function returns a NEW array.
 */
import { flatToPts, ptsToFlat, rotateAbout, vertexMean } from './geometry'
import { mod360 } from './orientation'
import { isArrayObject, isCircleGeometry, type LayoutObject, type ModuleRef, type Pt } from './types'

/** Distinct on screen and in the PDF legend; cycles for more strings. */
export const STRING_COLOURS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
  '#f032e6', '#9a6324', '#800000', '#469990', '#000075', '#808000',
] as const

export function stringColour(i: number): string {
  const n = STRING_COLOURS.length
  return STRING_COLOURS[((i % n) + n) % n]!
}

/** JSON with keys sorted at every depth — jsonb reorders keys, so a plain stringify diff would lie. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

const sig = (o: LayoutObject) => stableStringify([o.kind, o.geometry, o.props])

function pruneStrings(objs: LayoutObject[]): LayoutObject[] {
  const arrays = new Map(objs.filter(isArrayObject).map((a) => [a.id, a.geometry.modules.length]))
  const inverters = new Set(objs.filter((o) => o.kind === 'inverter').map((o) => o.id))
  return objs.flatMap<LayoutObject>((o) => {
    if (o.kind !== 'string') return [o]
    if (!inverters.has(o.props.inverterId)) return []
    const modules = o.props.modules.filter((m) => m.index < (arrays.get(m.arrayId) ?? 0))
    return modules.length > 0 ? [{ ...o, props: { ...o.props, modules } }] : []
  })
}

/**
 * Make every string reference valid after a MERGE (e.g. a rebased draft
 * restore), which can produce states no single edit does: strings whose
 * inverter is gone, module refs past an array's end, or a module claimed by
 * two strings. The first string to claim a module keeps it; emptied strings go.
 */
export function normaliseReferences(objs: LayoutObject[]): LayoutObject[] {
  const claimed = new Set<string>()
  return pruneStrings(objs).flatMap<LayoutObject>((o) => {
    if (o.kind !== 'string') return [o]
    const modules = o.props.modules.filter((m) => {
      const k = `${m.arrayId}#${m.index}`
      if (claimed.has(k)) return false
      claimed.add(k)
      return true
    })
    return modules.length > 0 ? [{ ...o, props: { ...o.props, modules } }] : []
  })
}

/** Delete whole objects; strings lose modules of deleted arrays and die with their inverter or when empty. */
export function removeObjects(objs: LayoutObject[], ids: string[]): LayoutObject[] {
  const gone = new Set(ids)
  return pruneStrings(objs.filter((o) => !gone.has(o.id)))
}

/** Delete individual modules; every string's references are re-indexed so they keep pointing at the same panels. */
export function removeModules(objs: LayoutObject[], refs: ModuleRef[]): LayoutObject[] {
  const drop = new Map<string, Set<number>>()
  for (const r of refs) {
    const s = drop.get(r.arrayId) ?? new Set<number>()
    s.add(r.index)
    drop.set(r.arrayId, s)
  }
  const remap = new Map<string, Map<number, number>>()
  const next = objs.map((o) => {
    if (!isArrayObject(o) || !drop.has(o.id)) return o
    const d = drop.get(o.id)!
    const m = new Map<number, number>()
    const modules: number[][] = []
    o.geometry.modules.forEach((q, i) => {
      if (!d.has(i)) {
        m.set(i, modules.length)
        modules.push(q)
      }
    })
    remap.set(o.id, m)
    return { ...o, geometry: { modules } } as LayoutObject
  })
  return next.flatMap<LayoutObject>((o) => {
    if (o.kind !== 'string') return [o]
    const modules = o.props.modules.flatMap((r) => {
      const m = remap.get(r.arrayId)
      if (!m) return [r]
      const ni = m.get(r.index)
      return ni === undefined ? [] : [{ arrayId: r.arrayId, index: ni }]
    })
    return modules.length > 0 ? [{ ...o, props: { ...o.props, modules } }] : []
  })
}

const shift = (flat: number[], dx: number, dy: number) => flat.map((v, i) => (i % 2 === 0 ? v + dx : v + dy))

export function translateObjects(objs: LayoutObject[], ids: string[], dx: number, dy: number): LayoutObject[] {
  const s = new Set(ids)
  return objs.map((o): LayoutObject => {
    if (!s.has(o.id)) return o
    switch (o.kind) {
      case 'roof':
        return { ...o, geometry: { points: shift(o.geometry.points, dx, dy) } }
      case 'obstruction':
        return isCircleGeometry(o.geometry)
          ? { ...o, geometry: { ...o.geometry, cx: o.geometry.cx + dx, cy: o.geometry.cy + dy } }
          : { ...o, geometry: { points: shift(o.geometry.points, dx, dy) } }
      case 'array':
      case 'module_block':
        return { ...o, geometry: { modules: o.geometry.modules.map((q) => shift(q, dx, dy)) } }
      case 'inverter':
      case 'equipment':
        return { ...o, geometry: { x: o.geometry.x + dx, y: o.geometry.y + dy } }
      default:
        return o
    }
  })
}

/** A representative point of an object (image px), or null for a string. */
export function objectAnchor(o: LayoutObject): Pt | null {
  switch (o.kind) {
    case 'roof':
      return vertexMean(flatToPts(o.geometry.points))
    case 'obstruction':
      return isCircleGeometry(o.geometry) ? { x: o.geometry.cx, y: o.geometry.cy } : vertexMean(flatToPts(o.geometry.points))
    case 'array':
    case 'module_block':
      return o.geometry.modules.length ? vertexMean(o.geometry.modules.flatMap((q) => flatToPts(q))) : null
    case 'inverter':
    case 'equipment':
      return { x: o.geometry.x, y: o.geometry.y }
    default:
      return null
  }
}

export function selectionPivot(objs: LayoutObject[], ids: string[]): Pt | null {
  const pts = objs.filter((o) => ids.includes(o.id)).map(objectAnchor).filter((p): p is Pt => p !== null)
  return pts.length ? vertexMean(pts) : null
}

const rot = (flat: number[], pivot: Pt, deg: number) => ptsToFlat(flatToPts(flat).map((p) => rotateAbout(p, pivot, deg)))

/** Rotate about one pivot (the transformer's box centre), clockwise on screen. Facing and fall line turn with the geometry. */
export function rotateObjects(objs: LayoutObject[], ids: string[], deg: number, pivot: Pt): LayoutObject[] {
  const s = new Set(ids)
  return objs.map((o): LayoutObject => {
    if (!s.has(o.id)) return o
    switch (o.kind) {
      case 'roof':
        return {
          ...o,
          geometry: { points: rot(o.geometry.points, pivot, deg) },
          props: { ...o.props, fallBearingDeg: o.props.fallBearingDeg === null ? null : mod360(o.props.fallBearingDeg + deg) },
        }
      case 'obstruction': {
        if (isCircleGeometry(o.geometry)) {
          const c = rotateAbout({ x: o.geometry.cx, y: o.geometry.cy }, pivot, deg)
          return { ...o, geometry: { ...o.geometry, cx: c.x, cy: c.y } }
        }
        return { ...o, geometry: { points: rot(o.geometry.points, pivot, deg) } }
      }
      case 'array':
      case 'module_block':
        return {
          ...o,
          geometry: { modules: o.geometry.modules.map((q) => rot(q, pivot, deg)) },
          props: { ...o.props, facingSheetDeg: mod360(o.props.facingSheetDeg + deg) },
        }
      case 'inverter':
      case 'equipment': {
        const p = rotateAbout({ x: o.geometry.x, y: o.geometry.y }, pivot, deg)
        return { ...o, geometry: { x: p.x, y: p.y } }
      }
      default:
        return o
    }
  })
}

/** What to send: changed or new objects, and ids that are gone. */
export function diffObjects(saved: LayoutObject[], current: LayoutObject[]): { upserts: LayoutObject[]; deletes: string[] } {
  const before = new Map(saved.map((o) => [o.id, sig(o)]))
  const now = new Set(current.map((o) => o.id))
  return {
    upserts: current.filter((o) => before.get(o.id) !== sig(o)),
    deletes: saved.filter((o) => !now.has(o.id)).map((o) => o.id),
  }
}

/**
 * The object list the database will hold after a save — used server-side to
 * compute layouts.summary. Existing objects keep their stored scale (00211 pins
 * it); new ones take `newObjectPixelsPerMeter` (the sheet's current scale).
 */
export function applyObjectDelta(
  saved: LayoutObject[], upserts: LayoutObject[], deletes: string[], newObjectPixelsPerMeter: number | null,
): LayoutObject[] {
  const del = new Set(deletes)
  const up = new Map(upserts.map((o) => [o.id, o]))
  const out: LayoutObject[] = []
  for (const o of saved) {
    if (del.has(o.id)) continue
    const u = up.get(o.id)
    out.push(u ? ({ ...u, pixelsPerMeter: o.pixelsPerMeter } as LayoutObject) : o)
    up.delete(o.id)
  }
  for (const u of up.values()) out.push({ ...u, pixelsPerMeter: newObjectPixelsPerMeter } as LayoutObject)
  return out
}

/** Copy for Duplicate: new ids, every reference (roofId, inverterId, module arrayId) remapped. */
export function cloneLayoutObjects(objs: LayoutObject[], newId: () => string): LayoutObject[] {
  const ids = new Map(objs.map((o) => [o.id, newId()]))
  const map = (id: string) => ids.get(id) ?? id
  return objs.map((o): LayoutObject => {
    const id = map(o.id)
    if (isArrayObject(o)) return { ...o, id, props: { ...o.props, roofId: map(o.props.roofId) } }
    if (o.kind === 'string') {
      return { ...o, id, props: { ...o.props, inverterId: map(o.props.inverterId), modules: o.props.modules.map((m) => ({ arrayId: map(m.arrayId), index: m.index })) } }
    }
    return { ...o, id } as LayoutObject
  })
}
