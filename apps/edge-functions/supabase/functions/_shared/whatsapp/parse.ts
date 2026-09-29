// apps/edge-functions/supabase/functions/_shared/whatsapp/parse.ts
export interface InboundMessage {
  id: string
  from: string
  timestamp: string
  type: string
  contextId: string | null
  text: string | null
  payload: string | null
  imageId: string | null
  imageMime: string | null
}

export interface StatusUpdate {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  errorCode: number | null
  errorTitle: string | null
}

// deno-lint-ignore no-explicit-any
type Any = any

export function toInboundMessage(m: Any): InboundMessage | null {
  if (!m || typeof m.id !== 'string' || typeof m.from !== 'string') return null
  const payload =
    m.type === 'button' ? (m.button?.payload ?? null)
    : m.type === 'interactive' ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null)
    : null
  const text = m.type === 'text' ? (m.text?.body ?? null) : m.type === 'image' ? (m.image?.caption ?? null) : null
  return {
    id: m.id, from: m.from, timestamp: String(m.timestamp ?? ''), type: String(m.type ?? 'unknown'),
    contextId: m.context?.id ?? null, text, payload,
    imageId: m.type === 'image' ? (m.image?.id ?? null) : null,
    imageMime: m.type === 'image' ? (m.image?.mime_type ?? null) : null,
  }
}

export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = []
  const statuses: StatusUpdate[] = []
  const entries = Array.isArray((body as Any)?.entry) ? (body as Any).entry : []
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      const v = change?.value ?? {}
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        const parsed = toInboundMessage(m)
        if (parsed) messages.push(parsed)
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        if (typeof s?.id !== 'string' || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue
        statuses.push({
          id: s.id, status: s.status,
          errorCode: typeof s.errors?.[0]?.code === 'number' ? s.errors[0].code : null,
          errorTitle: s.errors?.[0]?.title ?? null,
        })
      }
    }
  }
  return { messages, statuses }
}
