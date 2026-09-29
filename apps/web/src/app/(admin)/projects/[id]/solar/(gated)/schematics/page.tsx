import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSchematicsList } from '@/lib/solar/schematics/load'
import { SchematicsList } from './_components/SchematicsList'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Schematics tab (functional spec §13.1). View reads; Edit changes.
 * Every prop handed to the 'use client' list is JSON (no functions) — page.test.tsx pins it.
 */
export default async function SolarSchematicsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  return <SchematicsList projectId={id} canEdit={level !== 'view'} view={await loadSchematicsList(supabase, id)} />
}
