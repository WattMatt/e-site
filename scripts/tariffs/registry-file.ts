import { readFileSync } from 'node:fs'
import type { RegistryEntry } from '../../packages/shared/src/tariffs/ingest/registry.ts'

/** Reads the reviewed registry data file (scripts/tariffs/data/licensee-registry.json). */
export function loadRegistry(path: string): RegistryEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries: (RegistryEntry & { sources?: unknown })[] }
  return raw.entries.map(({ name, kind, province, aliases, notes }) => ({ name, kind, province, aliases, notes: notes ?? null }))
}
