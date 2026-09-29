// apps/edge-functions/supabase/functions/whatsapp-webhook/index.ts
//
// Meta WhatsApp Cloud API webhook. Deployed --no-verify-jwt because Meta sends
// no Supabase JWT. It authenticates Meta by PROVING the X-Hub-Signature-256
// HMAC over the raw body with WHATSAPP_APP_SECRET — it must never import
// requireServiceRole (edge-function-jwt.contract.test.ts enforces this).
// Order: verify -> store verbatim -> 200; processing runs after via waitUntil,
// so a processing crash can never lose a message (claim_inbound retries it).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyMetaSignature } from '../_shared/whatsapp/signature.ts'
import { parseWebhook } from '../_shared/whatsapp/parse.ts'
import { createMetaClient } from '../_shared/whatsapp/meta-client.ts'
import { applyStatuses, createProcessorStore, storeInbound } from '../_shared/whatsapp/store.ts'
import { processPending } from '../_shared/whatsapp/processor.ts'

const env = (k: string) => Deno.env.get(k) ?? ''

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const token = env('WHATSAPP_VERIFY_TOKEN')
    if (token && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === token) {
      return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const raw = new Uint8Array(await req.arrayBuffer())
  if (!(await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), env('WHATSAPP_APP_SECRET')))) {
    console.warn('whatsapp-webhook: rejected unsigned or mis-signed POST')
    return new Response('invalid signature', { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return new Response('bad json', { status: 400 })
  }

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const { messages, statuses } = parseWebhook(body)
  await storeInbound(sb, messages)
  await applyStatuses(sb, statuses)

  const deps = {
    store: createProcessorStore(sb),
    meta: createMetaClient({ token: env('WHATSAPP_TOKEN'), phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') }),
    now: () => new Date(),
    appUrl: env('APP_URL') || 'https://www.e-site.live',
  }
  const work = processPending(deps, 20, 0).catch((e) => console.error('whatsapp-webhook: processing failed', e))
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(work)
  else await work
  return new Response('ok', { status: 200 })
}

Deno.serve(handler)
