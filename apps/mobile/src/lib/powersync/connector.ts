// apps/mobile/src/lib/powersync/connector.ts
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native'
import { SupabaseClient } from '@supabase/supabase-js'
import { POWERSYNC_URL } from './config'

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
      endpoint: POWERSYNC_URL,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    }
  }

  // Writes bypass PowerSync — they go direct to Supabase (inspections via the
  // local outbox in src/inspections/response-outbox.ts). Never write to a synced
  // table locally: nothing here uploads it, and while PowerSync's CRUD queue is
  // non-empty it refuses every downloaded checkpoint. Guarded by
  // src/__tests__/no-local-writes-to-synced-tables.contract.test.ts.
  async uploadData(_database: AbstractPowerSyncDatabase): Promise<void> {
    return
  }
}
