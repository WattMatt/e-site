/**
 * Matching a detected block's tag to a project node (spec §5).
 *
 * Exactly one candidate links; zero or several need a person. The block's
 * NAME may break a tie between several tag candidates, and never links on its
 * own: two shops can share a name, a board cannot share a tag.
 */

export interface MatchableNode {
  id: string
  code: string | null
  shop_number: string | null
  /** Tenant nodes: shop_name; other boards: name. */
  name: string | null
  kind: string
}

export type MatchVia = 'code' | 'shop_number' | 'without_db' | 'main_board'

export type BlockMatch =
  | { state: 'matched'; nodeId: string; via: MatchVia; tieBrokenByName: boolean }
  | { state: 'ambiguous'; candidateIds: string[]; /** Matched only after dots were ignored (DB-2.1 vs DB-21). */ dotsOnly?: boolean }
  | { state: 'unmatched' }
  | { state: 'no_tag' }

// U+2010–U+2015 are the Unicode hyphens and dashes.
const STRIP = /[\s\-‐-―.]+/g
const STRIP_KEEP_DOTS = /[\s\-‐-―]+/g

/** Uppercase; strip spaces, hyphens/dashes and dots; keep '/' and the rest. */
export function normaliseTag(s: string): string {
  return s.toUpperCase().replace(STRIP, '')
}

/** Like normaliseTag but keeps dots, so DB-2.1 and DB-21 stay different. */
export function exactTag(s: string): string {
  return s.toUpperCase().replace(STRIP_KEEP_DOTS, '')
}

function normaliseName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

interface KeyMaps {
  byCode: ReadonlyMap<string, readonly string[]>
  byShop: ReadonlyMap<string, readonly string[]>
  mainBoardByName: ReadonlyMap<string, readonly string[]>
}

export interface NodeIndex {
  nodes: ReadonlyMap<string, MatchableNode>
  /** Keyed with dots kept (primary). */
  exact: KeyMaps
  /** Keyed with dots stripped (fallback; a hit there needs a person). */
  loose: KeyMaps
}

function add(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [id])
  else if (!list.includes(id)) list.push(id)
}

function buildMaps(nodes: readonly MatchableNode[], norm: (s: string) => string): KeyMaps {
  const byCode = new Map<string, string[]>()
  const byShop = new Map<string, string[]>()
  const mainBoardByName = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.code) add(byCode, norm(node.code), node.id)
    if (node.shop_number) add(byShop, norm(node.shop_number), node.id)
    if (node.kind === 'main_board' && node.name) add(mainBoardByName, norm(node.name), node.id)
  }
  return { byCode, byShop, mainBoardByName }
}

export function buildNodeIndex(nodes: readonly MatchableNode[]): NodeIndex {
  return {
    nodes: new Map(nodes.map((x) => [x.id, x])),
    exact: buildMaps(nodes, exactTag),
    loose: buildMaps(nodes, normaliseTag),
  }
}

function lookup(maps: KeyMaps, key: string): { ids: string[]; via: MatchVia } {
  const code = maps.byCode.get(key) ?? []
  const shop = maps.byShop.get(key) ?? []
  const ids = [...new Set([...code, ...shop])]
  return { ids, via: code.length > 0 ? 'code' : 'shop_number' }
}

const KIOSK_RE = /^KIOSK\s*0*(\d{1,3})$/i
const CODE_SHAPE_RE = /^[A-Z]{2,4}-[A-Z0-9]+$/
/** 'DB 72', 'MB 3.1': a short alpha prefix, one optional space, then the rest. */
const SPACED_TAG_RE = /^[A-Z]{1,5}\s[-A-Z0-9./]+$/

/**
 * Whether a NO: value is a board tag rather than a sentence: one token (or a short
 * alpha prefix, one space, then the rest: 'DB 72') of at
 * most 16 characters that carries a digit or reads like PREFIX-SUFFIX
 * (DB-05, DB-20/21, DB-K07, MB-3.1, DB-CM). "KIOSK n" is the one two-word tag.
 */
export function isTagShaped(text: string | null): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (KIOSK_RE.test(t)) return true
  if (Array.from(t).length > 16) return false
  if (/\s/.test(t)) return SPACED_TAG_RE.test(t.toUpperCase())
  return /\d/.test(t) || CODE_SHAPE_RE.test(t.toUpperCase())
}

const MB_RE = /^MB[\s\-‐-―.]*(\d+(?:\.\d+)*)$/i

function resolve(maps: KeyMaps, norm: (s: string) => string, tag: string): { ids: string[]; via: MatchVia } {
  const key = norm(tag)
  let found = lookup(maps, key)
  const kiosk = KIOSK_RE.exec(tag.trim())
  if (found.ids.length === 0 && kiosk) {
    const n = String(Number(kiosk[1]))
    const ids = [...new Set([...lookup(maps, norm(`DB-K${n.padStart(2, '0')}`)).ids, ...lookup(maps, norm(`DB-K${n}`)).ids])]
    found = { ids, via: 'code' }
  }
  if (found.ids.length === 0 && key.startsWith('DB') && key.length > 2) {
    found = { ids: lookup(maps, key.slice(2)).ids, via: 'without_db' }
  }
  if (found.ids.length === 0) {
    const mb = MB_RE.exec(tag.trim())
    if (mb) {
      const alias = norm(`MAIN BOARD ${mb[1]}`)
      const ids = [...new Set([...lookup(maps, alias).ids, ...(maps.mainBoardByName.get(alias) ?? [])])]
      found = { ids, via: 'main_board' }
    }
  }
  return found
}

export function matchBlock(block: { tag: string | null; name: string | null }, index: NodeIndex): BlockMatch {
  if (!block.tag || !isTagShaped(block.tag) || !normaliseTag(block.tag)) return { state: 'no_tag' }

  let { ids, via } = resolve(index.exact, exactTag, block.tag)
  if (ids.length === 0) {
    // Only a match once dots are ignored (DB-2.1 vs DB-21): a person decides.
    const loose = resolve(index.loose, normaliseTag, block.tag)
    if (loose.ids.length > 0) return { state: 'ambiguous', candidateIds: loose.ids, dotsOnly: true }
  }
  if (ids.length === 0) return { state: 'unmatched' }
  if (ids.length === 1) return { state: 'matched', nodeId: ids[0], via, tieBrokenByName: false }

  const wanted = block.name ? normaliseName(block.name) : ''
  if (wanted) {
    const hits = ids.filter((id) => {
      const nm = index.nodes.get(id)?.name
      return !!nm && normaliseName(nm) === wanted
    })
    if (hits.length === 1) return { state: 'matched', nodeId: hits[0], via, tieBrokenByName: true }
  }
  return { state: 'ambiguous', candidateIds: ids }
}
