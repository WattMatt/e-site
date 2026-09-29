// apps/web/src/actions/whatsapp-admin.actions.ts
'use server'
/**
 * The platform-wide WhatsApp switch and alert address. whatsapp.settings is a
 * single platform row, so ONLY WM's org owner/admin should hold this. Every
 * org's owner/admin passes OWNER_ADMIN (the same trade-off recorded for
 * /metrics). Accepted for v1 because only WM operates the number; recorded in
 * docs/rbac-matrix.md.
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { OWNER_ADMIN } from '@esite/shared'

async function isAdmin(): Promise<boolean> {
  const ctx = await getOrgContext().catch(() => null)
  return Boolean(ctx && (OWNER_ADMIN as readonly string[]).includes(ctx.role))
}

export async function setWhatsAppSendingAction(input: { enabled: boolean }): Promise<{ ok: true } | { error: string }> {
  if (!(await isAdmin())) return { error: 'Only an owner or admin can change this.' }
  const enabled = z.boolean().parse(input.enabled)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (createServiceClient() as any).schema('whatsapp').from('settings')
    .update({ sending_enabled: enabled, updated_at: new Date().toISOString() }).eq('id', true)
  revalidatePath('/settings/whatsapp')
  return { ok: true }
}

export async function setWhatsAppAlertEmailAction(input: { email: string }): Promise<{ ok: true } | { error: string }> {
  if (!(await isAdmin())) return { error: 'Only an owner or admin can change this.' }
  const parsed = z.string().email().safeParse(input.email)
  if (!parsed.success) return { error: 'Enter a valid email address.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (createServiceClient() as any).schema('whatsapp').from('settings').update({ alert_email: parsed.data }).eq('id', true)
  revalidatePath('/settings/whatsapp')
  return { ok: true }
}
