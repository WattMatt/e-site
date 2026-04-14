import { Slot } from 'expo-router'
import { SupabaseProvider } from '../src/providers/SupabaseProvider'
import { AuthProvider } from '../src/providers/AuthProvider'
import { PowerSyncProvider } from '../src/providers/PowerSyncProvider'
import { QueryProvider } from '../src/providers/QueryProvider'

export default function RootLayout() {
  return (
    <SupabaseProvider>
      <AuthProvider>
        <PowerSyncProvider>
          <QueryProvider>
            <Slot />
          </QueryProvider>
        </PowerSyncProvider>
      </AuthProvider>
    </SupabaseProvider>
  )
}
