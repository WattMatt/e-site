// apps/mobile/src/providers/PowerSyncProvider.tsx
import React, { useEffect } from 'react'
import { PowerSyncContext } from '@powersync/react-native'
import { powerSyncDb } from '../lib/powersync/database'
import { SupabaseConnector } from '../lib/powersync/connector'
import { supabase } from '../lib/supabase'

const connector = new SupabaseConnector(supabase)

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let connected = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        powerSyncDb.connect(connector)
        connected = true
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && !connected) {
        powerSyncDb.connect(connector)
        connected = true
      }
      if (event === 'SIGNED_OUT') {
        powerSyncDb.disconnect()
        connected = false
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <PowerSyncContext.Provider value={powerSyncDb}>
      {children}
    </PowerSyncContext.Provider>
  )
}
