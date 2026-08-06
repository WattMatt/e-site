#!/usr/bin/env node --experimental-strip-types
/**
 * Sweep orphaned objects out of the `snag-photos` storage bucket.
 * =========================================================================
 * Why these orphans exist: `apps/mobile/app/snags/create.tsx` uploaded each
 * photo to storage FIRST and only then inserted the `field.snag_photos` row —
 * with `photo_type: 'defect'`, a value the table's CHECK constraint
 * ('evidence' | 'closeout' | 'markup', 00004_field_schema.sql) has always
 * rejected. So every mobile snag photo ever taken landed a real object in the
 * bucket and then failed its row insert, stranding the file.
 *
 * This script lists every object in the bucket, joins against
 * field.snag_photos.file_path, and removes the objects with no owning row.
 *
 * Dry-run is the DEFAULT. Nothing is deleted without --live.
 *
 * Usage (from repo root; lives under apps/web so @supabase/supabase-js
 * resolves from the web app's node_modules):
 *   node --experimental-strip-types apps/web/scripts/sweep-orphan-snag-photos.ts
 *   node --experimental-strip-types apps/web/scripts/sweep-orphan-snag-photos.ts --live
 *
 * Requires env vars:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'snag-photos'
const PAGE = 100

const LIVE = process.argv.includes('--live')

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

/**
 * Recursively walk the bucket. Supabase storage `list` is per-prefix and
 * paginated; folders come back as entries with a null `id`.
 */
async function walk(prefix: string, out: string[]): Promise<void> {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list("${prefix}") failed: ${error.message}`)
    const entries = data ?? []
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : e.name
      // A null id marks a synthetic folder entry, not a real object.
      if ((e as { id: string | null }).id === null) await walk(path, out)
      else out.push(path)
    }
    if (entries.length < PAGE) break
  }
}

async function main(): Promise<void> {
  console.log(`Mode: ${LIVE ? 'LIVE (will delete)' : 'DRY RUN (no writes)'}`)

  const objects: string[] = []
  await walk('', objects)
  console.log(`Bucket objects found: ${objects.length}`)

  // Every referenced file_path, paged out of the table.
  const referenced = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (supabase as any)
      .schema('field')
      .from('snag_photos')
      .select('file_path')
      .range(from, from + 999)
    if (error) throw new Error(`snag_photos read failed: ${error.message}`)
    const rows = (data ?? []) as Array<{ file_path: string }>
    for (const r of rows) referenced.add(r.file_path)
    if (rows.length < 1000) break
  }
  console.log(`snag_photos rows referencing a path: ${referenced.size}`)

  const orphans = objects.filter((p) => !referenced.has(p))
  console.log(`Orphaned objects: ${orphans.length}`)
  for (const p of orphans.slice(0, 50)) console.log(`  ${p}`)
  if (orphans.length > 50) console.log(`  … and ${orphans.length - 50} more`)

  if (orphans.length === 0) {
    console.log('Nothing to do.')
    return
  }
  if (!LIVE) {
    console.log('\nDry run — re-run with --live to delete the objects listed above.')
    return
  }

  let removed = 0
  for (let i = 0; i < orphans.length; i += PAGE) {
    const chunk = orphans.slice(i, i + PAGE)
    const { error } = await supabase.storage.from(BUCKET).remove(chunk)
    if (error) {
      console.error(`remove chunk ${i / PAGE} failed: ${error.message}`)
      continue
    }
    removed += chunk.length
  }
  console.log(`Removed ${removed}/${orphans.length} orphaned objects.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
