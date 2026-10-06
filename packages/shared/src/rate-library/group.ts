/**
 * Review-queue grouping: lines that read the same (heading + description +
 * unit, after normalisation) are reviewed once. Only the line's own heading
 * counts, so the same "20mm Ø" under CONDUIT in forty tenant bills is one group.
 */
import { normaliseText, normaliseUnit } from './normalise'

export function groupKey(sectionPath: string[], description: string, unit: string | null): string {
  return [normaliseText(sectionPath[sectionPath.length - 1] ?? ''), normaliseText(description), normaliseUnit(unit) ?? ''].join(' | ')
}
