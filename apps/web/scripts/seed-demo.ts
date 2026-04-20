#!/usr/bin/env node --experimental-strip-types
/**
 * E-Site Demo Seed Script
 * =======================
 * Populates the database with a realistic South African electrical contractor
 * demo dataset. Safe to re-run — all inserts use ON CONFLICT DO NOTHING or
 * check existence first (idempotent).
 *
 * Usage:
 *   pnpm demo:seed
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
 *   apps/web/.env.local  (or set as env vars directly)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'

// ─── Env loading ─────────────────────────────────────────────────────────────

function loadEnv(envFile: string): Record<string, string> {
  if (!existsSync(envFile)) return {}
  const content = readFileSync(envFile, 'utf-8')
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    vars[key] = value
  }
  return vars
}

// Script lives at apps/web/scripts/seed-demo.ts — .env.local is one level up
const scriptDir = resolve(import.meta.dirname ?? process.cwd())
const envFile = resolve(scriptDir, '../.env.local')
const envVars = loadEnv(envFile)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? envVars.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envVars.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error(`   Looked in: ${envFile}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── Fixed UUIDs (idempotency) ────────────────────────────────────────────────

const IDs = {
  org:        'dddddddd-0000-0000-0000-000000000001',

  // Users
  uOwner:     'dddddddd-0000-0000-0001-000000000001',
  uPm:        'dddddddd-0000-0000-0001-000000000002',
  uField:     'dddddddd-0000-0000-0001-000000000003',
  uClient:    'dddddddd-0000-0000-0001-000000000004',

  // Projects
  pSandton:   'dddddddd-0000-0000-0002-000000000001',
  pMidrand:   'dddddddd-0000-0000-0002-000000000002',
  pCenturion: 'dddddddd-0000-0000-0002-000000000003',

  // Compliance Sites
  csSandton:   'dddddddd-0000-0000-0003-000000000001',
  csMidrand:   'dddddddd-0000-0000-0003-000000000002',
  csCenturion: 'dddddddd-0000-0000-0003-000000000003',

  // Suppliers
  sCbi:      'dddddddd-0000-0000-0005-000000000001',
  sSchneider:'dddddddd-0000-0000-0005-000000000002',
  sVoltex:   'dddddddd-0000-0000-0005-000000000003',
  sStalcor:  'dddddddd-0000-0000-0005-000000000004',
  sSafety:   'dddddddd-0000-0000-0005-000000000005',
}

const DEMO_PASSWORD = 'Demo@esite2025!'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ${msg}`) }
function section(title: string) { console.log(`\n▸ ${title}`) }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   E-Site Demo Seed                   ║')
  console.log('║   WM Electrical Contractors (Demo)   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`\nTarget: ${SUPABASE_URL}`)

  // ── 1. Demo users ─────────────────────────────────────────────────────────
  section('1/7  Auth users')

  const users = [
    { email: 'demo.owner@wmeng.co.za',  fullName: 'Arno Watson (Demo)',    role: 'owner' },
    { email: 'demo.pm@wmeng.co.za',     fullName: 'Luan Matthheus (Demo)', role: 'project_manager' },
    { email: 'demo.field@wmeng.co.za',  fullName: 'Sipho Dlamini (Demo)',  role: 'contractor' },
    { email: 'demo.client@wmeng.co.za', fullName: 'Sarah Khumalo (Demo)',  role: 'client_viewer' },
  ]

  const createdUsers: Record<string, any> = {}
  for (const u of users) {
    const { data: list } = await supabase.auth.admin.listUsers()
    const existing = list?.users?.find((x: any) => x.email === u.email)
    if (existing) {
      log(`↩ Exists: ${u.email}`)
      createdUsers[u.email] = existing
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: u.fullName },
      })
      if (error) { log(`⚠ ${u.email}: ${error.message}`); continue }
      log(`✓ Created: ${u.email}`)
      createdUsers[u.email] = data.user
    }
  }

  const ownerUser  = createdUsers['demo.owner@wmeng.co.za']
  const pmUser     = createdUsers['demo.pm@wmeng.co.za']
  const fieldUser  = createdUsers['demo.field@wmeng.co.za']
  const clientUser = createdUsers['demo.client@wmeng.co.za']

  if (!ownerUser) throw new Error('Owner user creation failed — cannot continue')

  // ── 2. Organisation ───────────────────────────────────────────────────────
  section('2/7  Organisation')

  const { error: orgErr } = await supabase
    .from('organisations')
    .upsert({
      id:                IDs.org,
      name:              'Watson Matthheus Electrical',
      slug:              'wm-electrical-demo',
      province:          'Gauteng',
      subscription_tier: 'professional',
    }, { onConflict: 'id', ignoreDuplicates: true })

  if (orgErr) log(`⚠ org: ${orgErr.message}`)
  else log('✓ Organisation: Watson Matthheus Electrical')

  // Memberships
  const memberships = [
    { user_id: ownerUser.id,   role: 'owner',           is_active: true },
    { user_id: pmUser?.id,     role: 'project_manager', is_active: true },
    { user_id: fieldUser?.id,  role: 'contractor',      is_active: true },
    { user_id: clientUser?.id, role: 'client_viewer',   is_active: true },
  ].filter((m) => m.user_id)

  for (const m of memberships) {
    const { error } = await supabase.from('user_organisations').upsert(
      { ...m, organisation_id: IDs.org },
      { onConflict: 'user_id,organisation_id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ membership ${m.role}: ${error.message}`)
    else log(`✓ Member: ${m.role}`)
  }

  // ── 3. Projects ───────────────────────────────────────────────────────────
  section('3/7  Projects')

  const projects = [
    {
      id:              IDs.pSandton,
      organisation_id: IDs.org,
      created_by:      ownerUser.id,
      name:            'Sandton City Office Tower — DB Upgrade',
      description:     'Full distribution board replacement and earthing upgrade across 12 office floors. Includes MCC panel refurbishment in basement plant room.',
      address:         '5th Street & Rivonia Road',
      city:            'Sandton',
      province:        'Gauteng',
      client_name:     'Growthpoint Properties',
      contract_value:  2_850_000,
      status:          'active',
      start_date:      '2026-01-15',
      end_date:        '2026-08-31',
    },
    {
      id:              IDs.pMidrand,
      organisation_id: IDs.org,
      created_by:      ownerUser.id,
      name:            'Midrand Business Estate — Phase 2 New Build',
      description:     'Complete electrical installation for 8 commercial units. MV/LV substation, metering, DB boards, fire detection integration.',
      address:         '14 Waterfall Drive',
      city:            'Midrand',
      province:        'Gauteng',
      client_name:     'Eaton Development Group',
      contract_value:  5_420_000,
      status:          'active',
      start_date:      '2025-11-01',
      end_date:        '2026-10-15',
    },
    {
      id:              IDs.pCenturion,
      organisation_id: IDs.org,
      created_by:      ownerUser.id,
      name:            'Centurion Industrial Park — Unit 12 Fitout',
      description:     'Light industrial fitout: 3-phase incomer, MCC panel, lighting, power outlets, compressed air supply wiring, emergency lighting.',
      address:         '42 Akkerboom Road, Hennopspark',
      city:            'Centurion',
      province:        'Gauteng',
      client_name:     'Bateleur Logistics (Pty) Ltd',
      contract_value:  980_000,
      status:          'active',
      start_date:      '2026-02-10',
      end_date:        '2026-06-30',
    },
  ]

  for (const p of projects) {
    const { error } = await (supabase as any).schema('projects').from('projects').upsert(
      p, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ project ${p.name}: ${error.message}`)
    else log(`✓ Project: ${p.name}`)
  }

  // Project members
  const projectMembers = [
    { project_id: IDs.pSandton,   user_id: ownerUser.id,   organisation_id: IDs.org, role: 'project_manager', is_active: true },
    { project_id: IDs.pSandton,   user_id: pmUser?.id,     organisation_id: IDs.org, role: 'project_manager', is_active: true },
    { project_id: IDs.pSandton,   user_id: fieldUser?.id,  organisation_id: IDs.org, role: 'contractor',      is_active: true },
    { project_id: IDs.pMidrand,   user_id: ownerUser.id,   organisation_id: IDs.org, role: 'project_manager', is_active: true },
    { project_id: IDs.pMidrand,   user_id: pmUser?.id,     organisation_id: IDs.org, role: 'project_manager', is_active: true },
    { project_id: IDs.pCenturion, user_id: ownerUser.id,   organisation_id: IDs.org, role: 'project_manager', is_active: true },
    { project_id: IDs.pCenturion, user_id: fieldUser?.id,  organisation_id: IDs.org, role: 'contractor',      is_active: true },
    { project_id: IDs.pCenturion, user_id: clientUser?.id, organisation_id: IDs.org, role: 'client_viewer',   is_active: true },
  ].filter((m) => m.user_id)

  for (const m of projectMembers) {
    const { error } = await (supabase as any).schema('projects').from('project_members').upsert(
      m, { onConflict: 'project_id,user_id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ project_member: ${error.message}`)
  }
  log(`✓ ${projectMembers.length} project memberships`)

  // ── 4. Snags ──────────────────────────────────────────────────────────────
  section('4/7  Snags')

  const snags = [
    // Sandton — critical
    {
      id: 'dddddddd-0000-0000-0004-000000000001',
      project_id: IDs.pSandton, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'DB room door damaged — fire rating fully compromised on Floor 7',
      description: 'The DB room fire door has been removed from its hinges and not replaced. The room is exposed, creating a non-compliant installation and safety risk.',
      location: 'Floor 7 — Electrical DB Room', category: 'safety', priority: 'critical', status: 'open',
    },
    {
      id: 'dddddddd-0000-0000-0004-000000000002',
      project_id: IDs.pSandton, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'Phase reversal detected on MCC feeder — motors at risk of reverse rotation',
      description: 'Phase rotation tester confirmed L1/L3 reversed on incomer to MCC panel in basement plant room. All motors currently locked out.',
      location: 'Basement Plant Room — MCC Panel', category: 'electrical', priority: 'critical', status: 'in_progress',
      assigned_to: pmUser?.id,
    },
    // Sandton — high
    {
      id: 'dddddddd-0000-0000-0004-000000000003',
      project_id: IDs.pSandton, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'Missing earth continuity bonding on structural steelwork (Levels 3–5)',
      description: 'Earth bonding conductors not installed on steel columns as per design drawing E-04. Required per SANS 10142-1 clause 5.4.6.',
      location: 'Levels 3, 4 and 5 — Structural Steel', category: 'electrical', priority: 'high', status: 'open',
    },
    {
      id: 'dddddddd-0000-0000-0004-000000000004',
      project_id: IDs.pSandton, organisation_id: IDs.org, raised_by: pmUser?.id ?? ownerUser.id,
      title: 'Undersized cable used on sub-incomer from TPN board DB-04A',
      description: '10mm² cable installed where 16mm² is specified on design drawing E-07B. Current carrying capacity insufficient for load demand.',
      location: 'Floor 4 — TPN Board DB-04A', category: 'electrical', priority: 'high', status: 'pending_sign_off',
      assigned_to: ownerUser.id,
    },
    // Sandton — medium
    {
      id: 'dddddddd-0000-0000-0004-000000000005',
      project_id: IDs.pSandton, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'Conduit penetration through fire wall not fire-sealed (Floor 2 comms room)',
      description: '50mm conduit passes through 2-hour fire wall between comms room and corridor. Gap around conduit not sealed with intumescent material.',
      location: 'Floor 2 — Comms Room / Corridor', category: 'general', priority: 'medium', status: 'open',
    },
    {
      id: 'dddddddd-0000-0000-0004-000000000006',
      project_id: IDs.pSandton, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'Cable tray supports insufficient — 42m run sagging on Level 9',
      description: 'Cable tray support spacing exceeds 1.2m maximum in the 42m horizontal run on Level 9. Tray noticeably sagging under cable load.',
      location: 'Level 9 — Main Cable Tray Run', category: 'electrical', priority: 'medium', status: 'in_progress',
    },
    // Midrand — various
    {
      id: 'dddddddd-0000-0000-0004-000000000007',
      project_id: IDs.pMidrand, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'No isolation facility provided for HVAC disconnect switch — Unit 3',
      description: 'HVAC disconnect switch installed without upstream isolation point. Cannot safely isolate for maintenance without de-energising whole board.',
      location: 'Unit 3 — HVAC Plant Room', category: 'electrical', priority: 'critical', status: 'open',
    },
    {
      id: 'dddddddd-0000-0000-0004-000000000008',
      project_id: IDs.pMidrand, organisation_id: IDs.org, raised_by: pmUser?.id ?? ownerUser.id,
      title: 'DB board labelling incomplete — circuits 14–22 unlabelled in Unit 5',
      description: 'Circuit breakers 14 through 22 have no labelling. As-built drawings show dedicated circuits for server room, kitchen and security.',
      location: 'Unit 5 — DB Board DB-05', category: 'documentation', priority: 'medium', status: 'resolved',
    },
    // Centurion
    {
      id: 'dddddddd-0000-0000-0004-000000000009',
      project_id: IDs.pCenturion, organisation_id: IDs.org, raised_by: fieldUser?.id ?? ownerUser.id,
      title: 'Junction box cover plate missing — corridor outside workshop',
      description: 'Surface-mount junction box in corridor is missing cover plate. Live terminals exposed. Box is at 1.4m height accessible to workers.',
      location: 'Workshop Corridor — Bay 7', category: 'safety', priority: 'low', status: 'open',
    },
    {
      id: 'dddddddd-0000-0000-0004-000000000010',
      project_id: IDs.pCenturion, organisation_id: IDs.org, raised_by: ownerUser.id,
      title: 'Emergency lighting battery backup test: 3 fittings below 3-hour threshold',
      description: 'Monthly battery test revealed 3 emergency luminaires with runtime below 3-hour SANS requirement. Units EM-07, EM-12, EM-19 need replacement.',
      location: 'Various — Workshop and Offices', category: 'safety', priority: 'high', status: 'signed_off',
      assigned_to: fieldUser?.id,
    },
  ]

  let snagCount = 0
  for (const s of snags) {
    const { error } = await (supabase as any).schema('field').from('snags').upsert(
      s, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ snag: ${error.message}`)
    else snagCount++
  }
  log(`✓ ${snagCount} snags created`)

  // ── 5. Compliance ─────────────────────────────────────────────────────────
  section('5/7  Compliance sites & subsections')

  const sites = [
    {
      id: IDs.csSandton, organisation_id: IDs.org, created_by: ownerUser.id,
      name: 'Sandton City Office Tower', address: '5th Street & Rivonia Road, Sandton',
      city: 'Sandton', province: 'Gauteng', erf_number: 'ERF 2847', site_type: 'commercial', status: 'active',
    },
    {
      id: IDs.csMidrand, organisation_id: IDs.org, created_by: ownerUser.id,
      name: 'Midrand Business Estate — Units 1–8', address: '14 Waterfall Drive, Midrand',
      city: 'Midrand', province: 'Gauteng', erf_number: 'ERF 1092', site_type: 'commercial', status: 'active',
    },
    {
      id: IDs.csCenturion, organisation_id: IDs.org, created_by: ownerUser.id,
      name: 'Centurion Industrial Park — Unit 12', address: '42 Akkerboom Road, Hennopspark, Centurion',
      city: 'Centurion', province: 'Gauteng', erf_number: 'ERF 556', site_type: 'industrial', status: 'active',
    },
  ]

  for (const s of sites) {
    const { error } = await (supabase as any).schema('compliance').from('sites').upsert(
      s, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ site ${s.name}: ${error.message}`)
    else log(`✓ Compliance site: ${s.name}`)
  }

  const subsectionsBySite: Record<string, Array<{ name: string; sans_ref?: string; coc_status: string; sort_order: number; description?: string }>> = {
    [IDs.csSandton]: [
      { sort_order: 1, name: 'Main Incomer & Metering',        sans_ref: 'SANS 10142-1:5.2',  coc_status: 'approved',     description: 'MV/LV transformer incomer, metering cubicle and main earth bar.' },
      { sort_order: 2, name: 'Distribution Board DB-Main',     sans_ref: 'SANS 10142-1:7.3',  coc_status: 'approved',     description: 'Main distribution board feeding all sub-DBs.' },
      { sort_order: 3, name: 'Distribution Board DB-L3',       sans_ref: 'SANS 10142-1:7.3',  coc_status: 'approved',     description: 'Level 3 office distribution board.' },
      { sort_order: 4, name: 'Distribution Board DB-L4',       sans_ref: 'SANS 10142-1:7.3',  coc_status: 'under_review', description: 'Level 4 office distribution board — pending inspector sign-off.' },
      { sort_order: 5, name: 'Distribution Board DB-L5',       sans_ref: 'SANS 10142-1:7.3',  coc_status: 'submitted',    description: 'Level 5 office distribution board.' },
      { sort_order: 6, name: 'Earthing & Bonding System',      sans_ref: 'SANS 10142-1:5.4',  coc_status: 'rejected',     description: 'Main earth electrode, bonding conductors and earth continuity.' },
      { sort_order: 7, name: 'Surge Protection (SPD)',         sans_ref: 'SANS 10142-1:9.10', coc_status: 'approved',     description: 'Type 1 and Type 2 SPDs at main board.' },
      { sort_order: 8, name: 'Emergency Lighting System',      sans_ref: 'SANS 10400-T',      coc_status: 'under_review', description: 'Central battery emergency lighting with 3-hour backup.' },
      { sort_order: 9, name: 'Earth Leakage Protection',       sans_ref: 'SANS 10142-1:7.5',  coc_status: 'approved',     description: 'ELCB/RCD devices on all final circuits.' },
    ],
    [IDs.csMidrand]: [
      { sort_order: 1, name: 'Main Incomer (All Units)',        sans_ref: 'SANS 10142-1:5.2',  coc_status: 'approved',  description: 'LV incomer and bulk metering.' },
      { sort_order: 2, name: 'Distribution Board — Unit 1',    sans_ref: 'SANS 10142-1:7.3',  coc_status: 'approved',  description: 'Sub-DB for Unit 1.' },
      { sort_order: 3, name: 'Distribution Board — Unit 2',    sans_ref: 'SANS 10142-1:7.3',  coc_status: 'approved',  description: 'Sub-DB for Unit 2.' },
      { sort_order: 4, name: 'Distribution Board — Unit 3',    sans_ref: 'SANS 10142-1:7.3',  coc_status: 'submitted', description: 'Sub-DB for Unit 3 — submitted for review.' },
      { sort_order: 5, name: 'Distribution Board — Unit 4',    sans_ref: 'SANS 10142-1:7.3',  coc_status: 'missing',   description: 'Sub-DB for Unit 4 — installation not yet complete.' },
      { sort_order: 6, name: 'Earthing & Bonding',             sans_ref: 'SANS 10142-1:5.4',  coc_status: 'approved',  description: 'Earth electrode array and bonding.' },
      { sort_order: 7, name: 'Surge Protection (SPD)',         sans_ref: 'SANS 10142-1:9.10', coc_status: 'approved',  description: 'Type 2 SPD at main incomer board.' },
      { sort_order: 8, name: 'External Supply Point',          sans_ref: 'SANS 10142-1:4.1',  coc_status: 'approved',  description: 'City Power supply point and service connection.' },
    ],
    [IDs.csCenturion]: [
      { sort_order: 1, name: 'Main Incomer & MCC Panel',       sans_ref: 'SANS 10142-1:5.2',  coc_status: 'approved',  description: 'Main incomer, isolator and motor control centre.' },
      { sort_order: 2, name: 'Distribution Board DB-Workshop', sans_ref: 'SANS 10142-1:7.3',  coc_status: 'approved',  description: 'Workshop power distribution board.' },
      { sort_order: 3, name: 'Distribution Board DB-Office',   sans_ref: 'SANS 10142-1:7.3',  coc_status: 'approved',  description: 'Office area distribution board.' },
      { sort_order: 4, name: 'Earthing & Bonding System',      sans_ref: 'SANS 10142-1:5.4',  coc_status: 'approved',  description: 'Earth electrode, bonding to steel structure and equipment.' },
      { sort_order: 5, name: 'Emergency Lighting',             sans_ref: 'SANS 10400-T',      coc_status: 'submitted', description: 'Self-contained emergency luminaires throughout facility.' },
      { sort_order: 6, name: 'Hazardous Area Wiring',          sans_ref: 'SANS 10108',        coc_status: 'missing',   description: 'Ex-rated wiring in battery charging area (Zone 2).' },
    ],
  }

  let subCount = 0
  let subId = 1
  for (const [siteId, subsections] of Object.entries(subsectionsBySite)) {
    for (const sub of subsections) {
      const id = `eeeeeeee-0000-0000-${String(subId).padStart(4, '0')}-000000000001`
      const { error } = await (supabase as any).schema('compliance').from('subsections').upsert(
        { id, site_id: siteId, organisation_id: IDs.org, ...sub },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      if (error) log(`⚠ subsection ${sub.name}: ${error.message}`)
      else subCount++
      subId++
    }
  }
  log(`✓ ${subCount} compliance subsections`)

  // ── 6. Marketplace suppliers & catalogue ──────────────────────────────────
  section('6/7  Marketplace suppliers')

  const suppliers = [
    { id: IDs.sCbi,       name: 'CBI Electric Africa',                trading_name: 'CBI Electric',      categories: ['electrical'],              province: 'Gauteng',     is_verified: true,  is_active: true },
    { id: IDs.sSchneider, name: 'Schneider Electric South Africa',    trading_name: 'Schneider Electric', categories: ['electrical', 'mechanical'], province: 'Gauteng',     is_verified: true,  is_active: true },
    { id: IDs.sVoltex,    name: 'Voltex Electrical Distributors',     trading_name: 'Voltex',             categories: ['electrical'],              province: 'Gauteng',     is_verified: true,  is_active: true },
    { id: IDs.sStalcor,   name: 'Stalcor Steel & Aluminium Products', trading_name: 'Stalcor',            categories: ['civil'],                   province: 'Gauteng',     is_verified: false, is_active: true },
    { id: IDs.sSafety,    name: 'Safety First PPE & Workwear',        trading_name: 'Safety First',       categories: ['safety', 'general'],       province: 'Western Cape', is_verified: true,  is_active: true },
  ]

  for (const s of suppliers) {
    const { error } = await (supabase as any).schema('suppliers').from('suppliers').upsert(
      s, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ supplier ${s.name}: ${error.message}`)
    else log(`✓ Supplier: ${s.name}`)
  }

  const catItems = [
    { id: 'ffffffff-0000-0000-0001-000000000001', supplier_id: IDs.sCbi,       name: 'CBI 3P 63A MCB C-Curve',           sku: 'CBI-3P-63A-C',   category: 'electrical', unit: 'each',   unit_price:  185.00, min_order_qty:   1, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0001-000000000002', supplier_id: IDs.sCbi,       name: 'CBI 1P 20A MCB B-Curve',           sku: 'CBI-1P-20A-B',   category: 'electrical', unit: 'each',   unit_price:   42.50, min_order_qty:  10, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0001-000000000003', supplier_id: IDs.sCbi,       name: 'CBI 4P 40A ELCB 30mA',             sku: 'CBI-ELCB-4P-40', category: 'electrical', unit: 'each',   unit_price:  320.00, min_order_qty:   1, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0002-000000000001', supplier_id: IDs.sVoltex,    name: 'Copper Cable 16mm² 3-Core',        sku: 'CAB-CU-16-3C',   category: 'electrical', unit: 'm',      unit_price:   95.00, min_order_qty:  50, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0002-000000000002', supplier_id: IDs.sVoltex,    name: 'Copper Cable 6mm² Single',         sku: 'CAB-CU-6-1C',    category: 'electrical', unit: 'm',      unit_price:   28.50, min_order_qty: 100, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0002-000000000003', supplier_id: IDs.sVoltex,    name: 'Steel Conduit 20mm × 3m',          sku: 'CON-ST-20-3M',   category: 'electrical', unit: 'length', unit_price:   35.00, min_order_qty:  20, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0003-000000000001', supplier_id: IDs.sSchneider, name: 'Acti9 iC60N 3P 32A MCB',          sku: 'SE-IC60N-3P-32', category: 'electrical', unit: 'each',   unit_price:  245.00, min_order_qty:   1, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0003-000000000002', supplier_id: IDs.sSchneider, name: 'iQuick PRD 40r Type 2 SPD',       sku: 'SE-PRD40R',      category: 'electrical', unit: 'each',   unit_price:  890.00, min_order_qty:   1, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0004-000000000001', supplier_id: IDs.sSafety,    name: 'Arc Flash Face Shield Class 1',   sku: 'PPE-ARC-FS-1',   category: 'safety',     unit: 'each',   unit_price:  420.00, min_order_qty:   1, marketplace_visible: true },
    { id: 'ffffffff-0000-0000-0004-000000000002', supplier_id: IDs.sSafety,    name: 'Class 00 Insulated Gloves',       sku: 'PPE-GLOVES-00',  category: 'safety',     unit: 'pair',   unit_price:  185.00, min_order_qty:   2, marketplace_visible: true },
  ]

  for (const item of catItems) {
    const { error } = await (supabase as any).schema('marketplace').from('catalogue_items').upsert(
      { ...item, currency: 'ZAR', is_active: true },
      { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ catalogue item ${item.name}: ${error.message}`)
  }
  log(`✓ ${catItems.length} catalogue items`)

  const orders = [
    {
      id: 'cccccccc-0000-0000-0001-000000000001',
      contractor_org_id: IDs.org, supplier_id: IDs.sCbi,
      created_by: pmUser?.id ?? ownerUser.id,
      status: 'confirmed', notes: 'Urgent — required for DB upgrade on Floor 4',
      total_amount: 1340.00,
    },
    {
      id: 'cccccccc-0000-0000-0001-000000000002',
      contractor_org_id: IDs.org, supplier_id: IDs.sVoltex,
      created_by: ownerUser.id,
      status: 'in_transit', notes: 'Cable run for Midrand Phase 2 Units 3-8',
      total_amount: 18750.00,
    },
  ]

  for (const o of orders) {
    const { error } = await (supabase as any).schema('marketplace').from('orders').upsert(
      o, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ order: ${error.message}`)
    else log(`✓ Order: ${o.id.slice(-6)} — ${o.status} (R${o.total_amount.toLocaleString()})`)
  }

  // Table is order_items (not order_lines); line_total is a generated column — omit it
  const orderItems = [
    { id: 'cccccccc-0000-0000-0002-000000000001', order_id: orders[0].id, catalogue_item_id: catItems[0].id, description: 'CBI 3P 63A MCB C-Curve',     quantity:   4, unit: 'each', unit_price:  185.00 },
    { id: 'cccccccc-0000-0000-0002-000000000002', order_id: orders[0].id, catalogue_item_id: catItems[2].id, description: 'CBI 4P 40A ELCB 30mA',        quantity:   1, unit: 'each', unit_price:  320.00 },
    { id: 'cccccccc-0000-0000-0002-000000000003', order_id: orders[1].id, catalogue_item_id: catItems[3].id, description: 'Copper Cable 16mm² 3-Core',   quantity: 150, unit: 'm',    unit_price:   95.00 },
    { id: 'cccccccc-0000-0000-0002-000000000004', order_id: orders[1].id, catalogue_item_id: catItems[4].id, description: 'Copper Cable 6mm² Single',    quantity: 150, unit: 'm',    unit_price:   28.50 },
  ]

  for (const item of orderItems) {
    const { error } = await (supabase as any).schema('marketplace').from('order_items').upsert(
      item, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ order item: ${error.message}`)
  }
  log(`✓ ${orderItems.length} order items`)

  // ── 7. Site diary entries ─────────────────────────────────────────────────
  section('7/7  Site diary entries')

  const diaryEntries = [
    {
      id: 'bbbbbbbb-0000-0000-0001-000000000001',
      project_id: IDs.pSandton, organisation_id: IDs.org, created_by: fieldUser?.id ?? ownerUser.id,
      entry_date: '2026-04-14', entry_type: 'progress',
      progress_notes: 'Completed cable tray installation on Level 6 and 7. Cable pulling commenced on Level 7 north wing. DB-L7 box installed and ready for terminations.',
      workers_on_site: 8, weather: 'Clear',
    },
    {
      id: 'bbbbbbbb-0000-0000-0001-000000000002',
      project_id: IDs.pSandton, organisation_id: IDs.org, created_by: fieldUser?.id ?? ownerUser.id,
      entry_date: '2026-04-15', entry_type: 'safety',
      progress_notes: 'Toolbox talk at 07:30 — working at heights. All workers signed attendance.',
      safety_notes: 'Toolbox talk conducted at 07:30 — focus on working at heights in open cable trays. All workers signed attendance. 1 PPE non-compliance noted (no safety glasses) — corrected immediately. No incidents.',
      workers_on_site: 8, weather: 'Clear',
    },
    {
      id: 'bbbbbbbb-0000-0000-0001-000000000003',
      project_id: IDs.pSandton, organisation_id: IDs.org, created_by: pmUser?.id ?? ownerUser.id,
      entry_date: '2026-04-16', entry_type: 'delay',
      progress_notes: 'Diverted team to Level 9 terminations during delay.',
      delay_notes: 'Work on Level 8 suspended for 4 hours — civil contractor poured screed on electrical conduit trench before sign-off. Defect raised. Screed will need to be broken out.',
      workers_on_site: 8, weather: 'Overcast',
    },
    {
      id: 'bbbbbbbb-0000-0000-0001-000000000004',
      project_id: IDs.pMidrand, organisation_id: IDs.org, created_by: fieldUser?.id ?? ownerUser.id,
      entry_date: '2026-04-14', entry_type: 'progress',
      progress_notes: 'MV substation transformer installed and energised. LV incomer cables pulled and terminated. Commissioned Units 1 and 2 main DBs. COC inspections scheduled for next week.',
      workers_on_site: 6, weather: 'Sunny',
    },
    {
      id: 'bbbbbbbb-0000-0000-0001-000000000005',
      project_id: IDs.pCenturion, organisation_id: IDs.org, created_by: fieldUser?.id ?? ownerUser.id,
      entry_date: '2026-04-15', entry_type: 'progress',
      progress_notes: 'MCC panel wiring complete. Final 3-phase testing and megger tests completed on all circuits. Waiting for City of Tshwane council connection.',
      workers_on_site: 3, weather: 'Windy',
    },
  ]

  let diaryCount = 0
  for (const e of diaryEntries) {
    const { error } = await (supabase as any).schema('projects').from('site_diary_entries').upsert(
      e, { onConflict: 'id', ignoreDuplicates: true }
    )
    if (error) log(`⚠ diary entry: ${error.message}`)
    else diaryCount++
  }
  log(`✓ ${diaryCount} diary entries`)

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   Seed complete ✓                    ║')
  console.log('╚══════════════════════════════════════╝')
  console.log('\nDemo credentials (password: Demo@esite2025!):\n')
  console.log('  demo.owner@wmeng.co.za  — Owner / Admin')
  console.log('  demo.pm@wmeng.co.za     — Project Manager')
  console.log('  demo.field@wmeng.co.za  — Field Worker')
  console.log('  demo.client@wmeng.co.za — Client Viewer')
  console.log('\nAll users are members of: Watson Matthheus Electrical\n')
}

seed().catch((err) => {
  console.error('\n❌  Seed failed:', err.message)
  process.exit(1)
})
