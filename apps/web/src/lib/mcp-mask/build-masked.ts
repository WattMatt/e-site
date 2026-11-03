// Candidates minus the allowlist plus the forced extras, shaped as the generated masked-columns.ts. Shared by the
// generator script and the contract test, so the file and its check cannot disagree about how the table is built.
import type { Candidate, TableInfo } from './mask-candidates'
import { isAllowlisted, MASK_EXTRA } from './allowlist'

/** Which column of a row names the project it belongs to: a project_id column, or `id` on projects.projects itself. */
export type ProjectKey = 'project_id' | 'id' | null
export type MaskedTable = { columns: string[]; projectKey: ProjectKey }

// Tables whose project is not in a project_id column.
const PROJECT_KEY_OVERRIDE: Record<string, ProjectKey> = { 'projects.projects': 'id' }

export function buildMasked(
  candidates: Candidate[], tables: Record<string, TableInfo>, extras: ReadonlyArray<Candidate> = MASK_EXTRA,
): { masked: Record<string, MaskedTable>; names: string[] } {
  const grouped: Record<string, Set<string>> = {}
  const add = (c: Candidate) => { (grouped[`${c.schema}.${c.table}`] ??= new Set()).add(c.column) }
  for (const c of candidates) if (!isAllowlisted(c)) add(c)
  for (const c of extras) add(c)
  const masked: Record<string, MaskedTable> = {}
  for (const k of Object.keys(grouped).sort()) {
    masked[k] = { columns: [...grouped[k]].sort(), projectKey: PROJECT_KEY_OVERRIDE[k] ?? (tables[k]?.hasProjectId ? 'project_id' : null) }
  }
  const names = [...new Set(Object.values(masked).flatMap(t => t.columns))].sort()
  return { masked, names }
}
