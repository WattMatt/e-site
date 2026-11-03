import { it, expect } from 'vitest'
import * as S from './sentences'

it('holds the refusal sentences verbatim', () => {
  expect({ ...S }).toEqual({
    NEED_FILTER: 'Update and delete need at least one filter.',
    DENYLISTED: 'This table is managed in the app, not through Claude.',
    UNKNOWN_OP: 'Unknown filter operator.',
    BAD_IDENT: 'Column names must be plain identifiers.',
    MASKED_COLUMN: 'That column is not available to your role.',
    SQL_ONLY_SELECT: 'Only one read-only SELECT is allowed here.',
    PREVIEW_MISMATCH: 'That preview has expired or does not match; run the preview again.',
    PREVIEW_TOO_WIDE: 'That would touch more than 1000 rows; narrow the filter.',
    SQL_ROLE: 'SQL is for owners, admins and project managers; use esite_db_select.',
    UNKNOWN_SCHEMA: 'That schema is not exposed; call esite_db_schemas for the list.',
    EMPTY_PATCH: 'The patch is empty.',
  })
})
