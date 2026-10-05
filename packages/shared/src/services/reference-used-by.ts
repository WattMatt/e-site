/**
 * Which calculator reads a reference table — derived from the code paths
 * themselves (the codes tableCodeFor returns, the derating lookup's tables,
 * the SANS tables that cite those), never maintained by hand.
 */
import { CITED_SANS_10142_1_YEAR, DERATING_TABLE_CODES, RATING_TABLE_CODES } from './sans-lookup.service'
import { LEGACY_CROSSCHECKS } from '../standards/crosscheck'
import { tableCode } from '../standards/dataset'

export interface UsedBy {
  calculator: string
  /** What the calculator takes from the table. */
  use: string
  /** Where to open it. Cable schedules live inside a project. */
  href: string
}

const CABLE_SCHEDULE = 'Cable schedule'
const OPEN_PROJECT = '/projects'

export function referenceUsedBy(code: string): UsedBy[] {
  const out: UsedBy[] = []
  if ((RATING_TABLE_CODES as readonly string[]).includes(code)) {
    out.push({ calculator: CABLE_SCHEDULE, use: 'fills in the impedance and base current rating when you pick a cable size', href: OPEN_PROJECT })
  }
  if ((DERATING_TABLE_CODES as readonly string[]).includes(code)) {
    out.push({ calculator: CABLE_SCHEDULE, use: 'multiplies the base rating by this derating factor', href: OPEN_PROJECT })
  }
  const cites = LEGACY_CROSSCHECKS.filter(
    (m) => (DERATING_TABLE_CODES as readonly string[]).includes(m.legacyCode)
      && tableCode('SANS 10142-1', CITED_SANS_10142_1_YEAR, m.sansClause) === code,
  )
  if (cites.length > 0) {
    out.push({
      calculator: CABLE_SCHEDULE,
      use: 'shows this table and page as the source of its derating factors (the values are identical)',
      href: OPEN_PROJECT,
    })
  }
  return out
}
