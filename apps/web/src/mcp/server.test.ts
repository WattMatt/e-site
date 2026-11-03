import { describe, it, expect } from 'vitest'
import type { ToolContext } from './define-tool'
import { createEsiteServer } from './server'

describe('createEsiteServer', () => {
  it('hands the client the open-database instructions, verbatim', () => {
    const server = createEsiteServer({} as ToolContext)
    const instructions = (server.server as unknown as { _instructions?: string })._instructions
    expect(instructions).toBe(
      "Every tool acts as the signed-in E-Site user under the database's row security. Start with esite_whoami. esite_db_schemas lists tables and columns; esite_db_select reads any table; esite_db_sql runs one read-only SELECT (owners, admins and project managers). esite_db_update and esite_db_delete first return a preview with a previewId; call again with that previewId within 24 hours to commit. Cost figures are null for roles that may not see them. A few tables (memberships, billing, sealed bids, templates, the audit log) are not writable here.",
    )
  })
})
