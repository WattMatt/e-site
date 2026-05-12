import { Slot } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SupabaseProvider } from '../src/providers/SupabaseProvider'
import { AuthProvider } from '../src/providers/AuthProvider'
import { PowerSyncProvider } from '../src/providers/PowerSyncProvider'
import { QueryProvider } from '../src/providers/QueryProvider'
import { ObservabilityBoot } from '../src/components/ObservabilityBoot'
import { SyncStatusBanner } from '../src/components/SyncStatusBanner'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SupabaseProvider>
        <AuthProvider>
          <PowerSyncProvider>
            <QueryProvider>
              <ObservabilityBoot />
              <SyncStatusBanner />
              <Slot />
            </QueryProvider>
          </PowerSyncProvider>
        </AuthProvider>
      </SupabaseProvider>
    </SafeAreaProvider>
  )
}
