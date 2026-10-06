// apps/web/src/lib/auth/service-client-gates.contract.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

/**
 * Every server file that reaches for the SERVICE client (RLS bypassed) must
 * prove the caller may see the project first. Site-scoped access
 * (spec 2026-10-01) only holds if no service-key path skips it.
 */
const WEB_SRC = resolve(__dirname, '../..')
const SERVICE = /createServiceClient|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/

/** Any of these in the file counts as a project gate (each is site-aware after the migration). */
const GATES = [
  'requireProjectAccess', 'requireEffectiveRole', 'requireSolarLevel', 'requireSolarLevelAPI', 'getSolarAccessLevel',
  'assertExportPolicy', 'getExportPolicy', 'requirePortalAccess', 'user_has_project_access', 'user_effective_project_role',
  'projectService.getById', 'requireVisibleProject', 'guardProjectAccess', 'requirePlatformTariffAdmin',
  // lib/tender/gate.ts: reads the tender AS THE CALLER (RLS + site_scope), then requireEffectiveRole.
  'gateTender',
]

/** Files with no project data, or gated by their caller / a signature. path (relative to src) -> reason */
const DECLARED: Record<string, string> = {
  'lib/supabase/server.ts': 'defines the clients',
  'instrumentation.ts': 'env presence check only',
  'middleware.ts': 'auth infra; reads own user_organisations',
  'app/api/health/route.ts': 'health probe',
  'app/(auth)/auth/callback/route.ts': 'auth infra',
  'app/auth/signout/route.ts': 'auth infra',
  'actions/account.actions.ts': 'own account',
  'actions/auth-event.actions.ts': 'own auth events',
  'actions/mfa.actions.ts': 'own MFA',
  'actions/security.actions.ts': 'own sessions',
  'actions/onboarding-email.actions.ts': 'own onboarding mail',
  'actions/unsubscribe.actions.ts': 'signed unsubscribe link',
  'actions/whatsapp-link.actions.ts': 'own WhatsApp link',
  'actions/data-request.actions.ts': 'public POPIA form',
  'actions/billing.actions.ts': 'org billing', 'actions/onboarding.actions.ts': 'org onboarding',
  'actions/org-branding.actions.ts': 'org branding', 'actions/seats.actions.ts': 'org seats',
  'actions/sub-org-members.actions.ts': 'org users', 'actions/users.actions.ts': 'org users',
  'actions/whatsapp-admin.actions.ts': 'platform WhatsApp settings', 'actions/project.actions.ts': 'creates a project',
  'actions/supplier.actions.ts': 'marketplace (exempt, spec §2)', 'actions/tariff-explorer.actions.ts': 'tariff library',
  'app/(admin)/settings/account/page.tsx': 'own account', 'app/(admin)/settings/branding/page.tsx': 'org',
  'app/(admin)/settings/users/page.tsx': 'org', 'app/(admin)/settings/whatsapp/page.tsx': 'platform',
  'app/(admin)/projects/[id]/settings/general/page.tsx': 'org name only, after requireRole',
  'app/(admin)/projects/[id]/settings/members/page.tsx': 'org owner only, after requireRole',
  'actions/tender-portal.actions.ts': 'tenderer portal: a tenderer is never a project member; the gate is the invitation token hash (lookup) and then the email-proved participant check inside the tender_* definer functions',
  'app/api/internal/whatsapp/forms/route.ts': 'HMAC-signed internal call; acts as the linked user',
  'app/api/internal/whatsapp/reports/route.ts': 'HMAC-signed internal call; gate in lib/whatsapp-reports/cable-schedule.ts (getExportPolicy for the named user)',
  'app/api/paystack/callback/route.ts': 'billing', 'app/api/paystack/mv-subscribe/route.ts': 'billing',
  'app/api/paystack/subaccount/route.ts': 'supplier billing', 'app/api/paystack/webhook/route.ts': 'HMAC webhook',
  'app/api/webhooks/resend/route.ts': 'svix webhook', 'app/api/notifications/dispatch/route.ts': 'bearer; notifications only',
  'app/inspection/[shareToken]/page.tsx': 'public share token with expiry/revocation',
  'lib/analytics/product-events.ts': 'caller-gated telemetry', 'lib/notifications.ts': 'caller-gated',
  'lib/notify.ts': 'caller-gated', 'lib/invite-email.ts': 'caller-gated', 'lib/jbcc/letterhead.ts': 'org letterhead',
  'lib/diary-email.ts': 'caller-gated', 'lib/qc-email.ts': 'caller-gated', 'lib/rfi-email.ts': 'caller-gated',
  'lib/site-form-email.ts': 'caller-gated', 'lib/snag-email.ts': 'caller-gated',
  'lib/reports/file-inspection-report.ts': 'caller-gated', 'lib/reports/file-site-form-report.ts': 'caller-gated',
  'lib/solar/activity.ts': 'caller-gated', 'lib/solar/audit.ts': 'caller-gated', 'lib/solar/grantors.ts': 'org',
  'lib/solar/notify.ts': 'caller-gated', 'lib/solar/pricing/pricing-hash.ts': 'HMAC key fallback only',
  'lib/solar/proposals/client.ts': 'share token or portal caller', 'lib/solar/proposals/email-toggle.ts': 'caller-gated',
  'lib/solar/proposals/notify.ts': 'caller-gated', 'lib/solar/access-panel.ts': 'solar_is_grantor rpc',
  'lib/tenant-electrical/recompute.ts': 'caller-gated', 'lib/whatsapp-forms/after-submit.ts': 'after HMAC / web submit',
  'lib/whatsapp/kick-worker.ts': 'kicks the worker', 'app/(admin)/admin/tariffs/reports/page.tsx': 'platform tariff admin',
  // Gated by a SESSION-client read first (RLS, site_scope applies); the service key only signs URLs / reads profiles.
  'actions/inspections.actions.ts': 'session select of inspections (RLS) + requireRole; svc reads profiles only',
  'actions/portal-qc.actions.ts': 'session select of qc_reports/reports (RLS) before svc signs the URL',
  'actions/snag.actions.ts': 'session-client update of the snag (RLS); svc key only forwarded to the notify edge function',
  'app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx': 'session select of the inspection (RLS); svc reads profiles',
  'app/api/inspections/upload-signature/route.ts': 'session select of the inspection (RLS) + status/role check',
  // Gated inside the report-data helper it calls (those files carry the gate and are scanned too).
  'app/api/projects/[id]/equipment-materials/reports/route.ts': 'gatherEquipmentMaterialsReportData -> requireEffectiveRole',
  'app/api/projects/[id]/generator-cost-recovery/reports/route.ts': 'gatherGeneratorReportData -> requireEffectiveRole',
  'app/api/projects/[id]/tenant-schedule/reports/route.ts': 'gatherTenantScheduleReportData -> projectService.getById (session, site_scope)',
  'lib/recipients.ts': 'caller-gated; filters recipients by project access',
  'lib/solar/meter-archive/apply.ts': 'library of the scripts/solar-meter-archive.ts CLI; no end-user path',
}

function strip(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
}
function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(f)
  }
  return out
}

describe('service-key files declare a project gate', () => {
  const files = walk(WEB_SRC).filter((f) => SERVICE.test(readFileSync(f, 'utf8')))

  it('finds the service-key files (sanity: the scan works)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('every one is gated or declared', () => {
    const bad = files
      .map((f) => relative(WEB_SRC, f))
      .filter((rel) => !(rel in DECLARED))
      .filter((rel) => !GATES.some((g) => strip(readFileSync(join(WEB_SRC, rel), 'utf8')).includes(g)))
    expect(bad, `service-key file with no project gate — add requireProjectAccess, or declare it with a reason:\n${bad.join('\n')}`).toEqual([])
  })

  it('every declared file still exists (no stale exemptions)', () => {
    const rels = new Set(files.map((f) => relative(WEB_SRC, f)))
    expect(Object.keys(DECLARED).filter((d) => !rels.has(d))).toEqual([])
  })
})
