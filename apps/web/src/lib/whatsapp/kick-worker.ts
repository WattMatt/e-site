// apps/web/src/lib/whatsapp/kick-worker.ts
import 'server-only'

/**
 * Nudge the whatsapp-worker edge function so an OTP or opt-in goes out now
 * rather than on the next per-minute cron tick. Never throws: the cron is the
 * backstop, so a failed kick only delays the message. Same shape as
 * lib/notifications.ts's call to send-notification.
 */
export async function kickWhatsAppWorker(reason: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/functions/v1/whatsapp-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
  } catch (e) {
    console.error('kickWhatsAppWorker failed (cron will retry):', e)
  }
}
