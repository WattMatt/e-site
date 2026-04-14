// apps/mobile/src/providers/PowerSyncProvider.tsx
import React, { useEffect, useRef } from 'react'
import { PowerSyncContext } from '@powersync/react-native'
import { powerSyncDb } from '../lib/powersync/database'
import { SupabaseConnector } from '../lib/powersync/connector'
import { supabase } from '../lib/supabase'

const connector = new SupabaseConnector(supabase)

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
  const connectedRef = useRef(false)

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

    return () => {
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
