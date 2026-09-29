// apps/web/src/app/(admin)/settings/whatsapp/page.tsx
import { requireRolePage } from '@/lib/auth/require-role'
import { createServiceClient } from '@/lib/supabase/server'
import { OWNER_ADMIN, maskPhone } from '@esite/shared'
import { WhatsAppAdminPanel } from './WhatsAppAdminPanel'

export const metadata = { title: 'WhatsApp · Settings' }

export default async function WhatsAppSettingsPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: members } = await svc.from('user_organisations').select('user_id').eq('organisation_id', ctx.organisationId).eq('is_active', true)
  const ids: string[] = (members ?? []).map((m: { user_id: string }) => m.user_id)
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [settings, links, profiles, out7, in7, templates] = await Promise.all([
    svc.schema('whatsapp').from('settings').select('*').eq('id', true).maybeSingle(),
    svc.schema('whatsapp').from('phone_links').select('user_id, phone_e164, status, created_at, undeliverable_reason').in('user_id', ids),
    svc.from('profiles').select('id, full_name').in('id', ids),
    svc.schema('whatsapp').from('outbox').select('status, trigger').in('user_id', ids).gte('created_at', since),
    svc.schema('whatsapp').from('inbound').select('outcome, outcome_reason').in('resolved_user_id', ids).gte('received_at', since),
    svc.schema('whatsapp').from('templates').select('name, category, status'),
  ])
  const nameOf = (id: string) => (profiles.data ?? []).find((p: { id: string }) => p.id === id)?.full_name ?? id.slice(0, 8)
  const count = (rows: Array<Record<string, string>> | null, key: string) =>
    Object.entries((rows ?? []).reduce<Record<string, number>>((acc, r) => { acc[r[key]] = (acc[r[key]] ?? 0) + 1; return acc }, {}))
  const staleOptins = (links.data ?? []).filter((l: { status: string; created_at: string }) =>
    l.status === 'pending_optin' && Date.now() - Date.parse(l.created_at) > 48 * 3600_000)

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820 }}>
      <div className="page-header"><h1 className="page-title">WhatsApp</h1></div>
      <WhatsAppAdminPanel
        sendingEnabled={Boolean(settings.data?.sending_enabled)}
        alertEmail={settings.data?.alert_email ?? ''}
        lastPolicyError={settings.data?.last_policy_error ? `${settings.data.last_policy_error_at}: ${settings.data.last_policy_error}` : null}
        links={(links.data ?? []).map((l: { user_id: string; phone_e164: string; status: string; undeliverable_reason: string | null }) =>
          ({ name: nameOf(l.user_id), phone: maskPhone(l.phone_e164), status: l.status, reason: l.undeliverable_reason }))}
        staleOptins={staleOptins.length}
        outbound7d={count(out7.data, 'status')}
        templateMessages7d={(out7.data ?? []).filter((r: { status: string }) => ['sent', 'delivered', 'read'].includes(r.status)).length}
        inbound7d={count(in7.data, 'outcome')}
        templates={templates.data ?? []}
      />
    </div>
  )
}
