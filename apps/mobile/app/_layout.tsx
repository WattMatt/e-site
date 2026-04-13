import { Slot } from 'expo-router'
import { SupabaseProvider } from '../src/providers/SupabaseProvider'
import { AuthProvider } from '../src/providers/AuthProvider'
import { QueryProvider } from '../src/providers/QueryProvider'

export default function RootLayout() {
  return (
    <SupabaseProvider>
      <QueryProvider>
        <AuthProvider>
          <Slot />
        </AuthProvider>
      </QueryProvider>
    </SupabaseProvider>
  )
}
