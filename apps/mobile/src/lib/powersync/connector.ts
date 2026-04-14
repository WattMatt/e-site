// apps/mobile/src/lib/powersync/connector.ts
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native'
import { SupabaseClient } from '@supabase/supabase-js'

export class SupabaseConnector implements PowerSyncBackendConnector {
  constructor(private readonly supabase: SupabaseClient) {}

  async fetchCredentials(): Promise<PowerSyncCredentials> {
    const {
      data: { session },
      error,
    } = await this.supabase.auth.getSession()

    if (error || !session) {
      throw new Error('No active Supabase session — cannot fetch PowerSync credentials')
    }

    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    }
  }

  // Writes bypass PowerSync — go direct to Supabase service layer.
  // PowerSync propagates Supabase changes back to SQLite automatically.
  async uploadData(_database: AbstractPowerSyncDatabase): Promise<void> {
    return
  }
}
