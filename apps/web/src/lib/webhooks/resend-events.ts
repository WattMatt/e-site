/**
 * Pure mapping from a Resend webhook payload to the rows it produces.
 *
 * Kept free of I/O so every decision the endpoint makes — store, attribute,
 * suppress, stamp — is testable without a database or a network.
 */

export const RESEND_EVENT_TYPES = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  // A send that never left. NOT a recipient verdict and never suppresses.
  // Without it here the single most actionable negative signal would be
  // acknowledged with a 200 and discarded.
  'email.failed',
] as const

export type ResendEventType = (typeof RESEND_EVENT_TYPES)[number]

export interface ResendEventRow {
  webhook_id: string
  resend_message_id: string | null
  event_type: ResendEventType
  occurred_at: string
  to_email: string | null
  subject: string | null
  bounce_type: string | null
  project_id: string | null
  entity_ref: string | null
  source: 'webhook'
  payload: unknown
}

export interface SuppressionRow {
  email_address: string
  reason: 'hard_bounce' | 'complaint'
  last_event_at: string
  source_message_id: string | null
}

/**
 * THE TAG VOCABULARY. Fixed here so §13 item 4's dispatcher and item 7's recap
 * send with it rather than each inventing one:
 *
 *   kind       recap | rfi | snag | invite | onboarding | report
 *   project_id the project the message is about (a UUID)
 *   entity_id  the RFI / snag / report id, when there is one
 *
 * Nothing sends tags today — send-email/index.ts:27 returns void and discards
 * the Resend response entirely — so project_id and entity_ref are NULL on every
 * message until item 4. The columns exist now because adding them to a live
 * table later is a second migration and another number claim.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readTags(data: Record<string, unknown>): Record<string, string> {
  const raw = data.tags
  const out: Record<string, string> = {}
  if (Array.isArray(raw)) {
    // The Resend SDK's send-side shape, echoed back.
    for (const entry of raw) {
      const tag = entry as { name?: unknown; value?: unknown }
      if (typeof tag?.name === 'string' && typeof tag?.value === 'string') out[tag.name] = tag.value
    }
  } else if (raw && typeof raw === 'object') {
    // Some payloads come back as a plain map. Accepting both costs four lines;
    // guessing one and being wrong yields a silent null, not an error.
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
  }
  return out
}

function isHandled(t: unknown): t is ResendEventType {
  return typeof t === 'string' && (RESEND_EVENT_TYPES as readonly string[]).includes(t)
}

/** `null` means "acknowledge and ignore" — never "reject". */
export function mapResendEvent(webhookId: string, raw: unknown): ResendEventRow | null {
  const evt = raw as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> } | null
  if (!evt || !isHandled(evt.type)) return null
  const data = evt.data ?? {}

  const to = Array.isArray(data.to) ? data.to : typeof data.to === 'string' ? [data.to] : []
  const bounce = data.bounce as { type?: unknown } | undefined

  const tags = readTags(data)
  // A non-UUID here would fail the insert with 22P02, 500 the route, and make
  // Svix retry that request forever. Dropping the tag is the safe behaviour.
  const projectId = tags.project_id && UUID_RE.test(tags.project_id) ? tags.project_id : null
  const entityRef = tags.kind
    ? tags.entity_id
      ? `${tags.kind}:${tags.entity_id}`
      : tags.kind
    : null

  return {
    webhook_id: webhookId,
    resend_message_id: typeof data.email_id === 'string' ? data.email_id : null,
    event_type: evt.type,
    occurred_at:
      (typeof evt.created_at === 'string' && evt.created_at) ||
      (typeof data.created_at === 'string' && data.created_at) ||
      new Date().toISOString(),
    to_email: typeof to[0] === 'string' ? (to[0] as string).trim().toLowerCase() : null,
    subject: typeof data.subject === 'string' ? data.subject : null,
    bounce_type: typeof bounce?.type === 'string' ? bounce.type : null,
    project_id: projectId,
    entity_ref: entityRef,
    source: 'webhook',
    payload: raw,
  }
}

/**
 * Only a Permanent bounce or a complaint suppresses.
 *
 * A bounce with no classification, a Transient one, and `email.failed` are all
 * recorded as events and do NOT suppress. The asymmetry is deliberate:
 * suppressing a live address silently deletes the channel to a contractor we
 * are trying to activate, and that failure is invisible; continuing to mail a
 * dead one costs a wasted send and shows up as another bounce event.
 */
export function suppressionFor(row: ResendEventRow): SuppressionRow | null {
  if (!row.to_email) return null
  if (row.event_type === 'email.complained') {
    return {
      email_address: row.to_email,
      reason: 'complaint',
      last_event_at: row.occurred_at,
      source_message_id: row.resend_message_id,
    }
  }
  if (row.event_type === 'email.bounced' && row.bounce_type === 'Permanent') {
    return {
      email_address: row.to_email,
      reason: 'hard_bounce',
      last_event_at: row.occurred_at,
      source_message_id: row.resend_message_id,
    }
  }
  return null
}

/**
 * public.email_sequence_events carries exactly two of these columns
 * (00030_email_sequences.sql:24-25). Full delivery history lives in
 * public.email_events and joins on resend_message_id — no duplicated columns.
 */
export function sequenceTimestampFor(
  row: ResendEventRow,
): { column: 'opened_at' | 'clicked_at'; value: string } | null {
  if (row.event_type === 'email.opened') return { column: 'opened_at', value: row.occurred_at }
  if (row.event_type === 'email.clicked') return { column: 'clicked_at', value: row.occurred_at }
  return null
}
