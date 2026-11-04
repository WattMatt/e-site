import { z } from 'zod'
import { ToolRefusal } from '../../define-tool'
import { assertIdent } from './identifiers'
import { UNKNOWN_OP } from './sentences'

export const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is', 'cs', 'cd', 'ov', 'fts', 'not.eq', 'not.in', 'not.is'] as const

export const filterSchema = z.object({ column: z.string(), op: z.string(), value: z.unknown() })
export type Filter = z.infer<typeof filterSchema>

/** The PostgrestFilterBuilder methods used here; the real builder and the test fake both satisfy it. */
export interface FilterableQuery {
  eq(column: string, value: unknown): this
  neq(column: string, value: unknown): this
  gt(column: string, value: unknown): this
  gte(column: string, value: unknown): this
  lt(column: string, value: unknown): this
  lte(column: string, value: unknown): this
  like(column: string, pattern: string): this
  ilike(column: string, pattern: string): this
  in(column: string, values: readonly unknown[]): this
  is(column: string, value: null | boolean): this
  contains(column: string, value: unknown): this
  containedBy(column: string, value: unknown): this
  overlaps(column: string, value: unknown): this
  textSearch(column: string, query: string): this
  not(column: string, operator: string, value: unknown): this
}

const bad = () => new ToolRefusal(UNKNOWN_OP)
const asArray = (v: unknown): readonly unknown[] => { if (!Array.isArray(v)) throw bad(); return v }
// Same rule as supabase-js `in` (it quotes values with , ( )), widened to the other characters that
// break a PostgREST list; embedded " and backslash are escaped so a quoted value cannot end early.
const needsQuote = /[,()"':\s]/
const listItem = (v: unknown): string => {
  const t = String(v)
  return typeof v === 'string' && needsQuote.test(t) ? `"${t.replace(/[\\"]/g, '\\$&')}"` : t
}
const asIs = (v: unknown): null | boolean => { if (v !== null && typeof v !== 'boolean') throw bad(); return v }

export function applyFilters<Q extends FilterableQuery>(query: Q, filters: Filter[]): Q {
  let q: Q = query
  for (const { column, op, value } of filters) {
    const c = assertIdent(column)
    switch (op) {
      case 'eq': q = q.eq(c, value); break
      case 'neq': q = q.neq(c, value); break
      case 'gt': q = q.gt(c, value); break
      case 'gte': q = q.gte(c, value); break
      case 'lt': q = q.lt(c, value); break
      case 'lte': q = q.lte(c, value); break
      case 'like': q = q.like(c, value as string); break
      case 'ilike': q = q.ilike(c, value as string); break
      case 'in': q = q.in(c, asArray(value)); break
      case 'is': q = q.is(c, asIs(value)); break
      case 'cs': q = q.contains(c, value); break
      case 'cd': q = q.containedBy(c, value); break
      case 'ov': q = q.overlaps(c, value); break
      case 'fts': q = q.textSearch(c, String(value)); break
      case 'not.eq': q = q.not(c, 'eq', value); break
      case 'not.in': q = q.not(c, 'in', `(${asArray(value).map(listItem).join(',')})`); break
      case 'not.is': q = q.not(c, 'is', value); break
      default: throw bad()
    }
  }
  return q
}

export function filterColumns(filters: Filter[]): string[] {
  return filters.map(f => assertIdent(f.column))
}
