/**
 * Every string drawn into a Solar PDF goes through here (spec §0.4 rule 7). winAnsiSafe maps
 * Ω, ≤, →, etc.; ✓ and ✗ have no ASCII reading there (they become "?"), so they are spelled out
 * first. collapseWhitespace:false because react-pdf line-breaks on "\n" natively — collapsing is a
 * pdf-lib constraint, and applying it here would flatten every multi-line field.
 */
import { winAnsiSafe } from '@/lib/pdf/winansi'

const SPELLED: Record<string, string> = { '✓': 'Yes', '✔': 'Yes', '✗': 'No', '✘': 'No' }

export function pdfText(s: string): string {
  return winAnsiSafe(s.replace(/[✓✔✗✘]/g, (c) => SPELLED[c]!), { collapseWhitespace: false })
}
