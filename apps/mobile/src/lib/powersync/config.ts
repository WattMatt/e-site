// apps/mobile/src/lib/powersync/config.ts
//
// Whether this build has a PowerSync instance to sync with. On 2026-10-05
// production has none (no `powersync` publication or replication slot) and
// EXPO_PUBLIC_POWERSYNC_URL is empty, so the app must not try to connect, and
// must not tell the user they are "offline" because sync is absent.

const PLACEHOLDER_HOST = 'your-instance.powersync.journeyapps.com'

export function isPowerSyncConfigured(url: string | undefined): boolean {
  const trimmed = url?.trim()
  if (!trimmed) return false
  try {
    const { protocol, host } = new URL(trimmed)
    return (protocol === 'https:' || protocol === 'http:') && host !== PLACEHOLDER_HOST
  } catch {
    return false
  }
}

export const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL ?? ''
export const POWERSYNC_ENABLED = isPowerSyncConfigured(POWERSYNC_URL)
