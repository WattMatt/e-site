// Candidates minus the allowlist, shaped as the generated masked-columns.ts. Shared by the generator script and
// the contract test, so the file and its check cannot disagree about how the table is built.
import type { Candidate, TableInfo } from './mask-candidates'
import { isAllowlisted } from './allowlist'

export type MaskedTable = { columns: string[]; hasProjectId: boolean }

export function buildMasked(candidates: Candidate[], tables: Record<string, TableInfo>): { masked: Record<string, MaskedTable>; names: string[] } {
  const grouped: Record<string, string[]> = {}
  for (const c of candidates) {
    if (isAllowlisted(c)) continue
    ;(grouped[`${c.schema}.${c.table}`] ??= []).push(c.column)
  }
  const masked: Record<string, MaskedTable> = {}
  for (const k of Object.keys(grouped).sort()) masked[k] = { columns: [...grouped[k]].sort(), hasProjectId: tables[k]?.hasProjectId ?? false }
  const names = [...new Set(Object.values(masked).flatMap(t => t.columns))].sort()
  return { masked, names }
}
