// apps/edge-functions/supabase/functions/_shared/whatsapp/templates.ts
import { encodePayload } from './core.ts'
import type { TemplateButton } from './meta-client.ts'

export const TEMPLATES = {
  otp: 'esite_otp',
  optin: 'esite_optin',
  assigned: 'esite_item_assigned',
  due_tomorrow: 'esite_item_due_tomorrow',
  overdue: 'esite_item_overdue',
  fold: 'esite_items_waiting',
} as const

export interface ItemCard {
  itemId: string
  ref: string
  projectName: string
  title: string
  dueDate: string
  daysOverdue?: number
}

export interface TemplateSend {
  name: string
  body: string[]
  buttons: TemplateButton[]
}

/** Meta rejects template params containing newlines, tabs or more than 4 consecutive spaces. */
export function cleanParam(s: string): string {
  return String(s ?? '').replace(/[\n\t\r]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function humanDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function itemCardSend(trigger: 'assigned' | 'due_tomorrow' | 'overdue', card: ItemCard): TemplateSend {
  const body = [cleanParam(card.ref), cleanParam(card.projectName), cleanParam(card.title), humanDate(card.dueDate)]
  if (trigger === 'overdue') body.push(String(card.daysOverdue ?? 1))
  return {
    name: TEMPLATES[trigger],
    body,
    buttons: [
      { type: 'quick_reply', index: 0, payload: encodePayload({ kind: 'ack', itemId: card.itemId }) },
      { type: 'quick_reply', index: 1, payload: encodePayload({ kind: 'done', itemId: card.itemId }) },
      { type: 'url', index: 2, suffix: card.itemId },
    ],
  }
}

export function otpSend(code: string): TemplateSend {
  return { name: TEMPLATES.otp, body: [code], buttons: [{ type: 'url', index: 0, suffix: code }] }
}

export function optinSend(inviterName: string, projectName: string, linkId: string): TemplateSend {
  return {
    name: TEMPLATES.optin,
    body: [cleanParam(inviterName), cleanParam(projectName)],
    buttons: [
      { type: 'quick_reply', index: 0, payload: encodePayload({ kind: 'optin', answer: 'yes', linkId }) },
      { type: 'quick_reply', index: 1, payload: encodePayload({ kind: 'optin', answer: 'no', linkId }) },
    ],
  }
}

export function foldSend(count: number): TemplateSend {
  return { name: TEMPLATES.fold, body: [String(count)], buttons: [] }
}
