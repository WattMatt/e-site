// apps/edge-functions/supabase/functions/whatsapp-worker/index.ts
//
// Drains the WhatsApp outbox and retries stuck inbound rows. Called by pg_cron
// every minute (docs/whatsapp-runbook.md) and kicked by web actions for OTP /
// opt-in immediacy. Gateway JWT verification ON; requireServiceRole decodes the
// already-verified role claim.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRole } from '../_shared/auth.ts'
import { createMetaClient } from '../_shared/whatsapp/meta-client.ts'
import { createProcessorStore, createWorkerStore } from '../_shared/whatsapp/store.ts'
import { drainOutbox } from '../_shared/whatsapp/worker.ts'
import { processPending } from '../_shared/whatsapp/processor.ts'

const env = (k: string) => Deno.env.get(k) ?? ''

export const handler = async (req: Request): Promise<Response> => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const meta = createMetaClient({ token: env('WHATSAPP_TOKEN'), phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') })
  const now = () => new Date()
  try {
    const drained = await drainOutbox({ store: createWorkerStore(sb), meta, now })
    const retried = await processPending({ store: createProcessorStore(sb), meta, now,
      appUrl: env('APP_URL') || 'https://www.e-site.live' }, 20, 30)
    return new Response(JSON.stringify({ drained, retried }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('whatsapp-worker error:', e)
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

Deno.serve(handler)
