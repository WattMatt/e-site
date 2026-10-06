// apps/edge-functions/supabase/functions/_shared/whatsapp/reports-client.ts
//
// HTTP client for the web app's report service, POST /api/internal/whatsapp/reports.
// Signed with WHATSAPP_INTERNAL_SECRET (core.signInternal), like forms-client.ts. A missing
// secret means on-demand reports are off: createReportsClient returns undefined and the
// Reports list never offers the cable schedule.
import { signInternal } from './core.ts'
import type { ReportsClient } from './files.ts'

export const REPORTS_PATH = '/api/internal/whatsapp/reports'
export const SIGNATURE_HEADER = 'x-esite-wa-signature'

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function createReportsClient(cfg: { appUrl: string; secret: string; fetchImpl?: typeof fetch; now?: () => Date }): ReportsClient | undefined {
  if (!cfg.secret) return undefined
  const f = cfg.fetchImpl ?? fetch
  const now = cfg.now ?? (() => new Date())
  return {
    async cableSchedule(userId, projectId) {
      const json = JSON.stringify({ op: 'cable_schedule', userId, projectId })
      const sig = await signInternal(cfg.secret, Math.floor(now().getTime() / 1000), json)
      const res = await f(`${cfg.appUrl.replace(/\/$/, '')}${REPORTS_PATH}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: sig }, body: json,
      })
      // A non-2xx throws: the inbound row stays pending and claim_inbound retries it.
      if (!res.ok) throw new Error(`reports service: HTTP ${res.status}`)
      const out = (await res.json()) as { code?: string; filename?: string; base64?: string; message?: string }
      if (out.code === 'ok' && typeof out.filename === 'string' && typeof out.base64 === 'string') {
        return { code: 'ok', filename: out.filename, bytes: fromBase64(out.base64) }
      }
      if (out.code === 'no_access' || out.code === 'none' || out.code === 'too_large') return { code: out.code, message: out.message }
      throw new Error('reports service: bad reply')
    },
  }
}
