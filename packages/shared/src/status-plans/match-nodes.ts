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
  | { state: 'ambiguous'; candidateIds: string[] }
  | { state: 'unmatched' }
  | { state: 'no_tag' }

// U+2010–U+2015 are the Unicode hyphens and dashes.
const STRIP = /[\s\-‐-―.]+/g

/** Uppercase; strip spaces, hyphens/dashes and dots; keep '/' and the rest. */
export function normaliseTag(s: string): string {
  return s.toUpperCase().replace(STRIP, '')
}

function normaliseName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

export interface NodeIndex {
  nodes: ReadonlyMap<string, MatchableNode>
  byCode: ReadonlyMap<string, readonly string[]>
  byShop: ReadonlyMap<string, readonly string[]>
  mainBoardByName: ReadonlyMap<string, readonly string[]>
}

function add(map: Map<string, string[]>, key: string, id: string) {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [id])
  else if (!list.includes(id)) list.push(id)
}

export function buildNodeIndex(nodes: readonly MatchableNode[]): NodeIndex {
  const byCode = new Map<string, string[]>()
  const byShop = new Map<string, string[]>()
  const mainBoardByName = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.code) add(byCode, normaliseTag(node.code), node.id)
    if (node.shop_number) add(byShop, normaliseTag(node.shop_number), node.id)
    if (node.kind === 'main_board' && node.name) add(mainBoardByName, normaliseTag(node.name), node.id)
  }
  return { nodes: new Map(nodes.map((x) => [x.id, x])), byCode, byShop, mainBoardByName }
}

function lookup(index: NodeIndex, key: string): { ids: string[]; via: MatchVia } {
  const code = index.byCode.get(key) ?? []
  const shop = index.byShop.get(key) ?? []
  const ids = [...new Set([...code, ...shop])]
  return { ids, via: code.length > 0 ? 'code' : 'shop_number' }
}

const MB_RE = /^MB[\s\-‐-―.]*(\d+(?:\.\d+)*)$/i

export function matchBlock(block: { tag: string | null; name: string | null }, index: NodeIndex): BlockMatch {
  const key = block.tag ? normaliseTag(block.tag) : ''
  if (!key) return { state: 'no_tag' }

  let found = lookup(index, key)
  if (found.ids.length === 0 && key.startsWith('DB') && key.length > 2) {
    found = { ids: lookup(index, key.slice(2)).ids, via: 'without_db' }
  }
  if (found.ids.length === 0) {
    const mb = MB_RE.exec(block.tag!.trim())
    if (mb) {
      const alias = normaliseTag(`MAIN BOARD ${mb[1]}`)
      const ids = [...new Set([...lookup(index, alias).ids, ...(index.mainBoardByName.get(alias) ?? [])])]
      found = { ids, via: 'main_board' }
    }
  }

  const { ids, via } = found
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
