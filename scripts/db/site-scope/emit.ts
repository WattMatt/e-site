// scripts/db/site-scope/emit.ts
// Usage: npx tsx scripts/db/site-scope/emit.ts [out.sql]
import { writeFileSync } from 'node:fs'
import { generateMigration } from '../../../packages/db/src/site-scope/generate'
const out = process.argv[2] ?? 'scripts/db/site-scope/site_scoped_access.sql'
writeFileSync(out, generateMigration())
console.log(`wrote ${out}`)
