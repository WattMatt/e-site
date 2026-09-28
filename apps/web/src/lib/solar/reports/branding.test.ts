import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { solarBranding, NEUTRAL_ACCENT, NO_BRANDING_WARNING } from './branding'

const data = { orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' }
const meta = { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: '2026-09-29' }

describe('solarBranding', () => {
  it('no branding: org name as wordmark, a NEUTRAL accent (never the E-Site amber) and a warning', () => {
    const r = solarBranding(data, meta)
    expect(r.branding.accent).toBe(NEUTRAL_ACCENT)
    expect(r.branding.accent.toUpperCase()).not.toBe('#E69500')
    expect(r.branding.issuer).toEqual({ wordmark: 'Sun Co' })
    expect(r.warning).toBe(NO_BRANDING_WARNING)
  })
  it('org accent and logo win; no warning', () => {
    const r = solarBranding({ ...data, orgAccent: '#0055AA', orgLogoDataUri: 'data:image/png;base64,AAAA' }, meta)
    expect(r.branding.accent.toLowerCase()).toBe('#0055aa')
    expect(r.branding.issuer).toEqual({ logoSrc: 'data:image/png;base64,AAAA' })
    expect(r.warning).toBeNull()
  })
  it('project accent beats org accent', () => {
    expect(solarBranding({ ...data, orgAccent: '#0055AA', projectAccent: '#AA5500' }, meta).branding.accent.toLowerCase()).toBe('#aa5500')
  })
  it('an unusable accent string falls back to NEUTRAL, not to the default amber', () => {
    expect(solarBranding({ ...data, orgAccent: 'not-a-colour' }, meta).branding.accent).toBe(NEUTRAL_ACCENT)
  })
  it('sanitises every drawn string', () => {
    const r = solarBranding({ ...data, orgName: 'Ω Power ✓', projectName: 'Mall → North' }, meta)
    expect(r.branding.issuer).toEqual({ wordmark: 'Ohm Power Yes' })
    expect(r.branding.projectLine).toBe('Mall -> North')
  })
})

describe('no hard-coded Watson Mattheus in Solar report code (spec §9.2)', () => {
  it('holds for every Solar report/proposal source file', () => {
    const SRC = path.resolve(__dirname, '../../..')
    const roots = ['lib/solar/reports', 'lib/solar/proposals', 'components/solar/proposal', 'app/(proposal)']
    const offenders: string[] = []
    for (const r of roots) {
      const dir = path.join(SRC, r)
      if (!fs.existsSync(dir)) continue
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) walk(f)
          else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /watson|mattheus|wm consult|wmeng|#e69500/i.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(SRC, f))
        }
      }
      walk(dir)
    }
    expect(offenders).toEqual([])
  })
})
