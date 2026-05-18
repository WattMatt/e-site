import { useEffect } from 'react'
import { Slot } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SupabaseProvider } from '../src/providers/SupabaseProvider'
import { AuthProvider } from '../src/providers/AuthProvider'
import { PowerSyncProvider } from '../src/providers/PowerSyncProvider'
import { QueryProvider } from '../src/providers/QueryProvider'
import { ObservabilityBoot } from '../src/components/ObservabilityBoot'
import { SyncStatusBanner } from '../src/components/SyncStatusBanner'
import { ensureSchema as ensureAttachmentQueueSchema } from '../src/inspections/attachment-queue'
import { startUploadWorker, stopUploadWorker } from '../src/inspections/upload-worker'

export default function RootLayout() {
  useEffect(() => {
    // Inspections attachment upload worker — drains the local
    // attachment_uploads queue in the background. Schema ensure is
    // idempotent; worker is a singleton (re-calling startUploadWorker
    // is a no-op once running).
    void ensureAttachmentQueueSchema().then(() => startUploadWorker())
    return () => {
      stopUploadWorker()
    }
  }, [])

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
