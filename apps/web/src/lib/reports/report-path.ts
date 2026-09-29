/**
 * The one shape every projects.reports writer produces: `<org uuid>/<project uuid>/[dir/…]<file>.pdf`.
 *
 * Why an allowlist and not a pattern search (review round 3): storage-js builds
 * `${url}/object/sign/${bucket}/${path}` WITHOUT encoding, and the WHATWG URL parser inside fetch then
 * turns `\` into `/`, deletes TAB/CR/LF and resolves `.`, `..` and `%2e%2e` segments. A raw-string check
 * (a `startsWith` prefix, a `/solar-reports/` search) therefore describes a string, not the object that
 * gets signed: `…/solar-reports\f.pdf` signs `…/solar-reports/f.pdf`, and `A/P/../../C/Q/x.pdf` signs
 * another org's object. Directory segments admit no dot and no `%`, the file name must end `.pdf`, and
 * `..` is refused outright, so no character the parser rewrites can appear.
 *
 * 00216 enforces the same pattern on every session-written report row
 * (reports_solar_service_only_insert / _update); report-path.test.ts pins the two together.
 */
export const CANONICAL_REPORT_PATH_SQL = '^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\\.pdf$'

const CANONICAL_REPORT_PATH = new RegExp(CANONICAL_REPORT_PATH_SQL)

export function isCanonicalReportPath(path: unknown): path is string {
  return typeof path === 'string' && CANONICAL_REPORT_PATH.test(path) && !path.includes('..')
}
