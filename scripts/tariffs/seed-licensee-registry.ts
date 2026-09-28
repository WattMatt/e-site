/**
 * Seeds tariffs.licensee + tariffs.licensee_alias from the reviewed registry
 * data file (owner default 4). Run BEFORE any ingestion so every source
 * resolves its licensee by alias. DRY RUN BY DEFAULT: prints the plan and
 * writes nothing.
 *
 *   pnpm exec tsx scripts/tariffs/seed-licensee-registry.ts [--registry <json>] [--rules-pdf <pdf>] [--apply]
 *
 * Also seeds the reference documents (owner defaults 8, 9): the Net-Billing
 * Rules PDF (stored by sha256 in tariff-sources/reference/, cited by every
 * Eskom sseg_rule) and the URL-only Eskom 2026/27 increase decision.
 *
 * With NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, the dry run
 * reads the live registry (read-only) and plans against it; without them it
 * plans against an empty registry. --apply needs both and writes with the
 * service role. It never deletes or renames an existing licensee, and it
 * refuses to steal an alias another licensee holds (reported as a conflict).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { referenceDocuments } from '../../packages/shared/src/tariffs/ingest/reference-documents.ts'
import { planRegistrySeed, validateRegistry, type ExistingRegistry } from '../../packages/shared/src/tariffs/ingest/registry.ts'
import {
  applyLicenseeRegistrySeed, insertReferenceDocument, readLicenseeRegistry, referenceDocumentExists,
} from '../../packages/shared/src/tariffs/ingest/supabase-store.ts'
import { loadRegistry, RULES_PDF } from './registry-file.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

async function main(): Promise<void> {
  const entries = loadRegistry(arg('registry') ?? resolve(import.meta.dirname, 'data/licensee-registry.json'))
  const problems = validateRegistry(entries)
  if (problems.length > 0) {
    console.error(`registry is invalid:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  const apply = flag('apply')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (apply && (!url || !key)) {
    console.error('--apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  let existing: ExistingRegistry = { licensees: [], aliases: [] }
  if (url && key) existing = await readLicenseeRegistry(url, key)
  else console.error('(no database credentials: planning against an empty registry)')

  const plan = planRegistrySeed(entries, existing)
  const byKind = plan.insert.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {})
  console.log(`${apply ? 'APPLY' : 'DRY_RUN'}  registry ${entries.length} licensees, ${entries.reduce((a, e) => a + e.aliases.length, 0)} aliases`)
  console.log(`  insert ${plan.insert.length} ${JSON.stringify(byKind)}  add-aliases ${plan.addAliases.length}  unchanged ${plan.unchanged}  conflicts ${plan.conflicts.length}  blocked ${plan.blocked.length}`)
  for (const c of plan.conflicts) console.log(`  conflict: alias "${c.alias}" wanted by ${c.wanted} is held by ${c.heldBy}`)

  // Reference documents (owner defaults 8 and 9): the Net-Billing Rules PDF and the URL-only Eskom 2026/27 decision.
  const rulesPath = arg('rules-pdf') ?? (process.env.TARIFF_SOURCE_DIR ? join(process.env.TARIFF_SOURCE_DIR, RULES_PDF) : undefined)
  const rulesBytes = rulesPath && existsSync(rulesPath) ? new Uint8Array(readFileSync(rulesPath)) : null
  if (!rulesBytes) console.error(`(no Net-Billing Rules PDF at ${rulesPath ?? '<unset>'}: pass --rules-pdf or set TARIFF_SOURCE_DIR)`)
  const docs = referenceDocuments({
    netBillingRules: rulesBytes && rulesPath
      ? { sha256: createHash('sha256').update(rulesBytes).digest('hex'), fileName: basename(rulesPath) }
      : null,
  })
  for (const d of docs) {
    const exists = url && key ? await referenceDocumentExists(url, key, d) : false
    console.log(`  reference ${exists ? 'exists' : 'insert'}  ${d.kind}  ${d.title}  ${d.sha256 ? `sha256 ${d.sha256} -> tariff-sources/${d.storagePath}` : `url ${d.url}`}`)
  }

  if (!apply) {
    console.log('Nothing written. Re-run with --apply to seed.')
    return
  }
  await applyLicenseeRegistrySeed(url as string, key as string, plan)
  for (const d of docs) await insertReferenceDocument(url as string, key as string, d, d.sha256 ? rulesBytes : null)
  console.log('Seeded.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
