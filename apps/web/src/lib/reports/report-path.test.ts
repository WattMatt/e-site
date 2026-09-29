import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isCanonicalReportPath, reportPathBelongsTo, CANONICAL_REPORT_PATH_SQL } from './report-path'

const O = 'aaaaaaaa-0000-4000-8000-000000000001'
const P = 'bbbbbbbb-0000-4000-8000-000000000001'
const X = 'cccccccc-0000-4000-8000-000000000003'

// storage-js builds `${url}/object/sign/${bucket}/${path}` unencoded and the WHATWG URL parser inside
// fetch rewrites `\` to `/`, deletes TAB/CR/LF and resolves `.`/`..`/`%2e%2e`, so a raw-string check on
// the path is not a check on the object that gets signed.
describe('isCanonicalReportPath', () => {
  it('accepts the shape every report writer produces', () => {
    for (const p of [
      `${O}/${P}/tenant-schedule-v3.pdf`,
      `${O}/${P}/equipment-materials-v1.pdf`,
      `${O}/${P}/qc-report-${X}-v2.pdf`,
      `${O}/${P}/snag-visit-${X}-v1.pdf`,
      `${O}/${P}/valuation-${X}-v4.pdf`,
      `${O}/${P}/inspection-${X}-v1.pdf`,
      `${O}/${P}/site-form-${X}-v1.pdf`,
      `${O}/${P}/cable-route-sheets/${X}-p2-v1.pdf`,
      `${O}/${P}/generator-cost-recovery/1785735377383-cfe9847b.pdf`,
    ]) expect(isCanonicalReportPath(p), p).toBe(true)
  })

  it('refuses every form the URL parser would rewrite into a different object', () => {
    for (const p of [
      `${O}/${P}/x\\f.pdf`,
      `${O}/${P}/x\ty/f.pdf`,
      `${O}/${P}/x\ry/f.pdf`,
      `${O}/${P}/x\ny/f.pdf`,
      `${O}/${P}/../../${X}/${X}/valuation-x.pdf`,
      `${O}/${P}/x/../f.pdf`,
      `${O}/${P}/./f.pdf`,
      `${O}/${P}/%2e%2e/%2e%2e/${X}/${X}/valuation-x.pdf`,
      `${O}/${P}/x%2Ff.pdf`,
      `${O}/${P}//f.pdf`,
      `${O}/${P}/f..pdf`,
      `${O}/${P}/f.pdf\n`,
      `${O}/${P}/f.pdf?x=1`,
      `${O}/${P}/f.pdf#x`,
      `${O}/${P}/f.png`,
      `/${O}/${P}/f.pdf`,
      `o1/p1/f.pdf`,
      '',
      null,
      undefined,
      42,
    ]) expect(isCanonicalReportPath(p), JSON.stringify(p)).toBe(false)
  })
})

describe('reportPathBelongsTo', () => {
  it('accepts a canonical path under the row’s own org and project', () => {
    expect(reportPathBelongsTo(`${O}/${P}/tenant-schedule-v1.pdf`, O, P)).toBe(true)
    expect(reportPathBelongsTo(`${O}/${P}/generator-cost-recovery/1-a.pdf`, O, P)).toBe(true)
  })

  it('refuses another project, another org, a traversal, or a missing owner', () => {
    expect(reportPathBelongsTo(`${O}/${X}/equipment-materials-v1.pdf`, O, P)).toBe(false)
    expect(reportPathBelongsTo(`${X}/${P}/tenant-schedule-v1.pdf`, O, P)).toBe(false)
    expect(reportPathBelongsTo(`${O}/${P}/../../${X}/${X}/x.pdf`, O, P)).toBe(false)
    expect(reportPathBelongsTo(`${O}/${P}x/f.pdf`, O, P)).toBe(false)
    expect(reportPathBelongsTo(`${O}/${P}/f.pdf`, null, P)).toBe(false)
    expect(reportPathBelongsTo(`${O}/${P}/f.pdf`, O, undefined)).toBe(false)
  })
})

describe('the SQL twin', () => {
  it('is the same pattern 00220 enforces on session-written report rows', () => {
    expect(CANONICAL_REPORT_PATH_SQL).toBe('^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\\.pdf$')
    const sql = readFileSync(
      resolve(__dirname, '../../../../edge-functions/supabase/migrations/00220_reports_storage_hardening.sql'), 'utf8')
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.report_path_belongs'))
    expect(fn).toContain(`coalesce(_path, '') ~ '${CANONICAL_REPORT_PATH_SQL}'`)
    expect(fn).toContain(`strpos(_path, '..') = 0`)
    expect(fn).toContain(`starts_with(_path, _org::text || '/' || _project::text || '/')`)
  })
})
