import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadSchematicEditor } from '@/lib/solar/schematics/load'
import { SchematicWorkspace } from './_components/SchematicWorkspace'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Schematic editor (functional spec §13.2). View reads the diagram; Edit changes it.
 * Every prop handed to the 'use client' workspace is JSON (no functions) — page.test.tsx pins it.
 * The key remounts the workspace when Replace drawing moves the anchor (new drawing or page).
 */
export default async function SchematicEditorPage({ params }: { params: Promise<{ id: string; schematicId: string }> }) {
  const { id, schematicId } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const view = await loadSchematicEditor(supabase, id, schematicId)
  if (!view) notFound()
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Link href={`/projects/${id}/solar/schematics`} style={{ fontSize: 12 }}>← All schematics</Link>
      <SchematicWorkspace key={`${view.schematic.id}:${view.schematic.floorPlanId}:${view.schematic.pageIndex}`} projectId={id} view={view} canEdit={level !== 'view'} />
    </div>
  )
}
