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
  | { kind: 'menu'; row: 'mine' | 'project' | 'post' | 'switch' }
  | { kind: 'proj'; projectId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'open'; itemId: string }
  | { kind: 'post'; choice: 'diary' | 'issue'; postId: string }

export function encodePayload(p: Payload): string {
  switch (p.kind) {
    case 'ack':
    case 'done':
    case 'pick':
    case 'item':
    case 'open':
      return `${p.kind}:${p.itemId}`
    case 'proj':
      return `proj:${p.projectId}`
    case 'menu':
      return `menu:${p.row}`
    case 'optin':
      return `optin:${p.answer}:${p.linkId}`
    case 'wrong':
      return `wrong:${p.target}:${p.id}`
    case 'post':
      return `post:${p.choice}:${p.postId}`
  }
}

const MENU_ROWS = new Set(['mine', 'project', 'post', 'switch'])

export function decodePayload(s: string | null | undefined): Payload | null {
  if (typeof s !== 'string') return null
  const parts = s.split(':')
  if (parts.length === 2) {
    const [kind, v] = parts
    if (kind === 'menu') return MENU_ROWS.has(v) ? { kind, row: v as 'mine' | 'project' | 'post' | 'switch' } : null
    if (!UUID.test(v)) return null
    if (kind === 'ack' || kind === 'done' || kind === 'pick' || kind === 'item' || kind === 'open') return { kind, itemId: v }
    if (kind === 'proj') return { kind, projectId: v }
    return null
  }
  if (parts.length === 3) {
    const [kind, mid, id] = parts
    if (!UUID.test(id)) return null
    if (kind === 'optin' && (mid === 'yes' || mid === 'no')) return { kind, answer: mid, linkId: id }
    if (kind === 'wrong' && (mid === 'note' || mid === 'attachment')) return { kind, target: mid, id }
    if (kind === 'post' && (mid === 'diary' || mid === 'issue')) return { kind, choice: mid, postId: id }
  }
  return null
}

export function isWithin(sinceIso: string | null | undefined, now: Date, ms: number): boolean {
  if (!sinceIso) return false
  const t = Date.parse(sinceIso)
  return Number.isFinite(t) && now.getTime() - t <= ms
}

export type Target =
  | { kind: 'item'; itemId: string; via: 'button' | 'context' | 'pending_done' | 'active' }
  | { kind: 'pick' }

export interface TargetInput {
  payloadItemId: string | null
  contextItemId: string | null
  pendingDoneItemId: string | null
  pendingDoneAt: string | null
  /** What the pending Mark done is waiting for: a close-out photo (snag) or an answer (RFI). */
  pendingDoneWants: 'photo' | 'answer' | null
  activeItemId: string | null
  activeItemAt: string | null
  isImage: boolean
  now: Date
}

/** Strictest rule first. Never guesses: with nothing current, the user picks. */
export function resolveTarget(i: TargetInput): Target {
  if (i.payloadItemId) return { kind: 'item', itemId: i.payloadItemId, via: 'button' }
  if (i.contextItemId) return { kind: 'item', itemId: i.contextItemId, via: 'context' }
  const wantsThis = i.pendingDoneWants === 'photo' ? i.isImage : i.pendingDoneWants === 'answer' ? !i.isImage : false
  if (wantsThis && i.pendingDoneItemId && isWithin(i.pendingDoneAt, i.now, PENDING_DONE_TTL_MS)) {
    return { kind: 'item', itemId: i.pendingDoneItemId, via: 'pending_done' }
  }
  if (i.activeItemId && isWithin(i.activeItemAt, i.now, ACTIVE_ITEM_TTL_MS)) {
    return { kind: 'item', itemId: i.activeItemId, via: 'active' }
  }
  return { kind: 'pick' }
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

function sastClock(now: Date): Date {
  return new Date(now.getTime() + SAST_OFFSET_MINUTES * 60_000)
}

/** yyyy-mm-dd in Africa/Johannesburg (fixed UTC+2, no DST). */
export function sastDate(now: Date): string {
  return sastClock(now).toISOString().slice(0, 10)
}

/** Earliest instant >= now outside [quietStart, quietEnd) SAST. Handles overnight windows. */
export function nextSendTime(now: Date, quietStart: string, quietEnd: string): Date {
  const s = minutesOf(quietStart)
  const e = minutesOf(quietEnd)
  if (s === e) return now
  const c = sastClock(now)
  const m = c.getUTCHours() * 60 + c.getUTCMinutes()
  const quiet = s > e ? m >= s || m < e : m >= s && m < e
  if (!quiet) return now
  const midnight = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate())
  const addDay = s > e && m >= s ? 1 : 0
  return new Date(midnight + addDay * 86_400_000 + e * 60_000 - SAST_OFFSET_MINUTES * 60_000)
}

export type DoneRoute = 'spine' | 'snag' | 'rfi' | 'link_out'

/** Where "Mark done" must act. Mirrors take status FROM their source (#193 map_source_status). */
export function doneRouteFor(itemType: string, origin: string): DoneRoute {
  if (origin !== 'mirror') return 'spine'
  if (itemType === 'snag') return 'snag'
  if (itemType === 'rfi') return 'rfi'
  return 'link_out'
}

export const PENDING_POST_TTL_MS = 30 * 60 * 1000
const MENU_WORDS = new Set(['MENU', 'HI', 'HELLO', 'HEY', 'HELP', 'START'])

export function isMenuWord(text: string): boolean {
  return MENU_WORDS.has((text ?? '').toUpperCase().replace(/[^A-Z]/g, ''))
    && (text ?? '').trim().split(/\s+/).length === 1
}

export interface ProjectRef { id: string; name: string }
export type ProjectMatch =
  | { kind: 'exact'; project: ProjectRef }
  | { kind: 'candidates'; projects: ProjectRef[] }
  | { kind: 'none' }

export function normaliseName(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Exact (full name, name without its job number, or the job number) → switch. Partial → always confirm. Never guesses. */
export function matchProjects(query: string, projects: ProjectRef[]): ProjectMatch {
  const q = normaliseName(query)
  if (q.length < 3) return { kind: 'none' }
  const exact = projects.filter((p) => {
    const n = normaliseName(p.name)
    const m = /^(\d+) (.+)$/.exec(n)
    return n === q || (m !== null && (m[2] === q || m[1] === q))
  })
  if (exact.length === 1) return { kind: 'exact', project: exact[0] }
  if (exact.length > 1) return { kind: 'candidates', projects: exact.slice(0, 10) }
  if (q.length < 4) return { kind: 'none' }
  const partial = projects.filter((p) => normaliseName(p.name).includes(q))
  return partial.length ? { kind: 'candidates', projects: partial.slice(0, 10) } : { kind: 'none' }
}

/** The user proves a number by SENDING "LINK <6 digits>" from it to E-Site (no auth template needed). */
export function linkCodeMessage(code: string): string {
  return `LINK ${code}`
}

export function parseLinkCode(text: string): string | null {
  const m = /^\s*LINK\s*(\d{6})\s*$/i.exec(text ?? '')
  return m ? m[1] : null
}
