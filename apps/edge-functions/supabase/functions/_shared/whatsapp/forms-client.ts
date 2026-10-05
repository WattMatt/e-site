// apps/edge-functions/supabase/functions/_shared/whatsapp/forms-client.ts
//
// HTTP client for the web app's inspection-form service, POST /api/internal/whatsapp/forms.
// Signed with WHATSAPP_INTERNAL_SECRET (core.signInternal). A missing secret means forms are
// off on this deployment: createFormsClient returns undefined and the processor never offers them.
import { signInternal } from './core.ts'
import type { FormsClient, FormsOp, FormsReply } from './forms.ts'

export const FORMS_PATH = '/api/internal/whatsapp/forms'
export const SIGNATURE_HEADER = 'x-esite-wa-signature'

export function createFormsClient(cfg: { appUrl: string; secret: string; fetchImpl?: typeof fetch; now?: () => Date }): FormsClient | undefined {
  if (!cfg.secret) return undefined
  const f = cfg.fetchImpl ?? fetch
  const now = cfg.now ?? (() => new Date())
  return {
    async call(op: FormsOp, body: Record<string, unknown>): Promise<FormsReply> {
      const json = JSON.stringify({ op, ...body })
      const sig = await signInternal(cfg.secret, Math.floor(now().getTime() / 1000), json)
      const res = await f(`${cfg.appUrl.replace(/\/$/, '')}${FORMS_PATH}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: sig }, body: json,
      })
      // A non-2xx throws: the inbound row stays pending and claim_inbound retries it.
      if (!res.ok) throw new Error(`forms service ${op}: HTTP ${res.status}`)
      const out = (await res.json()) as FormsReply
      if (!out || typeof out.code !== 'string' || !Array.isArray(out.messages)) throw new Error(`forms service ${op}: bad reply`)
      return out
    },
  }
}
