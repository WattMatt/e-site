import 'server-only'
/**
 * Solar notifications: bell (+push) through dispatchNotification, optional
 * branded email through send-email. Unlike lib/notify.ts this does NOT go to
 * the project roster — Solar requests go to the org's owners/admins and
 * decisions go to one person. Never throws (a failed notification must not
 * fail the user's action). The four types are in notifications_type_check
 * from 00208; a type missing there makes the bell insert fail silently.
 *
 * Email uses send-email's `rfi-created` passthrough ({to, subject, html}),
 * the same shape lib/notify.ts uses for every module.
 */
import { DEFAULT_ACCENT_COLOR, escapeHtml, filterSuppressed, renderBrandedEmail } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

export type SolarNotificationType =
  | 'solar_subscribe_requested'
  | 'solar_access_requested'
  | 'solar_access_changed'
  | 'solar_access_declined'

export interface SolarNotice {
  type: SolarNotificationType
  projectId: string
  projectName: string
  title: string
  body: string
  /** App route, e.g. /projects/<id>/solar/access */
  route: string
  email: boolean
}

export async function notifySolarUsers(userIds: string[], emails: string[], n: SolarNotice): Promise<void> {
  if (userIds.length === 0) return
  await dispatchNotification({
    userIds, title: n.title, body: n.body, route: n.route,
    type: n.type, entityType: 'solar_project', entityId: n.projectId,
  })
  if (!n.email || emails.length === 0) return
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const { allowed } = await filterSuppressed(createServiceClient() as never, emails)
    if (allowed.length === 0) return
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.e-site.live').replace(/\/$/, '')
    const link = `${siteUrl}${n.route}`
    const html = renderBrandedEmail({
      accentColor: DEFAULT_ACCENT_COLOR,
      logoUrl: null,
      projectName: n.projectName,
      title: n.title,
      contentHtml: `<p>${escapeHtml(n.body)}</p><p><a href="${escapeHtml(link)}">Open in E-Site</a></p>`,
      siteUrl,
    })
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ type: 'rfi-created', payload: { to: allowed, subject: n.title, html } }),
    })
    if (!res.ok) console.error('[solar-notify] email failed', { type: n.type, status: res.status })
  } catch (e) {
    console.error('[solar-notify] email threw', { type: n.type, err: String(e) })
  }
}
