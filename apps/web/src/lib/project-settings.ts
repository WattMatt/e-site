/**
 * Web-side helpers around @esite/shared's projectSettingsService.
 *
 * NOTE: these used to be wrapped in `unstable_cache`, but Next.js forbids
 * accessing `cookies()` / `headers()` inside `unstable_cache`, and
 * `createClient()` from `@/lib/supabase/server` reads cookies for the user's
 * session. Calling the wrapped function threw a runtime error on every
 * settings sub-page that fetched data (operational / contract / integrations
 * / history). Per-request React `cache()` still dedupes calls within a single
 * render; cross-request caching of authenticated data is dangerous anyway
 * (different users → different RLS scopes → different rows).
 *
 * `invalidateProjectSettings` is retained as a tag-revalidator so server
 * actions can still bust any downstream tag-keyed fetch cache. No-op for
 * the get* functions above (they no longer cache).
 */

import { revalidateTag } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { projectSettingsService } from '@esite/shared'
import type { ProjectSettings, ProjectSettingsHistoryRow } from '@esite/shared'

const TAG = (projectId: string) => `project-settings:${projectId}`

/**
 * Returns the project_settings row for `projectId`, or null. Each call reads
 * cookies → user session → RLS-scoped Supabase client.
 *
 * Function name keeps the `Cached` suffix so existing imports don't need
 * updating in this fix. Cross-request caching has been removed (see header).
 */
export async function getProjectSettingsCached(projectId: string): Promise<ProjectSettings | null> {
  const supabase = await createClient()
  return projectSettingsService.get(supabase as any, projectId)
}

/**
 * Returns the most recent history rows for `projectId`. Same shape as above.
 */
export async function getProjectHistoryCached(
  projectId: string,
  limit = 50,
): Promise<ProjectSettingsHistoryRow[]> {
  const supabase = await createClient()
  return projectSettingsService.getHistory(supabase as any, projectId, { limit })
}

/**
 * Bust any downstream tag-keyed cache for this project. Safe to call from
 * server actions after a write.
 */
export function invalidateProjectSettings(projectId: string): void {
  revalidateTag(TAG(projectId))
}
