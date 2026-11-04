import { ToolRefusal } from '../../define-tool'
import * as sentences from './sentences'

export type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null

const KNOWN = new Set<string>(Object.values(sentences))

/** A database error from the person's own client is shown as PostgREST shows it to them over REST. */
export function refuseOnDbError(error: DbError): void {
  if (!error) return
  const message = error.message ?? ''
  if (KNOWN.has(message)) throw new ToolRefusal(message)
  let text = `Database error ${error.code ?? 'unknown'}: ${message}`
  if (error.details) text += ` — ${error.details}`
  if (error.hint) text += ` (${error.hint})`
  throw new ToolRefusal(text)
}
