#!/usr/bin/env node --experimental-strip-types
/**
 * Recompute stored cable derate factors + derated ratings against the live
 * SANS reference tables.
 * =========================================================================
 * One-off maintenance sweep for the 2026-07 SANS-audit corrections. Stored
 * `cables.derate_*` + `derated_current_rating_a` values were written at
 * cable-creation time by whatever lookup logic was live then; the shared
 * lookup has since been corrected (conservative row selection instead of
 * floor, buried grouping via Table 6.3.3 instead of the in-air 6.3.6,
 * honest-null misses), so stored rows are stale. This script re-runs the
 * CURRENT shared `lookupDeratingFactors` / `deratedRating` for every cable
 * (each with its own stored inputs) and writes back only rows whose values
 * changed.
 *
 * Ω/km and manual_override are never touched (grouping/ambient corrections
 * affect the current rating, not the conductor impedance).
 *
 * Legacy soil resistivity: a stored thermal_resistivity_kmw of 1.0 on a
 * DRAFT-revision cable is the pre-audit hardcoded UI default (never a user
 * measurement — the edit path never exposed the field), so it is treated as
 * an artifact: factors are derived at the SANS reference 1.2 and 1.2 is
 * written back. Belt-and-braces for rows the 00167 §4 data fix didn't cover.
 *
 * ISSUED / SUPERSEDED revisions are SKIPPED by default — those snapshots are
 * contractually frozen. Pass --include-issued to sweep them too (do this
 * only with the engineer's sign-off; the change_log records the sweep).
 * Frozen rows keep their stored soil resistivity even under --include-issued.
 *
 * After a LIVE sweep the persisted tenant electrical rollup
 * (structure.nodes incomer_*) is refreshed for every affected project by
 * invoking the canonical backfill script (scripts/db/
 * backfill-tenant-electrical.ts) per project — derated_current_rating_a
 * feeds incomer_capacity_a / the under-protected flag. Failures print the
 * exact manual commands.
 *
 * Usage (from repo root; lives under apps/web so @supabase/supabase-js
 * resolves from the web app's node_modules):
 *   node --experimental-strip-types apps/web/scripts/recompute-cable-derates.ts --dry-run
 *   node --experimental-strip-types apps/web/scripts/recompute-cable-derates.ts
 *   node --experimental-strip-types apps/web/scripts/recompute-cable-derates.ts --include-issued
 *
 * Requires env vars:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
// Deep relative imports (not '@esite/shared') so node --experimental-strip-types
// loads ONLY the two pure service files, not the whole shared barrel.
import {
  lookupCableProperties,
  lookupDeratingFactors,
} from '../../../packages/shared/src/services/sans-lookup.service.ts'
import { deratedRating } from '../../../packages/shared/src/services/cable-calc.service.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// ─── CLI + env ───────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const INCLUDE_ISSUED = process.argv.includes('--include-issued')

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── Types ───────────────────────────────────────────────────────────────────

interface CableRow {
  id: string
  cable_no: number
  supply_id: string
  revision_id: string
  organisation_id: string
  size_mm2: number | string
  cores: '3' | '3+E' | '4'
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  installation_method: string | null
  depth_mm: number | string | null
  grouped_with: number | string | null
  grouping_arrangement: 'TOUCHING' | 'SPACING_D' | null
  ambient_temp_c: number | string | null
  thermal_resistivity_kmw: number | string | null
  derate_depth: number | string | null
  derate_thermal: number | string | null
  derate_grouping: number | string | null
  derate_temp: number | string | null
  derated_current_rating_a: number | string | null
  manual_override: boolean
  revision: { id: string; code: string; status: string; project_id: string } | null
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function close(a: number | null, b: number | null, eps = 1e-6): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(a - b) <= eps
}

// ─── Memoised lookups (many cables share the same spec / conditions) ────────

const propsCache = new Map<string, ReturnType<typeof lookupCableProperties>>()
function cachedProps(args: {
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  cores: '3' | '3+E' | '4'
  size_mm2: number
  projectId?: string
}) {
  const key = JSON.stringify(args)
  let hit = propsCache.get(key)
  if (!hit) {
    hit = lookupCableProperties(supabase as never, args)
    propsCache.set(key, hit)
  }
  return hit
}

const factorCache = new Map<string, ReturnType<typeof lookupDeratingFactors>>()
function cachedFactors(args: Parameters<typeof lookupDeratingFactors>[1]) {
  const key = JSON.stringify(args)
  let hit = factorCache.get(key)
  if (!hit) {
    hit = lookupDeratingFactors(supabase as never, args)
    factorCache.set(key, hit)
  }
  return hit
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Recompute cable derates — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}${INCLUDE_ISSUED ? ' + ISSUED revisions' : ''}`)

  // Page through every cable with its revision context.
  const PAGE = 1000
  const cables: CableRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase as never as {
      schema: (s: string) => { from: (t: string) => any }
    })
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, cable_no, supply_id, revision_id, organisation_id, size_mm2, cores, conductor, insulation, ' +
        'installation_method, depth_mm, grouped_with, grouping_arrangement, ambient_temp_c, thermal_resistivity_kmw, ' +
        'derate_depth, derate_thermal, derate_grouping, derate_temp, derated_current_rating_a, manual_override, ' +
        'revision:revisions!revision_id(id, code, status, project_id)',
      )
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('❌  Cable fetch failed:', error.message)
      process.exit(1)
    }
    const rows = (data ?? []) as CableRow[]
    cables.push(...rows)
    if (rows.length < PAGE) break
  }
  console.log(`Loaded ${cables.length} cables.`)

  let skippedFrozen = 0
  let unchanged = 0
  let changed = 0
  let failedWrites = 0
  let nullRatings = 0
  let rhoFixed = 0
  const changedByRevision = new Map<string, { code: string; count: number; rhoFixed: number }>()
  const affectedProjects = new Set<string>()
  const samples: string[] = []

  for (const c of cables) {
    const status = c.revision?.status ?? 'UNKNOWN'
    if (!INCLUDE_ISSUED && status !== 'DRAFT') {
      skippedFrozen++
      continue
    }

    const projectId = c.revision?.project_id
    const props = await cachedProps({
      conductor: c.conductor,
      insulation: c.insulation,
      cores: c.cores,
      size_mm2: num(c.size_mm2) ?? 0,
      projectId,
    })
    const baseRating =
      c.installation_method === 'DIRECT_IN_GROUND' ? props?.rating_direct_buried
      : c.installation_method === 'DUCT'           ? props?.rating_in_duct
      : props?.rating_in_air

    // Legacy soil-resistivity artifact (00167 §4): every pre-audit UI create
    // payload hardcoded 1.0 and the edit path never exposed the field, so a
    // stored 1.0 on a DRAFT cable is provably the old default, never a
    // measurement. Derive factors at the SANS reference 1.2 and write 1.2
    // back (belt-and-braces for rows the migration data fix didn't cover).
    // Frozen revisions keep their stored value even under --include-issued.
    const storedRho = num(c.thermal_resistivity_kmw)
    const legacyRho = status === 'DRAFT' && storedRho === 1
    const rho = legacyRho ? 1.2 : storedRho ?? 1.2

    const derate = await cachedFactors({
      depth_mm: num(c.depth_mm) ?? 500,
      thermal_resistivity_kmw: rho,
      grouped_with: num(c.grouped_with) ?? 1,
      ambient_c: num(c.ambient_temp_c) ?? 30,
      insulation: c.insulation,
      installation_method: c.installation_method,
      grouping_arrangement: c.grouping_arrangement ?? 'TOUCHING',
    })
    const nextRating = deratedRating(baseRating ?? null, {
      depth: derate.depth,
      thermal: derate.thermal,
      grouping: derate.grouping,
      temperature: derate.temperature,
    })
    const nextRatingRounded = nextRating == null ? null : Math.round(nextRating * 100) / 100
    if (nextRatingRounded == null) nullRatings++

    const same =
      close(num(c.derate_depth), derate.depth) &&
      close(num(c.derate_thermal), derate.thermal) &&
      close(num(c.derate_grouping), derate.grouping) &&
      close(num(c.derate_temp), derate.temperature) &&
      close(num(c.derated_current_rating_a), nextRatingRounded, 0.01)
    // A legacy-ρ row is a change even when the factors happen to agree —
    // the stored input value itself must be re-baselined to 1.2.
    if (same && !legacyRho) {
      unchanged++
      continue
    }

    changed++
    if (legacyRho) rhoFixed++
    const revKey = c.revision_id
    const entry = changedByRevision.get(revKey) ?? { code: c.revision?.code ?? '?', count: 0, rhoFixed: 0 }
    entry.count++
    if (legacyRho) entry.rhoFixed++
    changedByRevision.set(revKey, entry)

    if (samples.length < 20) {
      samples.push(
        `  ${c.conductor} ${c.insulation} ${num(c.size_mm2)}mm² [${c.installation_method ?? 'air'}, grp ${num(c.grouped_with) ?? 1}] ` +
        `${c.revision?.code ?? '?'}#${c.cable_no}: ` +
        `factors ${num(c.derate_depth)}/${num(c.derate_thermal)}/${num(c.derate_grouping)}/${num(c.derate_temp)} ` +
        `→ ${derate.depth}/${derate.thermal}/${derate.grouping}/${derate.temperature}; ` +
        `rating ${num(c.derated_current_rating_a) ?? '∅'} → ${nextRatingRounded ?? '∅'} A` +
        (legacyRho ? '; ρ 1.0 → 1.2' : ''),
      )
    }

    if (DRY_RUN) continue

    const { error: upErr } = await (supabase as never as {
      schema: (s: string) => { from: (t: string) => any }
    })
      .schema('cable_schedule')
      .from('cables')
      .update({
        ...(legacyRho ? { thermal_resistivity_kmw: 1.2 } : {}),
        derate_depth: derate.depth,
        derate_thermal: derate.thermal,
        derate_grouping: derate.grouping,
        derate_temp: derate.temperature,
        derated_current_rating_a: nextRatingRounded,
      })
      .eq('id', c.id)
    if (upErr) {
      failedWrites++
      console.error(`  ❌ update failed for cable ${c.id}: ${upErr.message}`)
    } else if (projectId) {
      affectedProjects.add(projectId)
    }
  }

  // One audit entry per affected revision (per-cable entries would flood).
  if (!DRY_RUN) {
    for (const [revisionId, entry] of changedByRevision) {
      const orgId = cables.find((c) => c.revision_id === revisionId)?.organisation_id
      if (!orgId) continue
      await (supabase as never as {
        schema: (s: string) => { from: (t: string) => any }
      })
        .schema('cable_schedule')
        .from('change_log')
        .insert({
          revision_id: revisionId,
          organisation_id: orgId,
          entity_type: 'revision',
          entity_id: revisionId,
          field_name: 'derate_recompute',
          old_value: null,
          new_value: `SANS-audit derate recompute (2026-07): ${entry.count} cable(s) updated` +
            (entry.rhoFixed > 0 ? `; ${entry.rhoFixed} legacy soil-resistivity value(s) re-baselined 1.0 → 1.2` : ''),
          reason: 'scripts/recompute-cable-derates.ts — conservative row selection + T6.3.3 buried grouping corrections' +
            (entry.rhoFixed > 0
              ? '; thermal_resistivity_kmw = 1.0 was the pre-audit hardcoded UI default (the edit path never exposed the field, so it was never a measurement) — substituted the SANS reference 1.2'
              : ''),
          changed_by: null,
        })
        .then(({ error }: { error: { message: string } | null }) => {
          if (error) console.error(`  ⚠ change_log insert failed for revision ${revisionId}: ${error.message}`)
        })
    }
  }

  // ── Tenant electrical rollup refresh (live sweeps only) ───────────────────
  // The sweep rewrites derated_current_rating_a, which feeds the persisted
  // structure.nodes incomer_* rollup (incomer_capacity_a / under-protected
  // flag). Refresh every affected project by invoking the canonical backfill
  // script — it wraps the same shared computeTenantElectrical the server
  // actions use, so the derivation stays single-sourced. Invoked as a child
  // process (tsx) because tenant-electrical.ts's extensionless internal
  // imports don't load under this script's --experimental-strip-types runtime.
  const rollupFailures: string[] = []
  if (!DRY_RUN && affectedProjects.size > 0) {
    console.log(`\nRefreshing tenant electrical rollups for ${affectedProjects.size} project(s)…`)
    for (const projectId of affectedProjects) {
      const r = spawnSync(
        'pnpm',
        ['--filter', '@esite/shared', 'exec', 'tsx', '../../scripts/db/backfill-tenant-electrical.ts'],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PROJECT_ID: projectId,
            NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
          },
          stdio: 'inherit',
        },
      )
      if (r.status !== 0) rollupFailures.push(projectId)
    }
  }

  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`Total cables:            ${cables.length}`)
  console.log(`Skipped (frozen rev):    ${skippedFrozen}${INCLUDE_ISSUED ? '' : '  (ISSUED/SUPERSEDED — rerun with --include-issued to sweep)'}`)
  console.log(`Unchanged:               ${unchanged}`)
  console.log(`${DRY_RUN ? 'Would change' : 'Changed'}:            ${changed}`)
  console.log(`Legacy ρ re-baselined:   ${rhoFixed}  (stored 1.0 → 1.2 — pre-audit UI default, DRAFT revisions only)`)
  console.log(`Now-null ratings:        ${nullRatings}  (missing SANS row / factor — honest null)`)
  if (!DRY_RUN) console.log(`Failed writes:           ${failedWrites}`)
  if (!DRY_RUN) console.log(`Rollups refreshed:       ${affectedProjects.size - rollupFailures.length}/${affectedProjects.size} project(s)`)
  if (changedByRevision.size > 0) {
    console.log('\nPer revision:')
    for (const [, entry] of changedByRevision) console.log(`  ${entry.code}: ${entry.count} cable(s)`)
  }
  if (samples.length > 0) {
    console.log(`\nFirst ${samples.length} diffs:`)
    for (const s of samples) console.log(s)
  }

  if (rollupFailures.length > 0) {
    console.error('\n⚠⚠⚠  TENANT ELECTRICAL ROLLUP REFRESH FAILED for the project(s) below.')
    console.error('The persisted structure.nodes incomer_* fields still reflect PRE-recompute')
    console.error('ratings there. Run each command manually from the repo root:')
    for (const id of rollupFailures) {
      console.error(
        `  PROJECT_ID=${id} NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \\\n` +
        '    pnpm --filter @esite/shared exec tsx ../../scripts/db/backfill-tenant-electrical.ts',
      )
    }
  }
  process.exit(failedWrites > 0 || rollupFailures.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('❌  Unhandled error:', e)
  process.exit(1)
})
