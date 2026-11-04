import { describe, it, expect } from 'vitest'
import type { ToolContext } from './define-tool'
import { createEsiteServer } from './server'

describe('createEsiteServer', () => {
  it('hands the client the open-database instructions, verbatim', () => {
    const server = createEsiteServer({} as ToolContext)
    const instructions = (server.server as unknown as { _instructions?: string })._instructions
    expect(instructions).toBe(
      "Every tool acts as the signed-in E-Site user under the database's row security. Start with esite_whoami. esite_db_schemas lists tables and columns; esite_db_select reads any table; esite_db_sql runs one read-only SELECT, only for people who are owner, admin or project manager in every organisation AND on every project they belong to. esite_db_update and esite_db_delete first return a preview with a previewId; call again with that previewId within 24 hours to commit. In rows from esite_db_select, esite_db_insert, esite_db_update and esite_db_delete, cost figures are null for roles that may not see them. esite_db_sql results and esite_db_rpc results are not masked per row: who may run SQL, see cost keys in an rpc result, or filter and order on a cost column is decided by that same every-organisation-and-every-project rule. A few tables (memberships, billing, sealed bids, templates, the audit log) are not writable here. Inspection answers are not columns: each answer is a row in inspections.responses keyed by a text field_id, with the value in value_text, value_number, value_bool or pass_state; a repeating group is written as group[N].field, for example sub_feeds[3].meter_serial, so match with field_id like 'sub_feeds[%' and pivot by the suffix. Join inspections.inspections for project_id, target_label (the board) and template_id, and read field labels from inspections.templates.schema_json. Site forms use the same shape in field.form_responses.",
    )
  })
})
