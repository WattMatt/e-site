// apps/edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts
export const GRAPH_VERSION = 'v23.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
const MAX_MEDIA_BYTES = 16 * 1024 * 1024

export type MetaErrorClass = 'transient' | 'recipient' | 'policy'

export class MetaError extends Error {
  constructor(public code: number, message: string, public klass: MetaErrorClass) {
    super(message)
    this.name = 'MetaError'
  }
}

const RECIPIENT = new Set([131026, 131047, 131051, 131052, 131053, 133010])
const POLICY = new Set([10, 190, 200, 368, 131031, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069])

/** recipient: stop sending to this number. policy: an admin must act. transient: retry. */
export function classifyMetaError(code: number, httpStatus: number): MetaErrorClass {
  if (RECIPIENT.has(code)) return 'recipient'
  if (POLICY.has(code)) return 'policy'
  if (httpStatus === 401 || httpStatus === 403) return 'policy'
  return 'transient'
}

export type TemplateButton =
  | { type: 'quick_reply'; index: number; payload: string }
  | { type: 'url'; index: number; suffix: string }

export interface MetaClient {
  sendTemplate(to: string, name: string, body: string[], buttons: TemplateButton[]): Promise<string>
  sendText(to: string, body: string, replyTo?: string): Promise<string>
  sendButtons(to: string, body: string, buttons: Array<{ id: string; title: string }>, replyTo?: string): Promise<string>
  sendList(to: string, body: string, buttonLabel: string, rows: Array<{ id: string; title: string; description?: string }>): Promise<string>
  fetchMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }>
}

export function createMetaClient(cfg: {
  token: string
  phoneNumberId: string
  fetchImpl?: typeof fetch
  language?: string
}): MetaClient {
  const f = cfg.fetchImpl ?? fetch
  const auth = { Authorization: `Bearer ${cfg.token}` }
  const digits = (to: string) => to.replace(/^\+/, '')

  async function post(message: Record<string, unknown>): Promise<string> {
    const res = await f(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...message }),
    })
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) {
      const code = Number(json?.error?.code ?? 0)
      throw new MetaError(code, String(json?.error?.message ?? `HTTP ${res.status}`), classifyMetaError(code, res.status))
    }
    const id = json?.messages?.[0]?.id
    if (typeof id !== 'string') throw new MetaError(0, 'Meta returned no message id', 'transient')
    return id
  }

  const ctx = (replyTo?: string) => (replyTo ? { context: { message_id: replyTo } } : {})

  return {
    sendTemplate(to, name, body, buttons) {
      return post({
        to: digits(to), type: 'template',
        template: {
          name, language: { code: cfg.language ?? 'en' },
          components: [
            ...(body.length ? [{ type: 'body', parameters: body.map((t) => ({ type: 'text', text: t })) }] : []),
            ...buttons.map((b) => b.type === 'quick_reply'
              ? { type: 'button', sub_type: 'quick_reply', index: String(b.index), parameters: [{ type: 'payload', payload: b.payload }] }
              : { type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: b.suffix }] }),
          ],
        },
      })
    },
    sendText(to, body, replyTo) {
      return post({ to: digits(to), type: 'text', text: { body: body.slice(0, 4096), preview_url: false }, ...ctx(replyTo) })
    },
    sendButtons(to, body, buttons, replyTo) {
      return post({
        to: digits(to), type: 'interactive', ...ctx(replyTo),
        interactive: { type: 'button', body: { text: body.slice(0, 1024) },
          action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } },
      })
    },
    sendList(to, body, buttonLabel, rows) {
      return post({
        to: digits(to), type: 'interactive',
        interactive: { type: 'list', body: { text: body.slice(0, 1024) },
          action: { button: buttonLabel.slice(0, 20), sections: [{ title: 'Open items',
            rows: rows.slice(0, 10).map((r) => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }] } },
      })
    },
    async fetchMedia(mediaId) {
      const meta = await f(`${GRAPH}/${mediaId}`, { headers: auth })
      // deno-lint-ignore no-explicit-any
      const info: any = await meta.json().catch(() => ({}))
      if (!meta.ok || typeof info?.url !== 'string') {
        const code = Number(info?.error?.code ?? 0)
        throw new MetaError(code, 'media lookup failed', classifyMetaError(code, meta.status))
      }
      if (Number(info.file_size ?? 0) > MAX_MEDIA_BYTES) throw new MetaError(0, 'media over 16 MB', 'recipient')
      const bin = await f(info.url, { headers: auth })
      if (!bin.ok) throw new MetaError(0, `media download HTTP ${bin.status}`, 'transient')
      return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: String(info.mime_type ?? 'image/jpeg') }
    },
  }
}
