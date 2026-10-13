/**
 * Matching a detected block's tag to a project node (spec §5).
 *
 * Exactly one candidate links; zero or several need a person. The block's
 * NAME may break a tie between several tag candidates, and never links on its
 * own: two shops can share a name, a board cannot share a tag.
 *
 * Order of passes (the first that finds anything decides):
 *   1. exact — dots and leading zeros kept (DB-2.1 ≠ DB-21, DB-01 ≠ DB-1);
 *   2. zeros — every run of digits loses its leading zeros (DB-01 → DB1,
 *      DB-02A → DB2A, MB-01.1 → MB1.1). One candidate links; several need a
 *      person with nothing preselected (both DB-1 and DB-01 exist);
 *   3. dots-only — dots ignored as well; any hit needs a person.
 *
 * A NO: value may carry words after its tag ("MB-1.1 LOCAL MAIN",
 * "MB-1.1 BULK CHECK METER", "MB-1.4 INCOMMING GEN"): parseNoText splits
 * them. The board itself matches as its tag; a meter or incomer is part of
 * that board, never a separate one, and is reported as part_of.
 *
 * MB-x.y also reads as MAIN BOARD x.y against ANY node kind's code or name
 * ("MAIN BOARD 1.1", "MAINBOARD 1.2", "MB 1.1"): main boards are often entered
 * as another kind (rmu) during data entry.
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

export type PartRole = 'meter' | 'incomer'
export type NoRole = 'board' | PartRole

export type BlockMatch =
  | {
      state: 'matched'; nodeId: string; via: MatchVia; tieBrokenByName: boolean
      /** Present (true) only when the board matched once leading zeros were ignored. */
      leadingZeros?: true
    }
  | {
      state: 'ambiguous'; candidateIds: string[]
      /** Matched only after dots were ignored (DB-2.1 vs DB-21). */ dotsOnly?: boolean
      /** Several boards matched only once leading zeros were ignored. */ zerosOnly?: true
    }
  | { state: 'unmatched' }
  | { state: 'no_tag' }
  /** A meter or incomer inside the board `tag` ("MB-1.1 BULK CHECK METER"). */
  | { state: 'part_of'; tag: string; role: PartRole }

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

/** Every run of digits loses its leading zeros (a lone 0 stays): DB01 → DB1, MB01.01 → MB1.1. */
export function stripLeadingZeros(s: string): string {
  return s.replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ''))
}

const zeroExact = (s: string) => stripLeadingZeros(exactTag(s))
const zeroLoose = (s: string) => stripLeadingZeros(normaliseTag(s))

function normaliseName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

interface KeyMaps {
  byCode: ReadonlyMap<string, readonly string[]>
  byShop: ReadonlyMap<string, readonly string[]>
  /** Every node's name, any kind — read ONLY by the MB-x.y alias. */
  byName: ReadonlyMap<string, readonly string[]>
}

export interface NodeIndex {
  nodes: ReadonlyMap<string, MatchableNode>
  /** Keyed with dots and leading zeros kept (primary). */
  exact: KeyMaps
  /** Dots kept, leading zeros stripped (one hit links; several need a person). */
  zeros: KeyMaps
  /** Keyed with dots stripped (fallback; a hit there needs a person). */
  loose: KeyMaps
  /** Dots and leading zeros stripped (fallback; a hit there needs a person). */
  looseZeros: KeyMaps
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
  const byName = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.code) add(byCode, norm(node.code), node.id)
    if (node.shop_number) add(byShop, norm(node.shop_number), node.id)
    if (node.name) add(byName, norm(node.name), node.id)
  }
  return { byCode, byShop, byName }
}

export function buildNodeIndex(nodes: readonly MatchableNode[]): NodeIndex {
  return {
    nodes: new Map(nodes.map((x) => [x.id, x])),
    exact: buildMaps(nodes, exactTag),
    zeros: buildMaps(nodes, zeroExact),
    loose: buildMaps(nodes, normaliseTag),
    looseZeros: buildMaps(nodes, zeroLoose),
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

const ROLE_WORD_RE = /^[A-Z][A-Z'&/()]*$/
const METER_WORD_RE = /^(METER|METERS|CHECK)$/
/** INCOMING and its usual misspellings (INCOMMING, INCOMNG), and INCOMER. */
const INCOMER_WORD_RE = /^(INC?OM+I?N+G|INCOM+ER)$/

function roleOf(words: readonly string[]): NoRole {
  if (words.some((w) => METER_WORD_RE.test(w))) return 'meter'
  if (words.some((w) => INCOMER_WORD_RE.test(w))) return 'incomer'
  // LOCAL MAIN, MAIN, or anything else names the board itself.
  return 'board'
}

/**
 * A NO: value as {tag, role}: a lone tag is the board; a leading tag-shaped
 * token followed by words ("MB-1.1 LOCAL MAIN", "MB-1.1 BULK CHECK METER",
 * "MB-1.4 INCOMMING GEN") is split, the words read as the role. Text with no
 * leading tag ("GENERATOR 2.1 INCOMING") or with non-words after it → null.
 */
export function parseNoText(text: string | null): { tag: string; role: NoRole } | null {
  const t = (text ?? '').trim()
  if (!t) return null
  if (isTagShaped(t)) return { tag: t, role: 'board' }
  const [head, ...rest] = t.split(/\s+/)
  if (!head || rest.length === 0 || !isTagShaped(head)) return null
  const words = rest.map((w) => w.toUpperCase())
  if (!words.every((w) => ROLE_WORD_RE.test(w))) return null
  return { tag: head, role: roleOf(words) }
}

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
      // Any node kind: main boards are often entered as rmu during data entry.
      const alias = norm(`MAIN BOARD ${mb[1]}`)
      const short = norm(`MB ${mb[1]}`)
      const ids = [...new Set([
        ...lookup(maps, alias).ids,
        ...(maps.byName.get(alias) ?? []),
        ...(maps.byName.get(short) ?? []),
      ])]
      found = { ids, via: 'main_board' }
    }
  }
  return found
}

export function matchBlock(block: { tag: string | null; name: string | null }, index: NodeIndex): BlockMatch {
  const parsed = parseNoText(block.tag)
  if (!parsed || !normaliseTag(parsed.tag)) return { state: 'no_tag' }
  if (parsed.role !== 'board') return { state: 'part_of', tag: parsed.tag, role: parsed.role }
  const tag = parsed.tag

  let { ids, via } = resolve(index.exact, exactTag, tag)
  if (ids.length === 0) {
    // Only a match once leading zeros are ignored (DB-01 vs DB-1).
    const z = resolve(index.zeros, zeroExact, tag)
    if (z.ids.length === 1) return { state: 'matched', nodeId: z.ids[0]!, via: z.via, tieBrokenByName: false, leadingZeros: true }
    if (z.ids.length > 1) return { state: 'ambiguous', candidateIds: z.ids, zerosOnly: true }
    // Only a match once dots are ignored (DB-2.1 vs DB-21): a person decides.
    let loose = resolve(index.loose, normaliseTag, tag)
    if (loose.ids.length === 0) loose = resolve(index.looseZeros, zeroLoose, tag)
    if (loose.ids.length > 0) return { state: 'ambiguous', candidateIds: loose.ids, dotsOnly: true }
  }
  if (ids.length === 0) return { state: 'unmatched' }
  if (ids.length === 1) return { state: 'matched', nodeId: ids[0]!, via, tieBrokenByName: false }

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
