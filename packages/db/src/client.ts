import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from './types'

export type TypedSupabaseClient = SupabaseClient<Database>

export function createTypedClient(url: string, key: string): TypedSupabaseClient {
  return createClient<Database>(url, key)
}
