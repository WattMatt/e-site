// apps/mobile/src/providers/PowerSyncProvider.tsx
import React, { useEffect, useRef } from 'react'
import { PowerSyncContext } from '@powersync/react-native'
import { powerSyncDb } from '../lib/powersync/database'
import { SupabaseConnector } from '../lib/powersync/connector'
import { supabase } from '../lib/supabase'
import { track, ANALYTICS_EVENTS } from '../lib/analytics'

const connector = new SupabaseConnector(supabase)

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
  const connectedRef = useRef(false)
  // sync_completed transitions: fire when downloading goes true→false with hasSynced=true.
  const wasDownloadingRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !connectedRef.current) {
        powerSyncDb.connect(connector)
        connectedRef.current = true
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && !connectedRef.current) {
        powerSyncDb.connect(connector)
        connectedRef.current = true
      }
      if (event === 'SIGNED_OUT') {
        powerSyncDb.disconnect()
        connectedRef.current = false
      }
    })

    // sync_completed telemetry: edge-trigger on downloading true→false.
    // Avoids firing repeatedly while connected; fires once per sync cycle.
    const syncListener = (powerSyncDb as any).registerListener?.({
      statusChanged: (status: any) => {
        const isDownloading = !!status?.dataFlowStatus?.downloading
        const hasSynced = !!status?.hasSynced
        if (wasDownloadingRef.current && !isDownloading && hasSynced) {
          void track(ANALYTICS_EVENTS.SYNC_COMPLETED, {
            last_synced_at: status?.lastSyncedAt
              ? new Date(status.lastSyncedAt).toISOString()
              : undefined,
            connected: !!status?.connected,
            source: 'mobile',
          })
        }
        wasDownloadingRef.current = isDownloading
      },
    })

    return () => {
      if (typeof syncListener === 'function') syncListener()
      listener.subscription.unsubscribe()
      powerSyncDb.disconnect()
      connectedRef.current = false
    }
  }, [])

  return (
    <PowerSyncContext.Provider value={powerSyncDb}>
      {children}
    </PowerSyncContext.Provider>
  )
}
