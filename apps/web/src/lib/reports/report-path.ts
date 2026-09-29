/**
 * The one shape every report writer produces: `<org uuid>/<project uuid>/[dir/…]<file>.pdf`.
 *
 * Why an allowlist and not a pattern search: storage-js builds
 * `${url}/object/sign/${bucket}/${path}` WITHOUT encoding, and the WHATWG URL parser inside fetch then
 * turns `\` into `/`, deletes TAB/CR/LF and resolves `.`, `..` and `%2e%2e` segments. A raw-string check
 * (a `startsWith` prefix) therefore describes a string, not the object that gets signed:
 * `A/P/../../C/Q/x.pdf` starts with `A/P/` and signs another org's object. Directory segments admit no
 * dot and no `%`, the file name must end `.pdf`, and `..` is refused outright, so no character the parser
 * rewrites can appear.
 *
 * Migration 00220 enforces the same rule on every session-written projects.reports and
 * gcr.report_revisions row (public.report_path_belongs); report-path.test.ts pins the two together.
 */
export const CANONICAL_REPORT_PATH_SQL = '^[0-9a-f-]{36}/[0-9a-f-]{36}/([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+\\.pdf$'

const CANONICAL_REPORT_PATH = new RegExp(CANONICAL_REPORT_PATH_SQL)

export function isCanonicalReportPath(path: unknown): path is string {
  return typeof path === 'string' && CANONICAL_REPORT_PATH.test(path) && !path.includes('..')
}

/**
 * True when `path` is canonical AND sits under `<orgId>/<projectId>/`. Every server path that hands a
 * stored report path to the SERVICE client (sign, download, remove) must check this first: the service
 * client bypasses storage RLS, so the row's own org and project are the only boundary left.
 */
export function reportPathBelongsTo(
  path: unknown,
  orgId: string | null | undefined,
  projectId: string | null | undefined,
): path is string {
  return (
    isCanonicalReportPath(path) &&
    !!orgId &&
    !!projectId &&
    path.startsWith(`${orgId}/${projectId}/`)
  )
}

/** The user-facing sentence for a refused path: says what happened, names nothing internal. */
export const REPORT_PATH_REFUSED = 'This report’s file could not be verified, so it cannot be opened.'
