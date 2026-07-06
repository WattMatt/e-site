import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION = resolve(
  process.cwd(), '..', '..',
  'apps/edge-functions/supabase/migrations/00156_powersync_jwt_project_access.sql',
)
const sql = readFileSync(MIGRATION, 'utf8')

describe('00156: custom_jwt_claims adds a project_ids claim mirroring user_has_project_access clause (a)', () => {
  it('replaces the hook and preserves the org_id claim', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.custom_jwt_claims')
    expect(sql).toMatch(/jsonb_set\(_claims, '\{org_id\}'/)
  })

  it('computes project_ids from project_members joined to ACTIVE user_organisations', () => {
    expect(sql).toContain('projects.project_members')
    expect(sql).toMatch(/JOIN\s+public\.user_organisations\s+uo/i)
    expect(sql).toMatch(/uo\.user_id\s*=\s*pm\.user_id/i)
    expect(sql).toMatch(/uo\.organisation_id\s*=\s*pm\.organisation_id/i)
    expect(sql).toMatch(/uo\.is_active\s*=\s*TRUE/i)
    expect(sql).toMatch(/jsonb_agg\(DISTINCT pm\.project_id\)/i)
    expect(sql).toMatch(/jsonb_set\(_claims, '\{project_ids\}'/)
  })

  it('keeps the auth-admin grant and PUBLIC revoke intact', () => {
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) TO supabase_auth_admin')
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.custom_jwt_claims\(JSONB\) FROM PUBLIC/)
  })
})
