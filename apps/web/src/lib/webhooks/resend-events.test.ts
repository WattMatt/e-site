// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mapResendEvent,
  suppressionFor,
  sequenceTimestampFor,
  RESEND_EVENT_TYPES,
} from './resend-events'

const base = (type: string, data: Record<string, unknown> = {}) => ({
  type,
  created_at: '2026-09-10T06:00:00.000Z',
  data: {
    email_id: 'ab12cd34-0000-0000-0000-000000000001',
    to: ['Site.Foreman@AEEC.co.za'],
    from: 'E-Site <noreply@e-site.live>',
    subject: 'Your open items',
    created_at: '2026-09-10T05:59:00.000Z',
    ...data,
  },
})

const PROJECT = '11111111-2222-3333-4444-555555555555'

describe('mapResendEvent', () => {
  it('maps a delivered event onto a row', () => {
    expect(mapResendEvent('msg_1', base('email.delivered'))).toEqual({
      webhook_id: 'msg_1',
      resend_message_id: 'ab12cd34-0000-0000-0000-000000000001',
      event_type: 'email.delivered',
      occurred_at: '2026-09-10T06:00:00.000Z',
      to_email: 'site.foreman@aeec.co.za',
      subject: 'Your open items',
      bounce_type: null,
      project_id: null,
      entity_ref: null,
      source: 'webhook',
      payload: base('email.delivered'),
    })
  })

  it('lower-cases the recipient — the RLS policy and the suppression list key on it', () => {
    expect(mapResendEvent('msg_1', base('email.sent'))?.to_email).toBe('site.foreman@aeec.co.za')
  })

  // Added after the mutation sweep: deleting `.trim()` left all 21 planned
  // tests green. A recipient stored as ' a@x.co.za ' never matches the
  // suppression-list key or the RLS join on lower(profiles.email), and it
  // fails silently in both places.
  it('trims the recipient — a padded address matches neither the RLS join nor the suppression key', () => {
    const row = mapResendEvent('msg_1', base('email.sent', { to: ['  Site.Foreman@AEEC.co.za  '] }))
    expect(row?.to_email).toBe('site.foreman@aeec.co.za')
  })

  it('keeps the first recipient and preserves the whole array in payload', () => {
    const row = mapResendEvent('msg_1', base('email.sent', { to: ['a@x.co.za', 'b@x.co.za'] }))
    expect(row?.to_email).toBe('a@x.co.za')
    expect((row?.payload as any).data.to).toEqual(['a@x.co.za', 'b@x.co.za'])
  })

  it('extracts the bounce classification', () => {
    const row = mapResendEvent('msg_1', base('email.bounced', {
      bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
    }))
    expect(row?.bounce_type).toBe('Permanent')
  })

  it('handles email.failed — a send that never left', () => {
    const row = mapResendEvent('msg_1', base('email.failed', {
      failed: { reason: 'Recipient domain does not accept mail' },
    }))
    expect(row?.event_type).toBe('email.failed')
    expect(row?.bounce_type).toBeNull()
  })

  it('returns null for an event type we do not handle', () => {
    expect(mapResendEvent('msg_1', base('contact.created'))).toBeNull()
  })

  it('returns null for a payload with no type', () => {
    expect(mapResendEvent('msg_1', { data: {} })).toBeNull()
  })

  it('falls back to the data timestamp when the envelope has none', () => {
    const payload: any = base('email.opened')
    delete payload.created_at
    expect(mapResendEvent('msg_1', payload)?.occurred_at).toBe('2026-09-10T05:59:00.000Z')
  })
})

/**
 * occurred_at is the one output column with no other gate. event_type and
 * source are pinned by the CHECK contract at the bottom of this file,
 * project_id by UUID_RE, to_email by the suppression guard — occurred_at went
 * from the payload straight into TIMESTAMPTZ NOT NULL (00185:56) on the
 * strength of `typeof === 'string'` alone.
 */
describe('mapResendEvent occurred_at', () => {
  const at = (payload: unknown) => mapResendEvent('msg_1', payload)!.occurred_at

  it('drops an unparseable created_at rather than poisoning a timestamptz column', () => {
    // 22007 invalid input syntax for type timestamp with time zone -> 500 ->
    // Svix retries that same svix-id forever. Verbatim the failure the
    // project_id guard three lines above it exists to prevent.
    const p: any = base('email.delivered')
    p.created_at = 'yesterday afternoon'
    delete p.data.created_at
    expect(Number.isNaN(Date.parse(at(p)))).toBe(false)
  })

  it('falls back to the data timestamp when the envelope timestamp is garbage', () => {
    const p: any = base('email.delivered')
    p.created_at = 'yesterday afternoon'
    expect(at(p)).toBe('2026-09-10T05:59:00.000Z')
  })

  it('rejects the literals Postgres ACCEPTS — the silent half, which nothing errors on', () => {
    // Postgres reads every one of these as a real timestamptz, so an
    // unvalidated string inserts cleanly and is wrong forever: 'infinity'
    // sorts first in email_events_to_email_idx (to_email, occurred_at DESC)
    // and breaks every weekly bucket, with no error anywhere. Date.parse
    // returns NaN for all of them, which is what makes one check enough — the
    // first assertion pins that premise so a Date.parse change fails loudly
    // here rather than silently reopening the hole.
    for (const literal of ['infinity', '-infinity', 'now', 'today', 'yesterday', 'epoch']) {
      expect(Number.isNaN(Date.parse(literal))).toBe(true)
      const p: any = base('email.delivered')
      p.created_at = literal
      delete p.data.created_at
      expect(at(p)).not.toBe(literal)
      expect(Number.isNaN(Date.parse(at(p)))).toBe(false)
    }
  })

  it('stamps a real now() when the payload carries no timestamp at all', () => {
    const p: any = base('email.sent')
    delete p.created_at
    delete p.data.created_at
    expect(at(p)).not.toBe('')
    expect(Number.isNaN(Date.parse(at(p)))).toBe(false)
  })

  it('rejects a non-string and an empty-string created_at', () => {
    const p: any = base('email.sent')
    p.created_at = 1788998400000
    p.data.created_at = ''
    expect(at(p)).not.toBe('')
    expect(Number.isNaN(Date.parse(at(p)))).toBe(false)
  })
})

/**
 * The defensive guards. Each of these mutates to something that leaves every
 * other test in this file green, so each needs its own killer: a guard whose
 * test passes with the guard removed is decorative.
 */
describe('mapResendEvent guards', () => {
  it('never throws on a hostile payload shape', () => {
    // A throw is a 500, and Svix retries a 5xx with the same svix-id forever.
    // null/undefined pin the `!evt` guard; the type-only object pins the
    // `evt.data ?? {}` default, without which `data.to` throws.
    for (const payload of [null, undefined, 42, 'x', [], { type: 'email.delivered' }]) {
      expect(() => mapResendEvent('msg_1', payload)).not.toThrow()
    }
    expect(mapResendEvent('msg_1', null)).toBeNull()
    expect(mapResendEvent('msg_1', undefined)).toBeNull()
  })

  it('maps a handled event carrying no data object onto a well-formed row', () => {
    const row = mapResendEvent('msg_1', { type: 'email.delivered' })!
    expect(row.event_type).toBe('email.delivered')
    expect(row.to_email).toBeNull()
    expect(row.subject).toBeNull()
    expect(row.resend_message_id).toBeNull()
    expect(row.project_id).toBeNull()
    expect(row.entity_ref).toBeNull()
    expect(Number.isNaN(Date.parse(row.occurred_at))).toBe(false)
  })

  it('nulls a non-string subject and email_id instead of handing them to TEXT columns', () => {
    const row = mapResendEvent('msg_1', base('email.delivered', {
      subject: { html: '<b>Your open items</b>' },
      email_id: 12345,
    }))!
    expect(row.subject).toBeNull()
    expect(row.resend_message_id).toBeNull()
  })

  it('drops non-string tag values in both encodings', () => {
    const arrayForm = mapResendEvent('msg_1', base('email.delivered', {
      tags: [{ name: 'kind', value: 42 }, { name: 'project_id', value: PROJECT }],
    }))!
    expect(arrayForm.entity_ref).toBeNull()
    expect(arrayForm.project_id).toBe(PROJECT)

    const objectForm = mapResendEvent('msg_1', base('email.delivered', {
      tags: { kind: ['rfi'], project_id: PROJECT },
    }))!
    expect(objectForm.entity_ref).toBeNull()
    expect(objectForm.project_id).toBe(PROJECT)
  })

  it("returns null rather than '' for an all-whitespace recipient", () => {
    // '' matches nothing in the RLS policy's lower(p.email) = to_email join
    // (00185:182), so the row would be invisible to every human.
    expect(mapResendEvent('msg_1', base('email.sent', { to: ['   '] }))?.to_email).toBeNull()
  })
})

describe('mapResendEvent tags', () => {
  it('reads the array-of-{name,value} encoding the Resend SDK sends', () => {
    const row = mapResendEvent('msg_1', base('email.delivered', {
      tags: [
        { name: 'kind', value: 'rfi' },
        { name: 'project_id', value: PROJECT },
        { name: 'entity_id', value: 'rfi-0042' },
      ],
    }))
    expect(row?.project_id).toBe(PROJECT)
    expect(row?.entity_ref).toBe('rfi:rfi-0042')
  })

  it('reads the plain-object encoding some payloads come back as', () => {
    const row = mapResendEvent('msg_1', base('email.delivered', {
      tags: { kind: 'recap', project_id: PROJECT },
    }))
    expect(row?.project_id).toBe(PROJECT)
    expect(row?.entity_ref).toBe('recap')  // no entity_id — kind alone
  })

  it('drops a non-UUID project_id instead of poisoning a uuid column', () => {
    // A 22P02 on insert would 500 the route, and Svix would retry that
    // request forever. Dropping the tag is the only safe behaviour.
    const row = mapResendEvent('msg_1', base('email.delivered', {
      tags: [{ name: 'project_id', value: 'KINGSWALK' }, { name: 'kind', value: 'snag' }],
    }))
    expect(row?.project_id).toBeNull()
    expect(row?.entity_ref).toBe('snag')
  })

  it('leaves both null when there are no tags — every message sent today', () => {
    const row = mapResendEvent('msg_1', base('email.delivered'))
    expect(row?.project_id).toBeNull()
    expect(row?.entity_ref).toBeNull()
  })
})

describe('suppressionFor', () => {
  const row = (type: string, bounce_type: string | null = null) =>
    ({ ...mapResendEvent('msg_1', base(type))!, event_type: type as any, bounce_type })

  it('suppresses a Permanent bounce', () => {
    expect(suppressionFor(row('email.bounced', 'Permanent'))).toEqual({
      email_address: 'site.foreman@aeec.co.za',
      reason: 'hard_bounce',
      last_event_at: '2026-09-10T06:00:00.000Z',
      source_message_id: 'ab12cd34-0000-0000-0000-000000000001',
    })
  })

  it('suppresses a complaint', () => {
    expect(suppressionFor(row('email.complained'))?.reason).toBe('complaint')
  })

  it('does NOT suppress a Transient bounce', () => {
    expect(suppressionFor(row('email.bounced', 'Transient'))).toBeNull()
  })

  it('does NOT suppress a bounce with no classification', () => {
    expect(suppressionFor(row('email.bounced', null))).toBeNull()
  })

  it('does NOT suppress email.failed — the send failed, the address did not', () => {
    expect(suppressionFor(row('email.failed'))).toBeNull()
  })

  it('does NOT suppress a delivery', () => {
    expect(suppressionFor(row('email.delivered'))).toBeNull()
  })

  // Added after the mutation sweep: dropping the `event_type === 'email.bounced'`
  // half of the hard_bounce condition left all 21 planned tests green. Only a
  // bounce is a recipient verdict; a delayed or failed message carrying a
  // classification in its payload must not delete the channel to that address.
  it('does NOT suppress a non-bounce event that happens to carry a classification', () => {
    expect(suppressionFor(row('email.delivery_delayed', 'Permanent'))).toBeNull()
    expect(suppressionFor(row('email.failed', 'Permanent'))).toBeNull()
  })

  // Added after the mutation sweep: deleting the missing-recipient guard left
  // all 21 planned tests green, and email_suppressions.email_address is the
  // PRIMARY KEY (00185:123) — a null there is a 23502, a 500, and a Svix
  // retry loop on that request forever. Same failure class as a non-UUID
  // project_id, which the plan does pin.
  it('returns null rather than a null-keyed row when there is no recipient', () => {
    expect(suppressionFor({ ...row('email.complained'), to_email: null })).toBeNull()
    expect(suppressionFor({ ...row('email.bounced', 'Permanent'), to_email: null })).toBeNull()
  })
})

describe('sequenceTimestampFor', () => {
  const row = (type: string) => ({ ...mapResendEvent('msg_1', base(type))!, event_type: type as any })

  it('maps opened to opened_at', () => {
    expect(sequenceTimestampFor(row('email.opened')))
      .toEqual({ column: 'opened_at', value: '2026-09-10T06:00:00.000Z' })
  })

  it('maps clicked to clicked_at', () => {
    expect(sequenceTimestampFor(row('email.clicked'))?.column).toBe('clicked_at')
  })

  it('maps everything else to null — 00030 has only those two columns', () => {
    for (const t of ['email.sent', 'email.delivered', 'email.delivery_delayed',
                     'email.bounced', 'email.complained', 'email.failed']) {
      expect(sequenceTimestampFor(row(t))).toBeNull()
    }
  })
})

/**
 * The mapper's output has to satisfy migration 00185's CHECK constraints. A
 * value this file emits that the CHECK rejects is a 23514 on insert, a 500 from
 * the route, and — because Svix retries a 5xx with the same svix-id — a retry
 * loop on that request forever. That is the same failure mode the non-UUID
 * project_id test guards against, so it is pinned the same way: by reading the
 * constraint out of the migration rather than by restating it here.
 */
describe('contract with migration 00185', () => {
  const MIGRATION = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../apps/edge-functions/supabase/migrations/00185_resend_email_delivery_evidence.sql',
  )
  const sql = readFileSync(MIGRATION, 'utf8')

  const checkValues = (constraint: string, column: string): string[] => {
    const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\(${column} IN \\(([^)]*)\\)`, 's').exec(sql)
    if (!m) throw new Error(`${constraint} not found in ${MIGRATION}`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }

  it('emits only event_type values the CHECK accepts, and covers all of them', () => {
    expect([...RESEND_EVENT_TYPES].sort())
      .toEqual(checkValues('email_events_event_type_check', 'event_type').sort())
  })

  it("emits a source the CHECK accepts", () => {
    const row = mapResendEvent('msg_1', base('email.delivered'))!
    expect(checkValues('email_events_source_check', 'source')).toContain(row.source)
  })

  it('emits only suppression reasons the CHECK accepts', () => {
    const reasons = checkValues('email_suppressions_reason_check', 'reason')
    const bounced = { ...mapResendEvent('msg_1', base('email.bounced'))!, bounce_type: 'Permanent' }
    const complained = mapResendEvent('msg_1', base('email.complained'))!
    expect(reasons).toContain(suppressionFor(bounced)!.reason)
    expect(reasons).toContain(suppressionFor(complained)!.reason)
  })
})
