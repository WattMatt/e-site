// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The status ledger has two halves that must not drift: a CHECK constraint in
 * migration 00188 and the string literals the Deno sender writes. They live in
 * different languages, in different deploy pipelines — the migration ships on
 * merge, the edge function is CLI-deployed and is not in
 * deploy-edge-functions.yml — so nothing else in the build makes them agree.
 *
 * The precedent is exact: the snag module shipped `photo_type:'defect'`, a
 * value the CHECK never allowed, and every insert failed AFTER its storage
 * upload for months. The contract test that caught it parses the CHECK set out
 * of the migration rather than restating it, and so does this one.
 *
 * apps/web/src/lib/email -> five levels up is the repo root.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

const MIGRATION = readFileSync(
  resolve(ROOT, 'apps/edge-functions/supabase/migrations/00188_email_sequence_send_status.sql'),
  'utf8',
)
const SENDER = readFileSync(
  resolve(ROOT, 'apps/edge-functions/supabase/functions/_shared/email-sequence.ts'),
  'utf8',
)

/** The CHECK set, read out of the migration. */
function checkedStatuses(): string[] {
  const m = MIGRATION.match(/CHECK\s*\(status\s+IN\s*\(([^)]*)\)\)/i)
  if (!m) throw new Error('00188 declares no CHECK on status')
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

/** The SendRowStatus union, read out of the sender. */
function declaredStatuses(): string[] {
  const m = SENDER.match(/export type SendRowStatus\s*=\s*([^\n]+)/)
  if (!m) throw new Error('email-sequence.ts declares no SendRowStatus')
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

/**
 * Every `status: '…'` the sender actually writes to the TABLE.
 *
 * Deliberately not a blanket scan for `status:` — SendResult uses the same key
 * for its return discriminant ('skipped_opt_out' and friends), which is a
 * different vocabulary that the CHECK must not contain. So this walks only the
 * object literals handed to .insert(), .update() and stampOutcome().
 */
function writtenStatuses(): string[] {
  const out: string[] = []
  const sites = /(?:\.insert\(|\.update\(|stampOutcome\([^,]+,[^,]+,\s*)\{/g
  for (const m of SENDER.matchAll(sites)) {
    const open = m.index! + m[0].length - 1
    let depth = 0
    let end = open
    for (let i = open; i < SENDER.length; i++) {
      if (SENDER[i] === '{') depth++
      else if (SENDER[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const payload = SENDER.slice(open, end + 1)
    for (const s of payload.matchAll(/status:\s*'([^']+)'/g)) out.push(s[1])
  }
  return out
}

describe('email_sequence_events.status: code and CHECK agree', () => {
  it('the parsers found something — none of this is vacuous', () => {
    expect(checkedStatuses().length).toBe(4)
    expect(declaredStatuses().length).toBe(4)
    // pending (insert), pending (retry claim), failed, sent, send_id_unrecorded
    expect(writtenStatuses().length).toBeGreaterThanOrEqual(5)
    // and the return-value vocabulary must NOT have leaked in
    expect(writtenStatuses()).not.toContain('skipped_opt_out')
  })

  it('every status the sender writes is allowed by the CHECK', () => {
    const allowed = new Set(checkedStatuses())
    for (const written of new Set(writtenStatuses())) {
      expect(allowed.has(written), `sender writes '${written}', CHECK forbids it`).toBe(true)
    }
  })

  it('the CHECK and the SendRowStatus union are the same set', () => {
    expect([...checkedStatuses()].sort()).toEqual([...declaredStatuses()].sort())
  })

  it("the column DEFAULT is 'pending' — the state that is never retried", () => {
    // This is what a row inserted by the not-yet-deployed old code gets. It has
    // to be the state the retry gate refuses, or applying the migration before
    // deploying the functions would arm a double-send.
    expect(MIGRATION).toMatch(/ALTER COLUMN status\s+SET DEFAULT 'pending'/)
    expect(SENDER).toMatch(/row\.status !== 'failed'/)
  })

  it('backfills before it makes the column NOT NULL', () => {
    // Reversed, the ALTER fails outright on 246 existing rows and the whole
    // migration aborts — recoverable, but only after a failed deploy.
    const firstBackfill = MIGRATION.indexOf("SET status         = 'sent'")
    const notNull       = MIGRATION.search(/ALTER COLUMN status\s+SET NOT NULL/)
    expect(firstBackfill).toBeGreaterThan(-1)
    expect(notNull).toBeGreaterThan(-1)
    expect(firstBackfill).toBeLessThan(notNull)
  })

  it('classifies all three shapes of legacy row', () => {
    // 246 rows exist. 11 have a NULL message id; the empty-string case is
    // reachable because resendSend() returns `data.id ?? ''`.
    expect(MIGRATION).toMatch(/resend_message_id IS NOT NULL/)
    expect(MIGRATION).toMatch(/resend_message_id = ''/)
    expect(MIGRATION).toMatch(/resend_message_id IS NULL/)
  })
})
