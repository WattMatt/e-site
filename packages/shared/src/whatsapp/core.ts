// packages/shared/src/whatsapp/core.ts
//
// CANONICAL SOURCE. `node packages/shared/scripts/sync-whatsapp-core.mjs` copies
// this file byte-for-byte (behind a generated header) to
// apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts, and
// apps/web/src/lib/whatsapp/core-sync.contract.test.ts fails if they differ.
// It must stay import-free so Deno and Node load it identically.

export const CONSENT_TEXT_VERSION = '2026-09-28.1'
export const PLACEHOLDER_EMAIL_DOMAIN = 'wa.e-site.live'
export const DAILY_ITEM_CAP = 8
export const ACTIVE_ITEM_TTL_MS = 24 * 60 * 60 * 1000
export const WRONG_ITEM_WINDOW_MS = 15 * 60 * 1000
export const PENDING_DONE_TTL_MS = 30 * 60 * 1000
export const BURST_WINDOW_MS = 60 * 1000
export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS_PER_HOUR = 3
export const SAST_OFFSET_MINUTES = 120
export const OPEN_ITEMS_LIST_MAX = 10

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function placeholderEmailFor(userId: string): string {
  return `wa-${userId}@${PLACEHOLDER_EMAIL_DOMAIN}`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith('@' + PLACEHOLDER_EMAIL_DOMAIN)
}

/** Free text a person typed → E.164, defaulting to South Africa. Null if not a plausible number. */
export function normalisePhone(input: string): string | null {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (/^0\d{9}$/.test(s)) s = '+27' + s.slice(1)
  else if (/^27\d{9}$/.test(s)) s = '+' + s
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null
  if (s.startsWith('+27') && s.length !== 12) return null
  return s
}

/** Meta's `from` / `wa_id` is digits without a plus. */
export function fromMetaWaId(waId: string): string | null {
  if (typeof waId !== 'string' || !/^[1-9]\d{7,14}$/.test(waId)) return null
  return '+' + waId
}

export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)} ${e164.slice(3, 5)} *** ${e164.slice(-4)}`
}

export type Keyword = 'stop' | 'start' | null
const STOP_WORDS = new Set(['STOP', 'STOPP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'STOP ALL'])
const START_WORDS = new Set(['START', 'UNSTOP', 'OPT IN', 'OPTIN'])

export function classifyKeyword(text: string): Keyword {
  const t = (text ?? '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim()
  if (STOP_WORDS.has(t)) return 'stop'
  if (START_WORDS.has(t)) return 'start'
  return null
}

export type Payload =
  | { kind: 'ack'; itemId: string }
  | { kind: 'done'; itemId: string }
  | { kind: 'optin'; answer: 'yes' | 'no'; linkId: string }
  | { kind: 'wrong'; target: 'note' | 'attachment'; id: string }
  | { kind: 'pick'; itemId: string }

export function encodePayload(p: Payload): string {
  switch (p.kind) {
    case 'ack':
    case 'done':
    case 'pick':
      return `${p.kind}:${p.itemId}`
    case 'optin':
      return `optin:${p.answer}:${p.linkId}`
    case 'wrong':
      return `wrong:${p.target}:${p.id}`
  }
}

export function decodePayload(s: string | null | undefined): Payload | null {
  if (typeof s !== 'string') return null
  const parts = s.split(':')
  if (parts.length === 2) {
    const [kind, id] = parts
    if (!UUID.test(id)) return null
    if (kind === 'ack' || kind === 'done' || kind === 'pick') return { kind, itemId: id }
    return null
  }
  if (parts.length === 3) {
    const [kind, mid, id] = parts
    if (!UUID.test(id)) return null
    if (kind === 'optin' && (mid === 'yes' || mid === 'no')) return { kind, answer: mid, linkId: id }
    if (kind === 'wrong' && (mid === 'note' || mid === 'attachment')) return { kind, target: mid, id }
  }
  return null
}
