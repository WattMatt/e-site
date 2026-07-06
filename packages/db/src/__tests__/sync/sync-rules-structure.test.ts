import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest runs with cwd = packages/db; repo root is two levels up.
const RULES_PATH = resolve(process.cwd(), '..', '..', 'supabase', 'powersync', 'sync-rules.yaml')
const yaml = readFileSync(RULES_PATH, 'utf8')

/** Return the text of a top-level (2-space indented) bucket block, or '' if absent. */
function bucketBlock(name: string): string {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => l.replace(/\s+$/, '') === `  ${name}:`)
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\S/.test(lines[i])) { end = i; break }
  }
  return lines.slice(start, end).join('\n')
}

describe('sync-rules.yaml: project_access bucket', () => {
  const block = bucketBlock('project_access')

  it('defines a project_access bucket', () => {
    expect(block).not.toBe('')
  })

  it('parameterises project_id by expanding the JWT project_ids array', () => {
    expect(block).toContain("json_each(request.jwt() -> 'project_ids')")
    expect(block).toMatch(/SELECT\s+value\s+AS\s+project_id\s+FROM\s+json_each/i)
  })

  it('scopes every data query by bucket.project_id and never by org', () => {
    expect(block).toContain('bucket.project_id')
    expect(block).not.toContain('bucket.org_id')
    // one bucket.project_id reference per data query (>= number of "- SELECT" lines)
    const selects = (block.match(/^\s*- SELECT/gm) ?? []).length
    const refs = (block.match(/bucket\.project_id/g) ?? []).length
    expect(selects).toBeGreaterThanOrEqual(8)
    expect(refs).toBeGreaterThanOrEqual(selects)
  })

  it('syncs the project row with the same columns as org_projects', () => {
    // Normalise whitespace: the data query spans multiple YAML lines.
    const flat = block.replace(/\s+/g, ' ')
    expect(flat).toContain('id, name, status, city, province, organisation_id')
    expect(flat).toContain('FROM projects WHERE id = bucket.project_id')
  })

  it('leaves the existing org_projects bucket untouched', () => {
    expect(bucketBlock('org_projects')).toContain('WHERE organisation_id = bucket.org_id')
  })
})
