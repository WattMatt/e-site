/**
 * Web-side cache wrappers around @esite/shared's projectSettingsService.
 *
 * Server components call get*Cached() to read; server actions call
 * invalidateProjectSettings() after a write so the next render fetches fresh.
 *
 * Cache key strategy: per-project tags so writes on project A don't bust
 * project B's cache. Tag format: `project-settings:<projectId>`.
 */

import { unstable_cache, revalidateTag } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { projectSettingsService } from '@esite/shared'
import type { ProjectSettings, ProjectSettingsHistoryRow } from '@esite/shared'

const TAG = (projectId: string) => `project-settings:${projectId}`

/**
 * Returns the project_settings row for `projectId`, or null. Cached per
 * project with a 60s revalidate window; busted explicitly on write via
 * invalidateProjectSettings.
 */
export async function getProjectSettingsCached(projectId: string): Promise<ProjectSettings | null> {
  const cached = unstable_cache(
    async () => {
      const supabase = await createClient()
      return projectSettingsService.get(supabase as any, projectId)
    },
    ['project-settings', projectId],
    { tags: [TAG(projectId)], revalidate: 60 },
  )
  return cached()
}

/**
 * Returns the most recent history rows for `projectId`. Same cache pattern.
 * Limit caps at 50 by default — the audit viewer (Phase 2) can override.
 */
export async function getProjectHistoryCached(
  projectId: string,
  limit = 50,
): Promise<ProjectSettingsHistoryRow[]> {
  const cached = unstable_cache(
    async () => {
      const supabase = await createClient()
      return projectSettingsService.getHistory(supabase as any, projectId, { limit })
    },
    ['project-settings-history', projectId, String(limit)],
    { tags: [TAG(projectId)], revalidate: 60 },
  )
  return cached()
}

/**
 * Bust the cache for this project. Call after any write (update / reset /
 * restore). Cheap — Next dedupes within a request and tag invalidation is
 * O(1) on the tag index.
 */
export function invalidateProjectSettings(projectId: string): void {
  revalidateTag(TAG(projectId))
}
