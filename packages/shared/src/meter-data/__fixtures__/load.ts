import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FixtureManifestEntry {
  id: string
  file: string
  format: string
  source: string
  sourceSha256: string
  window: [string, string] | null
  dataRows: number
}

const DIR = join(__dirname, 'corpus')

export function manifest(): FixtureManifestEntry[] {
  return JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as FixtureManifestEntry[]
}

/** Returns the fixture bytes and its (anonymised) file name. Test-only: uses node:fs. */
export function fixture(id: string): { bytes: Uint8Array; fileName: string } {
  const entry = manifest().find((m) => m.id === id)
  if (!entry) throw new Error(`no fixture ${id}`)
  return { bytes: new Uint8Array(readFileSync(join(DIR, entry.file))), fileName: entry.file }
}

export function registerFixture(name: string): { bytes: Uint8Array; fileName: string } {
  return { bytes: new Uint8Array(readFileSync(join(__dirname, 'register', name))), fileName: name }
}
