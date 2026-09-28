import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RegistryEntry } from '../../packages/shared/src/tariffs/ingest/registry.ts'

/** The Net-Billing Rules PDF, relative to TARIFF_SOURCE_DIR (owner default 9). */
export const RULES_PDF = 'DOCUMENTATION/Net-Billing-Rules-licensed-Distributors.pdf'

export const DEFAULT_REGISTRY = resolve(import.meta.dirname, 'data/licensee-registry.json')

/** Reads the reviewed registry data file (scripts/tariffs/data/licensee-registry.json). */
export function loadRegistry(path: string = DEFAULT_REGISTRY): RegistryEntry[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries: (RegistryEntry & { sources?: unknown })[] }
  return raw.entries.map(({ name, kind, province, aliases, notes }) => ({ name, kind, province, aliases, notes: notes ?? null }))
}
