import fs from 'node:fs'; import path from 'node:path'
const dir = path.join(__dirname); const files = fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const SERVICE = /createServiceClient|SUPABASE_SERVICE_ROLE_KEY|service_role/
const ALLOWED_IMPORT = /^(\.\.?\/|@\/lib\/|@\/actions\/|@\/services\/|@esite\/shared|@esite\/db|@modelcontextprotocol\/sdk|@supabase\/supabase-js|zod|server-only|next\/|node:)/
// Same comment-stripping approach as lib/auth/service-client-gates.contract.test.ts: block comments and full-line comments are blanked before matching.
function strip(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n')
}
const read = (f: string) => strip(fs.readFileSync(path.join(dir, f), 'utf8'))
it('only audit.ts touches the service key', () => {
  for (const f of files) { const src = read(f); if (f !== 'audit.ts') expect(src, f).not.toMatch(SERVICE) }
})
it('tool files import only loaders, actions, services and shared packages; no raw queries', () => {
  for (const f of files.filter(f => f.startsWith('tools/'))) {
    const src = read(f)
    for (const m of src.matchAll(/from '([^']+)'/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(ALLOWED_IMPORT)
    expect(src, `${f} runs a raw query`).not.toMatch(/\.from\(['"]/)
  }
})
