import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { logAuthEvent } from '@esite/shared'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { WaLinkDeps } from './wa-link'

/** The real dependencies of consumeWaLink: service client for the link and the admin API, cookie client for the session. */
export function waLinkDeps(): WaLinkDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  return {
    hash: (t) => createHash('sha256').update(t).digest('hex'),
    async consume(tokenHash) {
      const now = new Date().toISOString()
      const { data, error } = await svc.schema('whatsapp').from('form_links')
        .update({ consumed_at: now })
        .eq('token_hash', tokenHash).is('consumed_at', null).gt('expires_at', now)
        .select('user_id, target_path').maybeSingle()
      if (error) throw new Error(`wa-link consume: ${error.message}`)
      return data ?? null
    },
    async projectRole(projectId, userId) {
      const { data, error } = await svc.rpc('user_effective_project_role', { p_project_id: projectId, p_user_id: userId })
      return error ? null : ((data as string | null) ?? null)
    },
    async emailFor(userId) {
      const { data } = await svc.auth.admin.getUserById(userId)
      return data?.user?.email ?? null
    },
    async magicLinkHash(email) {
      const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
      return error ? null : (data?.properties?.hashed_token ?? null)
    },
    async signIn(tokenHash) {
      const supabase = await createClient()
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
      if (error) console.error('wa-link: verifyOtp failed', error.message)
      return !error
    },
    async audit(userId) {
      const h = await headers()
      await logAuthEvent(svc, { userId, eventType: 'login', ipAddress: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        userAgent: h.get('user-agent') ?? null, metadata: { method: 'whatsapp_link' } })
    },
  }
}
