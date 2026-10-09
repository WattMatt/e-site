/**
 * A refusal on the bulk accept of detected blocks, as a sentence.
 *
 * The accept is ONE insert statement, so a refusal means nothing was added;
 * every sentence says so. The per-cause wording is slice 2's
 * statusPlanWriteError — only the duplicate-board case is reworded, because in
 * a batch "that board" does not say which, and the remedy is to re-run
 * detection (which leaves out blocks already on the plan).
 */
import { statusPlanWriteError, type PgErrorLike } from './write-errors'

const STALE_LIST = 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.'

export function acceptErrorSentence(err: PgErrorLike): string {
  if (err.code === '23505') return STALE_LIST
  return `${statusPlanWriteError(err, 'shape')} Nothing was added; run detection again.`
}
