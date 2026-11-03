// Reads the migration files and answers: which numeric columns of the exposed schemas are named like money?
// A static read of the DDL (no database), so the cost mask is derived from the schema, not retyped from intent.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXPOSED_SCHEMAS } from './exposed-schemas'

// Money words, matched as whole underscore-separated tokens. Wider than the spec's first list (rate … retention):
// the review found money in gross_to_date, net_change, stated_vat, commission_kobo, credit_limit and the like.
// A false positive (a net_area measurement) is cleared in allowlist.ts with a reason.
export const MASK_NAME = /^(.*_)?(rate|price|amount|value|total|cost|retention|gross|net|due|subtotal|vat|kobo|commission|fee|budget|limit|contingency|payout|margin|markup)(_.*)?$/
export const NUMERIC_TYPES = /^(numeric|decimal|integer|int|int2|int4|int8|bigint|smallint|real|float|float4|float8|double precision|money)\b/i

export type Candidate = { schema: string; table: string; column: string }
export type TableInfo = { hasProjectId: boolean }

const ID = '(?:"[^"]+"|[A-Za-z_][\\w$]*)'
const QNAME = `${ID}(?:\\s*\\.\\s*${ID})?`
const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase())
function qname(s: string): { schema: string; table: string } {
  const parts = s.split('.').map(p => unquote(p.trim()))
  return parts.length === 1 ? { schema: 'public', table: parts[0] } : { schema: parts[0], table: parts[1] }
}
const key = (q: { schema: string; table: string }) => `${q.schema}.${q.table}`

// Comments, dollar-quoted bodies and string literals hold semicolons and look-alike statements; blank them.
function clean(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
}

// Split at commas that are not inside parentheses (numeric(12,2), CHECK (a, b)).
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(x => x.trim()).filter(Boolean)
}

// The text between the paren at `open` and its match.
function balanced(s: string, open: number): string | null {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0) return s.slice(open + 1, i)
  }
  return null
}

const NOT_A_COLUMN = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i
const COLUMN = new RegExp(`^(${ID})\\s+([\\s\\S]+)$`)

type Cols = Map<string, string>

function addColumn(cols: Cols, def: string) {
  const m = COLUMN.exec(def.trim())
  if (m) cols.set(unquote(m[1]), m[2].trim())
}

function alterAction(state: Map<string, Cols>, at: string, action: string): string {
  const cols = state.get(at)
  if (!cols) return at
  let m: RegExpExecArray | null
  if ((m = new RegExp(`^rename\\s+to\\s+(${ID})$`, 'i').exec(action))) {
    const next = { schema: at.split('.')[0], table: unquote(m[1]) }
    state.delete(at); state.set(key(next), cols)
    return key(next)
  }
  if ((m = new RegExp(`^rename\\s+(?:column\\s+)?(${ID})\\s+to\\s+(${ID})$`, 'i').exec(action))) {
    const from = unquote(m[1]); const type = cols.get(from)
    if (type !== undefined) { cols.delete(from); cols.set(unquote(m[2]), type) }
  } else if ((m = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]+)$/i.exec(action)) && (/^add\s+column\b/i.test(action) || !NOT_A_COLUMN.test(m[1]))) {
    addColumn(cols, m[1])
  } else if ((m = new RegExp(`^drop\\s+column\\s+(?:if\\s+exists\\s+)?(${ID})`, 'i').exec(action))) {
    cols.delete(unquote(m[1]))
  } else if ((m = new RegExp(`^alter\\s+(?:column\\s+)?(${ID})\\s+(?:set\\s+data\\s+)?type\\s+([\\s\\S]+)$`, 'i').exec(action))) {
    cols.set(unquote(m[1]), m[2].trim())
  }
  return at
}

// Replays every migration in name order and returns the resulting columns of each table: name -> declared type.
function replay(dir: string): Map<string, Cols> {
  const state = new Map<string, Cols>()
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    for (const raw of clean(readFileSync(join(dir, f), 'utf8')).split(';')) {
      const st = raw.trim()
      let m: RegExpExecArray | null
      if ((m = new RegExp(`^create\\s+(?:unlogged\\s+)?table\\s+(if\\s+not\\s+exists\\s+)?(${QNAME})\\s*\\(`, 'i').exec(st))) {
        const q = qname(m[2])
        if (m[1] && state.has(key(q))) continue
        const body = balanced(st, m[0].length - 1)
        const cols: Cols = new Map()
        for (const item of splitTop(body ?? '')) if (!NOT_A_COLUMN.test(item)) addColumn(cols, item)
        state.set(key(q), cols)
      } else if ((m = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QNAME})\\s+([\\s\\S]+)$`, 'i').exec(st))) {
        let k = key(qname(m[1]))
        for (const action of splitTop(m[2])) k = alterAction(state, k, action)
      } else if ((m = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?view\\s+(${QNAME})\\s+(?:with\\s*\\([^)]*\\)\\s*)?as\\s+select\\s+(?:${ID}\\s*\\.\\s*)?\\*\\s+from\\s+(${QNAME})(?=\\s|$)`, 'i').exec(st))) {
        // A view that passes every column of one table through (SELECT o.* FROM t o) exposes the same columns.
        const source = state.get(key(qname(m[2])))
        if (source) state.set(key(qname(m[1])), new Map(source))
      } else if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i.exec(st))) {
        for (const t of splitTop(m[1])) state.delete(key(qname(t)))
      }
    }
  }

  return state
}

const exposed = new Set<string>(EXPOSED_SCHEMAS)

export function readMigrations(dir: string): { candidates: Candidate[]; tables: Record<string, TableInfo> } {
  const state = replay(dir)
  const candidates: Candidate[] = []
  const tables: Record<string, TableInfo> = {}
  for (const k of [...state.keys()].sort()) {
    const [schema, table] = k.split('.')
    if (!exposed.has(schema)) continue
    const cols = state.get(k)!
    tables[k] = { hasProjectId: cols.has('project_id') }
    for (const column of [...cols.keys()].sort()) {
      if (MASK_NAME.test(column) && NUMERIC_TYPES.test(cols.get(column)!)) candidates.push({ schema, table, column })
    }
  }
  return { candidates, tables }
}

/** Every numeric column of the exposed schemas, whatever its name: the survey behind the name pattern. */
export function allNumericColumns(dir: string): Array<Candidate & { type: string }> {
  const state = replay(dir)
  const out: Array<Candidate & { type: string }> = []
  for (const k of [...state.keys()].sort()) {
    const [schema, table] = k.split('.')
    if (!exposed.has(schema)) continue
    const cols = state.get(k)!
    for (const column of [...cols.keys()].sort()) {
      const type = cols.get(column)!
      if (NUMERIC_TYPES.test(type)) out.push({ schema, table, column, type: type.split(/\s+/).slice(0, 2).join(' ') })
    }
  }
  return out
}
