// Shared helper utilities for validation rule files.
// COPIED FROM: validate-inspection/rules.ts (helpers section)
// Keep in sync if matching logic changes.

import type { RuleContext, ResponseRow } from './types.ts'

/**
 * Find a response whose field_id contains any of the given substrings (case-insensitive).
 * Heuristic: production templates use varying field-naming conventions; substring
 * matching against the field_id portion of the `section_id.field_id` map key covers them.
 */
export function findResponseByFieldId(ctx: RuleContext, ...patterns: string[]): ResponseRow | null {
  for (const [key, value] of ctx.responses.entries()) {
    const fieldId = key.split('.').pop() ?? ''
    const lc = fieldId.toLowerCase()
    if (patterns.some((p) => lc.includes(p.toLowerCase()))) return value
  }
  return null
}
