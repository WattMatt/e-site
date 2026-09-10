import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No email template may hardcode a hostname as the visible text of a link.
 *
 * Why this exists. Four templates set `href` to the caller's `siteUrl` — which
 * is correct — and then hardcoded the anchor's *visible text* as
 * `app.e-site.live`. That host has no DNS record. It is the host behind the
 * invite incident that stranded all 14 invitees by burning their single-use
 * token on a dead page.
 *
 * So the link worked and the text lied: every QC report, RFI, snag-visit and
 * lifecycle email told its reader they were going to a hostname that does not
 * resolve. Nothing failed, nothing errored, and no test noticed — the templates
 * were only ever asserted on their `href`.
 *
 * The fix derives the label from the URL, so the two can never disagree again.
 * This test is what keeps it that way: it reads the shipped template sources and
 * fails if a hostname is written literally between `>` and `</a>`.
 *
 * It is deliberately a source scan rather than a render assertion. A render test
 * would have to know which `siteUrl` was passed, and the defect was precisely
 * that the label ignored `siteUrl` altogether.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')

const TEMPLATES = [
  'apps/edge-functions/supabase/functions/_shared/email-templates/base.ts',
  'packages/shared/src/email/qc-email.ts',
  'packages/shared/src/email/rfi-email.ts',
  'packages/shared/src/email/snag-visit-email.ts',
]

/** Matches a hostname sitting as literal anchor text: `>www.example.com</a>`. */
const LITERAL_HOST_LABEL = />\s*[a-z0-9-]+(\.[a-z0-9-]+)+\s*<\/a>/gi

describe('email templates never hardcode a host as link text', () => {
  it.each(TEMPLATES)('%s derives its footer label from siteUrl', (relPath) => {
    const source = readFileSync(join(REPO_ROOT, relPath), 'utf8')
    const offenders = source.match(LITERAL_HOST_LABEL) ?? []

    expect(
      offenders,
      `${relPath} writes a hostname as literal link text: ${offenders.join(', ')}. ` +
        'Derive it from the URL instead, e.g. ' +
        "`${siteUrl.replace(/^https?:\\/\\//, '')}`, so the text cannot " +
        'disagree with the href. See the invite incident: app.e-site.live has no DNS record.',
    ).toEqual([])
  })

  it('specifically contains no reference to the DNS-less invite-incident host', () => {
    for (const relPath of TEMPLATES) {
      const source = readFileSync(join(REPO_ROOT, relPath), 'utf8')
      expect(source, `${relPath} still names app.e-site.live`).not.toContain('app.e-site.live')
    }
  })
})
