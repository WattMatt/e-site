import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * THE FOURTH-INSTANCE GUARD.
 *
 * The notifications settings panel accumulated the same defect four times: a
 * control that writes a column nothing reads, and a column with real
 * consequences and no control.
 *
 *   · notify_inspection_email — a toggle, ON for KINGSWALK since 2026-06-18,
 *     surfaced as cfg.inspectionEmail, ZERO consumers. Twelve weeks, no email.
 *   · notify_rfi_to           — a validator, a mapper, a restore entry, no sender.
 *   · notify_form_email       — defaults TRUE on all 14 projects, mails a whole
 *     roster a SANS 10142-1 safety record, and had no control at all. The
 *     DistributePanel told users to "turn on form notifications in project
 *     settings", a control that did not exist, in a branch nothing could reach.
 *   · the restore field list  — omitted four of the six toggles.
 *
 * These assertions are source-level ON PURPOSE. The defect is not a wrong value
 * a runtime test could observe; it is a control and a consumer drifting apart in
 * two different files, which nothing at runtime ever compares.
 */

const HERE = __dirname
const WEB_SRC = resolve(HERE, '../../../../../..')            // apps/web/src
const SHARED_SRC = resolve(WEB_SRC, '../../../packages/shared/src')

const panel = readFileSync(join(HERE, 'IntegrationsPanel.tsx'), 'utf8')
const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const mappers = readFileSync(join(SHARED_SRC, 'services/_project-settings-mappers.ts'), 'utf8')
const service = readFileSync(join(SHARED_SRC, 'services/project-settings.service.ts'), 'utf8')

/** camelCase notify_* boolean fields the mapper actually round-trips. */
function notifyBooleanFields(): string[] {
  return [...mappers.matchAll(/if \(patch\.(notify\w+) !== undefined\) out\.(notify_\w+)/g)]
    .filter((m) => !m[2].endsWith('_to'))
    .map((m) => m[1])
}

/** The `field:` values in the panel's TOGGLES array. */
function toggleFields(): string[] {
  const arr = panel.slice(panel.indexOf('const TOGGLES'))
  return [...arr.matchAll(/field: '(\w+)'/g)].map((m) => m[1])
}

/** getNotificationConfig's camelCase keys, e.g. notifySnagEmail → snagEmail. */
function cfgKeyFor(field: string): string {
  const bare = field.replace(/^notify/, '')
  return bare.charAt(0).toLowerCase() + bare.slice(1)
}

/** Every .ts/.tsx under apps/web/src plus packages/shared/src, minus tests. */
function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next') continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(name) && !/\.(test|contract\.test|integration\.test)\.tsx?$/.test(name)) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

const ALL_SOURCE = [...sourceFiles(WEB_SRC), ...sourceFiles(SHARED_SRC)].filter(
  (f) => !f.endsWith('project-settings.service.ts') && !f.endsWith('_project-settings-mappers.ts'),
)

/** Does any file outside the settings service read `cfg.<key>` / `.<key>`? */
function hasConsumer(cfgKey: string): boolean {
  const re = new RegExp(`\\.${cfgKey}\\b`)
  return ALL_SOURCE.some((f) => re.test(readFileSync(f, 'utf8')))
}

/**
 * Columns knowingly wired to nothing. An entry here is a decision with a
 * reason, not a leak: none of them may appear in TOGGLES.
 */
const KNOWINGLY_UNWIRED: Record<string, string> = {
  notifyInspectionEmail:
    'No inspection email sender exists. The toggle was REMOVED rather than left ' +
    'lying. Building the sender is the dangerous option, not the safe one: ' +
    "KINGSWALK's column is already true, so a sender would start mailing that " +
    'roster on the next deploy with nobody re-consenting. And the code\'s real ' +
    'events are inspection_assigned / inspection_awaiting_verification / ' +
    'inspection_abandoned — not the "scheduled or completed" the old copy ' +
    'promised. Pick the events, write copy to them, THEN add the toggle back.',
}

describe('the notifications panel may not render a control for something that does not happen', () => {
  it('every toggle in the panel drives a column something actually reads', () => {
    for (const field of toggleFields()) {
      const key = cfgKeyFor(field)
      expect(
        hasConsumer(key),
        `IntegrationsPanel offers "${field}", but nothing outside the project-settings ` +
          `service reads cfg.${key}. Either build the sender or remove the control.`,
      ).toBe(true)
    }
  })

  it('every notify_* boolean column either has a toggle or a written-down reason for not having one', () => {
    const toggles = new Set(toggleFields())
    for (const field of notifyBooleanFields()) {
      if (toggles.has(field)) continue
      expect(
        KNOWINGLY_UNWIRED,
        `${field} has no control and no recorded reason. notify_form_email spent ` +
          'months defaulting TRUE, mailing a safety record to a 19-person roster, ' +
          'with no way to turn it off — add it to TOGGLES or record why not.',
      ).toHaveProperty(field)
    }
  })

  it('a knowingly-unwired column is not ALSO offered as a control', () => {
    for (const field of Object.keys(KNOWINGLY_UNWIRED)) {
      expect(toggleFields()).not.toContain(field)
    }
  })

  it('every toggle is actually plumbed from the page, not just declared', () => {
    for (const field of toggleFields()) {
      const prop = `initial${field.charAt(0).toUpperCase()}${field.slice(1)}`
      expect(panel, `${prop} missing from IntegrationsPanel's Props`).toContain(prop)
      expect(page, `${prop} not passed by page.tsx — the control would render dead`).toContain(prop)
    }
  })

  it('the history restore rebuilds every notify_* column', () => {
    // patchToRow skips undefined, so a field missing from restore's explicit
    // patch is silently NOT restored — no error, just less than it says.
    const restore = service.slice(service.indexOf('async restore('), service.indexOf('// ─── Convenience bundles'))
    for (const field of notifyBooleanFields()) {
      expect(restore, `restore() omits ${field}`).toContain(`${field}: snap.${field}`)
    }
  })

  it('notifyRfiTo is gone from the schema, the mapper, the service and the restore', () => {
    expect(mappers).not.toContain('notify_rfi_to')
    expect(service).not.toContain('notifyRfiTo')
    expect(service).not.toContain('rfiTo:')
    expect(readFileSync(join(SHARED_SRC, 'schemas/project-settings.schema.ts'), 'utf8'))
      .not.toContain('notifyRfiTo:')
  })
})
