import React, { createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'
import type { TypedSupabaseClient } from '@esite/db'

const SupabaseContext = createContext<TypedSupabaseClient>(supabase)

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  return <SupabaseContext.Provider value={supabase}>{children}</SupabaseContext.Provider>
}

export function useSupabase(): TypedSupabaseClient {
  return useContext(SupabaseContext)
}
