import { ToolRefusal } from '../../define-tool'
import { BAD_IDENT } from './sentences'

// No aliases, casts, embeds, JSON paths or `*`, so a mask keyed on a column name cannot be routed around.
export const IDENT = /^[a-z_][a-z0-9_]*$/

export function assertIdent(name: unknown): string {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new ToolRefusal(BAD_IDENT)
  return name
}

export function assertIdents(names: readonly unknown[]): string[] {
  return names.map(assertIdent)
}
