import 'server-only'
/**
 * Project toggle `notify_solar_email` (00216). Gates the optional client email at Issue and the
 * proposer's accept/decline email; the in-app bell is never gated. Fails CLOSED: a read error sends
 * no email (probes on WM projects resolve 12-13 real recipients).
 */
import { projectSettingsService } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'

export async function solarEmailEnabled(projectId: string): Promise<boolean> {
  try {
    const cfg = await projectSettingsService.getNotificationConfig(createServiceClient() as never, projectId)
    return Boolean(cfg.solarEmail)
  } catch {
    return false
  }
}
