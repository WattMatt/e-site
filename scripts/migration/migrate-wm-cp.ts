/**
 * T-058: WM CP Data Migration Script
 *
 * ETL from dual legacy Supabase projects into e-site v2 schema.
 *
 * Source projects:
 *   - oltzgidkjxwsukvkomof  (compliance data)
 *   - rsdisaisxdglmdmzmkyw  (nexus / project management data)
 *
 * Target:
 *   - New e-site Supabase project (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
 *
 * Usage:
 *   LEGACY_COMPLIANCE_URL=https://oltzgidkjxwsukvkomof.supabase.co \
 *   LEGACY_COMPLIANCE_KEY=<service_role_key> \
 *   LEGACY_NEXUS_URL=https://rsdisaisxdglmdmzmkyw.supabase.co \
 *   LEGACY_NEXUS_KEY=<service_role_key> \
 *   SUPABASE_URL=<new_url> \
 *   SUPABASE_SERVICE_ROLE_KEY=<new_service_key> \
 *   FOUNDER_ORG_NAME="Watson Mattheus" \
 *   DRY_RUN=true \
 *   npx ts-node scripts/migration/migrate-wm-cp.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ─── Config ──────────────────────────────────────────────────────────────────

const COMPLIANCE_URL  = process.env.LEGACY_COMPLIANCE_URL!
const COMPLIANCE_KEY  = process.env.LEGACY_COMPLIANCE_KEY!
const NEXUS_URL       = process.env.LEGACY_NEXUS_URL!
const NEXUS_KEY       = process.env.LEGACY_NEXUS_KEY!
const TARGET_URL      = process.env.SUPABASE_URL!
const TARGET_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY!
const FOUNDER_ORG_NAME = process.env.FOUNDER_ORG_NAME ?? 'Watson Mattheus'
const DRY_RUN         = process.env.DRY_RUN === 'true'
const BATCH_SIZE      = 100

if (!COMPLIANCE_URL || !COMPLIANCE_KEY || !NEXUS_URL || !NEXUS_KEY || !TARGET_URL || !TARGET_KEY) {
  console.error('Missing required environment variables. See file header for usage.')
  process.exit(1)
}

const compliance = createClient(COMPLIANCE_URL, COMPLIANCE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const nexus = createClient(NEXUS_URL, NEXUS_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const target = createClient(TARGET_URL, TARGET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Counters ─────────────────────────────────────────────────────────────────

const stats = {
  orgs: 0,
  profiles: 0,
  memberships: 0,
  projects: 0,
  sites: 0,
  subsections: 0,
  cocUploads: 0,
  snags: 0,
  errors: 0,
}

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`) }
function warn(msg: string) { console.warn(`[WARN] ${msg}`); stats.errors++ }

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchAll<T>(client: SupabaseClient, table: string, schema?: string): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    const q = schema
      ? (client as any).schema(schema).from(table)
      : client.from(table)
    const { data, error } = await q
      .select('*')
      .range(offset, offset + BATCH_SIZE - 1)
    if (error) { warn(`fetchAll ${table}: ${error.message}`); break }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < BATCH_SIZE) break
    offset += BATCH_SIZE
  }
  return rows
}

async function insert<T extends object>(
  client: SupabaseClient,
  table: string,
  rows: T[],
  schema?: string,
  onConflict?: string
) {
  if (DRY_RUN) {
    log(`[DRY RUN] Would insert ${rows.length} rows into ${schema ? schema + '.' : ''}${table}`)
    return
  }
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const q = schema
      ? (client as any).schema(schema).from(table)
      : client.from(table)
    const uq = onConflict
      ? q.upsert(batch, { onConflict, ignoreDuplicates: true })
      : q.insert(batch)
    const { error } = await uq
    if (error) warn(`insert ${table} @${i}: ${error.message}`)
  }
}

// ─── Migration steps ─────────────────────────────────────────────────────────

async function migrateFounderOrg(): Promise<string> {
  log(`Creating founder org: ${FOUNDER_ORG_NAME}`)
  const { data, error } = DRY_RUN
    ? { data: { id: 'dry-run-org-id' }, error: null }
    : await target.from('organisations').insert({
        name: FOUNDER_ORG_NAME,
        slug: 'watson-mattheus',
        subscription_tier: 'professional',
        type: 'contractor',
      }).select('id').single()

  if (error) {
    // May already exist — try to find it
    const { data: existing } = await target.from('organisations')
      .select('id').eq('slug', 'watson-mattheus').single()
    if (existing) {
      log(`Founder org already exists: ${existing.id}`)
      return existing.id
    }
    throw new Error(`create founder org: ${error.message}`)
  }
  stats.orgs++
  log(`Founder org created: ${data!.id}`)
  return data!.id
}

async function migrateProfiles(sourceClient: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  log('Migrating profiles...')
  const legacyProfiles = await fetchAll<any>(sourceClient, 'profiles')
  log(`Found ${legacyProfiles.length} legacy profiles`)

  const idMap = new Map<string, string>() // legacyId → newId

  for (const profile of legacyProfiles) {
    // In v2, profiles are linked 1:1 to auth.users via Supabase's auth.admin API
    // Since we can't migrate password hashes directly without admin access,
    // we create placeholder profiles and send password reset emails
    const newProfile = {
      email: profile.email,
      full_name: profile.full_name ?? profile.name ?? 'Unknown',
      phone: profile.phone ?? null,
      avatar_url: profile.avatar_url ?? null,
    }

    if (!DRY_RUN) {
      // Invite user to new project (triggers email with set-password link)
      const { data: authUser, error: inviteErr } = await (target.auth.admin as any)
        .inviteUserByEmail(profile.email, {
          data: { full_name: newProfile.full_name, migrated_from: 'wm-cp-v1' },
        })
      if (inviteErr && !inviteErr.message.includes('already registered')) {
        warn(`invite user ${profile.email}: ${inviteErr.message}`)
        continue
      }
      const newId = authUser?.user?.id
      if (newId) {
        idMap.set(profile.id, newId)
        stats.profiles++
      }
    } else {
      idMap.set(profile.id, `dry-run-${profile.id}`)
      stats.profiles++
    }
  }

  log(`Migrated ${stats.profiles} profiles`)
  return idMap
}

async function migrateComplianceSites(
  orgId: string,
  profileMap: Map<string, string>
): Promise<Map<string, string>> {
  log('Migrating compliance sites...')
  const legacySites = await fetchAll<any>(compliance, 'sites')
  log(`Found ${legacySites.length} legacy compliance sites`)

  const siteMap = new Map<string, string>()

  const newSites = legacySites.map((s: any) => ({
    id: s.id,  // Preserve UUID for subsection FK integrity
    organisation_id: orgId,
    name: s.name ?? s.site_name ?? 'Unnamed Site',
    address: s.address ?? s.street_address ?? null,
    city: s.city ?? null,
    province: s.province ?? null,
    erf_number: s.erf_number ?? s.erf ?? null,
    site_type: s.site_type ?? 'residential',
    status: s.status ?? 'active',
    created_by: profileMap.get(s.created_by) ?? profileMap.values().next().value ?? null,
    created_at: s.created_at,
  }))

  await insert(target, 'sites', newSites, 'compliance', 'id')
  newSites.forEach(s => siteMap.set(s.id, s.id))
  stats.sites += newSites.length

  log(`Migrated ${newSites.length} compliance sites`)
  return siteMap
}

async function migrateSubsections(
  orgId: string,
  siteMap: Map<string, string>
): Promise<void> {
  log('Migrating subsections...')
  const legacySubs = await fetchAll<any>(compliance, 'subsections')
  log(`Found ${legacySubs.length} legacy subsections`)

  const newSubs = legacySubs
    .filter((s: any) => siteMap.has(s.site_id))
    .map((s: any) => ({
      id: s.id,
      site_id: siteMap.get(s.site_id)!,
      organisation_id: orgId,
      name: s.name ?? s.subsection_name ?? 'Unnamed',
      description: s.description ?? null,
      sans_ref: s.sans_ref ?? s.sans_reference ?? null,
      sort_order: s.sort_order ?? 0,
      coc_status: s.coc_status ?? 'missing',
    }))

  await insert(target, 'subsections', newSubs, 'compliance', 'id')
  stats.subsections += newSubs.length
  log(`Migrated ${newSubs.length} subsections`)
}

async function migrateCocUploads(
  orgId: string,
  profileMap: Map<string, string>
): Promise<void> {
  log('Migrating COC uploads...')
  const legacyUploads = await fetchAll<any>(compliance, 'coc_uploads')
  log(`Found ${legacyUploads.length} legacy COC uploads`)

  // Note: File paths will need to be re-organised in storage
  // Legacy path format: likely different from v2 pattern
  // v2 pattern: coc-uploads/{orgId}/{subsectionId}/{filename}

  const newUploads = legacyUploads.map((u: any) => ({
    id: u.id,
    subsection_id: u.subsection_id,
    organisation_id: orgId,
    file_path: u.file_path ?? u.storage_path ?? `migrated/${u.id}`,
    file_size_bytes: u.file_size_bytes ?? u.size ?? null,
    status: u.status ?? 'approved',
    uploaded_by: profileMap.get(u.uploaded_by) ?? null,
    reviewed_by: profileMap.get(u.reviewed_by) ?? null,
    reviewed_at: u.reviewed_at ?? null,
    version: u.version ?? 1,
    created_at: u.created_at,
  }))

  await insert(target, 'coc_uploads', newUploads, 'compliance', 'id')
  stats.cocUploads += newUploads.length
  log(`Migrated ${newUploads.length} COC uploads`)
}

async function migrateProjects(
  orgId: string,
  profileMap: Map<string, string>
): Promise<Map<string, string>> {
  log('Migrating projects from nexus...')
  const legacyProjects = await fetchAll<any>(nexus, 'projects')
  log(`Found ${legacyProjects.length} legacy projects`)

  const projectMap = new Map<string, string>()

  const newProjects = legacyProjects.map((p: any) => ({
    id: p.id,
    organisation_id: orgId,
    name: p.name ?? p.project_name ?? 'Unnamed Project',
    description: p.description ?? null,
    address: p.address ?? p.site_address ?? null,
    city: p.city ?? null,
    province: p.province ?? null,
    status: p.status ?? 'active',
    start_date: p.start_date ?? null,
    end_date: p.end_date ?? p.due_date ?? null,
    contract_value: p.contract_value ?? p.value ?? null,
    client_name: p.client_name ?? p.client ?? null,
    client_contact: p.client_contact ?? p.client_email ?? null,
    created_by: profileMap.get(p.created_by) ?? profileMap.values().next().value ?? null,
    created_at: p.created_at,
  }))

  await insert(target, 'projects', newProjects, 'projects', 'id')
  newProjects.forEach(p => projectMap.set(p.id, p.id))
  stats.projects += newProjects.length

  log(`Migrated ${newProjects.length} projects`)
  return projectMap
}

async function migrateSnags(
  orgId: string,
  projectMap: Map<string, string>,
  profileMap: Map<string, string>
): Promise<void> {
  log('Migrating snags from nexus...')
  const legacySnags = await fetchAll<any>(nexus, 'snags')
  log(`Found ${legacySnags.length} legacy snags`)

  const newSnags = legacySnags
    .filter((s: any) => projectMap.has(s.project_id))
    .map((s: any) => ({
      id: s.id,
      project_id: projectMap.get(s.project_id)!,
      organisation_id: orgId,
      title: s.title ?? s.description?.slice(0, 100) ?? 'Unnamed Snag',
      description: s.description ?? null,
      location: s.location ?? null,
      category: s.category ?? null,
      priority: s.priority ?? 'medium',
      status: s.status ?? 'open',
      raised_by: profileMap.get(s.raised_by) ?? null,
      assigned_to: profileMap.get(s.assigned_to) ?? null,
      signed_off_by: profileMap.get(s.signed_off_by) ?? null,
      signed_off_at: s.signed_off_at ?? null,
      created_at: s.created_at,
    }))

  await insert(target, 'snags', newSnags, 'field', 'id')
  stats.snags += newSnags.length
  log(`Migrated ${newSnags.length} snags`)
}

// ─── Row count verification ───────────────────────────────────────────────────

async function verifyRowCounts(orgId: string): Promise<void> {
  log('\n=== Row Count Verification ===')

  const checks = [
    { label: 'compliance.sites', schema: 'compliance', table: 'sites' },
    { label: 'compliance.subsections', schema: 'compliance', table: 'subsections' },
    { label: 'compliance.coc_uploads', schema: 'compliance', table: 'coc_uploads' },
    { label: 'projects.projects', schema: 'projects', table: 'projects' },
    { label: 'field.snags', schema: 'field', table: 'snags' },
  ]

  for (const { label, schema, table } of checks) {
    const { count } = await (target as any)
      .schema(schema)
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
    log(`  ${label}: ${count ?? 0} rows`)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log(`\n${'='.repeat(60)}`)
  log(`E-Site v2 — WM CP Data Migration`)
  log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  log(`${'='.repeat(60)}\n`)

  try {
    // 1. Create founder org
    const orgId = await migrateFounderOrg()

    // 2. Migrate profiles (from compliance source, which likely has all users)
    const profileMap = await migrateProfiles(compliance, orgId)

    // 3. Compliance data
    const siteMap = await migrateComplianceSites(orgId, profileMap)
    await migrateSubsections(orgId, siteMap)
    await migrateCocUploads(orgId, profileMap)

    // 4. Project / field data
    const projectMap = await migrateProjects(orgId, profileMap)
    await migrateSnags(orgId, projectMap, profileMap)

    // 5. Verify
    if (!DRY_RUN) await verifyRowCounts(orgId)

    // 6. Summary
    log('\n=== Migration Summary ===')
    log(`  Organisations:  ${stats.orgs}`)
    log(`  Profiles:       ${stats.profiles}`)
    log(`  Projects:       ${stats.projects}`)
    log(`  Sites:          ${stats.sites}`)
    log(`  Subsections:    ${stats.subsections}`)
    log(`  COC Uploads:    ${stats.cocUploads}`)
    log(`  Snags:          ${stats.snags}`)
    log(`  Errors:         ${stats.errors}`)

    if (stats.errors > 0) {
      log('\n⚠️  Migration completed with errors. Check warnings above.')
      process.exit(1)
    } else {
      log('\n✅ Migration completed successfully!')
    }
  } catch (err: any) {
    console.error('FATAL:', err.message)
    process.exit(1)
  }
}

main()
