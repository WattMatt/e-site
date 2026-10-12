// Contract: nothing in the mobile app writes to a PowerSync-synced table.
//
// SupabaseConnector.uploadData is a no-op, so a local INSERT/UPDATE/DELETE on a
// synced table never reaches Supabase. Worse, it sits in PowerSync's CRUD queue
// for good, and while that queue is non-empty the SDK refuses every downloaded
// checkpoint — the device's whole offline copy stops updating. Writes go to
// Supabase directly (or through a non-synced local outbox table).
//
// The table list is read out of the PowerSync schema file itself, so a table
// added to the schema later is covered without editing this test.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOBILE = join(__dirname, '..', '..')
const SCHEMA = join(MOBILE, 'src', 'lib', 'powersync', 'schema.ts')

function syncedTables(): string[] {
  const src = readFileSync(SCHEMA, 'utf8')
  const block = src.match(/new Schema\(\{([\s\S]*?)\}\)/)
  if (!block) throw new Error('could not find `new Schema({ … })` in schema.ts')
  return block[1]
    .split(',')
    .map((s) => s.trim().split(':')[0].trim())
    .filter((s) => /^[a-z_][a-z0-9_]*$/i.test(s))
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

function stripComments(src: string): string {
  // Blank comments line-for-line so reported line numbers stay true.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('mobile never writes to PowerSync-synced tables', () => {
  const tables = syncedTables()

  it('reads the synced table list from schema.ts', () => {
    expect(tables).toEqual(expect.arrayContaining(['inspections', 'responses', 'snags']))
  })

  it('has no INSERT/UPDATE/DELETE/REPLACE on a synced table anywhere in app/ or src/', () => {
    const write = new RegExp(
      String.raw`\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+["\`]?(${tables.join('|')})\b`,
      'gi',
    )
    const hits: string[] = []
    for (const file of [...sourceFiles(join(MOBILE, 'app')), ...sourceFiles(join(MOBILE, 'src'))]) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, i) => {
        for (const m of line.matchAll(write)) hits.push(`${relative(MOBILE, file)}:${i + 1} → ${m[0]}`)
      })
    }
    expect(hits).toEqual([])
  })
})
